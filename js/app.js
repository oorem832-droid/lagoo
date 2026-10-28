'use strict';
/* =====================================================================
   Lagoo : single-page app (no build step) on top of Supabase

   Model: the ADMIN publishes every listing. Visitors send a request;
   the admin checks availability with the owner, then connects both sides.
   ===================================================================== */

const CFG = window.APP_CONFIG || {};
const configured = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && !CFG.SUPABASE_URL.includes('YOUR-'));
const sb = configured ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;
const WA_NUMBER = String(CFG.WHATSAPP_NUMBER || '').replace(/\D/g, '');
const WA_OK = WA_NUMBER.length >= 8 && !/^225X+$/i.test(String(CFG.WHATSAPP_NUMBER || ''));

const COMMUNES = ['Abobo','Adjamé','Anyama','Attécoubé','Bingerville','Cocody','Koumassi','Marcory','Plateau','Port-Bouët','Songon','Treichville','Yopougon'];
// Suggestions only (shown in the admin form). The public filter lists the quartiers that really have listings.
const QUARTIERS_BY_COMMUNE = {
  'Cocody': ['Angré', 'Riviera 2', 'Riviera 3', 'Riviera Palmeraie', 'Riviera Golf', 'Deux-Plateaux', 'Deux-Plateaux Vallons', 'Danga', 'Blockhauss', 'Saint-Jean', 'Ambassades'],
  'Marcory': ['Zone 4', 'Biétry', 'Résidentiel', 'Anoumabo'],
  'Koumassi': ['Remblais', 'Prodomo', 'Sicogi'],
  'Yopougon': ['Niangon', 'Siporex', 'Toits Rouges', 'Selmer', 'Sideci'],
  'Abobo': ['Abobo-Gare', 'Baoulé', 'PK18', 'Avocatier'],
  'Adjamé': ['Williamsville', '220 Logements', 'Liberté'],
  'Treichville': ['Biafra', 'Arras', 'Zone 3'],
  'Attécoubé': ['Locodjro', 'Agban'],
  'Bingerville': ['Bingerville Centre', 'Féh Kessé', 'Akandjé'],
  'Port-Bouët': ['Vridi', 'Gonzagueville'],
  'Plateau': ['Plateau Centre']
};
const LISTING_TYPES = { rent: 'Location', sale: 'Vente', short_stay: 'Séjour court' };
const PROPERTY_TYPES = { apartment: 'Appartement', villa: 'Villa', studio: 'Studio', house: 'Maison', room: 'Chambre', hotel: 'Hôtel', residence: 'Résidence meublée', land: 'Terrain', office: 'Bureau' };
const AMENITIES = { wifi: 'WiFi', parking: 'Parking', pool: 'Piscine', security: 'Gardiennage', generator: 'Groupe électrogène', ac: 'Climatisation', water: 'Eau 24h/24', balcony: 'Balcon', garden: 'Jardin', gym: 'Salle de sport', kitchen: 'Cuisine équipée', tv: 'TV / Canal+' };
const LEAD_STATUS = { new: 'Nouvelle', checking: 'Vérification propriétaire', available: 'Disponible', introduced: 'Mise en relation faite', signed: 'Conclue', lost: 'Perdue' };
const OPEN_LEADS = ['new', 'checking', 'available', 'introduced'];
const PAGE_SIZE = 12;
const MAX_PHOTOS = 10;

let user = null;
let profile = null;
let postFiles = [];      // new photos picked in the admin form: { blob, url }
let adminPhotos = [];    // existing photos of the listing being edited
let editingOwner = null;

const view = document.getElementById('view');

/* ---------- helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('fr-FR');
const money = n => nf.format(n).replace(/ | /g, ' ') + ' FCFA';
const unit = t => (t === 'rent' ? '/mois' : t === 'short_stay' ? '/nuit' : '');
const publicUrl = path => sb.storage.from('listing-photos').getPublicUrl(path).data.publicUrl;
const skeletons = n => '<div class="grid">' + '<div class="skeleton"></div>'.repeat(n) + '</div>';
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const val = id => document.getElementById(id)?.value.trim() || '';
const isAdmin = () => profile?.role === 'admin';
const digits = s => String(s || '').replace(/\D/g, '');
const waLink = (number, text) => `https://wa.me/${digits(number)}?text=${encodeURIComponent(text)}`;
const telLink = number => 'tel:+' + digits(number);
const isExpired = l => l.paid_until && l.paid_until < new Date().toISOString().slice(0, 10);

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3200);
}
function timeAgo(iso) {
  const d = new Date(iso), s = (Date.now() - d) / 1000;
  if (s < 60) return "à l'instant";
  if (s < 3600) return Math.floor(s / 60) + ' min';
  if (s < 86400) return Math.floor(s / 3600) + ' h';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

/* ---------- boot ---------- */
(async function boot() {
  document.getElementById('burger').addEventListener('click', () => {
    const m = document.getElementById('mobileMenu'), open = m.classList.toggle('open');
    document.getElementById('burger').setAttribute('aria-expanded', open);
  });
  if (!configured) {
    const b = document.getElementById('configBanner');
    b.hidden = false;
    b.innerHTML = '⚠ Le site n\'est pas encore relié à Supabase. Ouvrez <code>js/config.js</code> et collez votre URL et votre clé « anon ».';
    updateNav();
    view.innerHTML = '<div class="page"><div class="panel empty"><b>Configuration requise</b>Suivez le guide README.md, étape 3, puis rechargez cette page.</div></div>';
    return;
  }
  const { data: { session } } = await sb.auth.getSession();
  user = session?.user || null;
  if (user) await loadProfile();
  sb.auth.onAuthStateChange((event, session) => {
    // never await Supabase calls directly inside this callback (can deadlock): defer them
    setTimeout(async () => {
      user = session?.user || null;
      if (user) await loadProfile(); else profile = null;
      updateNav();
      if (event === 'PASSWORD_RECOVERY') {
        const pw = prompt('Choisissez un nouveau mot de passe (8 caractères minimum) :');
        if (pw && pw.length >= 8) { const { error } = await sb.auth.updateUser({ password: pw }); toast(error ? error.message : 'Mot de passe mis à jour.'); }
      }
    }, 0);
  });
  updateNav();
  window.addEventListener('hashchange', route);
  route();
})();

async function loadProfile() {
  const { data } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  profile = data;
}

/* ---------- navigation ---------- */
function updateNav() {
  const right = document.getElementById('navRight');
  const mm = document.getElementById('mobileMenu');
  const first = (profile?.full_name || user?.email || '').split(' ')[0];
  const common = `<a href="#/search?type=rent">Louer</a><a href="#/search?type=sale">Acheter</a><a href="#/search?type=short_stay">Séjours courts</a><a href="#/owners">Proposer mon bien</a>`;
  if (user) {
    right.innerHTML = `
      ${isAdmin() ? '<a class="btn btn-teal btn-sm" href="#/admin">Administration<span class="badge" id="newleads" hidden></span></a>' : ''}
      <a class="btn btn-line btn-sm" href="#/account">${esc(first)}</a>
      <button class="btn btn-line btn-sm" onclick="logout()">Déconnexion</button>`;
    mm.innerHTML = common + (isAdmin() ? '<a href="#/admin">Administration</a>' : '') + '<a href="#/account">Mon espace</a><button onclick="logout()">Déconnexion</button>';
    if (isAdmin()) refreshNewLeads();
  } else {
    right.innerHTML = `<a class="btn btn-primary btn-sm" href="#/owners">Proposer mon bien</a>`; // visitors need no account; admin login lives in the footer
    mm.innerHTML = common;
  }
  mm.querySelectorAll('a,button').forEach(el => el.addEventListener('click', () => mm.classList.remove('open')));
}
async function refreshNewLeads() {
  if (!isAdmin()) return;
  const { count } = await sb.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'new');
  document.querySelectorAll('#newleads').forEach(b => { b.hidden = !count; b.textContent = count || ''; });
}

function route() {
  const raw = location.hash || '#/';
  if (/access_token=|type=recovery|error_description=/.test(raw)) return; // Supabase auth redirect, handled by the SDK
  const [path, qs] = raw.slice(1).split('?');
  const params = new URLSearchParams(qs || '');
  const parts = path.split('/').filter(Boolean);
  window.scrollTo(0, 0);
  const r = parts[0] || '';
  if (r === '') return viewHome();
  if (r === 'search') return viewSearch(params);
  if (r === 'listing' && parts[1]) return viewListing(parts[1]);
  if (r === 'owners') return viewOwnersPage();
  if (r === 'account') return viewAccount(params.get('tab') || 'favs');
  if (r === 'admin') {
    if (parts[1] === 'new') return viewAdminForm(null);
    if (parts[1] === 'edit' && parts[2]) return viewAdminForm(parseInt(parts[2], 10));
    return viewAdmin(params.get('tab') || 'leads');
  }
  view.innerHTML = '<div class="page"><div class="panel empty"><b>Page introuvable</b><a class="btn btn-teal" href="#/">Retour à l\'accueil</a></div></div>';
}

/* ---------- auth ---------- */
function requireAuth(nextHash) {
  if (user) { location.hash = nextHash; return true; }
  sessionStorage.setItem('afterLogin', nextHash || location.hash);
  openAuth('login');
  return false;
}
function closeAuth() { document.getElementById('authOverlay').hidden = true; }
function openAuth(mode) {
  const body = document.getElementById('authBody');
  document.getElementById('authOverlay').hidden = false;
  if (mode === 'login') {
    body.innerHTML = `
      <h2 id="authTitle">Connexion</h2>
      <div class="field"><label for="a-email">Email</label><input id="a-email" type="email" autocomplete="email"></div>
      <div class="field"><label for="a-pass">Mot de passe</label><input id="a-pass" type="password" autocomplete="current-password"></div>
      <p class="err" id="a-err"></p>
      <button class="btn btn-primary btn-block" id="a-go" onclick="doLogin()">Se connecter</button>
      <p class="switch"><button onclick="doReset()">Mot de passe oublié ?</button></p>
      <p class="switch">Pas de compte ? <button onclick="openAuth('register')">Créer un compte</button></p>`;
  } else {
    body.innerHTML = `
      <h2 id="authTitle">Créer un compte</h2>
      <p class="hint" style="margin-bottom:12px">Un compte vous permet d'enregistrer vos annonces favorites.</p>
      <div class="field"><label for="a-name">Nom complet</label><input id="a-name" autocomplete="name"></div>
      <div class="field"><label for="a-email">Email</label><input id="a-email" type="email" autocomplete="email"></div>
      <div class="field"><label for="a-phone">Téléphone (optionnel)</label><input id="a-phone" type="tel" placeholder="+225 07 00 00 00 00" autocomplete="tel"></div>
      <div class="field"><label for="a-pass">Mot de passe (8 caractères min.)</label><input id="a-pass" type="password" autocomplete="new-password"></div>
      <p class="err" id="a-err"></p>
      <button class="btn btn-primary btn-block" id="a-go" onclick="doRegister()">Créer mon compte</button>
      <p class="switch">Déjà inscrit ? <button onclick="openAuth('login')">Se connecter</button></p>`;
  }
  setTimeout(() => document.getElementById(mode === 'login' ? 'a-email' : 'a-name')?.focus(), 30);
}
async function afterAuth(newUser) {
  user = newUser; await loadProfile(); updateNav();
  closeAuth();
  const next = sessionStorage.getItem('afterLogin');
  sessionStorage.removeItem('afterLogin');
  if (next && next !== location.hash) location.hash = next; else route();
}
async function doLogin() {
  const err = document.getElementById('a-err'), btn = document.getElementById('a-go');
  err.textContent = ''; btn.disabled = true;
  const { data, error } = await sb.auth.signInWithPassword({ email: val('a-email'), password: document.getElementById('a-pass').value });
  btn.disabled = false;
  if (error) { err.textContent = error.message.includes('Invalid login') ? 'Email ou mot de passe incorrect.' : error.message; return; }
  toast('Connexion réussie.');
  afterAuth(data.user);
}
async function doRegister() {
  const err = document.getElementById('a-err'), btn = document.getElementById('a-go');
  err.textContent = '';
  const pass = document.getElementById('a-pass').value;
  if (!val('a-name') || !val('a-email')) { err.textContent = 'Nom et email obligatoires.'; return; }
  if (pass.length < 8) { err.textContent = 'Le mot de passe doit contenir au moins 8 caractères.'; return; }
  btn.disabled = true;
  const { data, error } = await sb.auth.signUp({
    email: val('a-email'), password: pass,
    options: { data: { full_name: val('a-name'), phone: val('a-phone') }, emailRedirectTo: location.origin + location.pathname }
  });
  btn.disabled = false;
  if (error) { err.textContent = error.message; return; }
  if (!data.session) {
    document.getElementById('authBody').innerHTML = `<h2>Vérifiez vos emails</h2><p>Nous avons envoyé un lien de confirmation à <b>${esc(val('a-email'))}</b>. Cliquez dessus, puis revenez vous connecter.</p>`;
    return;
  }
  toast('Compte créé. Bienvenue !');
  afterAuth(data.user);
}
async function doReset() {
  const email = val('a-email');
  if (!email) { document.getElementById('a-err').textContent = 'Saisissez votre email ci-dessus, puis cliquez à nouveau.'; return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  document.getElementById('a-err').textContent = error ? error.message : 'Email de réinitialisation envoyé.';
}
async function logout() {
  await sb.auth.signOut();
  user = null; profile = null; updateNav();
  toast('Vous êtes déconnecté.');
  location.hash = '#/';
  route();
}

/* ---------- shared: photos, favourites, cards ---------- */
async function photoMap(ids) {
  if (!ids.length) return {};
  const { data } = await sb.from('listing_photos').select('listing_id,path,position').in('listing_id', ids).order('position');
  const m = {};
  (data || []).forEach(r => { if (!(r.listing_id in m)) m[r.listing_id] = publicUrl(r.path); });
  return m;
}
async function favSet(ids) {
  if (!user || !ids.length) return new Set();
  const { data } = await sb.from('favourites').select('listing_id').eq('user_id', user.id).in('listing_id', ids);
  return new Set((data || []).map(r => r.listing_id));
}
function cardHTML(l, img, faved) {
  const facts = [
    l.bedrooms > 0 ? `${l.bedrooms} ch.` : (['studio', 'room'].includes(l.property_type) ? PROPERTY_TYPES[l.property_type] : null),
    l.area_sqm > 0 ? `${l.area_sqm} m²` : null,
    l.furnished ? 'Meublé' : null,
    l.listing_type === 'short_stay' && l.max_guests ? `${l.max_guests} voyageurs` : null
  ].filter(Boolean);
  return `
  <a class="lcard" href="#/listing/${l.id}">
    <div class="lcard-img">
      ${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : esc(PROPERTY_TYPES[l.property_type] || '')}
      <span class="chip ${esc(l.listing_type)}">${esc(LISTING_TYPES[l.listing_type])}</span>
      ${l.verified ? '<span class="vbadge">✓ Vérifié</span>' : ''}
      ${user ? `<button class="fav" aria-label="Enregistrer en favori" onclick="event.preventDefault();event.stopPropagation();toggleFav(${l.id},this)">${faved ? '❤️' : '🤍'}</button>` : ''}
    </div>
    <div class="lcard-body">
      <div class="price">${money(l.price)}<small> ${unit(l.listing_type)}</small></div>
      <div class="lcard-title">${esc(l.title)}</div>
      <div class="loc">📍 ${esc(l.quartier ? l.quartier + ', ' : '')}${esc(l.commune)} · Réf. ${l.id}</div>
      <div class="facts">${facts.map(f => `<span class="fact">${esc(f)}</span>`).join('')}</div>
    </div>
  </a>`;
}
async function fillCards(container, rows, emptyHtml) {
  if (!rows.length) { container.innerHTML = emptyHtml || ''; return; }
  const ids = rows.map(r => r.id);
  const [imgs, favs] = await Promise.all([photoMap(ids), favSet(ids)]);
  container.innerHTML = '<div class="grid">' + rows.map(l => cardHTML(l, imgs[l.id], favs.has(l.id))).join('') + '</div>';
}
async function toggleFav(id, btn) {
  if (!user) return requireAuth(location.hash);
  const on = btn.textContent.trim() === '❤️';
  const { error } = on
    ? await sb.from('favourites').delete().eq('user_id', user.id).eq('listing_id', id)
    : await sb.from('favourites').insert({ user_id: user.id, listing_id: id });
  if (error) return toast('Action impossible : ' + error.message);
  btn.textContent = on ? '🤍' : '❤️';
}

/* =====================================================================
   PUBLIC PAGES
   ===================================================================== */

/* ---------- HOME ---------- */
let heroType = 'rent';
async function viewHome() {
  view.innerHTML = `
    <section class="hero"><div class="hero-in">
      <h1>Trouvez votre chez-vous à <u>Abidjan</u></h1>
      <p class="lead">Locations, ventes et séjours courts : des annonces réelles, publiées et suivies par notre équipe.</p>
      <div class="searchcard">
        <div class="seg" role="tablist">
          <button class="on" data-t="rent">Louer</button><button data-t="sale">Acheter</button><button data-t="short_stay">Séjours courts</button>
        </div>
        <h2 id="h-title">Rechercher des biens à louer</h2>
        <div class="herosearch">
          <div class="where">
            <input id="h-q" placeholder="Commune ou quartier (ex : Cocody, Angré)" aria-label="Commune ou quartier" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="h-sugg">
            <ul id="h-sugg" class="sugg" role="listbox" hidden></ul>
          </div>
        </div>
        <div class="hero-opts">
          <label>Budget maximum<select id="h-max" aria-label="Budget maximum"></select></label>
          <label>Chambres (min.)<select id="h-beds" aria-label="Chambres minimum"><option value="">Indifférent</option>${[1, 2, 3, 4, 5].map(n => `<option value="${n}">${n}+</option>`).join('')}</select></label>
          <button class="btn btn-primary" id="h-go">Rechercher</button>
        </div>
      </div>
    </div></section>
    <div class="wrap">
      <section class="section"><div class="trust">
        <div><b>Annonces publiées par notre équipe</b><p>Chaque bien est ajouté par nous, pas par des inconnus.</p></div>
        <div><b>Aucun paiement demandé</b><p>Ce site ne vous demande jamais d'argent. Ne payez rien avant d'avoir visité.</p></div>
        <div><b>Disponibilité confirmée</b><p>Nous vérifions auprès du propriétaire avant de vous mettre en relation.</p></div>
      </div></section>
      <section class="section" style="padding-top:0"><div class="promos">
        <a class="promo" href="#/search?type=rent"><small>Location</small><b>Louer à Abidjan</b><p>Appartements, villas et studios à louer, du Plateau à Bingerville.</p><span>Voir les locations →</span></a>
        <a class="promo" href="#/search?type=sale"><small>Vente</small><b>Acheter un bien</b><p>Maisons, terrains et appartements en vente dans toutes les communes.</p><span>Voir les ventes →</span></a>
        <a class="promo" href="#/search?type=short_stay"><small>Séjours courts</small><b>Hôtels et résidences meublées</b><p>Pour quelques nuits ou quelques semaines, prêts à vivre.</p><span>Voir les séjours →</span></a>
      </div></section>
      <section class="section" style="padding-top:0">
        <div class="section-head"><h2>Dernières annonces</h2><a href="#/search">Tout voir →</a></div>
        <div id="latest">${skeletons(4)}</div>
      </section>
      <section class="section" style="padding-top:0"><div class="cta-band">
        <div><h3>Vous avez un bien à louer, vendre ou proposer en séjour court ?</h3><p>Confiez-nous votre annonce : nous la publions et vous envoyons des clients sérieux.</p></div>
        <a class="btn btn-primary" href="#/owners">Proposer mon bien</a>
      </div></section>
    </div>`;
  heroType = 'rent';
  const HERO_BUDGETS = { rent: [50000, 100000, 150000, 200000, 300000, 500000, 1000000], sale: [10000000, 25000000, 50000000, 100000000, 200000000, 500000000], short_stay: [15000, 25000, 40000, 60000, 100000, 150000] };
  const HERO_TITLES = { rent: 'Rechercher des biens à louer', sale: 'Rechercher des biens à acheter', short_stay: 'Rechercher un séjour court' };
  const fillBudget = () => {
    const unitTxt = unit(heroType);
    document.getElementById('h-max').innerHTML = '<option value="">Pas de limite</option>' + HERO_BUDGETS[heroType].map(v => `<option value="${v}">${fmtNum(v)} FCFA${unitTxt}</option>`).join('');
    document.getElementById('h-title').textContent = HERO_TITLES[heroType];
  };
  fillBudget();
  view.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
    heroType = b.dataset.t;
    view.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x === b));
    fillBudget();
  }));
  // place suggestions: communes + known quartiers, matched while typing (accents and case ignored)
  const norm = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const PLACES = [
    ...COMMUNES.map(c => ({ label: c, sub: 'Commune', commune: c, quartier: '' })),
    ...Object.entries(QUARTIERS_BY_COMMUNE).flatMap(([c, qs]) => qs.map(qt => ({ label: qt, sub: c, commune: c, quartier: qt })))
  ];
  const inp = document.getElementById('h-q'), box = document.getElementById('h-sugg');
  let picked = null, active = -1, shown = [];
  const matches = t => {
    const n = norm(t);
    if (!n) return PLACES.filter(x => !x.quartier).slice(0, 8);
    const starts = PLACES.filter(x => norm(x.label).startsWith(n)), has = PLACES.filter(x => !norm(x.label).startsWith(n) && norm(x.label).includes(n));
    return [...starts, ...has].slice(0, 8);
  };
  const render = () => {
    shown = matches(inp.value); active = -1;
    box.innerHTML = shown.map((x, i) => `<li role="option" data-i="${i}"><b>${esc(x.label)}</b><span>${esc(x.sub)}</span></li>`).join('')
      || `<li class="none">Aucun lieu connu : « Rechercher » cherchera « ${esc(inp.value)} » dans les annonces.</li>`;
    box.hidden = false; inp.setAttribute('aria-expanded', 'true');
  };
  const hide = () => { box.hidden = true; inp.setAttribute('aria-expanded', 'false'); };
  const pick = x => { picked = x; inp.value = x.quartier ? `${x.quartier}, ${x.commune}` : x.commune; hide(); };
  inp.addEventListener('input', () => { picked = null; render(); });
  inp.addEventListener('focus', render);
  box.addEventListener('mousedown', e => { const li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); pick(shown[+li.dataset.i]); } });
  inp.addEventListener('blur', () => setTimeout(hide, 120));
  const go = () => {
    const p = new URLSearchParams({ type: heroType });
    const t = inp.value.trim();
    const first = t && matches(t.split(',')[0])[0];
    const hit = picked || (first && norm(first.label).startsWith(norm(t.split(',')[0])) ? first : null); // best suggestion when the visitor just presses Enter
    if (hit) { p.set('commune', hit.commune); if (hit.quartier) p.set('quartier', hit.quartier); }
    else if (t) p.set('q', t);
    if (val('h-max')) p.set('max', val('h-max'));
    if (val('h-beds')) p.set('beds', val('h-beds'));
    hide();
    location.hash = '#/search?' + p;
  };
  document.getElementById('h-go').addEventListener('click', go);
  inp.addEventListener('keydown', e => {
    const items = [...box.querySelectorAll('li[data-i]')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (box.hidden) render();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % (items.length || 1);
      items.forEach((li, i) => li.classList.toggle('on', i === active));
    } else if (e.key === 'Enter') { if (active >= 0 && shown[active] && !box.hidden) pick(shown[active]); go(); }
    else if (e.key === 'Escape') hide();
  });
  const { data } = await sb.from('listings_public').select('*').order('created_at', { ascending: false }).limit(8);
  fillCards(document.getElementById('latest'), data || [],
    '<div class="empty"><b>Les premières annonces arrivent bientôt</b>Revenez dans quelques instants.</div>');
}

/* ---------- SEARCH ---------- */
function viewSearch(p) {
  const amen = p.getAll('amen');
  const sel = (name, v) => (p.get(name) === v ? 'selected' : '');
  view.innerHTML = `
    <div class="search-layout">
      <aside class="filters" id="filters"><form id="ff" onsubmit="return false">
        <h2>Filtres</h2>
        <div class="fg"><label for="f-q">Recherche</label><input type="text" id="f-q" name="q" value="${esc(p.get('q') || '')}" placeholder="Quartier, mot-clé, n° de réf.…"></div>
        <div class="fg"><label for="f-type">Type d'annonce</label>
          <select id="f-type" name="type"><option value="">Toutes</option>${Object.entries(LISTING_TYPES).map(([k, v]) => `<option value="${k}" ${sel('type', k)}>${v}</option>`).join('')}</select></div>
        <div class="fg"><label for="f-pt">Type de bien</label>
          <select id="f-pt" name="ptype"><option value="">Tous</option>${Object.entries(PROPERTY_TYPES).map(([k, v]) => `<option value="${k}" ${sel('ptype', k)}>${v}</option>`).join('')}</select></div>
        <div class="fg"><label for="f-c">Commune</label>
          <select id="f-c" name="commune"><option value="">Toutes</option>${COMMUNES.map(c => `<option ${sel('commune', c)}>${c}</option>`).join('')}</select></div>
        <div class="fg"><label for="f-qt">Quartier</label>
          <select id="f-qt" name="quartier" disabled><option value="">Choisissez d'abord une commune</option></select></div>
        <div class="fg"><label for="f-b">Chambres (minimum)</label>
          <select id="f-b" name="beds"><option value="">Indifférent</option>${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${sel('beds', String(n))}>${n}${n === 5 ? '+' : ''}</option>`).join('')}</select></div>
        <div class="fg"><span class="lbl">Budget</span>
          <output id="bud-val" class="bud-val" for="f-min f-max"></output>
          <div class="dual">
            <div class="dual-track"><div class="dual-fill" id="dual-fill"></div></div>
            <input type="range" id="f-min" min="0" max="1" step="1" value="0" disabled aria-label="Budget minimum">
            <input type="range" id="f-max" min="0" max="1" step="1" value="1" disabled aria-label="Budget maximum">
          </div>
          <p class="hint" id="bud-hint"></p></div>
        <div class="fg checks"><label><input type="checkbox" name="furn" value="1" ${p.get('furn') ? 'checked' : ''}> Meublé uniquement</label>
          <label><input type="checkbox" name="ver" value="1" ${p.get('ver') ? 'checked' : ''}> ✓ Vérifiés uniquement</label></div>
        <div class="fg"><span class="lbl">Équipements</span><div class="checks">
          ${Object.entries(AMENITIES).map(([k, v]) => `<label><input type="checkbox" name="amen" value="${k}" ${amen.includes(k) ? 'checked' : ''}> ${v}</label>`).join('')}
        </div></div>
        <button type="button" class="btn btn-line btn-block" id="f-clear">Effacer les filtres</button>
      </form></aside>
      <section>
        <div class="results-bar">
          <span class="count" id="count">…</span>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="btn btn-line btn-sm only-mobile" id="f-toggle">Filtres</button>
            <select id="f-sort" aria-label="Trier" class="btn btn-line btn-sm" style="padding:6px 10px">
              <option value="new" ${sel('sort', 'new')}>Plus récentes</option>
              <option value="price_asc" ${sel('sort', 'price_asc')}>Prix croissant</option>
              <option value="price_desc" ${sel('sort', 'price_desc')}>Prix décroissant</option>
            </select>
          </div>
        </div>
        <div id="results">${skeletons(6)}</div>
        <div class="pager" id="pager"></div>
      </section>
    </div>`;
  const form = document.getElementById('ff');
  const sortEl = document.getElementById('f-sort');
  const collect = (page) => {
    const q = new URLSearchParams();
    new FormData(form).forEach((v, k) => { v = String(v).trim(); if (v) q.append(k, v); });
    if (sortEl.value !== 'new') q.set('sort', sortEl.value);
    if (budget.active && budget.type) { // budget handles are not form fields: add them only when they actually narrow the search
      const lo = document.getElementById('f-min'), hi = document.getElementById('f-max');
      if (+lo.value > 0) q.set('min', lo.value);
      if (+hi.value < +hi.max) q.set('max', hi.value);
    }
    if (page > 1) q.set('page', page);
    return q;
  };
  const apply = (page = 1) => {
    const q = collect(page);
    history.replaceState(null, '', '#/search' + (q.toString() ? '?' + q : ''));
    runSearch(q);
  };
  const applyDebounced = debounce(() => apply(1), 350);
  // quartier list depends on the commune: reset it right away, then fill it with the quartiers that have listings
  document.getElementById('f-c').addEventListener('change', e => loadQuartiers(e.target.value, ''));
  // budget range depends on the listing type (rent per month, sale price, short stay per night)
  document.getElementById('f-type').addEventListener('change', e => loadBudget(e.target.value, null, null));
  document.getElementById('f-min').addEventListener('input', onBudgetInput);
  document.getElementById('f-max').addEventListener('input', onBudgetInput);
  form.addEventListener('change', () => apply(1));
  form.querySelectorAll('input[type=text],input[type=number],input[type=range]').forEach(i => i.addEventListener('input', applyDebounced));
  sortEl.addEventListener('change', () => apply(1));
  document.getElementById('f-toggle').addEventListener('click', () => document.getElementById('filters').classList.toggle('open'));
  document.getElementById('f-clear').addEventListener('click', () => { form.reset(); form.querySelectorAll('select').forEach(s => s.value = ''); sortEl.value = 'new'; loadQuartiers('', ''); loadBudget('', null, null); apply(1); });
  window.goPage = n => { apply(n); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  loadQuartiers(p.get('commune') || '', p.get('quartier') || '');
  loadBudget(p.get('type') || '', p.get('min'), p.get('max'));
  runSearch(p);
}

// Fill the Quartier dropdown with the quartiers of a commune that currently have listings (with counts)
async function loadQuartiers(commune, selected) {
  const el = document.getElementById('f-qt');
  if (!el) return;
  if (!commune) {
    el.disabled = true; el.innerHTML = '<option value="">Choisissez d\'abord une commune</option>';
    return;
  }
  el.disabled = true; el.innerHTML = '<option value="">Chargement…</option>';
  const { data } = await sb.from('listings_public').select('quartier').eq('commune', commune).neq('quartier', '');
  const counts = {};
  (data || []).forEach(r => { if (r.quartier) counts[r.quartier] = (counts[r.quartier] || 0) + 1; });
  const names = Object.keys(counts).sort((a, b) => a.localeCompare(b, 'fr'));
  if (selected && !names.includes(selected)) names.push(selected);
  const el2 = document.getElementById('f-qt');
  if (!el2 || document.getElementById('f-c').value !== commune) return; // user changed commune meanwhile
  el2.innerHTML = `<option value="">Tous les quartiers de ${esc(commune)}</option>` +
    names.map(n => `<option value="${esc(n)}" ${n === selected ? 'selected' : ''}>${esc(n)}${counts[n] ? ' (' + counts[n] + ')' : ''}</option>`).join('');
  el2.disabled = false;
}

/* ----- Budget slider: range is built from the real prices of the chosen listing type ----- */
const BUDGET_FALLBACK = { rent: 1000000, sale: 200000000, short_stay: 150000 };
const budget = { active: false, type: '' };
const fmtNum = n => nf.format(n).replace(/[  ]/g, ' ');

// pick a "round" step (1, 2 or 5 x 10^n) giving about 100 positions, and a max that is a multiple of it
function niceScale(top) {
  const raw = Math.max(top, 1000) / 100;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const r = raw / mag;
  const step = Math.max(mag * (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10), 1000);
  return { step, max: Math.ceil(top / step) * step };
}
async function loadBudget(type, selMin, selMax) {
  const minEl = document.getElementById('f-min'), maxEl = document.getElementById('f-max');
  if (!minEl) return;
  budget.active = false; budget.type = type;
  const hint = document.getElementById('bud-hint');
  if (!type) {
    [minEl, maxEl].forEach(el => { el.disabled = true; el.min = 0; el.max = 1; el.step = 1; });
    minEl.value = 0; maxEl.value = 1;
    hint.textContent = 'Choisissez Location, Vente ou Séjour court pour régler le budget : ces prix ne sont pas comparables.';
    updateBudgetUI();
    return;
  }
  hint.textContent = '';
  [minEl, maxEl].forEach(el => { el.disabled = true; });
  const { data } = await sb.from('listings_public').select('price').eq('listing_type', type).order('price', { ascending: false }).limit(1);
  if (budget.type !== type || !document.getElementById('f-min')) return; // the visitor changed type meanwhile
  const { step, max } = niceScale(data?.[0]?.price || BUDGET_FALLBACK[type]);
  [minEl, maxEl].forEach(el => { el.min = 0; el.max = max; el.step = step; el.disabled = false; });
  const clamp = v => Math.min(max, Math.max(0, parseInt(v, 10) || 0));
  minEl.value = selMin ? clamp(selMin) : 0;
  maxEl.value = selMax ? clamp(selMax) : max;
  if (+minEl.value > +maxEl.value) minEl.value = maxEl.value;
  budget.active = true;
  updateBudgetUI();
}
function onBudgetInput(e) { // the two handles can never cross each other
  const minEl = document.getElementById('f-min'), maxEl = document.getElementById('f-max');
  if (e.target === minEl && +minEl.value > +maxEl.value) minEl.value = maxEl.value;
  if (e.target === maxEl && +maxEl.value < +minEl.value) maxEl.value = minEl.value;
  updateBudgetUI();
}
function updateBudgetUI() {
  const minEl = document.getElementById('f-min'), maxEl = document.getElementById('f-max');
  if (!minEl) return;
  const top = +maxEl.max || 1, lo = +minEl.value, hi = +maxEl.value;
  const fill = document.getElementById('dual-fill');
  fill.style.left = (lo / top * 100) + '%';
  fill.style.width = (Math.max(hi - lo, 0) / top * 100) + '%';
  minEl.style.zIndex = lo > top / 2 ? 5 : 3; // keep the handle you can still grab on top when they overlap
  maxEl.style.zIndex = 4;
  const out = document.getElementById('bud-val');
  if (!budget.active) { out.textContent = ''; return; }
  const u = unit(budget.type);
  out.textContent = (lo === 0 && hi === top) ? 'Tous les prix'
    : lo === 0 ? `Jusqu'à ${fmtNum(hi)} FCFA${u}`
    : hi === top ? `À partir de ${fmtNum(lo)} FCFA${u}`
    : `${fmtNum(lo)} – ${fmtNum(hi)} FCFA${u}`;
}

async function runSearch(p) {
  const results = document.getElementById('results');
  if (!results) return;
  const page = Math.max(1, parseInt(p.get('page') || '1', 10));
  let q = sb.from('listings_public').select('*', { count: 'exact' });
  if (p.get('type')) q = q.eq('listing_type', p.get('type'));
  if (p.get('ptype')) q = q.eq('property_type', p.get('ptype'));
  if (p.get('commune')) q = q.eq('commune', p.get('commune'));
  if (p.get('quartier') && p.get('commune')) q = q.eq('quartier', p.get('quartier'));
  if (p.get('beds')) q = q.gte('bedrooms', parseInt(p.get('beds'), 10));
  if (p.get('type')) { // a budget only makes sense inside one listing type
    if (p.get('min')) q = q.gte('price', parseInt(p.get('min'), 10));
    if (p.get('max')) q = q.lte('price', parseInt(p.get('max'), 10));
  }
  if (p.get('furn')) q = q.eq('furnished', true);
  if (p.get('ver')) q = q.eq('verified', true);
  const am = p.getAll('amen').filter(a => a in AMENITIES);
  if (am.length) q = q.contains('amenities', am);
  const text = (p.get('q') || '').replace(/[,()%*\\]/g, ' ').trim();
  if (/^#?\d+$/.test(text)) q = q.eq('id', parseInt(text.replace('#', ''), 10)); // search by reference number
  else if (text) q = q.or(`title.ilike.%${text}%,quartier.ilike.%${text}%,commune.ilike.%${text}%,description.ilike.%${text}%`);
  const sort = p.get('sort');
  q = sort === 'price_asc' ? q.order('price', { ascending: true })
    : sort === 'price_desc' ? q.order('price', { ascending: false })
    : q.order('created_at', { ascending: false });
  q = q.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const { data, count, error } = await q;
  if (!document.getElementById('results')) return; // user navigated away
  if (error) { results.innerHTML = `<div class="empty"><b>Erreur</b>${esc(error.message)}</div>`; return; }
  document.getElementById('count').textContent = `${count || 0} annonce${count === 1 ? '' : 's'}`;
  await fillCards(results, data || [], '<div class="empty"><b>Aucun résultat</b>Essayez d\'élargir vos critères.</div>');
  const pages = Math.ceil((count || 0) / PAGE_SIZE);
  document.getElementById('pager').innerHTML = pages > 1
    ? Array.from({ length: pages }, (_, i) => `<button class="${i + 1 === page ? 'on' : ''}" onclick="goPage(${i + 1})">${i + 1}</button>`).join('') : '';
}

/* ---------- LISTING DETAIL + REQUEST FORM ---------- */
async function viewListing(idStr) {
  const id = parseInt(idStr, 10);
  view.innerHTML = '<div class="detail">' + skeletons(1) + '</div>';
  const { data: l } = await sb.from('listings_public').select('*').eq('id', id).maybeSingle();
  if (!l) { view.innerHTML = '<div class="page"><div class="panel empty"><b>Annonce introuvable</b>Elle a peut-être été retirée ou n\'est plus disponible.<br><br><a class="btn btn-teal" href="#/search">Voir les annonces</a></div></div>'; return; }
  sb.rpc('increment_views', { listing: id }).then(() => {});
  const { data: ph } = await sb.from('listing_photos').select('path').eq('listing_id', id).order('position');
  const imgs = (ph || []).map(r => publicUrl(r.path));
  const faved = (await favSet([id])).has(id);
  const spec = [
    ['Réf.', '#' + l.id],
    ['Type', PROPERTY_TYPES[l.property_type]],
    l.bedrooms > 0 ? ['Chambres', l.bedrooms] : null,
    l.bathrooms > 0 ? ['Salles de bain', l.bathrooms] : null,
    l.area_sqm > 0 ? ['Surface', l.area_sqm + ' m²'] : null,
    l.furnished ? ['Meublé', 'Oui'] : null,
    l.listing_type === 'short_stay' && l.max_guests ? ['Voyageurs max', l.max_guests] : null
  ].filter(Boolean);
  const shareUrl = 'https://wa.me/?text=' + encodeURIComponent(l.title + ' – ' + money(l.price) + unit(l.listing_type) + '\n' + location.href);
  const waText = `Bonjour, je suis intéressé(e) par l'annonce Réf. ${l.id} « ${l.title} » sur Lagoo.`;
  view.innerHTML = `
    <div class="detail">
      <a class="crumb" href="javascript:history.back()">← Retour</a>
      <div class="gallery">
        <div class="gallery-main" id="gmain">${imgs[0] ? `<img src="${esc(imgs[0])}" alt="Photo principale de l'annonce">` : '<span style="color:var(--lagoon-d);font-weight:700">Pas de photo</span>'}</div>
        ${imgs.length > 1 ? `<div class="thumbs">${imgs.map((u, i) => `<button class="${i === 0 ? 'on' : ''}" data-i="${i}" aria-label="Photo ${i + 1}"><img src="${esc(u)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
      </div>
      <div class="detail-grid">
        <div>
          <span class="chip ${esc(l.listing_type)}" style="position:static;display:inline-block">${esc(LISTING_TYPES[l.listing_type])}</span>
          ${l.verified ? '<span class="vbadge vbadge-inline">✓ Vérifié par notre équipe</span>' : ''}
          <h1>${esc(l.title)}</h1>
          <div class="loc">📍 ${esc(l.quartier ? l.quartier + ', ' : '')}${esc(l.commune)}, Abidjan</div>
          <div class="price" style="margin-top:8px">${money(l.price)}<small> ${unit(l.listing_type)}</small></div>
          <div class="spec">${spec.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>
          ${l.description ? `<p class="desc">${esc(l.description)}</p>` : ''}
          ${l.amenities?.length ? `<div class="amen">${l.amenities.map(a => `<span>✓ ${esc(AMENITIES[a] || a)}</span>`).join('')}</div>` : ''}
          <div class="actions">
            ${user ? `<button class="btn btn-line btn-sm" id="d-fav">${faved ? '❤️ Enregistrée' : '🤍 Enregistrer'}</button>` : ''}
            <a class="btn btn-line btn-sm" href="${shareUrl}" target="_blank" rel="noopener">Partager sur WhatsApp</a>
          </div>
        </div>
        <aside class="contact" id="contactCard">
          <h3>Ce bien vous intéresse ?</h3>
          <p class="hint" style="margin:4px 0 10px">Envoyez-nous votre demande. Nous vérifions la disponibilité auprès du propriétaire, puis nous vous rappelons pour vous mettre en relation.</p>
          <div class="field"><label for="r-name">Votre nom</label><input id="r-name" maxlength="80" autocomplete="name" value="${esc(profile?.full_name || '')}"></div>
          <div class="field"><label for="r-phone">Votre téléphone / WhatsApp</label><input id="r-phone" type="tel" maxlength="25" placeholder="+225 07 00 00 00 00" autocomplete="tel" value="${esc(profile?.phone || '')}"></div>
          <div class="field"><label for="r-msg">Message (optionnel)</label><textarea id="r-msg" maxlength="1000" style="min-height:80px" placeholder="Date de visite souhaitée, durée du séjour, questions…"></textarea></div>
          <input id="r-site" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;opacity:0">
          <p class="err" id="r-err"></p>
          <button class="btn btn-primary btn-block" id="r-send">Envoyer ma demande</button>
          ${WA_OK ? `<a class="btn btn-line btn-block" style="margin-top:8px" href="${waLink(WA_NUMBER, waText)}" target="_blank" rel="noopener">Nous écrire sur WhatsApp</a>` : ''}
          <div class="safety"><b>Sécurité :</b> ce site ne demande aucun paiement. Ne versez jamais d'argent (caution, avance, frais) avant d'avoir visité le bien.</div>
        </aside>
      </div>
    </div>`;
  const main = document.getElementById('gmain');
  view.querySelectorAll('.thumbs button').forEach(b => b.addEventListener('click', () => {
    main.innerHTML = `<img src="${esc(imgs[b.dataset.i])}" alt="Photo ${+b.dataset.i + 1}">`;
    view.querySelectorAll('.thumbs button').forEach(x => x.classList.toggle('on', x === b));
  }));
  document.getElementById('d-fav')?.addEventListener('click', async e => {
    const on = e.target.textContent.includes('Enregistrée');
    const { error } = on ? await sb.from('favourites').delete().eq('user_id', user.id).eq('listing_id', id)
      : await sb.from('favourites').insert({ user_id: user.id, listing_id: id });
    if (!error) e.target.textContent = on ? '🤍 Enregistrer' : '❤️ Enregistrée';
  });
  document.getElementById('r-send').addEventListener('click', () => sendRequest(l));
}

async function sendRequest(l) {
  const err = document.getElementById('r-err'), btn = document.getElementById('r-send');
  err.textContent = '';
  const name = val('r-name'), phone = val('r-phone'), message = val('r-msg');
  if (!name) return (err.textContent = 'Indiquez votre nom.');
  if (digits(phone).length < 8) return (err.textContent = 'Indiquez un numéro de téléphone valide (avec l\'indicatif).');
  btn.disabled = true;
  if (!val('r-site')) { // honeypot: bots fill the hidden field, humans never see it
    const { error } = await sb.from('leads').insert({ listing_id: l.id, user_id: user?.id || null, name, phone, message });
    if (error) { btn.disabled = false; return (err.textContent = 'Envoi impossible. Réessayez ou écrivez-nous sur WhatsApp.'); }
  }
  document.getElementById('contactCard').innerHTML = `
    <h3>Demande envoyée ✅</h3>
    <p style="margin:8px 0 12px">Merci ${esc(name)}. Nous vérifions la disponibilité auprès du propriétaire et nous vous contactons au <b>${esc(phone)}</b>.</p>
    <p class="hint">Pensez à garder votre téléphone à portée de main.</p>
    <a class="btn btn-teal btn-block" style="margin-top:12px" href="#/search">Voir d'autres annonces</a>`;
}

/* ---------- OWNERS PAGE ---------- */
function viewOwnersPage() {
  const waText = "Bonjour, je souhaite proposer mon bien sur Lagoo.";
  view.innerHTML = `
  <div class="page">
    <h1>Proposez votre bien</h1>
    <p class="sub">Vous avez un logement à louer, à vendre ou à proposer en séjour court à Abidjan ? Nous nous occupons de tout.</p>
    <div class="panel">
      <h2>Comment ça marche</h2>
      <ol class="how">
        <li><b>Vous nous contactez</b> par WhatsApp avec quelques informations et des photos.</li>
        <li><b>Nous vérifions</b> le bien et fixons ensemble les conditions de publication.</li>
        <li><b>Nous publions l'annonce</b> sur le site. Vous n'avez rien à saisir vous-même.</li>
        <li><b>Nous recevons les demandes</b> des clients intéressés et confirmons avec vous la disponibilité.</li>
        <li><b>Nous vous mettons en relation</b> avec les clients sérieux, pour la visite et la suite.</li>
      </ol>
    </div>
    <div class="panel">
      <h2>Tarifs</h2>
      <p>La publication d'une annonce est payante et inclut la vérification et la mise en ligne. Contactez-nous pour connaître les conditions.</p>
    </div>
    ${WA_OK
      ? `<a class="btn btn-primary btn-block" style="padding:14px" href="${waLink(WA_NUMBER, waText)}" target="_blank" rel="noopener">Nous contacter sur WhatsApp</a>`
      : '<div class="panel empty"><b>Contact bientôt disponible</b></div>'}
  </div>`;
}

/* ---------- ACCOUNT (visitors: favourites + profile) ---------- */
async function viewAccount(tab) {
  if (!user) { requireAuth('#/account'); view.innerHTML = '<div class="page"><div class="panel empty"><b>Connexion requise</b></div></div>'; return; }
  view.innerHTML = `<div class="page"><h1>Mon espace</h1><p class="sub">${esc(user.email)}</p>
    <div class="tabs">
      <button data-t="favs" class="${tab === 'favs' ? 'on' : ''}">Favoris</button>
      <button data-t="profile" class="${tab === 'profile' ? 'on' : ''}">Profil</button>
    </div><div id="tabbody">${skeletons(2)}</div></div>`;
  view.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => { history.replaceState(null, '', '#/account?tab=' + b.dataset.t); viewAccount(b.dataset.t); }));
  const body = document.getElementById('tabbody');
  if (tab === 'profile') {
    body.innerHTML = `<div class="panel"><div class="field"><label for="pr-name">Nom complet</label><input id="pr-name" value="${esc(profile?.full_name || '')}"></div>
      <div class="row"><div class="field"><label for="pr-phone">Téléphone</label><input id="pr-phone" type="tel" value="${esc(profile?.phone || '')}"></div>
      <div class="field"><label for="pr-wa">WhatsApp</label><input id="pr-wa" type="tel" value="${esc(profile?.whatsapp || '')}"></div></div>
      <button class="btn btn-teal" id="pr-save">Enregistrer</button></div>`;
    document.getElementById('pr-save').addEventListener('click', async () => {
      const { error } = await sb.from('profiles').update({ full_name: val('pr-name'), phone: val('pr-phone'), whatsapp: val('pr-wa') }).eq('id', user.id);
      if (error) return toast(error.message);
      await loadProfile(); updateNav(); toast('Profil enregistré.');
    });
  } else {
    const { data: f } = await sb.from('favourites').select('listing_id').eq('user_id', user.id);
    const ids = (f || []).map(r => r.listing_id);
    const { data } = ids.length ? await sb.from('listings_public').select('*').in('id', ids) : { data: [] };
    await fillCards(body, data || [], '<div class="empty"><b>Aucun favori</b>Touchez le cœur sur une annonce pour la retrouver ici.</div>');
  }
}

/* =====================================================================
   ADMIN AREA (only visible to accounts with role = 'admin')
   ===================================================================== */
function adminGuard() {
  if (!user) { requireAuth(location.hash); view.innerHTML = '<div class="page"><div class="panel empty"><b>Connexion requise</b>Connectez-vous avec votre compte administrateur.</div></div>'; return false; }
  if (!isAdmin()) { view.innerHTML = '<div class="page"><div class="panel empty"><b>Accès réservé</b>Cette zone est réservée à l\'administrateur du site.</div></div>'; return false; }
  return true;
}

async function viewAdmin(tab) {
  if (!adminGuard()) return;
  if (!['leads', 'listings', 'owners'].includes(tab)) tab = 'leads';
  view.innerHTML = `<div class="page" style="max-width:980px">
    <div class="admin-head"><h1>Administration</h1><a class="btn btn-primary" href="#/admin/new">+ Nouvelle annonce</a></div>
    <div class="tabs">
      <button data-t="leads" class="${tab === 'leads' ? 'on' : ''}">Demandes<span class="badge" id="newleads" hidden></span></button>
      <button data-t="listings" class="${tab === 'listings' ? 'on' : ''}">Annonces</button>
      <button data-t="owners" class="${tab === 'owners' ? 'on' : ''}">Propriétaires</button>
    </div><div id="tabbody">${skeletons(2)}</div></div>`;
  view.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => { location.hash = '#/admin?tab=' + b.dataset.t; }));
  refreshNewLeads();
  if (tab === 'leads') return adminLeads();
  if (tab === 'listings') return adminListings();
  return adminOwners();
}

/* ----- Demandes (leads) ----- */
async function adminLeads(filter = 'open') {
  const body = document.getElementById('tabbody');
  const [{ data: all }, sums] = await Promise.all([
    (() => {
      let q = sb.from('leads').select('*, listing:listings(id,title,price,listing_type,commune,owner:owners(full_name,phone,whatsapp))').order('created_at', { ascending: false }).limit(200);
      if (filter === 'open') q = q.in('status', OPEN_LEADS); else if (filter !== 'all') q = q.eq('status', filter);
      return q;
    })(),
    sb.from('leads').select('commission_fcfa,commission_paid').not('commission_fcfa', 'is', null)
  ]);
  const rows = all || [];
  const due = (sums.data || []).filter(r => !r.commission_paid).reduce((a, r) => a + r.commission_fcfa, 0);
  const paid = (sums.data || []).filter(r => r.commission_paid).reduce((a, r) => a + r.commission_fcfa, 0);
  body.innerHTML = `
    <div class="sums"><div><span>À encaisser</span><b>${money(due)}</b></div><div><span>Encaissé</span><b>${money(paid)}</b></div></div>
    <div class="results-bar"><span class="count">${rows.length} demande${rows.length === 1 ? '' : 's'}</span>
      <select id="lead-filter" class="btn btn-line btn-sm" style="padding:6px 10px">
        <option value="open" ${filter === 'open' ? 'selected' : ''}>En cours</option>
        <option value="all" ${filter === 'all' ? 'selected' : ''}>Toutes</option>
        ${Object.entries(LEAD_STATUS).map(([k, v]) => `<option value="${k}" ${filter === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select></div>
    ${rows.length ? rows.map(leadCard).join('') : '<div class="empty"><b>Aucune demande</b>Les demandes des visiteurs apparaîtront ici.</div>'}`;
  document.getElementById('lead-filter').addEventListener('change', e => adminLeads(e.target.value));
}

function leadCard(r) {
  const l = r.listing || {}, o = l.owner;
  const ref = `Réf. ${l.id ?? r.listing_id}`;
  const toVisitor = `Bonjour ${r.name}, ici Lagoo. Concernant l'annonce ${ref} « ${l.title || ''} » : `;
  const toOwner = `Bonjour ${o?.full_name || ''}, un client est intéressé par votre bien (${ref} « ${l.title || ''} »). Est-il toujours disponible ?`;
  return `
  <div class="lead" id="lead-${r.id}">
    <div class="lead-top"><span class="pill st-${esc(r.status)}">${esc(LEAD_STATUS[r.status])}</span><span class="loc">${timeAgo(r.created_at)}</span></div>
    <div class="lead-listing"><a href="#/admin/edit/${l.id}"><b>${esc(l.title || 'Annonce supprimée')}</b></a> <span class="loc">${esc(ref)}${l.price ? ' · ' + money(l.price) + unit(l.listing_type) : ''}</span></div>
    <div class="lead-cols">
      <div><span class="lbl">Visiteur</span><b>${esc(r.name)}</b>${r.user_id ? ' <span class="loc">(compte)</span>' : ''}<br>${esc(r.phone)}
        ${r.message ? `<p class="lead-msg">« ${esc(r.message)} »</p>` : ''}
        <div class="actions"><a class="btn btn-line btn-sm" href="${telLink(r.phone)}">Appeler</a><a class="btn btn-line btn-sm" target="_blank" rel="noopener" href="${waLink(r.phone, toVisitor)}">WhatsApp</a></div></div>
      <div><span class="lbl">Propriétaire</span>${o ? `<b>${esc(o.full_name)}</b><br>${esc(o.phone)}
        <div class="actions"><a class="btn btn-line btn-sm" href="${telLink(o.phone)}">Appeler</a><a class="btn btn-line btn-sm" target="_blank" rel="noopener" href="${waLink(o.whatsapp || o.phone, toOwner)}">WhatsApp</a></div>`
        : '<span class="loc">Aucun propriétaire lié à cette annonce.</span>'}</div>
    </div>
    <div class="lead-edit">
      <div class="field"><label for="ls-${r.id}">Statut</label><select id="ls-${r.id}">${Object.entries(LEAD_STATUS).map(([k, v]) => `<option value="${k}" ${r.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label for="lc-${r.id}">Commission (FCFA)</label><input id="lc-${r.id}" type="number" min="0" step="1000" value="${r.commission_fcfa ?? ''}"></div>
      <div class="field"><label class="chk-inline"><input type="checkbox" id="lp-${r.id}" ${r.commission_paid ? 'checked' : ''}> Commission payée</label></div>
      <div class="field wide"><label for="ln-${r.id}">Notes internes</label><textarea id="ln-${r.id}" style="min-height:60px">${esc(r.admin_notes)}</textarea></div>
      <div class="actions"><button class="btn btn-teal btn-sm" onclick="saveLead(${r.id})">Enregistrer</button><button class="btn btn-danger btn-sm" onclick="deleteLead(${r.id})">Supprimer</button></div>
    </div>
  </div>`;
}
async function saveLead(id) {
  const c = val('lc-' + id);
  const { error } = await sb.from('leads').update({
    status: val('ls-' + id), commission_fcfa: c ? parseInt(c, 10) : null,
    commission_paid: document.getElementById('lp-' + id).checked, admin_notes: val('ln-' + id)
  }).eq('id', id);
  toast(error ? 'Erreur : ' + error.message : 'Enregistré.');
  refreshNewLeads();
}
async function deleteLead(id) {
  if (!confirm('Supprimer cette demande ?')) return;
  const { error } = await sb.from('leads').delete().eq('id', id);
  if (error) return toast(error.message);
  document.getElementById('lead-' + id)?.remove();
  refreshNewLeads();
}

/* ----- Annonces ----- */
async function adminListings() {
  const body = document.getElementById('tabbody');
  const { data } = await sb.from('listings').select('*, owner:owners(full_name,phone)').order('created_at', { ascending: false });
  const rows = data || [];
  if (!rows.length) { body.innerHTML = '<div class="empty"><b>Aucune annonce</b><a class="btn btn-primary" href="#/admin/new">Créer la première annonce</a></div>'; return; }
  const imgs = await photoMap(rows.map(r => r.id));
  body.innerHTML = rows.map(l => {
    const live = l.status === 'active' && !isExpired(l);
    return `<div class="mine">
      <div class="mine-img">${imgs[l.id] ? `<img src="${esc(imgs[l.id])}" alt="">` : ''}</div>
      <div><a href="#/listing/${l.id}"><b>${esc(l.title)}</b></a> <span class="loc">Réf. ${l.id}</span>
        <div class="loc">${esc(LISTING_TYPES[l.listing_type])} · ${esc(l.commune)} · ${money(l.price)}${unit(l.listing_type)}</div>
        <div class="loc">Propriétaire : ${l.owner ? esc(l.owner.full_name) + ' (' + esc(l.owner.phone) + ')' : '<i>non renseigné</i>'}</div>
        <span class="pill ${live ? 'active' : 'paused'}">${live ? 'En ligne' : (isExpired(l) ? 'Expirée' : l.status === 'paused' ? 'En pause' : 'Fermée')}</span>
        ${l.verified ? '<span class="pill active">✓ Vérifiée</span>' : ''}
        <span class="loc"> ${l.paid_until ? '· payée jusqu\'au ' + new Date(l.paid_until).toLocaleDateString('fr-FR') : ''} · ${l.views} vue${l.views === 1 ? '' : 's'}</span></div>
      <div class="mine-actions">
        <a class="btn btn-line btn-sm" href="#/admin/edit/${l.id}">Modifier</a>
        <button class="btn btn-line btn-sm" onclick="toggleListing(${l.id},'${l.status === 'active' ? 'paused' : 'active'}')">${l.status === 'active' ? 'Pause' : 'Remettre en ligne'}</button>
        <button class="btn btn-danger btn-sm" onclick="deleteListing(${l.id})">Supprimer</button>
      </div></div>`;
  }).join('');
}
async function toggleListing(id, status) {
  const { error } = await sb.from('listings').update({ status }).eq('id', id);
  if (error) return toast(error.message);
  adminListings();
}
async function deleteListing(id) {
  if (!confirm('Supprimer définitivement cette annonce, ses photos et ses demandes ?')) return;
  const { data: ph } = await sb.from('listing_photos').select('path').eq('listing_id', id);
  if (ph?.length) await sb.storage.from('listing-photos').remove(ph.map(p => p.path));
  const { error } = await sb.from('listings').delete().eq('id', id);
  if (error) return toast(error.message);
  toast('Annonce supprimée.');
  adminListings();
}

/* ----- Propriétaires ----- */
async function adminOwners() {
  const body = document.getElementById('tabbody');
  const [{ data }, { data: ls }] = await Promise.all([
    sb.from('owners').select('*').order('full_name'),
    sb.from('listings').select('id,owner_contact_id')
  ]);
  const rows = data || [];
  const count = {}; (ls || []).forEach(l => { if (l.owner_contact_id) count[l.owner_contact_id] = (count[l.owner_contact_id] || 0) + 1; });
  editingOwner = null;
  body.innerHTML = `
    <div class="panel"><h2 id="ow-title">Ajouter un propriétaire</h2>
      <p class="hint" style="margin-bottom:12px">Ces informations sont privées : seul votre compte administrateur peut les voir.</p>
      <div class="row3">
        <div class="field"><label for="ow-name">Nom *</label><input id="ow-name" maxlength="80"></div>
        <div class="field"><label for="ow-phone">Téléphone *</label><input id="ow-phone" type="tel"></div>
        <div class="field"><label for="ow-wa">WhatsApp</label><input id="ow-wa" type="tel" placeholder="si différent"></div>
      </div>
      <div class="field"><label for="ow-notes">Notes (conditions convenues, frais, etc.)</label><textarea id="ow-notes" style="min-height:70px"></textarea></div>
      <div class="actions"><button class="btn btn-teal" onclick="saveOwner()">Enregistrer</button><button class="btn btn-line" id="ow-cancel" hidden onclick="adminOwners()">Annuler</button></div>
    </div>
    ${rows.length ? rows.map(o => `
      <div class="mine" style="grid-template-columns:1fr auto">
        <div><b>${esc(o.full_name)}</b> <span class="loc">· ${count[o.id] || 0} annonce${(count[o.id] || 0) === 1 ? '' : 's'}</span>
          <div class="loc">${esc(o.phone)}${o.whatsapp ? ' · WhatsApp ' + esc(o.whatsapp) : ''}</div>
          ${o.notes ? `<div class="loc">${esc(o.notes)}</div>` : ''}</div>
        <div class="mine-actions"><button class="btn btn-line btn-sm" onclick="editOwner(${o.id})">Modifier</button>
          <button class="btn btn-danger btn-sm" onclick="deleteOwner(${o.id})">Supprimer</button></div>
      </div>`).join('') : '<div class="empty"><b>Aucun propriétaire</b>Ajoutez-en un ci-dessus, ou directement depuis le formulaire d\'une annonce.</div>'}`;
  window._owners = rows;
}
function editOwner(id) {
  const o = (window._owners || []).find(x => x.id === id);
  if (!o) return;
  editingOwner = id;
  document.getElementById('ow-title').textContent = 'Modifier le propriétaire';
  document.getElementById('ow-name').value = o.full_name;
  document.getElementById('ow-phone').value = o.phone;
  document.getElementById('ow-wa').value = o.whatsapp || '';
  document.getElementById('ow-notes').value = o.notes || '';
  document.getElementById('ow-cancel').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
async function saveOwner() {
  const row = { full_name: val('ow-name'), phone: val('ow-phone'), whatsapp: val('ow-wa'), notes: val('ow-notes') };
  if (!row.full_name || !row.phone) return toast('Nom et téléphone obligatoires.');
  const { error } = editingOwner ? await sb.from('owners').update(row).eq('id', editingOwner) : await sb.from('owners').insert(row);
  if (error) return toast('Erreur : ' + error.message);
  toast('Propriétaire enregistré.');
  adminOwners();
}
async function deleteOwner(id) {
  if (!confirm('Supprimer ce propriétaire ? Ses annonces restent en ligne, sans propriétaire lié.')) return;
  const { error } = await sb.from('owners').delete().eq('id', id);
  if (error) return toast(error.message);
  adminOwners();
}

/* ----- Formulaire d'annonce (création / modification) ----- */
async function viewAdminForm(id) {
  if (!adminGuard()) return;
  postFiles = []; adminPhotos = [];
  view.innerHTML = '<div class="page"><div class="panel">Chargement…</div></div>';
  const [{ data: owners }, one, photos] = await Promise.all([
    sb.from('owners').select('id,full_name,phone').order('full_name'),
    id ? sb.from('listings').select('*').eq('id', id).maybeSingle() : Promise.resolve({ data: null }),
    id ? sb.from('listing_photos').select('*').eq('listing_id', id).order('position') : Promise.resolve({ data: [] })
  ]);
  const l = one.data;
  if (id && !l) { view.innerHTML = '<div class="page"><div class="panel empty"><b>Annonce introuvable</b><a class="btn btn-teal" href="#/admin?tab=listings">Retour</a></div></div>'; return; }
  adminPhotos = photos.data || [];
  const g = (k, d = '') => esc(l?.[k] ?? d);
  const s = (cond) => cond ? 'selected' : '';
  const lt = l?.listing_type || 'rent';
  view.innerHTML = `
  <div class="page">
    <a class="crumb" href="#/admin?tab=listings">← Retour à l'administration</a>
    <h1>${id ? 'Modifier l\'annonce <span class="loc">Réf. ' + id + '</span>' : 'Nouvelle annonce'}</h1>
    <form id="pf" onsubmit="return false">
    <div class="panel"><h2>1. Propriétaire (privé)</h2>
      <div class="field"><label for="x-owner">Propriétaire</label>
        <select id="x-owner"><option value="">— Aucun / à renseigner —</option>
          ${(owners || []).map(o => `<option value="${o.id}" ${s(l?.owner_contact_id === o.id)}>${esc(o.full_name)} (${esc(o.phone)})</option>`).join('')}
          <option value="new">+ Nouveau propriétaire…</option></select></div>
      <div id="x-newowner" hidden><div class="row3">
        <div class="field"><label for="x-on">Nom *</label><input id="x-on" maxlength="80"></div>
        <div class="field"><label for="x-op">Téléphone *</label><input id="x-op" type="tel"></div>
        <div class="field"><label for="x-ow">WhatsApp</label><input id="x-ow" type="tel"></div></div></div>
    </div>
    <div class="panel"><h2>2. Type d'annonce</h2>
      <div class="field"><div class="opts" id="x-lt">${Object.entries(LISTING_TYPES).map(([k, v]) => `<label><input type="radio" name="lt" value="${k}" ${lt === k ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div></div>
      <div class="row">
        <div class="field"><label for="x-pt">Type de bien *</label><select id="x-pt">${Object.entries(PROPERTY_TYPES).map(([k, v]) => `<option value="${k}" ${s(l?.property_type === k)}>${v}</option>`).join('')}</select></div>
        <div class="field"><label for="x-title">Titre *</label><input id="x-title" maxlength="120" value="${g('title')}" placeholder="ex : Appartement 3 pièces, Riviera 3"></div>
      </div>
    </div>
    <div class="panel"><h2>3. Localisation</h2>
      <div class="row">
        <div class="field"><label for="x-commune">Commune *</label><select id="x-commune">${COMMUNES.map(c => `<option ${s((l?.commune || 'Cocody') === c)}>${c}</option>`).join('')}</select></div>
        <div class="field"><label for="x-quartier">Quartier</label><input id="x-quartier" list="qlist" value="${g('quartier')}"><datalist id="qlist">${(QUARTIERS_BY_COMMUNE[l?.commune || 'Cocody'] || []).map(q => `<option value="${esc(q)}">`).join('')}</datalist></div>
      </div>
      <p class="hint">Ne mettez pas l'adresse exacte : elle est donnée lors de la mise en relation.</p>
    </div>
    <div class="panel"><h2>4. Détails et prix</h2>
      <div class="row">
        <div class="field"><label for="x-price" id="x-price-l">Prix (FCFA) *</label><input id="x-price" type="number" min="0" step="1000" inputmode="numeric" value="${g('price')}"></div>
        <div class="field" id="x-guests-f" hidden><label for="x-guests">Voyageurs maximum</label><input id="x-guests" type="number" min="1" max="30" value="${g('max_guests')}"></div>
      </div>
      <div class="row3">
        <div class="field"><label for="x-beds">Chambres</label><select id="x-beds">${[0, 1, 2, 3, 4, 5, 6, 7, 8].map(n => `<option value="${n}" ${s((l?.bedrooms ?? 0) === n)}>${n === 0 ? 'Aucune / studio' : n}</option>`).join('')}</select></div>
        <div class="field"><label for="x-baths">Salles de bain</label><select id="x-baths">${[0, 1, 2, 3, 4, 5].map(n => `<option ${s((l?.bathrooms ?? 0) === n)}>${n}</option>`).join('')}</select></div>
        <div class="field"><label for="x-area">Surface (m²)</label><input id="x-area" type="number" min="0" inputmode="numeric" value="${l?.area_sqm || ''}"></div>
      </div>
      <div class="field"><span class="lbl">Meublé</span><div class="opts">
        <label><input type="radio" name="furn" value="no" ${l?.furnished ? '' : 'checked'}><span>Non</span></label><label><input type="radio" name="furn" value="yes" ${l?.furnished ? 'checked' : ''}><span>Oui</span></label></div></div>
      <div class="field"><label for="x-desc">Description</label><textarea id="x-desc" maxlength="3000">${g('description')}</textarea></div>
      <div class="field"><span class="lbl">Équipements</span><div class="checks" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr))">
        ${Object.entries(AMENITIES).map(([k, v]) => `<label><input type="checkbox" name="am" value="${k}" ${(l?.amenities || []).includes(k) ? 'checked' : ''}> ${v}</label>`).join('')}</div></div>
    </div>
    <div class="panel"><h2>5. Photos</h2>
      <div id="x-existing" class="previews"></div>
      <div class="drop" id="drop" tabindex="0" role="button" style="margin-top:12px">📷 <b>Ajouter des photos</b><div class="hint">Jusqu'à ${MAX_PHOTOS} photos au total. La première est la photo principale. Elles sont réduites automatiquement.</div></div>
      <input type="file" id="x-files" accept="image/*" multiple hidden>
      <div class="previews" id="previews"></div>
    </div>
    <div class="panel"><h2>6. Publication (réservé à l'administrateur)</h2>
      <div class="row3">
        <div class="field"><label for="x-status">Statut</label><select id="x-status">
          <option value="active" ${s((l?.status || 'active') === 'active')}>En ligne</option>
          <option value="paused" ${s(l?.status === 'paused')}>En pause</option>
          <option value="closed" ${s(l?.status === 'closed')}>Fermée (louée / vendue)</option></select></div>
        <div class="field"><label for="x-paid">Payée jusqu'au</label><input id="x-paid" type="date" value="${g('paid_until')}"><div class="hint">Vide = pas d'expiration.</div></div>
        <div class="field"><label class="chk-inline" style="margin-top:26px"><input type="checkbox" id="x-verified" ${l?.verified ? 'checked' : ''}> ✓ Bien vérifié</label>
          <div class="hint">À cocher seulement si vous avez vérifié le bien.</div></div>
      </div>
      <div class="field"><label for="x-notes">Notes internes (jamais publiques)</label><textarea id="x-notes" style="min-height:70px">${g('admin_notes')}</textarea></div>
    </div>
    <p class="err" id="x-err"></p>
    <button class="btn btn-primary btn-block" id="x-save" style="padding:14px">${id ? 'Enregistrer les modifications' : 'Publier l\'annonce'}</button>
    </form>
  </div>`;
  const syncType = () => {
    const t = document.querySelector('input[name=lt]:checked').value;
    document.getElementById('x-price-l').textContent = t === 'rent' ? 'Loyer mensuel (FCFA) *' : t === 'sale' ? 'Prix de vente (FCFA) *' : 'Prix par nuit (FCFA) *';
    document.getElementById('x-guests-f').hidden = t !== 'short_stay';
  };
  document.getElementById('x-lt').addEventListener('change', syncType); syncType();
  document.getElementById('x-owner').addEventListener('change', e => { document.getElementById('x-newowner').hidden = e.target.value !== 'new'; });
  document.getElementById('x-commune').addEventListener('change', e => {   // quartier suggestions follow the commune
    document.getElementById('qlist').innerHTML = (QUARTIERS_BY_COMMUNE[e.target.value] || []).map(q => `<option value="${esc(q)}">`).join('');
  });
  const fileInput = document.getElementById('x-files'), drop = document.getElementById('drop');
  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('keydown', e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), fileInput.click()));
  drop.addEventListener('dragover', e => e.preventDefault());
  drop.addEventListener('drop', e => { e.preventDefault(); addPhotos(e.dataTransfer.files); });
  fileInput.addEventListener('change', () => { addPhotos(fileInput.files); fileInput.value = ''; });
  document.getElementById('x-save').addEventListener('click', () => saveListing(id));
  renderAdminPhotos();
}

/* photos: existing (stored) + new (to upload) */
function renderAdminPhotos() {
  const box = document.getElementById('x-existing');
  if (!box) return;
  box.innerHTML = adminPhotos.map((p, i) => `<div class="pv" id="ph-${p.id}"><img src="${esc(publicUrl(p.path))}" alt="Photo ${i + 1}">
    <button type="button" aria-label="Supprimer la photo" onclick="deleteStoredPhoto(${p.id})">✕</button>
    ${i === 0 ? '<em>Principale</em>' : `<button type="button" class="mk" onclick="makeMain(${p.id})">Principale</button>`}</div>`).join('');
}
async function deleteStoredPhoto(pid) {
  if (!confirm('Supprimer cette photo ?')) return;
  const p = adminPhotos.find(x => x.id === pid);
  if (!p) return;
  await sb.storage.from('listing-photos').remove([p.path]);
  const { error } = await sb.from('listing_photos').delete().eq('id', pid);
  if (error) return toast(error.message);
  adminPhotos = adminPhotos.filter(x => x.id !== pid);
  adminPhotos.forEach((x, i) => { x.position = i; });
  await Promise.all(adminPhotos.map(x => sb.from('listing_photos').update({ position: x.position }).eq('id', x.id)));
  renderAdminPhotos();
}
async function makeMain(pid) {
  const p = adminPhotos.find(x => x.id === pid);
  if (!p) return;
  adminPhotos = [p, ...adminPhotos.filter(x => x.id !== pid)];
  adminPhotos.forEach((x, i) => { x.position = i; });
  await Promise.all(adminPhotos.map(x => sb.from('listing_photos').update({ position: x.position }).eq('id', x.id)));
  renderAdminPhotos();
  toast('Photo principale modifiée.');
}
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
    return blob || file;
  } catch { return file; }
}
async function addPhotos(fileList) {
  for (const f of Array.from(fileList)) {
    if (adminPhotos.length + postFiles.length >= MAX_PHOTOS) { toast(`Maximum ${MAX_PHOTOS} photos.`); break; }
    if (!f.type.startsWith('image/')) continue;
    const blob = await shrink(f);
    postFiles.push({ blob, url: URL.createObjectURL(blob) });
  }
  renderPreviews();
}
function renderPreviews() {
  const box = document.getElementById('previews');
  if (!box) return;
  box.innerHTML = postFiles.map((f, i) => `<div class="pv"><img src="${f.url}" alt="Nouvelle photo ${i + 1}"><button type="button" aria-label="Retirer" onclick="removePhoto(${i})">✕</button><em class="new">Nouvelle</em></div>`).join('');
}
function removePhoto(i) { URL.revokeObjectURL(postFiles[i].url); postFiles.splice(i, 1); renderPreviews(); }

async function saveListing(id) {
  const err = document.getElementById('x-err'), btn = document.getElementById('x-save');
  err.textContent = '';
  const price = parseInt(val('x-price'), 10);
  if (val('x-title').length < 3) return (err.textContent = 'Ajoutez un titre (3 caractères minimum).');
  if (!(price >= 0) || isNaN(price)) return (err.textContent = 'Indiquez un prix valide.');
  if (!id && !postFiles.length) return (err.textContent = 'Ajoutez au moins une photo.');
  if (id && !adminPhotos.length && !postFiles.length) return (err.textContent = 'Ajoutez au moins une photo.');
  const t = document.querySelector('input[name=lt]:checked').value;
  btn.disabled = true; btn.textContent = 'Enregistrement…';
  const fail = msg => { btn.disabled = false; btn.textContent = id ? 'Enregistrer les modifications' : "Publier l'annonce"; err.textContent = msg; };

  let ownerId = val('x-owner') && val('x-owner') !== 'new' ? parseInt(val('x-owner'), 10) : null;
  if (val('x-owner') === 'new') {
    if (!val('x-on') || !val('x-op')) return fail('Nom et téléphone du propriétaire obligatoires.');
    const { data: o, error: oe } = await sb.from('owners').insert({ full_name: val('x-on'), phone: val('x-op'), whatsapp: val('x-ow') }).select('id').single();
    if (oe) return fail('Erreur propriétaire : ' + oe.message);
    ownerId = o.id;
  }
  const row = {
    listing_type: t, property_type: val('x-pt'), title: val('x-title'), description: val('x-desc'),
    commune: val('x-commune'), quartier: val('x-quartier'), price,
    bedrooms: parseInt(val('x-beds'), 10) || 0, bathrooms: parseInt(val('x-baths'), 10) || 0, area_sqm: parseInt(val('x-area'), 10) || 0,
    furnished: document.querySelector('input[name=furn]:checked').value === 'yes',
    max_guests: t === 'short_stay' ? (parseInt(val('x-guests'), 10) || null) : null,
    amenities: Array.from(document.querySelectorAll('input[name=am]:checked')).map(x => x.value),
    status: val('x-status'), paid_until: val('x-paid') || null, verified: document.getElementById('x-verified').checked,
    owner_contact_id: ownerId, admin_notes: val('x-notes')
  };
  let listingId = id;
  if (id) {
    const { error } = await sb.from('listings').update(row).eq('id', id);
    if (error) return fail('Erreur : ' + error.message);
  } else {
    row.created_by = user.id;
    const { data, error } = await sb.from('listings').insert(row).select('id').single();
    if (error) return fail('Erreur : ' + error.message);
    listingId = data.id;
  }
  let failed = 0;
  let pos = adminPhotos.length ? Math.max(...adminPhotos.map(p => p.position)) + 1 : 0;
  for (const f of postFiles) {
    const path = `${listingId}/${crypto.randomUUID()}.jpg`;
    const up = await sb.storage.from('listing-photos').upload(path, f.blob, { contentType: 'image/jpeg' });
    if (up.error) { failed++; continue; }
    const ins = await sb.from('listing_photos').insert({ listing_id: listingId, path, position: pos++ });
    if (ins.error) failed++;
  }
  toast(failed ? `Enregistré (${failed} photo(s) non envoyée(s)).` : (id ? 'Modifications enregistrées.' : 'Annonce publiée !'));
  location.hash = id ? '#/admin?tab=listings' : '#/listing/' + listingId;
}
