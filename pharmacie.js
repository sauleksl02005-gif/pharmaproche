const loginView = document.getElementById('loginView');
const dashView = document.getElementById('dashView');
const loginError = document.getElementById('loginError');
const stockList = document.getElementById('stockList');
const pharmaNom = document.getElementById('pharmaNom');
const pharmaLieu = document.getElementById('pharmaLieu');

async function checkSession() {
  const res = await fetch('/api/session');
  const data = await res.json();
  if (data.authenticated && data.role === 'pharmacie') showDashboard();
}

document.getElementById('loginBtn').addEventListener('click', async () => {
  loginError.textContent = '';
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const res = await fetch('/api/pharmacie/login', {
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
  await loadMine();
}

async function loadMine() {
  const res = await fetch('/api/pharmacie/me');
  if (!res.ok) { dashView.style.display = 'none'; loginView.style.display = 'block'; return; }
  const data = await res.json();
  const ph = data.result;
  pharmaNom.textContent = ph.nom;
  pharmaLieu.textContent = `${ph.quartier}, ${ph.ville} (${ph.region})`;
  renderStock(ph.medicaments);
}

function renderStock(medicaments) {
  const entries = Object.entries(medicaments);
  const dispo = entries.filter(([, v]) => v).length;
  document.getElementById('statTotal').textContent = entries.length;
  document.getElementById('statDispo').textContent = dispo;
  document.getElementById('statRupture').textContent = entries.length - dispo;

  stockList.innerHTML = '';
  entries.forEach(([name, avail]) => {
    const row = document.createElement('div');
    row.className = 'med-row';
    const span = document.createElement('span'); span.textContent = name;
    const label = document.createElement('label'); label.className = 'switch';
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = !!avail;
    const track = document.createElement('span'); track.className = 'track';
    label.appendChild(input); label.appendChild(track);
    row.appendChild(span); row.appendChild(label);
    stockList.appendChild(row);
    input.addEventListener('change', () => updateMed(name, input.checked));
  });
}

async function updateMed(name, avail) {
  await fetch('/api/pharmacie/medicaments', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ medicaments: { [name]: avail } }),
  });
  await loadMine();
}

document.getElementById('addMedBtn').addEventListener('click', async () => {
  const input = document.getElementById('newMed');
  const name = input.value.trim();
  if (!name) return;
  await updateMed(name, true);
  input.value = '';
});

checkSession();
