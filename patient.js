const searchEl = document.getElementById('search');
const regionEl = document.getElementById('region');
const villeEl = document.getElementById('ville');
const quartierEl = document.getElementById('quartier');
const resultsEl = document.getElementById('results');
const resultCountEl = document.getElementById('resultCount');
const suggestionsEl = document.getElementById('suggestions');
const geoStatusEl = document.getElementById('geoStatus');
const useMyLocationBtn = document.getElementById('useMyLocationBtn');

let regionsMap = {};
let allMedicaments = [];
let activeSuggestionIndex = -1;
let myLat = null;
let myLng = null;

async function loadMeta() {
  const res = await fetch('/api/meta');
  const data = await res.json();
  regionsMap = data.regions || {};
  regionEl.innerHTML = '<option value="">Toutes les régions</option>' +
    Object.keys(regionsMap).sort().map(r => `<option value="${escapeAttr(r)}">${escapeHtml(r)}</option>`).join('');
}

async function loadMedicaments() {
  const res = await fetch('/api/medicaments');
  const data = await res.json();
  allMedicaments = data.medicaments || [];
}

function updateVilleOptions() {
  const region = regionEl.value;
  const villes = region ? (regionsMap[region] || []) : [...new Set(Object.values(regionsMap).flat())].sort();
  villeEl.innerHTML = '<option value="">Toutes les villes</option>' +
    villes.map(v => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`).join('');
}

function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttr(s) { return escapeHtml(s); }
function normalize(s) { return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }

// ---------- Suggestions de recherche ----------

function updateSuggestions() {
  const raw = searchEl.value.trim();
  activeSuggestionIndex = -1;
  if (!raw) { closeSuggestions(); return; }
  const q = normalize(raw);
  const matches = allMedicaments.filter(m => normalize(m).includes(q)).slice(0, 6);
  if (!matches.length) { closeSuggestions(); return; }

  suggestionsEl.innerHTML = '';
  matches.forEach(name => {
    const item = document.createElement('div');
    item.className = 'suggestion-item';
    item.textContent = name;
    item.addEventListener('mousedown', (e) => {
      e.preventDefault(); // évite que le blur de l'input ne ferme la liste avant le clic
      searchEl.value = name;
      closeSuggestions();
      runSearch();
    });
    suggestionsEl.appendChild(item);
  });
  suggestionsEl.classList.add('open');
}

function closeSuggestions() {
  suggestionsEl.classList.remove('open');
  suggestionsEl.innerHTML = '';
  activeSuggestionIndex = -1;
}

function moveSuggestion(delta) {
  const items = [...suggestionsEl.querySelectorAll('.suggestion-item')];
  if (!items.length) return;
  items[activeSuggestionIndex]?.classList.remove('active');
  activeSuggestionIndex = (activeSuggestionIndex + delta + items.length) % items.length;
  items[activeSuggestionIndex].classList.add('active');
  searchEl.value = items[activeSuggestionIndex].textContent;
}

searchEl.addEventListener('keydown', (e) => {
  if (!suggestionsEl.classList.contains('open')) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); moveSuggestion(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); moveSuggestion(-1); }
  else if (e.key === 'Escape') { closeSuggestions(); }
  else if (e.key === 'Enter') { closeSuggestions(); }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.autocomplete-wrap')) closeSuggestions();
});

let debounceTimer;
function scheduleSearch() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => { runSearch(); updateSuggestions(); }, 200);
}

async function runSearch() {
  const medicament = searchEl.value.trim();
  if (!medicament) {
    resultCountEl.style.display = 'none';
    resultsEl.innerHTML = '<p class="empty">Tape le nom d’un médicament pour voir qui l’a en stock.</p>';
    return;
  }
  const params = new URLSearchParams({ medicament, region: regionEl.value, ville: villeEl.value, quartier: quartierEl.value });
  if (myLat !== null && myLng !== null) { params.set('lat', myLat); params.set('lng', myLng); }
  const res = await fetch('/api/search?' + params.toString());
  const data = await res.json();
  renderResults(data.results || [], quartierEl.value.trim().toLowerCase());
}

function renderResults(results, quartier) {
  if (!results.length) {
    resultCountEl.style.display = 'none';
    resultsEl.innerHTML = '<p class="empty">Aucune pharmacie trouvée avec ce médicament pour ces critères.</p>';
    return;
  }
  resultCountEl.style.display = 'block';
  resultCountEl.textContent = results.length + (results.length > 1 ? ' pharmacies trouvées' : ' pharmacie trouvée');
  resultsEl.innerHTML = '';
  results.forEach((ph, i) => {
    const hasDistance = ph.distance_km !== null && ph.distance_km !== undefined;
    const isClosestByQuartier = !hasDistance && i === 0 && quartier && ph.quartier.toLowerCase().includes(quartier);
    const isClosest = (hasDistance && i === 0) || isClosestByQuartier;

    const card = document.createElement('div');
    card.className = 'card avail';
    const row = document.createElement('div');
    row.className = 'row';
    const left = document.createElement('div');
    const h3 = document.createElement('h3'); h3.textContent = ph.nom;
    const meta = document.createElement('div'); meta.className = 'quartier';
    meta.textContent = `${ph.quartier}, ${ph.ville} (${ph.region})` + (hasDistance ? ` · à ${ph.distance_km} km` : '');
    left.appendChild(h3); left.appendChild(meta);
    const status = document.createElement('span');
    status.className = 'status ' + (isClosest ? 'closest' : 'avail');
    status.textContent = isClosest ? 'La plus proche' : 'En stock';
    row.appendChild(left); row.appendChild(status);
    card.appendChild(row);

    const actions = document.createElement('div'); actions.className = 'card-actions';
    if (ph.telephone) {
      const telDigits = ph.telephone.replace(/[^0-9+]/g, '');
      const callLink = document.createElement('a');
      callLink.className = 'ghost'; callLink.href = `tel:${telDigits}`;
      callLink.textContent = '📞 Appeler';
      actions.appendChild(callLink);

      const waLink = document.createElement('a');
      waLink.className = 'ghost'; waLink.href = `https://wa.me/${telDigits.replace('+', '')}`;
      waLink.target = '_blank'; waLink.rel = 'noopener';
      waLink.textContent = '💬 WhatsApp';
      actions.appendChild(waLink);
    }
    if (ph.lat !== null && ph.lng !== null) {
      const dirLink = document.createElement('a');
      dirLink.className = 'ghost'; dirLink.href = `https://www.google.com/maps/dir/?api=1&destination=${ph.lat},${ph.lng}`;
      dirLink.target = '_blank'; dirLink.rel = 'noopener';
      dirLink.textContent = '🧭 Itinéraire';
      actions.appendChild(dirLink);
    }
    if (actions.children.length) card.appendChild(actions);

    resultsEl.appendChild(card);
  });
}

// ---------- Géolocalisation du patient ----------

useMyLocationBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    geoStatusEl.textContent = "La géolocalisation n'est pas supportée par ce navigateur.";
    return;
  }
  geoStatusEl.textContent = 'Localisation en cours…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      myLat = pos.coords.latitude;
      myLng = pos.coords.longitude;
      geoStatusEl.textContent = 'Position détectée — les résultats sont triés par distance réelle.';
      runSearch();
    },
    (err) => {
      const messages = {
        1: "Localisation refusée. Tu peux autoriser l'accès à ta position dans ton navigateur, ou indiquer ton quartier ci-dessus à la place.",
        2: 'Position indisponible pour le moment. Réessaie, ou indique ton quartier à la place.',
        3: 'La localisation a pris trop de temps. Réessaie.',
      };
      geoStatusEl.textContent = messages[err.code] || 'Impossible de récupérer ta position.';
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

searchEl.addEventListener('input', scheduleSearch);
searchEl.addEventListener('focus', updateSuggestions);
quartierEl.addEventListener('input', scheduleSearch);
regionEl.addEventListener('change', () => { updateVilleOptions(); scheduleSearch(); });
villeEl.addEventListener('change', scheduleSearch);

loadMeta().then(updateVilleOptions);
loadMedicaments();
resultsEl.innerHTML = '<p class="empty">Tape le nom d’un médicament pour voir qui l’a en stock.</p>';
