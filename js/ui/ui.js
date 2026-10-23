/* WT.ui — panele, pasek górny, ekran startowy, dyplomacja, God Mode, zapis, dziennik, toasty, modale, skróty.
 * Klasyczny skrypt. Korzysta wyłącznie z API z docs/SPEC.md §4 (wywołania defensywne). */
(function () {
  'use strict';
  const WT = window.WT = window.WT || {};
  const UI = WT.ui = {};
  const R = () => WT.render;
  const G = () => WT.G || null;
  const $ = (id) => document.getElementById(id);
  const MAP = () => window.MAP_DATA;

  // ===========================================================================
  // Stan UI
  // ===========================================================================
  const S = {
    inGame: false,
    startCC: null,
    sel: null,              // { type: 'army'|'fleet', id }
    selProv: -1,
    diploCC: null,
    diploQuery: '',
    godTool: null,          // 'take' | 'army'
    godCC: null,
    godArmyK: 50,
    busy: false,
    modals: [],
    answered: {},
    recruitK: 10,
    shipsN: 2,
    lastHoverKey: ''
  };
  UI.state = S;
  UI.missingApi = {};

  // ===========================================================================
  // Bezpieczne wywołania API logiki
  // ===========================================================================
  function apiRef(path) {
    let o = WT, owner = null;
    for (const part of path.split('.')) { if (o == null) return null; owner = o; o = o[part]; }
    return typeof o === 'function' ? { fn: o, owner: owner } : null;
  }
  function apiFn(path) { const r = apiRef(path); return r ? r.fn : null; }
  function has(path) { return !!apiFn(path); }
  function call(path, args, fallback) {
    const ref = apiRef(path);
    if (!ref) {
      if (!UI.missingApi[path]) { UI.missingApi[path] = true; console.warn('[ui] brak API: WT.' + path); }
      return fallback;
    }
    try { return ref.fn.apply(ref.owner, args || []); }
    catch (e) { console.error('[ui] WT.' + path + ' rzucił wyjątek', e); return fallback; }
  }
  UI.call = call;

  // ===========================================================================
  // Formatowanie
  // ===========================================================================
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function fmtInt(n) { return Math.round(n || 0).toLocaleString('pl-PL'); }
  function fmtNum(n, d) { return (+n || 0).toLocaleString('pl-PL', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function fmtBn(n) { return fmtNum(n, Math.abs(n) >= 100 ? 0 : 1) + ' mld $'; }
  function fmtSigned(n, d) { const v = +n || 0; return (v > 0 ? '+' : v < 0 ? '−' : '') + fmtNum(Math.abs(v), d == null ? 1 : d); }
  function fmtK(n) { return R() && R().fmtK ? R().fmtK(n) : Math.round(n / 1000) + 'k'; }
  function fmtManK(k) { return k >= 1000 ? fmtNum(k / 1000, 2) + ' mln' : fmtInt(k) + ' tys.'; }
  function plural(n, one, few, many) {
    n = Math.abs(n);
    if (n === 1) return one;
    const d = n % 10, dd = n % 100;
    return d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? few : many;
  }
  function turnsText(n) { return n + ' ' + plural(n, 'tura', 'tury', 'tur'); }
  const TERRAIN_PL = { plains: 'Równiny', hills: 'Wzgórza', mountains: 'Góry', desert: 'Pustynia', forest: 'Lasy', tundra: 'Tundra', jungle: 'Dżungla' };
  const IDEOLOGY_PL = { demokracja: 'Demokracja', autorytaryzm: 'Autorytaryzm', teokracja: 'Teokracja', monarchia: 'Monarchia', komunizm: 'Komunizm' };

  // ===========================================================================
  // Dostęp do danych
  // ===========================================================================
  const me = () => (G() ? G().player : null);
  function countryName(cc) { return R() ? R().countryName(cc) : cc; }
  function countryColor(cc) { return R() ? R().countryColor(cc) : '#888'; }
  function staticCountry(cc) { return (window.COUNTRY_DATA && window.COUNTRY_DATA[cc]) || {}; }
  function liveCountry(cc) { return G() && G().countries ? G().countries[cc] : null; }
  function provStatic(id) { return MAP().provinces[id]; }
  function provDyn(id) { return G() ? G().provinces[id] : null; }
  function isGod() { const g = G(); if (!g) return false; return has('god.enabled') ? !!call('god.enabled', [], g.god) : !!g.god; }
  function armiesIn(id) {
    if (has('state.armiesIn')) return call('state.armiesIn', [id], []) || [];
    return Object.values(G().armies || {}).filter((a) => a.prov === id && !a.embarked);
  }
  function fleetsIn(id) {
    if (has('state.fleetsIn')) return call('state.fleetsIn', [id], []) || [];
    return Object.values(G().fleets || {}).filter((f) => f.prov === id);
  }
  function armiesOf(cc) { return Object.values(G().armies || {}).filter((a) => a.owner === cc); }
  function provincesOf(cc) {
    if (G() && has('state.provincesOf')) return call('state.provincesOf', [cc], []) || [];
    const out = [];
    MAP().provinces.forEach((p, i) => { if ((G() ? G().provinces[i].owner : p.cc) === cc) out.push(i); });
    return out;
  }
  function aliveCountries() {
    const g = G();
    if (g) {
      const list = has('state.countriesAlive') ? call('state.countriesAlive', [], null) : null;
      return list || Object.keys(g.countries).filter((cc) => g.countries[cc].alive !== false);
    }
    const set = {};
    MAP().provinces.forEach((p) => { set[p.cc] = 1; });
    return Object.keys(set);
  }
  function rel(a, b) { return call('diplomacy.relation', [a, b], 0) || 0; }
  function atWar(a, b) { return !!call('diplomacy.atWar', [a, b], false); }
  function allied(a, b) { return !!call('diplomacy.allied', [a, b], false); }
  function hasPact(a, b) { return !!call('diplomacy.hasPact', [a, b], false); }
  function hasTruce(a, b) { return !!call('diplomacy.hasTruce', [a, b], false); }
  function sortByName(list) { return list.sort((a, b) => countryName(a).localeCompare(countryName(b), 'pl')); }
  function dateStr() { return has('state.dateStr') ? call('state.dateStr', [], G().date) : G().date; }

  function statusTags(cc) {
    const p = me(); if (!p) return '';
    if (cc === p) return '<span class="tag self">Ty</span>';
    let t = '';
    if (atWar(p, cc)) t += '<span class="tag war">Wojna</span>';
    if (allied(p, cc)) t += '<span class="tag ally">Sojusz</span>';
    if (hasPact(p, cc)) t += '<span class="tag pact">Pakt</span>';
    if (hasTruce(p, cc)) t += '<span class="tag truce">Rozejm</span>';
    return t;
  }
  function relClass(v) { return v > 15 ? 'pos' : v < -15 ? 'neg' : 'dim'; }
  function swatch(cc) { return '<span class="swatch" style="background:' + esc(countryColor(cc)) + '"></span>'; }

  // ===========================================================================
  // Modale, toasty, potwierdzenia
  // ===========================================================================
  function openModal(opts) {
    const root = $('modal-root');
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = '<div class="modal ' + (opts.wide ? 'wide' : '') + '"><div class="modal-head"><h3>' + opts.title + '</h3></div>' +
      '<div class="modal-body"></div><div class="modal-foot"></div></div>';
    const body = back.querySelector('.modal-body');
    if (typeof opts.body === 'string') body.innerHTML = opts.body; else if (opts.body) body.appendChild(opts.body);
    const foot = back.querySelector('.modal-foot');
    const entry = { el: back, onClose: opts.onClose, dismissable: opts.dismissable !== false };
    const close = () => closeModal(entry);
    (opts.buttons || [{ label: 'Zamknij' }]).forEach((b) => {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (b.cls || '');
      btn.textContent = b.label;
      btn.addEventListener('click', () => { if (b.onClick) b.onClick(close); if (b.close !== false) close(); });
      foot.appendChild(btn);
    });
    if (!(opts.buttons || [1]).length) foot.remove();
    back.addEventListener('mousedown', (e) => { if (e.target === back && entry.dismissable) close(); });
    root.appendChild(back);
    S.modals.push(entry);
    const primary = foot.querySelector('.btn-primary, .btn-ok');
    if (primary && opts.focusPrimary !== false) setTimeout(() => primary.focus(), 0);
    if (opts.onOpen) opts.onOpen(back, close);
    return close;
  }
  function closeModal(entry) {
    const i = S.modals.indexOf(entry); if (i < 0) return;
    S.modals.splice(i, 1);
    entry.el.remove();
    if (entry.onClose) entry.onClose();
  }
  function closeTopModal() {
    const top = S.modals[S.modals.length - 1];
    if (top && top.dismissable) { closeModal(top); return true; }
    return !!top;
  }
  function confirmModal(title, text, okLabel, onOk, danger) {
    openModal({ title: esc(title), body: '<p>' + text + '</p>', buttons: [
      { label: 'Anuluj' },
      { label: okLabel, cls: danger ? 'btn-danger' : 'btn-primary', onClick: onOk }
    ] });
  }
  UI.openModal = openModal;

  function toast(text, kind, ms) {
    const box = $('toasts');
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 6) box.firstChild.remove();
    setTimeout(() => { el.classList.add('fade'); setTimeout(() => el.remove(), 450); }, ms || 4200);
  }
  UI.toast = toast;
  function resultToast(res, okText) {
    if (!res) { toast('Akcja niedostępna', 'bad'); return false; }
    const ok = res.ok === true || res.accepted === true;
    toast(res.reason || (ok ? okText || 'Wykonano' : 'Odrzucono'), ok ? 'ok' : 'bad');
    return ok;
  }
  function classifyText(t) {
    const s = (t || '').toLowerCase();
    if (/wojn|atak|inwaz/.test(s)) return 'war';
    if (/bitw|starci|pokonan|zwycię/.test(s)) return 'battle';
    if (/pok[oó]j|sojusz|pakt|rozejm/.test(s)) return 'peace';
    return '';
  }

  // ===========================================================================
  // Ekran startowy
  // ===========================================================================
  function startCountries() {
    const cd = window.COUNTRY_DATA || {};
    return sortByName(aliveCountries().filter((cc) => cc && (cd[cc] || true)));
  }
  function renderStartList() {
    const q = $('start-search').value.trim().toLowerCase();
    const list = startCountries().filter((cc) => !q || countryName(cc).toLowerCase().includes(q) || cc.toLowerCase().includes(q));
    $('start-results').innerHTML = list.map((cc) => {
      const d = staticCountry(cc);
      return '<div class="country-item' + (cc === S.startCC ? ' sel' : '') + '" data-cc="' + esc(cc) + '">' + swatch(cc) +
        '<span class="name">' + esc(countryName(cc)) + '</span><span class="faint mono">' + (d.gdp ? fmtInt(d.gdp) + ' mld $' : '') + '</span></div>';
    }).join('') || '<div class="country-item faint">Brak wyników</div>';
  }
  function renderStartCard() {
    const cc = S.startCC, card = $('start-card');
    if (!cc) { card.className = 'country-card empty'; card.textContent = 'Kliknij państwo na mapie lub wybierz z listy.'; return; }
    const d = staticCountry(cc);
    card.className = 'country-card';
    card.innerHTML = '<h3>' + swatch(cc) + esc(countryName(cc)) + '</h3><div class="kv">' +
      '<span class="k">PKB</span><span class="v">' + (d.gdp != null ? fmtInt(d.gdp) + ' mld $' : '—') + '</span>' +
      '<span class="k">Populacja</span><span class="v">' + (d.pop != null ? fmtNum(d.pop, 1) + ' mln' : '—') + '</span>' +
      '<span class="k">Armia</span><span class="v">' + (d.army != null ? fmtInt(d.army) + ' tys.' : '—') + '</span>' +
      '<span class="k">Flota</span><span class="v">' + (d.navy != null ? fmtInt(d.navy) + ' ' + plural(d.navy, 'eskadra', 'eskadry', 'eskadr') : '—') + '</span>' +
      '<span class="k">Ustrój</span><span class="v txt">' + esc(d.gov || '—') + (d.ideology ? ' · ' + esc(IDEOLOGY_PL[d.ideology] || d.ideology) : '') + '</span>' +
      '<span class="k">Prowincje</span><span class="v">' + provincesOf(cc).length + '</span></div>';
  }
  function selectStartCountry(cc, center) {
    S.startCC = cc || null;
    R().view.highlightCC = S.startCC;
    $('btn-start').disabled = !S.startCC;
    renderStartList(); renderStartCard();
    const el = $('start-results').querySelector('.sel');
    if (el) el.scrollIntoView({ block: 'nearest' });
    if (center && cc) R().centerOnCountry(cc, 0.9, startPanelWidth());
    R().requestDraw();
  }
  function startPanelWidth() { const el = document.querySelector('.start-panel'); return el ? el.offsetWidth + 18 : 0; }
  function showStart() {
    S.inGame = false; S.sel = null; S.selProv = -1; S.godTool = null;
    ['topbar', 'mapmodes', 'log', 'province-panel', 'diplo-panel', 'god-panel', 'order-bar', 'menu', 'legend'].forEach((id) => $(id).classList.add('hidden'));
    $('start-screen').classList.remove('hidden');
    const v = R().view; v.startScreen = true; v.sel = null; v.selProv = -1; v.preview = null; v.pending = null;
    R().setMode('political');
    R().invalidate();
    selectStartCountry(S.startCC, false);
    if (S.startCC) R().centerOnCountry(S.startCC, 0.9, startPanelWidth());
    else { const c = R().lonLatToMap(42, 47); R().centerOn(c[0] - startPanelWidth() / 2 / 0.55, c[1], 0.55); }
    if (!$('start-hint')) {
      const h = document.createElement('div'); h.id = 'start-hint'; h.className = 'start-hint';
      h.textContent = 'Przeciągnij mapę, kółko myszy = zoom, kliknij państwo aby je wybrać';
      $('start-screen').appendChild(h);
    }
  }
  UI.showStart = showStart;
  function startGame() {
    if (!S.startCC) return;
    const opts = { player: S.startCC, god: $('opt-god').checked, startWars: $('opt-wars').checked, seed: Math.floor(Math.random() * 1e9) };
    const g = call('state.newGame', [opts], null);
    if (!g && !G()) { toast('Nie udało się utworzyć gry (brak WT.state.newGame)', 'bad'); return; }
    if (g && !WT.G) WT.G = g;
    enterGame(true);
  }
  function bindStart() {
    $('start-search').addEventListener('input', renderStartList);
    $('start-results').addEventListener('click', (e) => { const it = e.target.closest('[data-cc]'); if (it) selectStartCountry(it.dataset.cc, true); });
    $('btn-start').addEventListener('click', startGame);
    $('btn-load').addEventListener('click', openSaveMenu);
  }

  // ===========================================================================
  // Wejście do gry / odświeżanie
  // ===========================================================================
  function enterGame(centerView) {
    S.inGame = true; S.sel = null; S.selProv = -1; S.diploCC = null; S.godTool = null; S.answered = {}; S.gameOverShown = false; S.proposalOpen = false;
    $('start-screen').classList.add('hidden');
    ['topbar', 'mapmodes', 'log'].forEach((id) => $(id).classList.remove('hidden'));
    ['province-panel', 'diplo-panel', 'god-panel', 'order-bar'].forEach((id) => $(id).classList.add('hidden'));
    const v = R().view; v.startScreen = false; v.highlightCC = null; v.sel = null; v.selProv = -1; v.preview = null; v.pending = null;
    S.godCC = me();
    R().invalidate();
    if (centerView) R().centerOnCountry(me(), 0.8);
    refreshAll();
    setTimeout(checkProposals, 300);
  }
  UI.enterGame = enterGame;
  function refreshAll() {
    if (!S.inGame || !G()) return;
    S.lastHoverKey = '';
    renderTopbar();
    if (!$('province-panel').classList.contains('hidden')) renderProvincePanel();
    if (!$('diplo-panel').classList.contains('hidden')) renderDiplomacy();
    if (!$('god-panel').classList.contains('hidden')) renderGodPanel();
    renderLog();
    renderLegend();
    R().requestDraw();
  }
  UI.refresh = refreshAll;

  // ===========================================================================
  // Górny pasek i menu
  // ===========================================================================
  function renderTopbar() {
    const cc = me(), c = liveCountry(cc) || {};
    $('tb-swatch').style.background = countryColor(cc);
    $('tb-name').textContent = countryName(cc);
    $('tb-date').textContent = dateStr();
    const god = isGod();
    $('tb-treasury').textContent = god ? '∞' : fmtBn(c.treasury || 0);
    $('tb-treasury').className = 'val num' + (!god && c.treasury < 0 ? ' neg' : '');
    const bal = has('economy.balance') ? call('economy.balance', [cc], 0) : (c.lastIncome || 0) - (c.lastExpense || 0);
    $('tb-balance').textContent = god ? '∞' : fmtSigned(bal, 2);
    $('tb-balance').className = 'val num ' + (god ? '' : bal >= 0 ? 'pos' : 'neg');
    $('tb-manpower').textContent = god ? '∞' : fmtManK(c.manpower || 0);
    const st = Math.round(c.stability || 0);
    $('tb-stability').textContent = st + '%';
    $('tb-stability').className = 'val num ' + (st >= 60 ? 'pos' : st < 35 ? 'neg' : '');
    $('tb-army').textContent = fmtK(armiesOf(cc).reduce((s, a) => s + (a.size || 0), 0));
    $('tb-god').classList.toggle('hidden', !god);
    $('btn-god').classList.toggle('hidden', !god);
    $('menu-god-toggle').textContent = god ? 'Wyłącz God Mode' : 'Włącz God Mode';
    $('btn-endturn').disabled = S.busy;
  }
  function toggleMenu(force) {
    const m = $('menu');
    const show = force != null ? force : m.classList.contains('hidden');
    m.classList.toggle('hidden', !show);
  }
  function setGodMode(on) {
    const g = G(); if (!g) return;
    if (has('god.toggle')) call('god.toggle', [!!on]); else g.god = !!on;
    if (!on) { S.godTool = null; $('god-panel').classList.add('hidden'); }
    toast(on ? 'God Mode włączony — nielimitowana kasa' : 'God Mode wyłączony', on ? 'ok' : '');
    refreshAll();
  }
  function onMenuAction(act) {
    toggleMenu(false);
    if (act === 'save') openSaveMenu();
    else if (act === 'god-toggle') setGodMode(!isGod());
    else if (act === 'help') openHelp();
    else if (act === 'exit') confirmModal('Wyjście', 'Wrócić do menu głównego? Niezapisany postęp zostanie utracony (autozapis co 5 tur).', 'Wyjdź', () => { WT.G = null; showStart(); }, true);
  }
  function openHelp() {
    const rows = [['Spacja', 'Koniec tury'], ['W A S D / strzałki', 'Przesuwanie mapy'], ['+ / −, kółko', 'Zoom'], ['1 – 4', 'Tryby mapy'],
      ['LPM na armii', 'Zaznacz armię'], ['Przeciągnij armię', 'Rozkaz ruchu'], ['PPM na prowincji', 'Rozkaz ruchu dla zaznaczonej jednostki'],
      ['Enter', 'Potwierdź rozkaz'], ['M', 'Scal armie w prowincji'], ['Esc', 'Anuluj / odznacz / zamknij']];
    openModal({ title: 'Skróty klawiszowe', body: '<div class="shortcuts">' + rows.map((r) => '<kbd>' + esc(r[0]) + '</kbd><span>' + esc(r[1]) + '</span>').join('') + '</div>' });
  }
  function bindTopbar() {
    $('btn-endturn').addEventListener('click', endTurn);
    $('btn-menu').addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
    $('btn-diplomacy').addEventListener('click', () => toggleDiplomacy());
    $('btn-god').addEventListener('click', () => toggleGodPanel());
    $('tb-country').addEventListener('click', () => R().centerOnCountry(me(), 0.8));
    $('menu').addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) onMenuAction(b.dataset.act); });
    document.addEventListener('mousedown', (e) => { if (!e.target.closest('#menu') && !e.target.closest('#btn-menu')) toggleMenu(false); });
  }

  // ===========================================================================
  // Tryby mapy + legenda
  // ===========================================================================
  const MODES = ['political', 'diplomatic', 'economic', 'terrain'];
  function setMapMode(m) {
    R().setMode(m);
    document.querySelectorAll('.mm-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
    renderLegend();
  }
  UI.setMapMode = setMapMode;
  function legendItem(color, label) { return '<span class="li"><span class="sw" style="background:' + color + '"></span>' + esc(label) + '</span>'; }
  function renderLegend() {
    const m = R().getMode(), el = $('legend');
    let html = '';
    if (m === 'diplomatic') html = legendItem('#e0c068', 'Ty') + legendItem('#3b7dd8', 'Sojusznik') + legendItem('#4aa3a0', 'Pakt') + legendItem('#c0392b', 'Wojna') +
      '<span class="li">Relacje <span class="grad" style="background:linear-gradient(90deg,#9b3b36,#6c7076,#3f9a52)"></span></span>';
    else if (m === 'economic') html = '<span class="li">Rozwój i fabryki: niski <span class="grad" style="background:linear-gradient(90deg,#2b2f45,#7c6a2c,#f2d45c)"></span> wysoki</span>';
    else if (m === 'terrain') html = [['#8fae5e', 'plains'], ['#b0a060', 'hills'], ['#8c7b6b', 'mountains'], ['#4f7f45', 'forest'], ['#d8c27e', 'desert'], ['#a9b8bd', 'tundra'], ['#2f7a4f', 'jungle']]
      .map((t) => legendItem(t[0], TERRAIN_PL[t[1]])).join('');
    el.innerHTML = html;
    el.classList.toggle('hidden', !html || !S.inGame);
  }
  function bindMapModes() {
    $('mapmodes').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) setMapMode(b.dataset.mode); });
  }

  // ===========================================================================
  // Zaznaczanie jednostek i prowincji
  // ===========================================================================
  function unitObj(sel) {
    if (!sel || !G()) return null;
    return sel.type === 'army' ? (G().armies || {})[sel.id] : (G().fleets || {})[sel.id];
  }
  function selectUnit(u) {
    S.sel = u ? { type: u.type, id: u.id } : null;
    R().view.sel = S.sel;
    R().view.preview = null;
    closeOrderBar();
    const obj = unitObj(S.sel);
    if (obj) openProvince(obj.prov);
    R().requestDraw();
  }
  UI.selectUnit = selectUnit;
  function deselect() {
    S.sel = null; R().view.sel = null; R().view.preview = null;
    closeOrderBar();
    R().requestDraw();
  }
  function validateSelection() {
    if (S.sel && !unitObj(S.sel)) deselect();
  }

  // ===========================================================================
  // Planowanie rozkazów (podgląd trasy)
  // ===========================================================================
  function estimateLandTurns(army, path) {
    if (has('military.estimateTurns')) { const t = call('military.estimateTurns', [army.owner, path], null); if (typeof t === 'number') return t; }
    let turns = 1, pts = 2;
    for (let i = 0; i < path.length; i++) {
      const id = path[i], t = provStatic(id).terrain;
      const ctrl = G().provinces[id].ctrl || G().provinces[id].owner;
      const hostile = ctrl !== army.owner && atWar(army.owner, ctrl);
      const cost = (hostile ? 2 : 1) + (t === 'mountains' || t === 'jungle' ? 1 : 0);
      if (pts <= 0 || (cost > pts && pts < 2)) { turns++; pts = 2; }
      pts -= cost;
      if (hostile) pts = 0;
      if (pts < 0) pts = 0;
    }
    return turns;
  }
  function seaTurns(path) {
    const t = has('naval.seaTurns') ? call('naval.seaTurns', [path], null) : null;
    return Math.max(1, typeof t === 'number' ? t : Math.ceil(path.length / 3));
  }
  function fleetFree(f) {
    if (has('naval.freeCapacity')) { const v = call('naval.freeCapacity', [f], null); if (typeof v === 'number') return v; }
    const used = (f.cargo || []).reduce((s, id) => s + (((G().armies || {})[id] || {}).size || 0), 0);
    return (f.ships || 0) * 10000 - used;
  }
  // Desant korzysta z jednej floty (o największej wolnej pojemności).
  function ownFleetCapacity(army) {
    const fl = fleetsIn(army.prov).filter((f) => f.owner === army.owner);
    return { fleets: fl.length, cap: fl.reduce((m, f) => Math.max(m, fleetFree(f)), 0) };
  }
  function planArmy(a, target) {
    const from = a.prov;
    const path = call('military.findPath', [a, target], null);
    if (path && path.length) {
      const turns = estimateLandTurns(a, path);
      return { ok: true, kind: 'land', target, path, turns, points: R().landPoints(from, path), label: turnsText(turns) };
    }
    const ps = provStatic(target), pf = provStatic(from);
    if (ps.coastal && pf.coastal) {
      const sp = call('naval.seaPath', [from, target], null);
      if (sp && sp.length) {
        const pts = [R().provPoint(from)].concat(R().seaPoints(from, sp), [R().provPoint(target)]);
        const cap = ownFleetCapacity(a);
        const turns = seaTurns(sp);
        const plan = { ok: true, kind: 'sea', target, path: sp, turns, points: pts, label: turnsText(turns) + ' · desant', capacity: cap.cap };
        if (!cap.fleets) { plan.ok = false; plan.reason = 'Desant wymaga własnej floty w tej prowincji'; plan.label = 'brak floty'; }
        else if (cap.cap <= 0) { plan.ok = false; plan.reason = 'Flota nie ma wolnej pojemności'; plan.label = 'brak miejsca'; }
        return plan;
      }
    }
    return { ok: false, kind: 'land', target, points: [R().provPoint(from), R().provPoint(target)], label: 'brak trasy',
      reason: 'Brak trasy — prowincja niedostępna (neutralne państwo bez wojny) lub brak połączenia' };
  }
  function planFleet(f, target) {
    const ps = provStatic(target);
    if (!ps.coastal) return { ok: false, kind: 'fleet', target, points: [R().portPoint(f.prov), R().provPoint(target)], label: 'ląd', reason: 'Flota może płynąć tylko do prowincji nadmorskiej' };
    const sp = call('naval.seaPath', [f.prov, target], null);
    if (!sp || !sp.length) return { ok: false, kind: 'fleet', target, points: [R().portPoint(f.prov), R().portPoint(target)], label: 'brak trasy', reason: 'Brak trasy morskiej' };
    const turns = seaTurns(sp);
    return { ok: true, kind: 'fleet', target, path: sp, turns, points: R().seaPoints(f.prov, sp), label: turnsText(turns) };
  }
  function planOrder(sel, target) {
    const u = unitObj(sel);
    if (!u || target == null || target < 0 || target === u.prov) return null;
    return sel.type === 'army' ? planArmy(u, target) : planFleet(u, target);
  }
  UI.planOrder = planOrder;
  function updatePreview(target) {
    if (!S.sel || R().view.pending) return;
    R().view.preview = planOrder(S.sel, target);
  }

  // ===========================================================================
  // Pasek rozkazu: "Wyślij: [suwak] 12 500 / 25 000 [Rozkaż]"
  // ===========================================================================
  function openOrderBar(target) {
    const u = unitObj(S.sel); if (!u) return;
    const plan = planOrder(S.sel, target);
    if (!plan) { closeOrderBar(); return; }
    R().view.pending = plan; R().view.preview = null;
    const bar = $('order-bar');
    const name = esc(provStatic(target).name);
    const routeCls = plan.kind === 'land' ? '' : ' sea';
    const routeTxt = plan.ok ? (plan.kind === 'land' ? 'Trasa lądowa: ' : plan.kind === 'sea' ? 'Desant morski: ' : 'Rejs: ') + turnsText(plan.turns) : '';
    const routeHtml = plan.ok ? '<span class="ob-route' + routeCls + '">' + routeTxt + '</span>' : '<span class="reason">' + esc(plan.reason) + '</span>';
    const buttons = '<button class="btn btn-primary" id="ob-go"' + (plan.ok ? '' : ' disabled') + '>Rozkaż <kbd>Enter</kbd></button><button class="btn btn-ghost" id="ob-cancel">Anuluj <kbd>Esc</kbd></button>';
    let html;
    if (S.sel.type === 'army') {
      const max = u.size, step = max > 20000 ? 500 : 100;
      const def = plan.kind === 'sea' && plan.capacity ? Math.min(max, Math.floor(plan.capacity / step) * step || max) : max;
      html = '<div class="ob-head"><span class="ob-title">Armia ' + fmtK(u.size) + ' → ' + name + '</span>' + routeHtml + '</div>' +
        '<div class="ob-row"><span class="dim">Wyślij:</span><input type="range" id="ob-size" min="' + Math.min(step, max) + '" max="' + max + '" step="' + step + '" value="' + def + '"' + (plan.ok ? '' : ' disabled') + '>' +
        '<span class="ob-count" id="ob-count"></span>' + buttons + '</div>';
    } else {
      html = '<div class="ob-head"><span class="ob-title">Flota (' + u.ships + ' ' + plural(u.ships, 'eskadra', 'eskadry', 'eskadr') + ') → ' + name + '</span>' + routeHtml + '</div>' +
        '<div class="ob-row" style="justify-content:flex-end">' + buttons + '</div>';
    }
    bar.innerHTML = html;
    bar.classList.remove('hidden');
    const slider = $('ob-size');
    if (slider) { const upd = () => { $('ob-count').innerHTML = '<b>' + fmtInt(+slider.value) + '</b> / ' + fmtInt(u.size); }; slider.addEventListener('input', upd); upd(); }
    $('ob-go').addEventListener('click', confirmOrder);
    $('ob-cancel').addEventListener('click', () => { closeOrderBar(); R().requestDraw(); });
    R().requestDraw();
  }
  function closeOrderBar() {
    $('order-bar').classList.add('hidden');
    $('order-bar').innerHTML = '';
    if (R()) R().view.pending = null;
  }
  function orderBarOpen() { return !$('order-bar').classList.contains('hidden'); }
  function confirmOrder() {
    const plan = R().view.pending, u = unitObj(S.sel);
    if (!plan || !u || !plan.ok) return;
    let res;
    if (S.sel.type === 'fleet') res = call('naval.orderFleet', [u.id, plan.target], null);
    else {
      const size = $('ob-size') ? +$('ob-size').value : u.size;
      const sizeArg = size < u.size ? size : undefined;
      if (plan.kind === 'sea') res = call('naval.planInvasion', [u.id, plan.target, sizeArg], null);
      else res = call('military.order', [u.id, plan.target, sizeArg], null);
    }
    closeOrderBar();
    if (!res || res.ok === false) toast((res && res.reason) || 'Nie można wydać rozkazu', 'bad');
    else toast(res.reason || (plan.kind === 'sea' ? 'Desant zaplanowany' : 'Rozkaz wydany: ' + provStatic(plan.target).name + ' (' + turnsText(plan.turns) + ')'), 'ok', 2200);
    R().view.preview = null;
    validateSelection();
    refreshAll();
  }

  // ===========================================================================
  // Panel prowincji
  // ===========================================================================
  function openProvince(id) {
    if (id == null || id < 0) return;
    S.selProv = id; R().view.selProv = id;
    $('province-panel').classList.remove('hidden');
    renderProvincePanel();
    R().requestDraw();
  }
  UI.openProvince = openProvince;
  function closeProvince() {
    S.selProv = -1; R().view.selProv = -1;
    $('province-panel').classList.add('hidden');
    R().requestDraw();
  }
  function renderProvincePanel() {
    const id = S.selProv; if (id < 0 || !G()) return;
    const ps = provStatic(id), pd = provDyn(id), owner = pd.owner, ctrl = pd.ctrl || owner;
    const mine = owner === me();
    let html = '<div class="panel-head">' + swatch(owner) + '<h2>' + esc(ps.name) + '</h2><button class="close" data-act="close" title="Zamknij (Esc)">×</button></div><div class="panel-body">';
    html += provinceInfoSection(ps, pd, owner, ctrl);
    html += provinceUnitsSection(id);
    if (mine) html += buildingsSection(id, pd) + recruitSection(id, ctrl) + shipsSection(id, ps, pd);
    else html += '<div class="section"><button class="btn" data-act="diplo" style="width:100%;justify-content:center">Dyplomacja z: ' + esc(countryName(owner)) + '</button></div>';
    html += '</div>';
    const panel = $('province-panel');
    const scroll = panel.scrollTop;
    panel.innerHTML = html;
    panel.scrollTop = scroll;
    bindProvincePanel(id);
  }
  function provinceInfoSection(ps, pd, owner, ctrl) {
    let h = '<div class="section"><div class="kv">';
    h += '<span class="k">Właściciel</span><span class="v txt">' + esc(countryName(owner)) + ' ' + statusTags(owner) + '</span>';
    h += '<span class="k">Kontrola</span><span class="v txt">' + (ctrl !== owner ? '<span class="tag occ">Okupacja</span> ' + esc(countryName(ctrl)) : esc(countryName(ctrl))) + '</span>';
    h += '<span class="k">Populacja</span><span class="v">' + fmtNum(ps.pop || 0, 2) + ' mln</span>';
    h += '<span class="k">Powierzchnia</span><span class="v">' + fmtInt(ps.areaKm2) + ' km²</span>';
    h += '<span class="k">Teren</span><span class="v txt">' + esc(TERRAIN_PL[ps.terrain] || ps.terrain || '—') + (ps.coastal ? ' · wybrzeże' : '') + '</span>';
    if (pd.dev != null) h += '<span class="k">Rozwój</span><span class="v">' + fmtNum(pd.dev, 2) + '</span>';
    if (pd.unrest) h += '<span class="k">Niepokoje</span><span class="v ' + (pd.unrest > 30 ? 'neg' : '') + '">' + fmtInt(pd.unrest) + '</span>';
    return h + '</div></div>';
  }
  function armyStatus(a) {
    if (a.embarked) return 'na okrętach';
    if (a.path && a.path.length) return '→ ' + provStatic(a.path[a.path.length - 1]).name;
    if (a.moved >= 99) return 'nowo zrekrutowana';
    return 'w gotowości';
  }
  function provinceUnitsSection(id) {
    const armies = armiesIn(id), fleets = fleetsIn(id);
    if (!armies.length && !fleets.length) return '';
    let h = '<div class="section"><div class="section-title">Jednostki</div>';
    armies.forEach((a) => {
      const c = countryColor(a.owner), light = R().luminance(c) > 0.62;
      const sel = S.sel && S.sel.type === 'army' && S.sel.id === a.id;
      h += '<div class="army-row' + (sel ? ' sel' : '') + '" data-army="' + esc(a.id) + '"><span class="army-chip" style="background:' + c + ';color:' + (light ? '#111' : '#fff') + '">' + fmtK(a.size) +
        '</span><span>' + esc(countryName(a.owner)) + '</span><span class="faint" style="margin-left:auto">' + esc(armyStatus(a)) + '</span></div>';
    });
    fleets.forEach((f) => {
      const sel = S.sel && S.sel.type === 'fleet' && S.sel.id === f.id;
      h += '<div class="army-row' + (sel ? ' sel' : '') + '" data-fleet="' + esc(f.id) + '"><span class="army-chip" style="background:#0b2034;color:#cfe8ff;border-color:' + countryColor(f.owner) + '">⛴ ' + f.ships +
        '</span><span>Flota: ' + esc(countryName(f.owner)) + '</span><span class="faint" style="margin-left:auto">' + ((f.cargo || []).length ? 'ładunek: ' + f.cargo.length : (f.path && f.path.length ? 'w rejsie' : 'w porcie')) + '</span></div>';
    });
    const selA = S.sel && S.sel.type === 'army' ? unitObj(S.sel) : null;
    const myCount = armies.filter((a) => a.owner === me()).length;
    if (selA && selA.prov === id && selA.owner === me()) {
      h += '<div class="row-actions">' +
        (myCount > 1 ? '<button class="btn btn-sm" data-act="merge">Scal armie <kbd>M</kbd></button>' : '') +
        (selA.path && selA.path.length ? '<button class="btn btn-sm" data-act="cancel">Zatrzymaj</button>' : '') +
        '<button class="btn btn-sm btn-danger" data-act="disband">Rozwiąż</button></div>' +
        '<div class="hint">Przeciągnij armię na mapie lub kliknij PPM na cel, aby wydać rozkaz.</div>';
    } else if (myCount > 1) h += '<div class="row-actions"><button class="btn btn-sm" data-act="merge">Scal armie <kbd>M</kbd></button></div>';
    return h + '</div>';
  }
  function buildingsSection(id, pd) {
    const B = (WT.economy && WT.economy.BUILDINGS) || null;
    if (!B) return '';
    let h = '<div class="section"><div class="section-title">Budynki</div>';
    Object.keys(B).forEach((type) => {
      const def = B[type], lvl = (pd.buildings || {})[type] || 0, max = def.max || 5;
      const can = call('economy.canBuild', [me(), id, type], { ok: false, reason: 'Niedostępne' }) || { ok: false };
      let pips = ''; for (let i = 0; i < max; i++) pips += '<i class="pip' + (i < lvl ? ' on' : '') + '"></i>';
      const price = can.cost != null ? can.cost : has('economy.buildCost') ? call('economy.buildCost', [me(), id, type], def.cost) : def.cost;
      const cost = isGod() ? 'darmo' : fmtNum(price, 1) + ' mld';
      h += '<div class="build-row"><div title="' + esc(def.desc || '') + '"><span class="build-name">' + esc(def.name || type) + '</span><span class="pips">' + pips + '</span></div>' +
        '<span class="build-lvl">' + cost + (def.turns && !isGod() ? ' · ' + def.turns + 't' : '') + '</span>' +
        '<button class="btn btn-sm" data-build="' + type + '"' + (can.ok ? '' : ' disabled') + ' title="' + esc(can.ok ? 'Buduj ' + (def.name || type) + (def.desc ? ' — ' + def.desc : '') : can.reason || '') + '">Buduj</button></div>';
    });
    if (pd.build) {
      const def = B[pd.build.type] || {}, total = def.turns || pd.build.turnsLeft || 1;
      const pct = Math.round(100 * (1 - pd.build.turnsLeft / total));
      h += '<div class="hint">W budowie: <b>' + esc(def.name || pd.build.type) + '</b> — ' + turnsText(pd.build.turnsLeft) + '</div><div class="progress"><i style="width:' + pct + '%"></i></div>';
    }
    return h + '</div>';
  }
  function recruitMax() {
    const c = liveCountry(me()) || {};
    return Math.max(1, Math.min(isGod() ? 1000 : Math.floor(c.manpower || 0), 500));
  }
  function recruitSection(id, ctrl) {
    if (!has('economy.recruit')) return '';
    const max = recruitMax();
    S.recruitK = Math.min(Math.max(1, S.recruitK), max);
    const can = call('economy.canRecruit', [me(), id, S.recruitK], { ok: true }) || { ok: true };
    return '<div class="section"><div class="section-title">Rekrutacja</div>' +
      '<div class="slider-row"><input type="range" id="rec-k" min="1" max="' + max + '" value="' + S.recruitK + '"><span class="num" id="rec-k-val">' + fmtInt(S.recruitK) + ' tys.</span></div>' +
      '<div class="slider-row" style="margin-top:6px"><span class="dim">Koszt: <span class="num" id="rec-cost">' + recruitCostText(id, S.recruitK) + '</span></span>' +
      '<button class="btn btn-sm btn-ok" id="rec-go" style="margin-left:auto"' + (can.ok ? '' : ' disabled') + '>Rekrutuj</button></div>' +
      '<div class="reason" id="rec-reason">' + (can.ok ? '' : esc(can.reason || '')) + '</div></div>';
  }
  function recruitCostText(id, k) {
    if (isGod()) return '0 (God Mode)';
    const c = call('economy.recruitCost', [me(), id, k], null);
    return c == null ? '—' : fmtNum(c, 2) + ' mld $';
  }
  function shipsSection(id, ps, pd) {
    if (!ps.coastal || !has('economy.buildShips')) return '';
    const hasPort = ((pd.buildings || {}).port || 0) > 0;
    const cost = call('economy.buildShipsCost', [S.shipsN], null);
    const can = shipsCheck(id, hasPort);
    return '<div class="section"><div class="section-title">Stocznia</div>' +
      '<div class="slider-row"><input type="range" id="ship-n" min="1" max="10" value="' + S.shipsN + '"><span class="num" id="ship-n-val">' + S.shipsN + ' esk.</span></div>' +
      '<div class="slider-row" style="margin-top:6px"><span class="dim">Koszt: <span class="num" id="ship-cost">' + (isGod() ? '0 (God Mode)' : cost == null ? '—' : fmtNum(cost, 1) + ' mld $') + '</span></span>' +
      '<button class="btn btn-sm btn-ok" id="ship-go" style="margin-left:auto"' + (can.ok ? '' : ' disabled') + '>Zbuduj okręty</button></div>' +
      '<div class="reason" id="ship-reason">' + (can.ok ? '' : esc(can.reason || '')) + '</div>' +
      (hasPort ? '' : '<div class="hint">Zbuduj Port w tej prowincji, aby budować okręty.</div>') + '</div>';
  }
  function shipsCheck(id, hasPort) {
    if (has('economy.canBuildShips')) return call('economy.canBuildShips', [me(), id, S.shipsN], { ok: hasPort }) || { ok: false };
    return hasPort ? { ok: true } : { ok: false, reason: 'Wymagany port.' };
  }
  function bindProvincePanel(id) {
    const panel = $('province-panel');
    panel.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => onProvinceAction(b.dataset.act, id)));
    panel.querySelectorAll('[data-build]').forEach((b) => b.addEventListener('click', () => doBuild(id, b.dataset.build)));
    panel.querySelectorAll('[data-army]').forEach((r) => r.addEventListener('click', () => {
      const a = G().armies[r.dataset.army]; if (a && a.owner === me()) selectUnit({ type: 'army', id: a.id });
    }));
    panel.querySelectorAll('[data-fleet]').forEach((r) => r.addEventListener('click', () => {
      const f = G().fleets[r.dataset.fleet]; if (f && f.owner === me()) selectUnit({ type: 'fleet', id: f.id });
    }));
    bindRecruit(id);
    bindShips(id);
  }
  function bindRecruit(id) {
    const s = $('rec-k'); if (!s) return;
    s.addEventListener('input', () => {
      S.recruitK = +s.value;
      $('rec-k-val').textContent = fmtInt(S.recruitK) + ' tys.';
      $('rec-cost').textContent = recruitCostText(id, S.recruitK);
      const can = call('economy.canRecruit', [me(), id, S.recruitK], { ok: true }) || { ok: true };
      $('rec-go').disabled = !can.ok; $('rec-reason').textContent = can.ok ? '' : (can.reason || '');
    });
    $('rec-go').addEventListener('click', () => {
      const a = call('economy.recruit', [me(), id, S.recruitK], null);
      if (a) toast('Zrekrutowano ' + fmtInt(S.recruitK * 1000) + ' żołnierzy w: ' + provStatic(id).name, 'ok', 2500);
      else toast('Rekrutacja nieudana', 'bad');
      refreshAll();
    });
  }
  function bindShips(id) {
    const s = $('ship-n'); if (!s) return;
    s.addEventListener('input', () => {
      S.shipsN = +s.value;
      $('ship-n-val').textContent = S.shipsN + ' esk.';
      const c = call('economy.buildShipsCost', [S.shipsN], null);
      $('ship-cost').textContent = isGod() ? '0 (God Mode)' : c == null ? '—' : fmtNum(c, 1) + ' mld $';
      const can = shipsCheck(id, ((provDyn(id).buildings || {}).port || 0) > 0);
      $('ship-go').disabled = !can.ok; $('ship-reason').textContent = can.ok ? '' : (can.reason || '');
    });
    $('ship-go').addEventListener('click', () => {
      const f = call('economy.buildShips', [me(), id, S.shipsN], null);
      if (f) toast('Zbudowano ' + S.shipsN + ' ' + plural(S.shipsN, 'eskadrę', 'eskadry', 'eskadr'), 'ok', 2500);
      else toast('Nie można zbudować okrętów (port, środki?)', 'bad');
      refreshAll();
    });
  }
  function doBuild(id, type) {
    const ok = call('economy.build', [me(), id, type], false);
    const def = (WT.economy.BUILDINGS || {})[type] || {};
    if (ok) toast((isGod() ? 'Zbudowano: ' : 'Rozpoczęto budowę: ') + (def.name || type), 'ok', 2500);
    else toast((call('economy.canBuild', [me(), id, type], {}) || {}).reason || 'Nie można budować', 'bad');
    if (R().getMode() === 'economic') R().invalidate();
    refreshAll();
  }
  function onProvinceAction(act, id) {
    if (act === 'close') closeProvince();
    else if (act === 'diplo') openDiplomacy(provDyn(id).owner);
    else if (act === 'merge') mergeHere(id);
    else if (act === 'cancel' && S.sel) { call('military.cancel', [S.sel.id]); refreshAll(); }
    else if (act === 'disband' && S.sel) {
      const a = unitObj(S.sel);
      confirmModal('Rozwiązanie armii', 'Rozwiązać armię ' + fmtInt(a ? a.size : 0) + ' żołnierzy?', 'Rozwiąż', () => { call('military.disband', [S.sel.id]); deselect(); refreshAll(); }, true);
    }
  }
  function mergeHere(provId) {
    if (provId == null || provId < 0) return;
    const before = armiesIn(provId).filter((a) => a.owner === me()).length;
    call('military.merge', [provId, me()]);
    const after = armiesIn(provId).filter((a) => a.owner === me()).length;
    if (after < before) toast('Scalono armie (' + before + ' → ' + after + ')', 'ok', 2000);
    else toast('Brak armii do scalenia (tylko bezczynne armie)', '', 2200);
    validateSelection();
    if (!S.sel) { const a = armiesIn(provId).find((x) => x.owner === me()); if (a) { S.sel = { type: 'army', id: a.id }; R().view.sel = S.sel; } }
    refreshAll();
  }

  // ===========================================================================
  // Panel dyplomacji
  // ===========================================================================
  function toggleDiplomacy() { if ($('diplo-panel').classList.contains('hidden')) openDiplomacy(S.diploCC); else closeDiplomacy(); }
  function openDiplomacy(cc) {
    $('god-panel').classList.add('hidden');
    if (cc && cc !== me()) S.diploCC = cc;
    $('diplo-panel').classList.remove('hidden');
    $('btn-diplomacy').classList.add('active');
    renderDiplomacy();
  }
  UI.openDiplomacy = openDiplomacy;
  function closeDiplomacy() {
    $('diplo-panel').classList.add('hidden');
    $('btn-diplomacy').classList.remove('active');
    R().view.highlightCC = null; R().requestDraw();
  }
  function renderDiplomacy() {
    const panel = $('diplo-panel');
    const focused = document.activeElement && document.activeElement.id === 'dip-search';
    let html = '<div class="panel-head"><h2>Dyplomacja</h2><button class="close" data-act="close" title="Zamknij (Esc)">×</button></div><div class="panel-body">';
    html += '<div class="section"><input type="search" id="dip-search" placeholder="Szukaj państwa…" value="' + esc(S.diploQuery) + '" style="width:100%"></div>';
    html += '<div class="section"><div class="country-list" id="dip-list" style="max-height:200px">' + diploListHtml() + '</div></div>';
    if (S.diploCC && liveCountry(S.diploCC)) html += diploDetailHtml(S.diploCC);
    html += warsHtml();
    html += '</div>';
    const listScroll = $('dip-list') ? $('dip-list').scrollTop : 0;
    panel.innerHTML = html;
    $('dip-list').scrollTop = listScroll;
    bindDiplomacy();
    if (focused) { const s = $('dip-search'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    R().view.highlightCC = S.diploCC; R().requestDraw();
  }
  function diploSortKey(cc) { const p = me(); return atWar(p, cc) ? 0 : allied(p, cc) ? 1 : hasPact(p, cc) ? 2 : 3; }
  function diploListHtml() {
    const q = S.diploQuery.trim().toLowerCase(), p = me();
    const list = sortByName(aliveCountries().filter((cc) => cc !== p && (!q || countryName(cc).toLowerCase().includes(q) || cc.toLowerCase().includes(q))));
    if (!q) list.sort((a, b) => diploSortKey(a) - diploSortKey(b));
    return list.map((cc) => {
      const r = Math.round(rel(p, cc));
      return '<div class="country-item' + (cc === S.diploCC ? ' sel' : '') + '" data-cc="' + esc(cc) + '">' + swatch(cc) + '<span class="name">' + esc(countryName(cc)) + '</span>' +
        statusTags(cc) + '<span class="rel ' + relClass(r) + '">' + (r > 0 ? '+' : '') + r + '</span></div>';
    }).join('') || '<div class="country-item faint">Brak wyników</div>';
  }
  function diploDetailHtml(cc) {
    const p = me(), c = liveCountry(cc), d = staticCountry(cc), r = Math.round(rel(p, cc));
    const war = atWar(p, cc), ally = allied(p, cc), pact = hasPact(p, cc), truce = hasTruce(p, cc);
    const armySum = armiesOf(cc).reduce((s, a) => s + (a.size || 0), 0);
    let h = '<div class="section"><div class="section-title">' + swatch(cc) + esc(countryName(cc)) + '</div>';
    h += '<div class="kv"><span class="k">Relacje</span><span class="v ' + relClass(r) + '">' + (r > 0 ? '+' : '') + r + '</span></div>';
    h += '<div class="relbar"><i style="left:' + ((r + 100) / 2) + '%"></i></div>';
    h += '<div style="margin:6px 0">' + (statusTags(cc) || '<span class="tag">Neutralny</span>') + '</div>';
    h += '<div class="kv">' +
      '<span class="k">Ustrój</span><span class="v txt">' + esc(d.gov || '—') + (c.ideology ? ' · ' + esc(IDEOLOGY_PL[c.ideology] || c.ideology) : '') + '</span>' +
      '<span class="k">PKB (2026)</span><span class="v">' + (d.gdp != null ? fmtInt(d.gdp) + ' mld $' : '—') + '</span>' +
      '<span class="k">Armia</span><span class="v">' + fmtInt(armySum) + '</span>' +
      '<span class="k">Prowincje</span><span class="v">' + provincesOf(cc).length + '</span>' +
      '<span class="k">Stabilność</span><span class="v">' + Math.round(c.stability || 0) + '%</span></div>';
    const impCost = has('diplomacy.improveRelationsCost') ? call('diplomacy.improveRelationsCost', [p], 1) : 1 + 0.001 * (staticCountry(p).gdp || 0);
    h += '<div class="action-grid" style="margin-top:10px">';
    h += war ? '<button class="btn btn-ok" data-dip="peace-white">Biały pokój</button><button class="btn btn-ok" data-dip="peace-annex">Pokój: aneksja</button>'
      : '<button class="btn btn-danger" data-dip="war"' + (truce ? ' disabled title="Obowiązuje rozejm"' : '') + '>Wypowiedz wojnę</button>';
    h += ally ? '<button class="btn" data-dip="break">Zerwij sojusz</button>' : '<button class="btn" data-dip="alliance"' + (war ? ' disabled' : '') + '>Zaproponuj sojusz</button>';
    if (!pact) h += '<button class="btn" data-dip="pact"' + (war ? ' disabled' : '') + '>Pakt o nieagresji</button>';
    h += '<button class="btn" data-dip="improve" title="Koszt ok. ' + fmtNum(impCost, 1) + ' mld $">Popraw relacje</button>';
    h += '<button class="btn" data-dip="insult">Obraź</button>';
    h += '<button class="btn btn-ghost" data-dip="show">Pokaż na mapie</button>';
    return h + '</div></div>';
  }
  function warScoreFor(war, cc) {
    const side = (war.attackers || []).indexOf(cc) >= 0 ? 1 : -1;
    const r = call('military.warScore', [war], null);
    if (typeof r === 'number') return side * r;
    if (r && typeof r === 'object' && r[cc] != null) return r[cc];
    if (war.score && war.score[cc] != null) return war.score[cc];
    return 0;
  }
  function warsHtml() {
    const wars = (G().wars || []).slice(), p = me();
    const involves = (w) => (w.attackers || []).concat(w.defenders || []).indexOf(p) >= 0;
    wars.sort((a, b) => involves(b) - involves(a));
    let h = '<div class="section"><div class="section-title">Aktywne wojny (' + wars.length + ')</div>';
    if (!wars.length) h += '<div class="hint">Brak trwających wojen.</div>';
    wars.forEach((w) => {
      const persp = involves(w) ? p : (w.attackers || [])[0];
      const leftSide = (w.attackers || []).indexOf(persp) >= 0 ? w.attackers : w.defenders;
      const rightSide = leftSide === w.attackers ? w.defenders : w.attackers;
      const sc = Math.max(-100, Math.min(100, Math.round(warScoreFor(w, persp))));
      const names = (l) => (l || []).map((c) => esc(countryName(c))).join(', ');
      h += '<div class="war-item"><div class="war-sides"><span>' + names(leftSide) + '</span><span class="faint">vs</span><span>' + names(rightSide) + '</span></div>' +
        '<div class="scorebar"><i style="width:' + ((sc + 100) / 2) + '%"></i></div>' +
        '<div class="war-score"><span>Wynik wojny: ' + (sc > 0 ? '+' : '') + sc + '</span><span>od tury ' + (w.start != null ? w.start : '?') + '</span></div></div>';
    });
    return h + '</div>';
  }
  function bindDiplomacy() {
    const panel = $('diplo-panel');
    panel.querySelector('[data-act=close]').addEventListener('click', closeDiplomacy);
    $('dip-search').addEventListener('input', (e) => { S.diploQuery = e.target.value; $('dip-list').innerHTML = diploListHtml(); });
    $('dip-list').addEventListener('click', (e) => { const it = e.target.closest('[data-cc]'); if (it) { S.diploCC = it.dataset.cc; renderDiplomacy(); } });
    panel.querySelectorAll('[data-dip]').forEach((b) => b.addEventListener('click', () => diploAction(b.dataset.dip, S.diploCC)));
  }
  function diploAction(act, cc) {
    const p = me(), name = countryName(cc);
    const after = () => { R().invalidate(); refreshAll(); };
    switch (act) {
      case 'war':
        confirmModal('Wypowiedzenie wojny', 'Czy na pewno wypowiedzieć wojnę państwu <b>' + esc(name) + '</b>?' + (hasPact(p, cc) ? '<br><span class="reason">Zerwanie paktu: −50 relacji ze wszystkimi, −20 stabilności.</span>' : ''), 'Wypowiedz wojnę', () => {
          const res = call('diplomacy.declareWar', [p, cc], null);
          resultToast(res, 'Wypowiedziano wojnę: ' + name); after();
        }, true);
        return;
      case 'peace-white': resultToast(call('diplomacy.proposePeace', [p, cc, 'white'], null), 'Zawarto biały pokój'); break;
      case 'peace-annex': resultToast(call('diplomacy.proposePeace', [p, cc, 'annex'], null), 'Pokój: aneksja okupowanych prowincji'); break;
      case 'alliance': resultToast(call('diplomacy.proposeAlliance', [p, cc], null), 'Sojusz zawarty'); break;
      case 'break': resultToast(call('diplomacy.breakAlliance', [p, cc], null), 'Sojusz zerwany'); break;
      case 'pact': resultToast(call('diplomacy.proposePact', [p, cc], null), 'Pakt podpisany'); break;
      case 'improve': resultToast(call('diplomacy.improveRelations', [p, cc], null), 'Relacje poprawione'); break;
      case 'insult': resultToast(call('diplomacy.insult', [p, cc], null), 'Obrażono ' + name); break;
      case 'show': R().centerOnCountry(cc, 0.8); return;
    }
    after();
  }

  // ===========================================================================
  // Panel God Mode
  // ===========================================================================
  function toggleGodPanel() { if ($('god-panel').classList.contains('hidden')) openGodPanel(); else closeGodPanel(); }
  function openGodPanel() {
    if (!isGod()) return;
    closeDiplomacy();
    $('god-panel').classList.remove('hidden');
    $('btn-god').classList.add('active');
    renderGodPanel();
  }
  function closeGodPanel() {
    $('god-panel').classList.add('hidden');
    $('btn-god').classList.remove('active');
    S.godTool = null; updateCursor();
  }
  function countryOptions(sel) {
    return sortByName(aliveCountries().slice()).map((cc) => '<option value="' + esc(cc) + '"' + (cc === sel ? ' selected' : '') + '>' + esc(countryName(cc)) + '</option>').join('');
  }
  function renderGodPanel() {
    const g = G(); if (!g) return;
    const a = S.godCC || me(), b = S.godB || (S.diploCC && S.diploCC !== a ? S.diploCC : aliveCountries().find((c) => c !== a));
    S.godB = b;
    const relV = Math.round(rel(a, b));
    let h = '<div class="panel-head"><span class="god-badge">GOD</span><h2>Narzędzia God Mode</h2><button class="close" data-act="close" title="Zamknij">×</button></div><div class="panel-body">';
    h += '<div class="section"><label class="check"><input type="checkbox" id="god-on"' + (isGod() ? ' checked' : '') + '> <span>God Mode (nielimitowana kasa)</span></label></div>';
    h += '<div class="section"><div class="section-title">Narzędzia mapy</div>';
    h += '<label class="field"><span>Państwo docelowe</span><select id="god-cc">' + countryOptions(a) + '</select></label>';
    h += '<div class="god-tool"><button class="btn' + (S.godTool === 'take' ? ' active' : '') + '" data-tool="take">Przejmij prowincję</button>' +
      '<button class="btn' + (S.godTool === 'army' ? ' active' : '') + '" data-tool="army">Dodaj armię</button></div>';
    h += '<label class="field" style="margin-top:8px"><span>Wielkość armii (tys.)</span><input type="number" id="god-army-k" min="1" max="5000" value="' + S.godArmyK + '"></label>';
    h += '<div class="hint">' + (S.godTool ? 'Kliknij prowincję na mapie. Esc — wyłącz narzędzie.' : 'Wybierz narzędzie, potem klikaj prowincje na mapie.') + '</div></div>';
    h += '<div class="section"><div class="section-title">Dyplomacja (wymuszenie)</div>';
    h += '<div class="field-row"><select id="god-a">' + countryOptions(a) + '</select><select id="god-b">' + countryOptions(b) + '</select></div>';
    h += '<div class="action-grid" style="margin-top:6px"><button class="btn" data-god="peace">Wymuś pokój</button><button class="btn" data-god="alliance">Wymuś sojusz</button>' +
      '<button class="btn" data-god="war">Wymuś wojnę</button><button class="btn btn-danger" data-god="annex" title="Państwo A anektuje całe państwo B">A anektuje B</button></div>';
    h += '<label class="field" style="margin-top:8px"><span>Relacja A–B: <b class="num" id="god-rel-val">' + relV + '</b></span>' +
      '<div class="field-row"><input type="range" id="god-rel" min="-100" max="100" value="' + relV + '"><button class="btn btn-sm" data-god="rel">Ustaw</button></div></label></div>';
    h += '</div>';
    $('god-panel').innerHTML = h;
    bindGodPanel();
  }
  function bindGodPanel() {
    const panel = $('god-panel');
    panel.querySelector('[data-act=close]').addEventListener('click', closeGodPanel);
    $('god-on').addEventListener('change', (e) => setGodMode(e.target.checked));
    $('god-cc').addEventListener('change', (e) => { S.godCC = e.target.value; $('god-a').value = S.godCC; });
    $('god-army-k').addEventListener('change', (e) => { S.godArmyK = Math.max(1, +e.target.value || 1); });
    $('god-a').addEventListener('change', (e) => { S.godCC = e.target.value; renderGodPanel(); });
    $('god-b').addEventListener('change', (e) => { S.godB = e.target.value; renderGodPanel(); });
    $('god-rel').addEventListener('input', (e) => { $('god-rel-val').textContent = e.target.value; });
    panel.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => {
      S.godTool = S.godTool === b.dataset.tool ? null : b.dataset.tool;
      if (S.godTool && S.sel) deselect();
      updateCursor(); renderGodPanel();
    }));
    panel.querySelectorAll('[data-god]').forEach((b) => b.addEventListener('click', () => godAction(b.dataset.god)));
  }
  function godAction(act) {
    const a = $('god-a').value, b = $('god-b').value;
    if (a === b && act !== 'rel') { toast('Wybierz dwa różne państwa', 'bad'); return; }
    if (act === 'peace') { call('god.forcePeace', [a, b]); toast('Wymuszono pokój: ' + countryName(a) + ' – ' + countryName(b), 'ok'); }
    else if (act === 'alliance') { call('god.forceAlliance', [a, b]); toast('Wymuszono sojusz: ' + countryName(a) + ' – ' + countryName(b), 'ok'); }
    else if (act === 'war') resultToast(call('diplomacy.declareWar', [a, b], null), 'Wojna: ' + countryName(a) + ' → ' + countryName(b));
    else if (act === 'rel') { call('god.setRelation', [a, b, +$('god-rel').value]); toast('Relacja ustawiona na ' + $('god-rel').value, 'ok', 2000); }
    else if (act === 'annex') { confirmModal('Aneksja', esc(countryName(a)) + ' anektuje całe państwo ' + esc(countryName(b)) + '?', 'Anektuj', () => { call('god.annexCountry', [b, a]); R().invalidate(); refreshAll(); renderGodPanel(); }, true); return; }
    R().invalidate();
    refreshAll();
  }
  function applyGodTool(prov) {
    if (prov < 0) return;
    const cc = S.godCC || me();
    if (S.godTool === 'take') {
      call('god.setOwner', [prov, cc]);
      R().invalidate();
      toast(provStatic(prov).name + ' → ' + countryName(cc), 'ok', 1500);
    } else if (S.godTool === 'army') {
      const a = call('god.spawnArmy', [prov, cc, S.godArmyK * 1000], null);
      toast(a !== null ? 'Dodano armię ' + fmtInt(S.godArmyK * 1000) + ' (' + countryName(cc) + ')' : 'Nie udało się dodać armii', a !== null ? 'ok' : 'bad', 1500);
    }
    refreshAll();
  }
  function updateCursor() { const c = $('map'); if (c) c.style.cursor = S.godTool ? 'crosshair' : ''; }

  // ===========================================================================
  // Zapis / wczytanie
  // ===========================================================================
  function saveList() { return call('save.list', [], []) || []; }
  function autosaveExists() {
    try { return !!localStorage.getItem('wartime2026_autosave'); } catch (e) { return false; }
  }
  function tryLoad(slot) {
    if (slot === 'auto') {
      const cand = ['auto', 'autosave', 0];
      for (const s of cand) { if (call('save.load', [s], false)) return true; }
      return false;
    }
    return !!call('save.load', [slot], false);
  }
  function slotRowHtml(slot, info, label) {
    const inGame = S.inGame && !!G();
    const desc = info ? '<b>' + esc(countryName(info.player)) + '</b> · tura ' + esc(info.turn) + ' · ' + esc(info.date || '') +
      (info.savedAt ? '<br><span class="faint">zapisano ' + esc(new Date(info.savedAt).toLocaleString('pl-PL')) + '</span>' : '') : '<span class="faint">pusty</span>';
    const saveBtn = slot === 'auto' ? '' : '<button class="btn btn-sm" data-save="' + slot + '"' + (inGame ? '' : ' disabled') + '>Zapisz</button>';
    const delBtn = slot === 'auto' ? '' : '<button class="btn btn-sm btn-ghost" data-del="' + slot + '"' + (info ? '' : ' disabled') + '>Usuń</button>';
    return '<div class="slot"><span class="slot-name">' + label + '</span><span class="slot-info">' + desc + '</span><span class="slot-actions">' + saveBtn +
      '<button class="btn btn-sm btn-primary" data-load="' + slot + '"' + (info ? '' : ' disabled') + '>Wczytaj</button>' + delBtn + '</span></div>';
  }
  function saveMenuHtml() {
    const list = saveList();
    const bySlot = {}; list.forEach((s) => { bySlot[s.slot] = s; });
    let h = '';
    for (let i = 1; i <= 5; i++) h += slotRowHtml(i, bySlot[i], 'Slot ' + i);
    const auto = bySlot.auto || bySlot.autosave || bySlot[0] || (autosaveExists() ? { player: '?', turn: '?', date: '' } : null);
    h += slotRowHtml('auto', auto, 'Autozapis');
    h += '<div class="row-actions" style="margin-top:12px"><button class="btn" id="sv-export"' + (S.inGame ? '' : ' disabled') + '>Eksportuj JSON</button>' +
      '<button class="btn" id="sv-import">Importuj JSON…</button><input type="file" id="sv-file" accept=".json,application/json" class="hidden"></div>';
    return h;
  }
  function openSaveMenu() {
    const body = document.createElement('div');
    const rerender = () => { body.innerHTML = saveMenuHtml(); bindSaveMenu(body, close); };
    const close = openModal({ title: 'Zapis i wczytanie gry', body: body, wide: true });
    rerender();
    body._rerender = rerender;
  }
  UI.openSaveMenu = openSaveMenu;
  function afterLoad(close) {
    close();
    toast('Wczytano grę', 'ok', 2000);
    enterGame(true);
  }
  function bindSaveMenu(body, close) {
    body.querySelectorAll('[data-save]').forEach((b) => b.addEventListener('click', () => {
      const ok = call('save.save', [+b.dataset.save], false);
      toast(ok !== false ? 'Zapisano w slocie ' + b.dataset.save : 'Zapis nieudany', ok !== false ? 'ok' : 'bad', 2000);
      body._rerender();
    }));
    body.querySelectorAll('[data-load]').forEach((b) => b.addEventListener('click', () => {
      const slot = b.dataset.load === 'auto' ? 'auto' : +b.dataset.load;
      if (tryLoad(slot) && G()) afterLoad(close); else toast('Nie udało się wczytać zapisu', 'bad');
    }));
    body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { call('save.remove', [+b.dataset.del]); body._rerender(); }));
    body.querySelector('#sv-export').addEventListener('click', exportGame);
    const file = body.querySelector('#sv-file');
    body.querySelector('#sv-import').addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      const f = file.files && file.files[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = () => { if (call('save.importJSON', [String(reader.result)], false) && G()) afterLoad(close); else toast('Niepoprawny plik zapisu', 'bad'); };
      reader.readAsText(f);
    });
  }
  function exportGame() {
    const json = call('save.exportJSON', [], null) || (G() ? JSON.stringify(G()) : null);
    if (!json) return;
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'wartime2026_' + me() + '_t' + G().turn + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Wyeksportowano zapis do pliku', 'ok', 2000);
  }

  // ===========================================================================
  // Dziennik
  // ===========================================================================
  function renderLog() {
    const g = G(); if (!g) return;
    const body = $('log-body');
    const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 20;
    const entries = (g.log || []).slice(-80);
    const p = me(), pname = countryName(p);
    body.innerHTML = entries.map((e) => {
      const mine = e.cc === p || (e.text || '').indexOf(pname) >= 0;
      const k = classifyText(e.text);
      return '<div class="log-entry' + (mine ? ' mine' : '') + (k === 'war' ? ' war' : k === 'peace' ? ' peace' : '') + '"><span class="t">T' + esc(e.turn) + '</span><span>' + esc(e.text) + '</span></div>';
    }).join('') || '<div class="log-entry faint">Brak zdarzeń.</div>';
    if (atBottom || !body._init) { body.scrollTop = body.scrollHeight; body._init = true; }
  }
  function bindLog() {
    $('log-head').addEventListener('click', () => $('log').classList.toggle('collapsed'));
  }

  // ===========================================================================
  // Koniec tury
  // ===========================================================================
  function endTurn() {
    if (!S.inGame || S.busy || !G()) return;
    if (S.modals.length) { toast('Najpierw odpowiedz na otwarte okno', '', 2000); return; }
    S.busy = true;
    closeOrderBar(); R().view.preview = null;
    $('busy').classList.remove('hidden');
    $('btn-endturn').disabled = true;
    const before = new Set(G().log || []);
    setTimeout(() => {
      let res = null;
      try { res = WT.turn && WT.turn.end ? WT.turn.end() : null; if (!res && !(WT.turn && WT.turn.end)) toast('Brak WT.turn.end', 'bad'); }
      catch (e) { console.error(e); toast('Błąd podczas przetwarzania tury: ' + e.message, 'bad', 6000); }
      S.busy = false;
      $('busy').classList.add('hidden');
      R().invalidate();
      validateSelection();
      turnToasts(before, res);
      refreshAll();
      checkGameOver();
      checkProposals();
    }, 30);
  }
  UI.endTurn = endTurn;
  function turnToasts(beforeSet, res) {
    const g = G(); if (!g) return;
    const p = me(), pname = countryName(p);
    const fresh = (g.log || []).filter((e) => !beforeSet.has(e));
    let mine = fresh.filter((e) => e.cc === p || (e.text || '').indexOf(pname) >= 0).map((e) => e.text);
    if (!fresh.length && res && Array.isArray(res.events)) mine = res.events.filter((t) => typeof t === 'string' && t.indexOf(pname) >= 0);
    mine.slice(0, 4).forEach((t) => toast(t, classifyText(t), 5000));
    if (mine.length > 4) toast('+' + (mine.length - 4) + ' innych zdarzeń — zobacz dziennik', '', 4000);
  }
  function checkGameOver() {
    const c = liveCountry(me());
    if (((c && c.alive === false) || G().gameOver) && !S.gameOverShown) {
      S.gameOverShown = true;
      openModal({ title: 'Koniec gry', body: '<p>' + esc(countryName(me())) + ' przestało istnieć.</p>', buttons: [
        { label: 'Obserwuj dalej' }, { label: 'Menu główne', cls: 'btn-primary', onClick: () => { WT.G = null; showStart(); } }] });
    }
  }

  // ===========================================================================
  // Propozycje AI → gracz
  // ===========================================================================
  const PROPOSAL_TITLES = { peace: 'Propozycja pokoju', alliance: 'Propozycja sojuszu', pact: 'Propozycja paktu o nieagresji' };
  function proposalText(pr) {
    const from = '<b>' + esc(countryName(pr.from)) + '</b>';
    let t;
    if (pr.text) t = esc(pr.text);
    else if (pr.type === 'peace') t = from + ' proponuje zakończenie wojny.';
    else if (pr.type === 'alliance') t = from + ' proponuje sojusz obronny.';
    else if (pr.type === 'pact') t = from + ' proponuje pakt o nieagresji.';
    else t = from + ' składa propozycję: ' + esc(pr.type);
    const terms = pr.terms;
    if (terms) {
      if (typeof terms === 'string') t += '<br><span class="dim">Warunki: ' + esc(terms === 'white' ? 'biały pokój' : terms === 'annex' ? 'aneksja okupowanych prowincji' : terms) + '</span>';
      else if (typeof terms === 'object') {
        const tt = pr.text ? null : terms.type || terms.kind;
        if (tt) t += '<br><span class="dim">Warunki: ' + esc(tt === 'white' ? 'biały pokój' : tt === 'annex' ? 'aneksja okupowanych prowincji' : tt) + '</span>';
        if (terms.text) t += '<br><span class="dim">' + esc(terms.text) + '</span>';
        if (terms.war || terms.vs || terms.against) t += '<br><span class="dim">Dotyczy: ' + esc(countryName(terms.war || terms.vs || terms.against)) + '</span>';
      }
    }
    const r = Math.round(rel(me(), pr.from));
    t += '<div class="kv" style="margin-top:10px"><span class="k">Relacje</span><span class="v ' + relClass(r) + '">' + (r > 0 ? '+' : '') + r + '</span></div>';
    return t;
  }
  function checkProposals() {
    const g = G(); if (!g || !S.inGame || S.proposalOpen) return;
    const pr = (g.proposals || []).find((x) => x.to === g.player && !S.answered[x.id]);
    if (!pr) return;
    S.proposalOpen = true;
    const answer = (acc) => {
      S.answered[pr.id] = true;
      const res = call('diplomacy.answerProposal', [pr.id, acc], null);
      if (res && res.reason) toast(res.reason, acc ? 'ok' : '', 3000);
      else toast(acc ? 'Przyjęto propozycję: ' + countryName(pr.from) : 'Odrzucono propozycję: ' + countryName(pr.from), acc ? 'ok' : '', 3000);
      R().invalidate();
      refreshAll();
    };
    openModal({
      title: esc(PROPOSAL_TITLES[pr.type] || 'Propozycja dyplomatyczna'), body: '<p>' + proposalText(pr) + '</p>', dismissable: false,
      buttons: [{ label: 'Odrzuć', cls: 'btn-danger', onClick: () => answer(false) }, { label: 'Przyjmij', cls: 'btn-ok', onClick: () => answer(true) }],
      onClose: () => { S.proposalOpen = false; setTimeout(checkProposals, 150); }
    });
  }
  UI.checkProposals = checkProposals;

  // ===========================================================================
  // Tooltip
  // ===========================================================================
  function tooltipHtml(id, unit) {
    if (unit) {
      const u = unit.type === 'army' ? (G().armies || {})[unit.id] : (G().fleets || {})[unit.id];
      if (u) {
        if (unit.type === 'army') return '<div class="tt-title">' + swatch(u.owner) + ' Armia: ' + esc(countryName(u.owner)) + '</div><div class="tt-row">Żołnierze: <b class="num">' + fmtInt(u.size) + '</b></div><div class="tt-row">' + esc(armyStatus(u)) + '</div>' +
          (u.owner === me() ? '<div class="tt-row faint">Przeciągnij na cel lub kliknij i PPM na cel</div>' : '');
        return '<div class="tt-title">' + swatch(u.owner) + ' Flota: ' + esc(countryName(u.owner)) + '</div><div class="tt-row">Eskadry: <b class="num">' + fmtInt(u.ships) + '</b></div>' +
          ((u.cargo || []).length ? '<div class="tt-row">Ładunek: <b>' + u.cargo.length + ' ' + plural(u.cargo.length, 'armia', 'armie', 'armii') + '</b></div>' : '');
      }
    }
    if (id < 0) return '';
    const ps = provStatic(id);
    const owner = R().ownerOf(id), ctrl = R().ctrlOf(id);
    let h = '<div class="tt-title">' + esc(ps.name) + '</div><div class="tt-row">' + swatch(owner) + '<b>' + esc(countryName(owner)) + '</b></div>';
    if (ctrl !== owner) h += '<div class="tt-row"><span class="tag occ">Okupacja</span> ' + swatch(ctrl) + esc(countryName(ctrl)) + '</div>';
    h += '<div class="tt-row">' + esc(TERRAIN_PL[ps.terrain] || ps.terrain || '') + ' · ' + fmtNum(ps.pop || 0, 2) + ' mln' + (ps.coastal ? ' · wybrzeże' : '') + '</div>';
    if (G()) {
      const armies = armiesIn(id);
      if (armies.length) {
        h += '<div class="tt-armies">' + armies.map((a) => {
          const c = countryColor(a.owner);
          return '<span class="army-chip" style="background:' + c + ';color:' + (R().luminance(c) > 0.62 ? '#111' : '#fff') + '">' + fmtK(a.size) + '</span>';
        }).join('') + '</div>';
      }
      const pv = R().view.preview;
      if (pv && pv.target === id) h += '<div class="tt-row" style="margin-top:4px;color:' + (pv.ok ? 'var(--accent)' : '#ff9c96') + '">' + esc(pv.ok ? (pv.kind === 'sea' ? 'Desant: ' : 'Ruch: ') + turnsText(pv.turns) + ' — PPM aby wydać rozkaz' : pv.reason || '') + '</div>';
    }
    return h;
  }
  function showTooltip(id, sx, sy, unit) {
    const tt = $('tooltip');
    if ((id < 0 && !unit) || R().isDraggingUnit()) { tt.classList.add('hidden'); S.lastHoverKey = ''; return; }
    const key = id + '|' + (unit ? unit.id : '') + '|' + (R().view.preview ? R().view.preview.target : '');
    if (key !== S.lastHoverKey) { tt.innerHTML = tooltipHtml(id, unit); S.lastHoverKey = key; }
    tt.classList.remove('hidden');
    const w = tt.offsetWidth, h = tt.offsetHeight;
    let x = sx + 16, y = sy + 18;
    if (x + w > window.innerWidth - 8) x = sx - w - 12;
    if (y + h > window.innerHeight - 8) y = sy - h - 12;
    tt.style.left = x + 'px'; tt.style.top = y + 'px';
  }

  // ===========================================================================
  // Obsługa zdarzeń mapy (WT.render.handlers)
  // ===========================================================================
  function canDragUnit(u) {
    if (!S.inGame || !G() || u.owner !== me()) return false;
    return u.type === 'fleet' || u.type === 'army';
  }
  function onUnitClick(u) {
    if (!S.inGame) return;
    if (S.godTool) { applyGodTool(u.prov); return; }
    if (u.owner === me()) {
      if (S.sel && S.sel.id === u.id) { deselect(); openProvince(u.prov); }
      else selectUnit(u);
    } else openProvince(u.prov);
  }
  function onMapClick(prov) {
    if (!S.inGame) { if (prov >= 0) selectStartCountry(R().ownerOf(prov), false); return; }
    if (S.godTool) { applyGodTool(prov); return; }
    if (orderBarOpen()) closeOrderBar();
    if (S.sel) deselect();
    if (prov >= 0) openProvince(prov); else closeProvince();
  }
  function onRightClick(prov) {
    if (!S.inGame) return;
    if (S.sel && prov >= 0) openOrderBar(prov);
    else if (orderBarOpen()) closeOrderBar();
  }
  function onDragStart(u) { selectUnit(u); }
  function onDragDrop(u, prov) {
    if (prov >= 0 && S.sel) openOrderBar(prov);
    else R().view.preview = null;
  }
  function onHoverChange(prov) {
    if (S.sel && !S.godTool) updatePreview(prov);
  }
  function bindRenderHandlers() {
    Object.assign(R().handlers, {
      canDragUnit, unitClick: onUnitClick, click: onMapClick, rightClick: onRightClick,
      dragStart: onDragStart, dragDrop: onDragDrop, hoverChange: onHoverChange, hover: showTooltip
    });
  }

  // ===========================================================================
  // Klawiatura
  // ===========================================================================
  function isTyping(e) {
    const t = e.target, tag = t && t.tagName;
    if (!tag) return false;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') return !['range', 'checkbox', 'button'].includes(t.type);
    return false;
  }
  function escapeChain() {
    if (closeTopModal()) return;
    if (!$('menu').classList.contains('hidden')) { toggleMenu(false); return; }
    if (orderBarOpen()) { closeOrderBar(); R().requestDraw(); return; }
    if (S.godTool) { S.godTool = null; updateCursor(); if (!$('god-panel').classList.contains('hidden')) renderGodPanel(); return; }
    if (S.sel) { deselect(); return; }
    if (!$('diplo-panel').classList.contains('hidden')) { closeDiplomacy(); return; }
    if (!$('god-panel').classList.contains('hidden')) { closeGodPanel(); return; }
    if (S.selProv >= 0) closeProvince();
  }
  function onKeyDown(e) {
    if (e.key === 'Escape') { if (isTyping(e)) e.target.blur(); escapeChain(); e.preventDefault(); return; }
    if (e.key === 'Enter' && orderBarOpen() && !isTyping(e) && !S.modals.length) { confirmOrder(); e.preventDefault(); return; }
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (S.modals.length) return;
    if (R().keyDown(e.code)) { e.preventDefault(); return; }
    if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') { R().zoomBy(1.25); e.preventDefault(); return; }
    if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') { R().zoomBy(0.8); e.preventDefault(); return; }
    if (!S.inGame) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.blur();
      if (!e.repeat) endTurn();
      return;
    }
    const digit = /^Digit([1-4])$/.exec(e.code) || /^Numpad([1-4])$/.exec(e.code);
    if (digit) { setMapMode(MODES[+digit[1] - 1]); return; }
    if (e.code === 'KeyM') { const u = unitObj(S.sel); mergeHere(u ? u.prov : S.selProv); }
  }
  function bindKeys() {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', (e) => R().keyUp(e.code));
    window.addEventListener('blur', () => R().clearKeys());
  }

  // ===========================================================================
  // Zdarzenia logiki
  // ===========================================================================
  function bindGameEvents() {
    if (!WT.events || typeof WT.events.on !== 'function') { UI.missingApi['events.on'] = true; return; }
    const mapChanged = () => { if (!S.busy) { R().invalidate(); } };
    ['occupy', 'annex', 'eliminated', 'peace'].forEach((n) => WT.events.on(n, mapChanged));
    WT.events.on('proposal', () => { if (!S.busy) setTimeout(checkProposals, 50); });
    WT.events.on('gameover', () => { if (!S.busy) setTimeout(checkGameOver, 50); });
    // Wojny poza turą (np. sojusznik wciąga gracza) — własne wypowiedzenia mają już toast z wyniku akcji.
    WT.events.on('war', (p) => {
      if (S.busy || !S.inGame || !p || !me()) return;
      if (p.defender === me() && p.attacker) toast(countryName(p.attacker) + ' wypowiada Ci wojnę!', 'war', 5000);
      else if (p.joined && p.joined !== me() && p.war && (p.war.attackers || []).concat(p.war.defenders || []).indexOf(me()) >= 0) toast(countryName(p.joined) + ' dołącza do wojny', 'war', 4000);
    });
  }

  // ===========================================================================
  // Inicjalizacja
  // ===========================================================================
  UI.init = function () {
    bindRenderHandlers();
    bindStart();
    bindTopbar();
    bindMapModes();
    bindLog();
    bindKeys();
    bindGameEvents();
  };
  UI.fatal = function (msg) { const f = $('fatal'); f.textContent = msg; f.classList.remove('hidden'); };
})();
