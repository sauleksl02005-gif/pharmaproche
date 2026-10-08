const loginView = document.getElementById('loginView');
const dashView = document.getElementById('dashView');
const loginError = document.getElementById('loginError');

async function checkSession() {
  const res = await fetch('/api/session');
  const data = await res.json();
  if (data.authenticated && data.role === 'admin') showDashboard();
}

document.getElementById('loginBtn').addEventListener('click', async () => {
  loginError.textContent = '';
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) { loginError.textContent = data.error || 'Connexion refusée.'; return; }
  showDashboard();
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  dashView.style.display = 'none';
  loginView.style.display = 'block';
});

async function showDashboard() {
  loginView.style.display = 'none';
  dashView.style.display = 'block';
  await loadMeta();
  await loadList();
}

let regionsMap = {};

async function loadMeta() {
  const res = await fetch('/api/meta');
  const data = await res.json();
  regionsMap = data.regions || {};
  const regionSelect = document.getElementById('regionSelect');
  regionSelect.innerHTML = '<option value="">— Nouvelle région —</option>' +
    Object.keys(regionsMap).sort().map(r => `<option value="${escapeAttr(r)}">${escapeHtml(r)}</option>`).join('');
  updateVilleSelect();
}

function updateVilleSelect() {
  const region = document.getElementById('regionSelect').value;
  const villeSelect = document.getElementById('villeSelect');
  const villes = region ? (regionsMap[region] || []) : [];
  villeSelect.innerHTML = '<option value="">— Nouvelle ville —</option>' +
    villes.map(v => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`).join('');
}
document.getElementById('regionSelect').addEventListener('change', updateVilleSelect);

document.getElementById('useMyLocationBtn').addEventListener('click', () => {
  const geoStatus = document.getElementById('geoStatus');
  if (!navigator.geolocation) {
    geoStatus.textContent = "La géolocalisation n'est pas supportée par ce navigateur.";
    return;
  }
  geoStatus.textContent = 'Localisation en cours…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      document.getElementById('lat').value = pos.coords.latitude.toFixed(6);
      document.getElementById('lng').value = pos.coords.longitude.toFixed(6);
      geoStatus.textContent = 'Position actuelle enregistrée dans les champs ci-dessus.';
    },
    (err) => {
      const messages = {
        1: "Localisation refusée — autorise l'accès à la position dans ton navigateur, ou saisis les coordonnées à la main.",
        2: 'Position indisponible pour le moment. Réessaie ou saisis les coordonnées à la main.',
        3: 'La localisation a pris trop de temps. Réessaie.',
      };
      geoStatus.textContent = messages[err.code] || 'Impossible de récupérer la position.';
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttr(s) { return escapeHtml(s); }

async function loadList() {
  const res = await fetch('/api/admin/pharmacies');
  const data = await res.json();
  const results = data.results || [];
  const list = document.getElementById('list');
  list.innerHTML = '';

  const villes = new Set(results.map(p => p.ville));
  let totalMeds = 0;
  results.forEach(p => { totalMeds += Object.keys(p.medicaments).length; });
  document.getElementById('statPharmacies').textContent = results.length;
  document.getElementById('statVilles').textContent = villes.size;
  document.getElementById('statMeds').textContent = totalMeds;

  if (!results.length) {
    list.innerHTML = '<p class="empty">Aucune pharmacie inscrite pour l’instant.</p>';
    return;
  }

  results.forEach(ph => {
    const medCount = Object.keys(ph.medicaments).length;
    const dispoCount = Object.values(ph.medicaments).filter(Boolean).length;
    const card = document.createElement('div');
    card.className = 'card avail';

    const row = document.createElement('div'); row.className = 'row';
    const left = document.createElement('div');
    const h3 = document.createElement('h3'); h3.textContent = ph.nom;
    const meta = document.createElement('div'); meta.className = 'quartier';
    const geoTag = (ph.lat !== null && ph.lng !== null) ? ' · 📍 géolocalisée' : ' · pas encore géolocalisée';
    const phoneTag = ph.telephone ? ` · ☎ ${ph.telephone}` : ' · pas de téléphone renseigné';
    meta.textContent = `${ph.quartier}, ${ph.ville} (${ph.region}) — identifiant : ${ph.username}${geoTag}${phoneTag}`;
    left.appendChild(h3); left.appendChild(meta);
    const status = document.createElement('span'); status.className = 'status avail';
    status.textContent = `${dispoCount}/${medCount} en stock`;
    row.appendChild(left); row.appendChild(status);
    card.appendChild(row);

    const actions = document.createElement('div'); actions.className = 'card-actions';

    const resetBtn = document.createElement('button');
    resetBtn.className = 'ghost'; resetBtn.textContent = 'Réinitialiser le mot de passe';
    resetBtn.addEventListener('click', () => resetPassword(ph.id, ph.nom));

    const delBtn = document.createElement('button');
    delBtn.className = 'ghost danger-btn'; delBtn.textContent = 'Supprimer';
    delBtn.addEventListener('click', () => deletePharmacy(ph.id, ph.nom));

    actions.appendChild(resetBtn); actions.appendChild(delBtn);
    card.appendChild(actions);

    list.appendChild(card);
  });
}

async function resetPassword(id, nom) {
  if (!confirm(`Générer un nouveau mot de passe pour « ${nom} » ? L'ancien cessera de fonctionner immédiatement.`)) return;
  const res = await fetch(`/api/admin/pharmacies/${encodeURIComponent(id)}/reset-password`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Erreur lors de la réinitialisation.'); return; }
  alert(`Nouveau mot de passe pour « ${nom} » (identifiant : ${data.username}) :\n\n${data.newPassword}\n\nNote-le maintenant et transmets-le à la pharmacie : il ne sera plus jamais affiché.`);
}

async function deletePharmacy(id, nom) {
  if (!confirm(`Supprimer définitivement « ${nom} » du réseau ? Cette action est irréversible.`)) return;
  const res = await fetch(`/api/admin/pharmacies/${encodeURIComponent(id)}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Erreur lors de la suppression.'); return; }
  await loadMeta();
  await loadList();
}

document.getElementById('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formError = document.getElementById('formError');
  const formSuccess = document.getElementById('formSuccess');
  formError.textContent = ''; formSuccess.textContent = '';

  const region = document.getElementById('regionNew').value.trim() || document.getElementById('regionSelect').value;
  const ville = document.getElementById('villeNew').value.trim() || document.getElementById('villeSelect').value;
  const medicaments = document.getElementById('medicaments').value.split(',').map(s => s.trim()).filter(Boolean);

  const payload = {
    nom: document.getElementById('nom').value.trim(),
    region, ville,
    quartier: document.getElementById('quartier').value.trim(),
    telephone: document.getElementById('telephone').value.trim(),
    lat: document.getElementById('lat').value.trim(),
    lng: document.getElementById('lng').value.trim(),
    medicaments,
    username: document.getElementById('loginUser').value.trim(),
    password: document.getElementById('loginPass').value,
  };

  if (!payload.region || !payload.ville) {
    formError.textContent = 'Choisis une région/ville existante ou saisis-en une nouvelle.';
    return;
  }

  const res = await fetch('/api/admin/pharmacies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) { formError.textContent = data.error || 'Erreur lors de l’ajout.'; return; }

  formSuccess.textContent = `Pharmacie « ${data.result.nom} » inscrite. Transmets-lui son identifiant et son mot de passe.`;
  e.target.reset();
  document.getElementById('geoStatus').textContent = "Renseigne les coordonnées GPS de l'officine pour permettre aux patients de voir la distance réelle et la pharmacie la plus proche. Sans coordonnées, la pharmacie reste trouvable, mais sans tri par distance.";
  await loadMeta();
  await loadList();
});

checkSession();
