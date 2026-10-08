// PharmaProche — serveur Node.js natif, zéro dépendance npm.
// Stockage JSON fichier, sessions par cookie httpOnly, mots de passe hachés (scrypt).

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PHARMACIES_FILE = path.join(DATA_DIR, 'pharmacies.json');
const ADMINS_FILE = path.join(DATA_DIR, 'admins.json');

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8h
const MAX_BODY_BYTES = 200 * 1024; // 200 Ko : largement assez pour ce JSON, évite les abus
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;

// Les 10 régions du Cameroun, toujours proposées dans la liste déroulante
// même avant qu'une pharmacie n'y soit inscrite.
const CAMEROON_REGIONS = [
  'Adamaoua', 'Centre', 'Est', 'Extrême-Nord', 'Littoral',
  'Nord', 'Nord-Ouest', 'Ouest', 'Sud', 'Sud-Ouest',
];

// ---------- Utilitaires fichiers (écriture atomique pour éviter un JSON corrompu) ----------

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJSON(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file); // rename = opération atomique sur la plupart des systèmes de fichiers
}

// ---------- Mots de passe ----------

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const attempt = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (attempt.length !== expected.length) return false;
  return crypto.timingSafeEqual(attempt, expected); // comparaison à temps constant
}

// ---------- Initialisation des données ----------

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!fs.existsSync(ADMINS_FILE)) {
    const defaultPassword = crypto.randomBytes(9).toString('base64url'); // mot de passe aléatoire, jamais en clair dans le code
    const { salt, hash } = hashPassword(defaultPassword);
    writeJSON(ADMINS_FILE, [{ id: 'a1', username: 'admin', salt, hash }]);
    console.log('========================================');
    console.log('Compte admin créé automatiquement :');
    console.log('  identifiant : admin');
    console.log('  mot de passe : ' + defaultPassword);
    console.log('Notez-le maintenant, il ne sera jamais réaffiché. Changez-le ensuite.');
    console.log('========================================');
  }

  if (!fs.existsSync(PHARMACIES_FILE)) {
    const seedPharmacies = [
      mkPharmacy('Pharmacie du Centre', 'Littoral', 'Douala', 'Bonanjo',
        ['Paracétamol', 'Amoxicilline', 'Oméprazole'], 'pharma.centre', 'ChangeMoi123!', 4.0511, 9.6903, '+237 677 12 34 56'),
      mkPharmacy("Pharmacie de l'Espoir", 'Littoral', 'Douala', 'Akwa',
        ['Paracétamol', 'Insuline', 'Salbutamol'], 'pharma.espoir', 'ChangeMoi123!', 4.0483, 9.6963, '+237 690 23 45 67'),
      mkPharmacy('Pharmacie Saint-Michel', 'Littoral', 'Douala', 'Bepanda',
        ['Amoxicilline', 'Artéméther-Luméfantrine'], 'pharma.stmichel', 'ChangeMoi123!', 4.0670, 9.7350, '+237 655 34 56 78'),
      mkPharmacy('Pharmacie du Plateau', 'Centre', 'Yaoundé', 'Plateau Atemengue',
        ['Paracétamol', 'Métformine', 'Insuline'], 'pharma.plateau', 'ChangeMoi123!', 3.8767, 11.5213, '+237 699 45 67 89'),
    ];
    writeJSON(PHARMACIES_FILE, seedPharmacies);
    console.log('Pharmacies de démonstration créées (mot de passe : ChangeMoi123!) — à changer.');
  }
}

function mkPharmacy(nom, region, ville, quartier, medNames, username, password, lat, lng, telephone) {
  const { salt, hash } = hashPassword(password);
  const medicaments = {};
  medNames.forEach(m => { medicaments[m] = true; });
  return {
    id: crypto.randomUUID(),
    nom, region, ville, quartier,
    lat: typeof lat === 'number' ? lat : null,
    lng: typeof lng === 'number' ? lng : null,
    telephone: telephone || null,
    medicaments,
    username, salt, hash,
  };
}

// Valide un numéro de téléphone saisi par l'admin : chiffres, espaces, + et - uniquement,
// entre 6 et 20 caractères. Renvoie null si vide ou invalide (le champ reste facultatif).
function parsePhone(v) {
  const s = cleanStr(v, 30);
  if (!s) return null;
  if (!/^[0-9+\-() ]{6,30}$/.test(s)) return null;
  return s;
}

// Distance à vol d'oiseau entre deux points GPS, en kilomètres (formule de Haversine).
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Valide une coordonnée GPS envoyée par le client ; renvoie null si absente/invalide.
function parseCoord(v, min, max) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (typeof n !== 'number' || Number.isNaN(n) || n < min || n > max) return null;
  return n;
}

// ---------- Sessions (en mémoire) ----------

const sessions = new Map(); // token -> { role, pharmacyId, expires }

function createSession(role, pharmacyId) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { role, pharmacyId: pharmacyId || null, expires: Date.now() + SESSION_TTL_MS });
  return token;
}

function getSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.session;
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.expires < Date.now()) { sessions.delete(token); return null; }
  return s;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

function setSessionCookie(res, token) {
  const parts = [
    `session=${token}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Strict',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0');
}

// ---------- Anti brute-force sur le login ----------

const loginAttempts = new Map(); // ip -> { count, windowStart }

function isRateLimited(ip) {
  const rec = loginAttempts.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.windowStart > LOGIN_WINDOW_MS) { loginAttempts.delete(ip); return false; }
  return rec.count >= LOGIN_MAX_ATTEMPTS;
}

function registerLoginFailure(ip) {
  const rec = loginAttempts.get(ip);
  if (!rec || Date.now() - rec.windowStart > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, windowStart: Date.now() });
  } else {
    rec.count += 1;
  }
}

function clearLoginFailures(ip) {
  loginAttempts.delete(ip);
}

// ---------- Aides HTTP ----------

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject({ status: 413, message: 'Corps de requête trop volumineux' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject({ status: 400, message: 'JSON invalide' });
      }
    });
    req.on('error', () => reject({ status: 400, message: 'Erreur de lecture' }));
  });
}

// Nettoie une chaîne texte fournie par l'utilisateur : coupe, limite la longueur.
function cleanStr(v, maxLen) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, maxLen || 100);
}

// Normalise pour une comparaison insensible aux accents et à la casse
// (permet de trouver "Paracétamol" en tapant "paracetamol").
function normalize(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function clientIp(req) {
  return req.socket.remoteAddress || 'unknown';
}

// Vue publique d'une pharmacie : jamais de salt/hash/username exposés aux patients.
function publicPharmacy(p) {
  return {
    id: p.id, nom: p.nom, region: p.region, ville: p.ville, quartier: p.quartier,
    lat: p.lat ?? null, lng: p.lng ?? null, telephone: p.telephone ?? null,
    medicaments: p.medicaments,
  };
}

// Vue admin : ajoute l'identifiant de connexion (utile pour gérer le compte),
// mais jamais le mot de passe — il est haché, donc irrécupérable par construction.
function adminPharmacyView(p) {
  return { ...publicPharmacy(p), username: p.username };
}

// ---------- Fichiers statiques ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Interdit'); }
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Introuvable'); }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      // 'self' pour tout par défaut ; on autorise en plus : polices Google (style-src/font-src),
      // les favicons en data URI (img-src), et les attributs style="" utilisés pour l'affichage
      // conditionnel (style-src 'unsafe-inline' — les scripts, eux, restent strictement 'self').
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'",
    });
    res.end(content);
  });
}

// ---------- Routeur API ----------

async function handleApi(req, res, pathname, query) {
  // GET /api/meta — régions/villes connues, pour peupler les listes déroulantes
  if (pathname === '/api/meta' && req.method === 'GET') {
    const pharmacies = readJSON(PHARMACIES_FILE, []);
    const map = {};
    CAMEROON_REGIONS.forEach(r => { map[r] = new Set(); }); // toujours proposées, même vides
    pharmacies.forEach(p => {
      if (!map[p.region]) map[p.region] = new Set();
      map[p.region].add(p.ville);
    });
    const regions = Object.fromEntries(Object.entries(map).map(([r, s]) => [r, [...s].sort()]));
    return sendJSON(res, 200, { regions });
  }

  // GET /api/medicaments — liste des noms connus dans le réseau, pour les suggestions de recherche
  if (pathname === '/api/medicaments' && req.method === 'GET') {
    const pharmacies = readJSON(PHARMACIES_FILE, []);
    const names = new Set();
    pharmacies.forEach(p => Object.keys(p.medicaments).forEach(m => names.add(m)));
    return sendJSON(res, 200, { medicaments: [...names].sort((a, b) => a.localeCompare(b)) });
  }

  // GET /api/search?medicament=&region=&ville=&quartier=&lat=&lng=
  if (pathname === '/api/search' && req.method === 'GET') {
    const medicament = normalize(cleanStr(query.medicament, 100));
    const region = cleanStr(query.region, 100);
    const ville = cleanStr(query.ville, 100);
    const quartier = normalize(cleanStr(query.quartier, 100));
    const patientLat = parseCoord(query.lat, -90, 90);
    const patientLng = parseCoord(query.lng, -180, 180);
    if (!medicament) return sendJSON(res, 200, { results: [] });

    const pharmacies = readJSON(PHARMACIES_FILE, []);
    let results = pharmacies.filter(p => {
      if (region && p.region !== region) return false;
      if (ville && p.ville !== ville) return false;
      const medKey = Object.keys(p.medicaments).find(m => normalize(m).includes(medicament));
      return !!medKey && p.medicaments[medKey] === true;
    });

    // Distance réelle si le patient a partagé sa position ET que la pharmacie a des coordonnées.
    const withDistance = results.map(p => {
      const distance_km = (patientLat !== null && patientLng !== null && p.lat !== null && p.lng !== null)
        ? Math.round(distanceKm(patientLat, patientLng, p.lat, p.lng) * 10) / 10
        : null;
      return { pharmacy: p, distance_km };
    });

    // Tri : distance réelle en priorité (les pharmacies sans coordonnées passent après),
    // sinon le quartier saisi sert d'indice de proximité approximatif, sinon ordre alphabétique.
    withDistance.sort((a, b) => {
      if (a.distance_km !== null && b.distance_km !== null) return a.distance_km - b.distance_km;
      if (a.distance_km !== null) return -1;
      if (b.distance_km !== null) return 1;
      const aMatch = quartier && normalize(a.pharmacy.quartier).includes(quartier) ? 0 : 1;
      const bMatch = quartier && normalize(b.pharmacy.quartier).includes(quartier) ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      return a.pharmacy.nom.localeCompare(b.pharmacy.nom);
    });

    return sendJSON(res, 200, {
      results: withDistance.map(({ pharmacy, distance_km }) => ({ ...publicPharmacy(pharmacy), distance_km })),
    });
  }

  // POST /api/admin/login
  if (pathname === '/api/admin/login' && req.method === 'POST') {
    return handleLogin(req, res, 'admin');
  }
  // POST /api/pharmacie/login
  if (pathname === '/api/pharmacie/login' && req.method === 'POST') {
    return handleLogin(req, res, 'pharmacie');
  }
  // POST /api/logout
  if (pathname === '/api/logout' && req.method === 'POST') {
    clearSessionCookie(res);
    return sendJSON(res, 200, { ok: true });
  }

  // GET /api/session — pour que le front sache qui est connecté
  if (pathname === '/api/session' && req.method === 'GET') {
    const s = getSession(req);
    if (!s) return sendJSON(res, 200, { authenticated: false });
    return sendJSON(res, 200, { authenticated: true, role: s.role, pharmacyId: s.pharmacyId });
  }

  // ---- Routes admin (auth requise) ----
  if (pathname === '/api/admin/pharmacies' && req.method === 'GET') {
    const s = requireRole(req, res, 'admin'); if (!s) return;
    const pharmacies = readJSON(PHARMACIES_FILE, []);
    return sendJSON(res, 200, { results: pharmacies.map(adminPharmacyView) });
  }

  if (pathname === '/api/admin/pharmacies' && req.method === 'POST') {
    const s = requireRole(req, res, 'admin'); if (!s) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, e.status || 400, { error: e.message }); }

    const nom = cleanStr(body.nom, 150);
    const region = cleanStr(body.region, 100);
    const ville = cleanStr(body.ville, 100);
    const quartier = cleanStr(body.quartier, 100);
    const username = cleanStr(body.username, 60);
    const password = typeof body.password === 'string' ? body.password : '';
    const medicaments = Array.isArray(body.medicaments) ? body.medicaments.map(m => cleanStr(m, 100)).filter(Boolean) : [];
    const lat = parseCoord(body.lat, -90, 90);
    const telephone = parsePhone(body.telephone);
    const lng = parseCoord(body.lng, -180, 180);

    if (!nom || !region || !ville || !quartier || !username || password.length < 8) {
      return sendJSON(res, 400, { error: 'Champs invalides : nom, région, ville, quartier, identifiant obligatoires, mot de passe ≥ 8 caractères.' });
    }
    if (typeof body.telephone === 'string' && body.telephone.trim() && telephone === null) {
      return sendJSON(res, 400, { error: 'Numéro de téléphone invalide (chiffres, espaces, + et - uniquement, 6 à 30 caractères).' });
    }

    const pharmacies = readJSON(PHARMACIES_FILE, []);
    if (pharmacies.some(p => p.username === username)) {
      return sendJSON(res, 409, { error: 'Cet identifiant pharmacie existe déjà.' });
    }

    const { salt, hash } = hashPassword(password);
    const medObj = {};
    medicaments.forEach(m => { medObj[m] = true; });

    const newPharmacy = { id: crypto.randomUUID(), nom, region, ville, quartier, lat, lng, telephone, medicaments: medObj, username, salt, hash };
    pharmacies.push(newPharmacy);
    writeJSON(PHARMACIES_FILE, pharmacies);
    return sendJSON(res, 201, { result: adminPharmacyView(newPharmacy) });
  }

  // DELETE /api/admin/pharmacies/:id — retire une pharmacie du réseau
  if (pathname.startsWith('/api/admin/pharmacies/') && req.method === 'DELETE') {
    const s = requireRole(req, res, 'admin'); if (!s) return;
    const id = decodeURIComponent(pathname.slice('/api/admin/pharmacies/'.length));
    const pharmacies = readJSON(PHARMACIES_FILE, []);
    const idx = pharmacies.findIndex(p => p.id === id);
    if (idx === -1) return sendJSON(res, 404, { error: 'Pharmacie introuvable.' });
    const [removed] = pharmacies.splice(idx, 1);
    writeJSON(PHARMACIES_FILE, pharmacies);
    return sendJSON(res, 200, { ok: true, id: removed.id });
  }

  // POST /api/admin/pharmacies/:id/reset-password
  // Les mots de passe sont hachés (voir hashPassword) : impossible et non souhaitable de les
  // "afficher" une fois créés. La réinitialisation est l'équivalent sûr : on génère un nouveau
  // mot de passe, renvoyé UNE SEULE FOIS dans cette réponse pour que l'admin le transmette à la
  // pharmacie ; il n'est jamais stocké en clair ni ré-affichable ensuite.
  if (pathname.endsWith('/reset-password') && pathname.startsWith('/api/admin/pharmacies/') && req.method === 'POST') {
    const s = requireRole(req, res, 'admin'); if (!s) return;
    const id = decodeURIComponent(pathname.slice('/api/admin/pharmacies/'.length, -'/reset-password'.length));
    const pharmacies = readJSON(PHARMACIES_FILE, []);
    const idx = pharmacies.findIndex(p => p.id === id);
    if (idx === -1) return sendJSON(res, 404, { error: 'Pharmacie introuvable.' });

    const newPassword = crypto.randomBytes(9).toString('base64url');
    const { salt, hash } = hashPassword(newPassword);
    pharmacies[idx].salt = salt;
    pharmacies[idx].hash = hash;
    writeJSON(PHARMACIES_FILE, pharmacies);
    return sendJSON(res, 200, { ok: true, username: pharmacies[idx].username, newPassword });
  }

  // ---- Routes pharmacien (auth requise, uniquement sur SA pharmacie) ----
  if (pathname === '/api/pharmacie/me' && req.method === 'GET') {
    const s = requireRole(req, res, 'pharmacie'); if (!s) return;
    const pharmacies = readJSON(PHARMACIES_FILE, []);
    const mine = pharmacies.find(p => p.id === s.pharmacyId);
    if (!mine) return sendJSON(res, 404, { error: 'Pharmacie introuvable' });
    return sendJSON(res, 200, { result: publicPharmacy(mine) });
  }

  if (pathname === '/api/pharmacie/medicaments' && req.method === 'PUT') {
    const s = requireRole(req, res, 'pharmacie'); if (!s) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, e.status || 400, { error: e.message }); }

    const pharmacies = readJSON(PHARMACIES_FILE, []);
    const idx = pharmacies.findIndex(p => p.id === s.pharmacyId);
    if (idx === -1) return sendJSON(res, 404, { error: 'Pharmacie introuvable' });

    // body.medicaments = { "Paracétamol": true, "NouveauMédicament": false, ... }
    if (body.medicaments && typeof body.medicaments === 'object' && !Array.isArray(body.medicaments)) {
      Object.entries(body.medicaments).forEach(([name, avail]) => {
        const key = cleanStr(name, 100);
        if (!key) return;
        pharmacies[idx].medicaments[key] = !!avail;
      });
    }
    writeJSON(PHARMACIES_FILE, pharmacies);
    return sendJSON(res, 200, { result: publicPharmacy(pharmacies[idx]) });
  }

  sendJSON(res, 404, { error: 'Route inconnue' });
}

async function handleLogin(req, res, role) {
  const ip = clientIp(req);
  if (isRateLimited(ip)) {
    return sendJSON(res, 429, { error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
  }
  let body;
  try { body = await readBody(req); } catch (e) { return sendJSON(res, e.status || 400, { error: e.message }); }

  const username = cleanStr(body.username, 60);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password) return sendJSON(res, 400, { error: 'Identifiant et mot de passe requis.' });

  if (role === 'admin') {
    const admins = readJSON(ADMINS_FILE, []);
    const admin = admins.find(a => a.username === username);
    if (!admin || !verifyPassword(password, admin.salt, admin.hash)) {
      registerLoginFailure(ip);
      return sendJSON(res, 401, { error: 'Identifiants invalides.' });
    }
    clearLoginFailures(ip);
    const token = createSession('admin');
    setSessionCookie(res, token);
    return sendJSON(res, 200, { ok: true, role: 'admin' });
  }

  // role === 'pharmacie'
  const pharmacies = readJSON(PHARMACIES_FILE, []);
  const pharma = pharmacies.find(p => p.username === username);
  if (!pharma || !verifyPassword(password, pharma.salt, pharma.hash)) {
    registerLoginFailure(ip);
    return sendJSON(res, 401, { error: 'Identifiants invalides.' });
  }
  clearLoginFailures(ip);
  const token = createSession('pharmacie', pharma.id);
  setSessionCookie(res, token);
  return sendJSON(res, 200, { ok: true, role: 'pharmacie', pharmacyId: pharma.id, nom: pharma.nom });
}

function requireRole(req, res, role) {
  const s = getSession(req);
  if (!s || s.role !== role) {
    sendJSON(res, 401, { error: 'Authentification requise.' });
    return null;
  }
  return s;
}

// ---------- Serveur ----------

ensureDataFiles();

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  try {
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname, parsed.query);
    } else {
      serveStatic(req, res, pathname);
    }
  } catch (err) {
    console.error(err);
    sendJSON(res, 500, { error: 'Erreur serveur' });
  }
});

server.listen(PORT, () => {
  console.log(`PharmaProche — serveur démarré sur http://localhost:${PORT}`);
});
