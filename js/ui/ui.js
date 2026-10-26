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
    scen: '2026',           // epoka na ekranie startowym ('2026' | klucz window.SCENARIOS)
    conts: ['EU', 'AS', 'AF'],
    previewSeed: 0,
    sel: null,              // { type: 'army'|'fleet', id }
    selProv: -1,
    multi: null,            // tablica id prowincji w trybie zaznaczania wielu (null = tryb wyłączony)
    diploCC: null,
    diploQuery: '',
    godTool: null,          // 'take' | 'army'
    godCC: null,
    godArmyK: 50,
    planesN: 5,             // suwak budowy bombowców
    gunN: 2,                // suwak zakupu okrętów artyleryjskich
    airRepeat: false,       // ponawianie nalotów
    airSel: null,           // id dywizjonu w trybie wyboru celu nalotu
    shellSel: null,         // id floty w trybie wyboru celu ostrzału
    selSea: -1,             // otwarta strefa morska (id >= SEA_BASE) w panelu prowincji
    rankSort: null,
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
  // Układ mobilny (css/mobile.css) i urządzenia dotykowe
  function isMobile() { return !!(window.matchMedia && window.matchMedia('(max-width: 900px), (max-height: 500px)').matches); }
  function isTouch() { return !!(R() && R().isTouch && R().isTouch()); }
  UI.isMobile = isMobile;
  function countryName(cc) { return R() ? R().countryName(cc) : cc; }
  function countryColor(cc) { return R() ? R().countryColor(cc) : '#888'; }
  function staticCountry(cc) { return (window.COUNTRY_DATA && window.COUNTRY_DATA[cc]) || {}; }
  function liveCountry(cc) { return G() && G().countries ? G().countries[cc] : null; }
  function provStatic(id) { return MAP().provinces[id]; }
  // Ludność prowincji w bieżącej epoce (scenariusz skaluje dane z 2026)
  function provPop(id) { const p = provStatic(id).pop || 0; return G() && has('state.provPop') ? call('state.provPop', [id], p) : p; }
  // Strefy morskie: węzły o id >= SEA_BASE (flota może w nich stać i stamtąd ostrzeliwać ląd)
  const SEA_BASE = 100000;
  function isSeaNode(id) { return id >= SEA_BASE; }
  function seaStatic(id) { return (MAP().seas || [])[id - SEA_BASE] || null; }
  function nodeName(id) { return isSeaNode(id) ? ((seaStatic(id) || {}).name || 'Morze') : provStatic(id).name; }
  // Funkcje zależne od epoki (lotnictwo, radar, plot., okręty artyleryjskie)
  function eraOk(feature) { return !G() || call('state.era', [feature], true) !== false; }
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
    const lordOfCC = overlordOf(cc), vassalLink = lordOfCC === p || overlordOf(p) === cc;
    if (lordOfCC === p) t += '<span class="tag vassal">Twój wasal</span>';
    else if (overlordOf(p) === cc) t += '<span class="tag vassal">Suzeren</span>';
    if (atWar(p, cc)) t += '<span class="tag war">Wojna</span>';
    if (allied(p, cc) && !vassalLink) t += '<span class="tag ally">Sojusz</span>';
    if (hasPact(p, cc)) t += '<span class="tag pact">Pakt</span>';
    if (hasTruce(p, cc)) t += '<span class="tag truce">Rozejm</span>';
    if (call('diplomacy.hasTrade', [p, cc], false)) t += '<span class="tag trade">Handel</span>';
    return t;
  }
  // Wasale (WT.vassal)
  function overlordOf(cc) { return WT.vassal && cc ? WT.vassal.overlordOf(cc) : null; }
  function relClass(v) { return v > 15 ? 'pos' : v < -15 ? 'neg' : 'dim'; }
  function swatch(cc) { return '<span class="swatch" style="background:' + esc(countryColor(cc)) + '"></span>'; }

  // ===========================================================================
  // Ikony: inline SVG, jeden styl (obrys 1.75, viewBox 24) — wygląd w css/style.css (.ico)
  // ===========================================================================
  const ICONS = {
    calendar: '<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    coins: '<ellipse cx="12" cy="6.5" rx="7" ry="3"/><path d="M5 6.5v5c0 1.66 3.13 3 7 3s7-1.34 7-3v-5"/><path d="M5 11.5v5c0 1.66 3.13 3 7 3s7-1.34 7-3v-5"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M21.5 20c0-3-1.8-5.2-4.5-5.8"/>',
    shield: '<path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
    swords: '<path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/><path d="M14.5 6.5L18 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3M3 19l2 2"/>',
    next: '<path d="M5 5.5l9.5 6.5L5 18.5z"/><path d="M19 5v14"/>',
    handshake: '<path d="M11 17l2 2a1 1 0 1 0 3-3"/><path d="M14 14l2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/><path d="M21 3l1 11h-2M3 3L2 14l6.5 6.5a1 1 0 1 0 3-3M3 4h8"/>',
    sparkles: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    factory: '<path d="M3.5 20.5h17"/><path d="M4.5 20.5V10l5 3v-3l5 3V4h4v16.5"/><path d="M8 17h2M12 17h2"/>',
    fort: '<path d="M4 20.5V8h3v3h3V8h4v3h3V8h3v12.5z"/><path d="M10 20.5v-4a2 2 0 0 1 4 0v4"/>',
    anchor: '<circle cx="12" cy="5" r="2"/><path d="M12 7v14M5 13a7 7 0 0 0 14 0M3 13h4M17 13h4M9 10h6"/>',
    tent: '<path d="M3 20.5L12 4l9 16.5z"/><path d="M12 20.5l-3-6h6z"/>',
    ship: '<path d="M3 14.5h18l-2.5 5h-13z"/><path d="M6 14.5V10h9l3 4.5"/><path d="M9 10V6h3v4"/>',
    flag: '<path d="M5 21V4"/><path d="M5 4h12l-2.5 4.5L17 13H5"/>',
    chart: '<path d="M4 20h16"/><path d="M7 16v-5M12 16V6M17 16v-8"/>',
    mountain: '<path d="M3 19l6-10 4 6 2-3 6 7z"/>',
    save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
    keyboard: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/>',
    logout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16l-4-4 4-4M6 12h10"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    landmark: '<path d="M3 21h18M5 18h14M6 18v-7M10 18v-7M14 18v-7M18 18v-7M3 9l9-6 9 6z"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    upload: '<path d="M12 16V5M7 10l5-5 5 5M5 20h14"/>',
    plane: '<path d="M21 15.5l-8-4.5V5a1.5 1.5 0 0 0-3 0v6l-8 4.5V17l8-2.5v4l-2.5 1.5V21l4-1 4 1v-1l-2.5-1.5v-4l8 2.5z"/>',
    aa: '<path d="M4 20.5h16M7 20.5l2-6h6l2 6"/><path d="M12 14.5L18 5"/><path d="M17 8.5l3-1.5M15.5 4.5l1 3"/>',
    radar: '<path d="M4.5 19.5a10 10 0 0 1 0-15"/><path d="M8 16a5.5 5.5 0 0 1 0-8"/><circle cx="12" cy="12" r="1.6"/><path d="M12 12l8.5-5"/><path d="M12 13.5v7"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    flask: '<path d="M9.5 3.5h5M10.5 3.5v5.5L5 18.5A1.6 1.6 0 0 0 6.4 21h11.2a1.6 1.6 0 0 0 1.4-2.5L13.5 9V3.5"/><path d="M7.5 14.5h9"/>',
    university: '<path d="M3 9.5L12 5l9 4.5-9 4.5z"/><path d="M6.5 11.3V16c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3v-4.7"/><path d="M21 9.5V15"/>',
    trade: '<path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"/>',
    crown: '<path d="M3.5 8.5l4.5 4L12 5.5l4 7 4.5-4-2 10.5h-13z"/><path d="M6 21h12"/>',
    scroll: '<path d="M8 4h10a2 2 0 0 1 2 2v1.5h-4"/><path d="M16 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1.5h10"/><path d="M8 4a2 2 0 0 0-2 2v11"/><path d="M9.5 9h3.5M9.5 12.5h3.5"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H4.5a3 3 0 0 0 3.5 4M16 6h3.5a3 3 0 0 1-3.5 4"/><path d="M12 13v4M8.5 20.5h7M9.5 17h5"/>',
    select: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><path d="M14 17.5l2 2 4.5-4.5"/>',
    mouse: '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 7v3"/>'
  };
  function icon(name, cls) {
    return '<svg class="ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }
  UI.icon = icon;
  const BUILDING_ICONS = { factory: 'factory', fort: 'fort', port: 'anchor', barracks: 'tent', aa: 'aa', radar: 'radar', university: 'university' };
  const TOAST_ICONS = { war: 'alert', bad: 'alert', battle: 'swords', peace: 'check', ok: 'check' };

  // Suwaki: wypełnienie toru do wartości (zmienna CSS --p)
  function syncRange(el) {
    const min = +el.min || 0, max = el.max === '' ? 100 : +el.max, v = +el.value;
    el.style.setProperty('--p', (max > min ? ((v - min) / (max - min)) * 100 : 0) + '%');
  }
  function syncRangesIn(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.matches && root.matches('input[type=range]')) syncRange(root);
    root.querySelectorAll('input[type=range]').forEach(syncRange);
  }
  function bindRangeStyling() {
    document.addEventListener('input', (e) => { if (e.target && e.target.type === 'range') syncRange(e.target); }, true);
    const mo = new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1 && n.id !== 'tooltip' && !n.closest('#tooltip')) syncRangesIn(n);
    });
    mo.observe($('app'), { childList: true, subtree: true });
    syncRangesIn(document);
  }

  // Ikony i wrappery dla statycznego markupu z index.html (bez zmiany identyfikatorów i logiki)
  function decorateChrome() {
    const statIcons = { 'tb-date': 'calendar', 'tb-treasury': 'coins', 'tb-balance': 'trend', 'tb-manpower': 'users', 'tb-stability': 'shield', 'tb-army': 'swords' };
    document.querySelectorAll('#topbar .tb-stat').forEach((s) => {
      const val = s.querySelector('.val'), ic = statIcons[val && val.id];
      if (ic && !s.querySelector('.tb-ico')) s.insertAdjacentHTML('afterbegin', '<span class="tb-ico">' + icon(ic) + '</span>');
    });
    const btnIcon = (id, name, keepLabel) => {
      const b = $(id); if (!b || b.querySelector('.ico')) return;
      const kbd = b.querySelector('kbd');
      const label = Array.from(b.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
      Array.from(b.childNodes).forEach((n) => { if (n.nodeType === 3) n.remove(); });
      b.insertAdjacentHTML('afterbegin', icon(name) + (label ? '<span class="btn-label"' + (keepLabel ? ' data-keep' : '') + '>' + esc(label) + '</span>' : ''));
      if (kbd) b.appendChild(kbd);
      if (!b.getAttribute('aria-label')) b.setAttribute('aria-label', label || b.title || '');
    };
    btnIcon('btn-science', 'flask');
    btnIcon('btn-ranking', 'trophy');
    btnIcon('btn-diplomacy', 'handshake');
    btnIcon('btn-god', 'sparkles');
    btnIcon('btn-endturn', 'next', true);
    const menuBtn = $('btn-menu');
    if (menuBtn && !menuBtn.querySelector('.ico')) { menuBtn.innerHTML = icon('menu'); menuBtn.classList.add('btn-icon'); menuBtn.setAttribute('aria-label', 'Menu'); }
    const endLabel = document.querySelector('#btn-endturn .btn-label'); if (endLabel) endLabel.classList.remove('btn-label');
    const god = $('tb-god'); if (god && !god.querySelector('.ico')) god.innerHTML = icon('sparkles') + 'GOD';
    const menuIcons = { settings: 'sliders', science: 'flask', ranking: 'trophy', save: 'save', 'god-toggle': 'sparkles', help: 'keyboard', exit: 'logout' };
    document.querySelectorAll('#menu .menu-item').forEach((b) => {
      if (b.querySelector('.ico')) return;
      const txt = document.createElement('span'); txt.textContent = b.textContent; b.textContent = '';
      if (b.id === 'menu-god-toggle') { txt.id = 'menu-god-toggle-label'; }
      b.insertAdjacentHTML('afterbegin', icon(menuIcons[b.dataset.act] || 'info'));
      b.appendChild(txt);
    });
    const modeIcons = { political: 'flag', diplomatic: 'handshake', economic: 'chart', terrain: 'mountain' };
    document.querySelectorAll('#mapmodes .mm-btn').forEach((b) => { const s = b.querySelector('.mm-ico'); if (s && !s.firstChild) s.innerHTML = icon(modeIcons[b.dataset.mode]); });
    const lh = $('log-head');
    if (lh && !lh.querySelector('.ico')) { lh.firstElementChild.insertAdjacentHTML('afterbegin', icon('clock', 'ico-sm')); $('log-toggle').innerHTML = icon('chevron', 'ico-sm'); }
    const title = document.querySelector('.start-title');
    if (title && !title.querySelector('.eyebrow')) title.insertAdjacentHTML('afterbegin', '<span class="eyebrow">Strategia turowa</span>');
    const optGod = $('opt-god'), optWars = $('opt-wars');
    if (optGod && !document.querySelector('.start-options')) {
      const box = document.createElement('div'); box.className = 'start-options';
      const l1 = optGod.closest('label'), l2 = optWars && optWars.closest('label');
      l1.parentNode.insertBefore(box, l1);
      box.appendChild(l1); if (l2) box.appendChild(l2);
      const l3 = $('opt-nopacts') && $('opt-nopacts').closest('label'), ag = $('opt-aggr-row');
      if (l3) { box.appendChild(l3); l3.querySelector('span').innerHTML = 'Odrzucaj pakty automatycznie<small>Propozycje paktów o nieagresji nie będą się pojawiać</small>'; }
      if (ag) box.appendChild(ag);
      l1.querySelector('span').innerHTML = 'God Mode<small>Nielimitowana kasa i rezerwy, narzędzia edycji</small>';
    }
    const btnStart = $('btn-start'); if (btnStart && !btnStart.querySelector('.ico')) btnStart.insertAdjacentHTML('beforeend', icon('next'));
    const btnLoad = $('btn-load'); if (btnLoad && !btnLoad.querySelector('.ico')) btnLoad.insertAdjacentHTML('afterbegin', icon('save'));
  }

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
    el.innerHTML = '<span class="toast-ico">' + icon(TOAST_ICONS[kind] || 'info') + '</span><span class="toast-txt">' + esc(text) + '</span>';
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
    if (/wojn|atak|inwaz|nalot|radar/.test(s)) return 'war';
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
      const d = startStats(cc);
      return '<div class="country-item' + (cc === S.startCC ? ' sel' : '') + '" data-cc="' + esc(cc) + '">' + swatch(cc) +
        '<span class="name">' + esc(countryName(cc)) + '</span><span class="faint mono">' + (d.gdp ? fmtInt(d.gdp) + ' mld $' : '') + '</span></div>';
    }).join('') || '<div class="country-item faint">Brak wyników</div>';
  }
  // Dane państwa na ekranie startowym — z podglądu gry (epoka i kontynenty), inaczej statyczne z 2026
  function startStats(cc) {
    const c = liveCountry(cc);
    if (!c) return staticCountry(cc);
    const army = Object.values(G().armies || {}).reduce((s, a) => s + (a.owner === cc ? a.size || 0 : 0), 0);
    return { gdp: c.startGdp, pop: c.pop, army: army / 1000, navy: c.navy, ideology: c.ideology, gov: c.gov };
  }
  function renderStartCard() {
    const cc = S.startCC, card = $('start-card');
    if (!cc) { card.className = 'country-card empty'; card.textContent = 'Kliknij państwo na mapie lub wybierz z listy.'; return; }
    const d = startStats(cc);
    card.className = 'country-card';
    const tile = (ic, k, v) => '<div class="stat-tile"><div class="k">' + icon(ic) + k + '</div><div class="v" title="' + esc(v) + '">' + v + '</div></div>';
    card.innerHTML = '<h3>' + swatch(cc) + esc(countryName(cc)) + '</h3><div class="stat-grid">' +
      tile('coins', 'PKB', d.gdp != null ? fmtInt(d.gdp) + ' mld $' : '—') +
      tile('users', 'Ludność', d.pop != null ? fmtNum(d.pop, 1) + ' mln' : '—') +
      tile('pin', 'Prowincje', String(provincesOf(cc).length)) +
      tile('swords', 'Armia', d.army != null ? fmtInt(d.army) + ' tys.' : '—') +
      tile('ship', 'Flota', d.navy != null ? fmtInt(d.navy) + ' esk.' : '—') +
      tile('landmark', 'Ustrój', esc(d.ideology ? (IDEOLOGY_PL[d.ideology] || d.ideology) : (d.gov || '—'))) +
      '</div>' + (d.gov ? '<div class="hint">' + esc(d.gov) + '</div>' : '');
  }
  function selectStartCountry(cc, center) {
    S.startCC = cc || null;
    R().view.highlightCC = S.startCC;
    $('btn-start').disabled = !S.startCC;
    renderStartList(); renderStartCard();
    const el = $('start-results').querySelector('.sel');
    if (el) el.scrollIntoView({ block: 'nearest' });
    if (center && cc) { const o = startPanelOffsets(); R().centerOnCountry(cc, isMobile() ? 0.3 : 0.9, o[0], o[1]); }
    R().requestDraw();
  }
  // [lewy, dolny] fragment ekranu zasłonięty przez panel startowy (na telefonie w pionie panel jest na dole).
  function startPanelOffsets() {
    const el = document.querySelector('.start-panel');
    if (!el || !el.offsetWidth) return [0, 0];
    const r = el.getBoundingClientRect();
    if (r.width >= window.innerWidth * 0.9) return [0, Math.max(0, window.innerHeight - r.top + 8)];
    return [el.offsetWidth + 18, 0];
  }
  // ----- Epoka i kontynenty: podgląd = gra tworzona z tymi samymi opcjami i ziarnem co po "Rozpocznij" -----
  const SCEN_2026 = { id: '2026', title: '2026 — współczesność', desc: 'Współczesny świat: 1 stycznia 2026. Wojna Rosji z Ukrainą, konflikt w Gazie, ponad sto państw — bez gotowych sojuszy.' };
  const CONT_PL = { EU: 'Europa', AS: 'Azja', AF: 'Afryka' };
  function scenarioList() {
    const sc = window.SCENARIOS || {};
    return [SCEN_2026].concat(Object.keys(sc).sort((a, b) => b - a).map((k) => sc[k]));
  }
  function scenarioInfo(id) { return scenarioList().find((x) => x.id === id) || SCEN_2026; }
  function startOpts() {
    return { scenario: S.scen, continents: S.conts.slice(), startWars: $('opt-wars').checked, seed: S.previewSeed,
      god: $('opt-god').checked, autoRejectPacts: $('opt-nopacts').checked, aiAggression: +$('opt-aggr').value };
  }
  function buildPreview() {
    if (!has('state.newGame')) return;
    call('state.newGame', [Object.assign(startOpts(), { player: null })], null);
    const g = G();
    if (S.startCC && !(g && g.countries[S.startCC] && g.countries[S.startCC].alive !== false)) S.startCC = null;
    R().invalidate();
  }
  // Pary wojen startowych widoczne przy danym wyborze (oba państwa muszą istnieć)
  function startWarPairs() {
    const sc = (window.SCENARIOS || {})[S.scen], list = S.scen === '2026' ? (window.START_WARS || []) : ((sc && sc.wars) || []);
    const g = G(), alive = (cc) => g && g.countries[cc] && g.countries[cc].alive !== false;
    return list.filter((w) => alive(w[0]) && alive(w[1]));
  }
  function renderSetup() {
    $('opt-scen').innerHTML = scenarioList().map((x) => '<button type="button" class="seg-btn' + (x.id === S.scen ? ' on' : '') + '" data-scen="' + esc(x.id) +
      '" role="radio" aria-checked="' + (x.id === S.scen) + '" title="' + esc(x.title || x.id) + '">' + esc(x.id) + '</button>').join('');
    document.querySelectorAll('#opt-conts .seg-btn').forEach((b) => {
      const on = S.conts.includes(b.dataset.ct);
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    });
    const sc = scenarioInfo(S.scen);
    $('scen-desc').textContent = sc.desc || '';
    const yr = document.querySelector('.start-title h1 span'); if (yr) yr.textContent = S.scen;
    const sub = document.querySelector('.start-title .subtitle'), conts = S.conts.map((c) => CONT_PL[c]).join(', ');
    if (sub) sub.textContent = conts + ' · ' + (G() && has('state.dateStr') ? call('state.dateStr', [], '') : '') + ' · wybierz państwo na mapie';
    const pairs = startWarPairs(), wl = $('opt-wars').closest('label');
    const names = pairs.map((w) => countryName(w[0]) + '–' + countryName(w[1])).join(', ');
    wl.querySelector('span').innerHTML = 'Trwające konflikty ' + esc(S.scen) + '<small>' + esc(names || 'Brak wojen w tym momencie historii') + '</small>';
    $('opt-wars').disabled = !pairs.length;
    wl.classList.toggle('disabled', !pairs.length);
  }
  function applySetup() {
    buildPreview();
    renderSetup();
    renderStartList(); renderStartCard();
    selectStartCountry(S.startCC, false);
  }
  function setScenario(id) { if (id === S.scen) return; S.scen = id; applySetup(); centerStartView(); }
  function toggleContinent(ct) {
    const on = S.conts.includes(ct);
    if (on && S.conts.length === 1) { toast('Musi zostać co najmniej jeden kontynent', 'bad'); return; }
    S.conts = on ? S.conts.filter((c) => c !== ct) : WT.state && WT.state.CONTINENTS ? WT.state.CONTINENTS.filter((c) => c === ct || S.conts.includes(c)) : S.conts.concat([ct]);
    applySetup();
  }
  function showStart() {
    S.inGame = false; S.airSel = null; S.shellSel = null; S.selSea = -1; R().view.shellRange = null; R().view.selSea = -1; R().view.airRange = null; R().view.radarRing = null; S.multi = null; R().view.multi = null; S.sel = null; S.selProv = -1; S.godTool = null;
    document.body.classList.remove('in-game', 'ob-open');
    ['topbar', 'mapmodes', 'log', 'province-panel', 'diplo-panel', 'god-panel', 'order-bar', 'menu', 'legend'].forEach((id) => $(id).classList.add('hidden'));
    $('start-screen').classList.remove('hidden');
    const v = R().view; v.startScreen = true; v.sel = null; v.selProv = -1; v.preview = null; v.pending = null;
    R().setMode('political');
    S.previewSeed = Math.floor(Math.random() * 1e9);
    applySetup();
    centerStartView();
    if (!$('start-hint')) {
      const h = document.createElement('div'); h.id = 'start-hint'; h.className = 'start-hint';
      h.textContent = isTouch() ? 'Przeciągnij mapę, rozsuń palce = zoom, stuknij państwo aby je wybrać'
        : 'Przeciągnij mapę, kółko myszy = zoom, kliknij państwo aby je wybrać';
      $('start-screen').appendChild(h);
    }
  }
  UI.showStart = showStart;
  function centerStartView() {
    const o = startPanelOffsets();
    if (S.startCC) { R().centerOnCountry(S.startCC, isMobile() ? 0.3 : 0.9, o[0], o[1]); return; }
    const z = isMobile() ? 0.3 : 0.55, c = R().lonLatToMap(42, 47);
    R().centerOn(c[0] - o[0] / 2 / z, c[1] + o[1] / 2 / z, z);
  }
  function startGame() {
    if (!S.startCC) return;
    const opts = Object.assign(startOpts(), { player: S.startCC });
    const g = call('state.newGame', [opts], null);
    if (!g && !G()) { toast('Nie udało się utworzyć gry (brak WT.state.newGame)', 'bad'); return; }
    if (g && !WT.G) WT.G = g;
    enterGame(true);
  }
  function aggressionLabel(v) { return v <= 0 ? 'Pokojowa (bez nowych wojen)' : v < 35 ? 'Niska' : v <= 65 ? 'Standardowa' : v < 90 ? 'Wysoka' : 'Bardzo wysoka'; }
  function bindStart() {
    const ag = $('opt-aggr');
    ag.addEventListener('input', () => { $('opt-aggr-val').textContent = aggressionLabel(+ag.value); });
    $('start-search').addEventListener('input', renderStartList);
    $('opt-scen').addEventListener('click', (e) => { const b = e.target.closest('[data-scen]'); if (b) setScenario(b.dataset.scen); });
    $('opt-conts').addEventListener('click', (e) => { const b = e.target.closest('[data-ct]'); if (b) toggleContinent(b.dataset.ct); });
    $('opt-wars').addEventListener('change', applySetup);
    $('start-results').addEventListener('click', (e) => { const it = e.target.closest('[data-cc]'); if (it) selectStartCountry(it.dataset.cc, true); });
    $('btn-start').addEventListener('click', startGame);
    $('btn-load').addEventListener('click', openSaveMenu);
  }

  // ===========================================================================
  // Wejście do gry / odświeżanie
  // ===========================================================================
  function enterGame(centerView) {
    S.inGame = true; S.airSel = null; S.shellSel = null; S.selSea = -1; R().view.shellRange = null; R().view.selSea = -1; R().view.airRange = null; R().view.radarRing = null; S.multi = null; R().view.multi = null; S.sel = null; S.selProv = -1; S.diploCC = null; S.godTool = null; S.answered = {}; S.gameOverShown = false; S.proposalOpen = false;
    $('start-screen').classList.add('hidden');
    document.body.classList.add('in-game');
    ['topbar', 'mapmodes', 'log'].forEach((id) => $(id).classList.remove('hidden'));
    if (isMobile()) $('log').classList.add('collapsed');
    setTopbarExpanded(false);
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
    if (S.multi) renderMultiPanel();
    else if (!$('province-panel').classList.contains('hidden')) renderProvincePanel();
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
    $('tb-date').textContent = isMobile() ? shortDate(dateStr()) : dateStr();
    $('tb-date').parentNode.title = 'Data: ' + dateStr();
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
    ($('menu-god-toggle-label') || $('menu-god-toggle')).textContent = god ? 'Wyłącz God Mode' : 'Włącz God Mode';
    $('btn-endturn').disabled = S.busy;
  }
  // "5 stycznia 2026" → "5 sty 2026" (kompaktowy pasek na telefonie)
  function shortDate(t) {
    return String(t).replace(/\b(stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)\b/,
      (m) => ({ stycznia: 'sty', lutego: 'lut', marca: 'mar', kwietnia: 'kwi', maja: 'maj', czerwca: 'cze', lipca: 'lip', sierpnia: 'sie', 'września': 'wrz', 'października': 'paź', listopada: 'lis', grudnia: 'gru' }[m]));
  }
  function setTopbarExpanded(on) {
    $('topbar').classList.toggle('tb-expanded', !!on);
    $('btn-more').classList.toggle('active', !!on);
    $('btn-more').setAttribute('aria-expanded', on ? 'true' : 'false');
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
    else if (act === 'ranking') openRanking();
    else if (act === 'science') openScience();
    else if (act === 'settings') openSettings();
    else if (act === 'help') openHelp();
    else if (act === 'exit') confirmModal('Wyjście', 'Wrócić do menu głównego? Niezapisany postęp zostanie utracony (autozapis co 5 tur).', 'Wyjdź', () => { WT.G = null; showStart(); }, true);
  }
  function openHelp() {
    const rows = [['Spacja', 'Koniec tury'], ['W A S D / strzałki', 'Przesuwanie mapy'], ['+ / −, kółko', 'Zoom'], ['1 – 4', 'Tryby mapy'],
      ['LPM na armii', 'Zaznacz armię'], ['Przeciągnij armię', 'Rozkaz ruchu'], ['PPM na prowincji', 'Rozkaz ruchu dla zaznaczonej jednostki'],
      ['Enter', 'Potwierdź rozkaz'], ['M', 'Scal armie w prowincji'], ['Esc', 'Anuluj / odznacz / zamknij']];
    if (isTouch()) rows.unshift(['1 palec', 'Przesuwanie mapy (z bezwładnością)'], ['2 palce', 'Zoom (rozsuń / zsuń) i przesuwanie'],
      ['Stuknięcie', 'Wybór prowincji / armii'], ['Podwójne stuknięcie', 'Przybliżenie ×2'], ['Przytrzymanie', 'Informacje o prowincji'],
      ['Przeciągnij armię', 'Rozkaz ruchu'], ['Armia zaznaczona + stuknij cel', 'Rozkaz ruchu (pasek z suwakiem)']);
    openModal({ title: isTouch() ? 'Sterowanie' : 'Skróty klawiszowe', body: '<div class="shortcuts">' + rows.map((r) => '<kbd>' + esc(r[0]) + '</kbd><span>' + esc(r[1]) + '</span>').join('') + '</div>' });
  }
  function bindTopbar() {
    $('btn-endturn').addEventListener('click', endTurn);
    $('btn-menu').addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
    $('btn-diplomacy').addEventListener('click', () => toggleDiplomacy());
    $('btn-ranking').addEventListener('click', () => openRanking());
    $('btn-science').addEventListener('click', () => openScience());
    $('btn-god').addEventListener('click', () => toggleGodPanel());
    $('tb-country').addEventListener('click', () => R().centerOnCountry(me(), 0.8));
    $('btn-more').addEventListener('click', (e) => { e.stopPropagation(); setTopbarExpanded(!$('topbar').classList.contains('tb-expanded')); });
    // Na telefonie rozwinięty pasek zwija się po wybraniu akcji z drugiego rzędu
    $('topbar').addEventListener('click', (e) => { if (e.target.closest('button.tb-secondary')) setTopbarExpanded(false); });
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
    if (m === 'diplomatic') html = legendItem('#d9b86a', 'Ty') + legendItem('#a585f0', 'Wasal') + legendItem('#5b8def', 'Sojusznik') + legendItem('#3fb8b0', 'Pakt') + legendItem('#e5484d', 'Wojna') +
      '<span class="li">Relacje <span class="grad" style="background:linear-gradient(90deg,#94464a,#5d6673,#3f9466)"></span></span>';
    else if (m === 'economic') html = '<span class="li">Rozwój i fabryki: niski <span class="grad" style="background:linear-gradient(90deg,#262a4a,#2c7d78,#d6e06c)"></span> wysoki</span>';
    else if (m === 'terrain') html = [['#8fa865', 'plains'], ['#a99a63', 'hills'], ['#867a70', 'mountains'], ['#4e7a4c', 'forest'], ['#cdb882', 'desert'], ['#a3b2b8', 'tundra'], ['#33735a', 'jungle']]
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
    if (obj) {
      openNode(obj.prov);
      // Telefon: panel prowincji zwinięty do nagłówka, żeby było widać mapę do wskazania celu.
      if (isMobile()) $('province-panel').classList.add('sheet-collapsed');
      if (isTouch() && obj.owner === me() && (S.touchHints = (S.touchHints || 0) + 1) <= 2)
        toast('Stuknij prowincję docelową albo przeciągnij jednostkę na cel', '', 2600);
    }
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
    if (isSeaNode(target)) {
      const sp = call('naval.seaPath', [f.prov, target], null);
      if (!sp || !sp.length) return { ok: false, kind: 'fleet', target, points: [R().portPoint(f.prov), R().portPoint(target)], label: 'brak trasy', reason: 'Brak trasy morskiej' };
      const turns = seaTurns(sp);
      return { ok: true, kind: 'fleet', target, path: sp, turns, points: R().seaPoints(f.prov, sp), label: turnsText(turns) };
    }
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
    if (isSeaNode(target) && sel.type !== 'fleet') return null;
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
    const name = esc(nodeName(target));
    const routeCls = plan.kind === 'land' ? '' : ' sea';
    const routeTxt = plan.ok ? (plan.kind === 'land' ? 'Trasa lądowa: ' : plan.kind === 'sea' ? 'Desant morski: ' : 'Rejs: ') + turnsText(plan.turns) : '';
    const routeHtml = plan.ok ? '<span class="ob-route' + routeCls + '">' + routeTxt + '</span>' : '<span class="reason">' + esc(plan.reason) + '</span>';
    const buttons = '<button class="btn btn-primary" id="ob-go"' + (plan.ok ? '' : ' disabled') + '>Rozkaż <kbd>Enter</kbd></button><button class="btn btn-ghost" id="ob-cancel">Anuluj <kbd>Esc</kbd></button>';
    let html;
    if (S.sel.type === 'army') {
      // Suwak w procentach (0–100), a nie w żołnierzach: 100% zawsze oznacza dokładnie całą armię, bez reszty z zaokrąglenia kroku.
      const capPct = plan.kind === 'sea' && plan.capacity ? Math.max(1, Math.min(100, Math.floor(100 * plan.capacity / u.size))) : 100;
      html = '<div class="ob-head"><span class="ob-title">' + icon('swords') + 'Armia ' + fmtK(u.size) + ' → ' + name + '</span>' + routeHtml + '</div>' +
        '<div class="ob-row"><span class="dim">Wyślij:</span><input type="range" id="ob-size" min="1" max="100" step="1" value="' + capPct + '"' + (plan.ok ? '' : ' disabled') + '>' +
        '<span class="ob-count" id="ob-count"></span><button class="btn btn-sm" id="ob-all"' + (plan.ok ? '' : ' disabled') + '>Całość</button>' + buttons + '</div>';
    } else {
      html = '<div class="ob-head"><span class="ob-title">' + icon('ship') + 'Flota (' + u.ships + ' ' + plural(u.ships, 'eskadra', 'eskadry', 'eskadr') + ') → ' + name + '</span>' + routeHtml + '</div>' +
        '<div class="ob-row" style="justify-content:flex-end">' + buttons + '</div>';
    }
    bar.innerHTML = html;
    bar.classList.remove('hidden');
    document.body.classList.add('ob-open');
    const slider = $('ob-size');
    if (slider) {
      const upd = () => { const n = orderSize(u); $('ob-count').innerHTML = '<b>' + fmtInt(n) + '</b> / ' + fmtInt(u.size) + (n === u.size ? ' <span class="dim">(całość)</span>' : ''); };
      slider.addEventListener('input', upd); upd();
      $('ob-all').addEventListener('click', () => { slider.value = 100; syncRange(slider); upd(); });
    }
    $('ob-go').addEventListener('click', confirmOrder);
    $('ob-cancel').addEventListener('click', () => { closeOrderBar(); R().requestDraw(); });
    R().requestDraw();
  }
  /** Liczba wysyłanych żołnierzy z suwaka %; gdy w prowincji zostałaby drobna resztka — cała armia. */
  function orderSize(u) {
    const slider = $('ob-size');
    if (!slider || +slider.value >= 100) return u.size;
    const n = Math.max(WT.military.MIN_ARMY, Math.round(u.size * slider.value / 100 / 100) * 100);
    return n >= u.size - WT.military.MIN_REMAINDER ? u.size : n;
  }
  function closeOrderBar() {
    $('order-bar').classList.add('hidden');
    $('order-bar').innerHTML = '';
    document.body.classList.remove('ob-open');
    if (R()) R().view.pending = null;
  }
  function orderBarOpen() { return !$('order-bar').classList.contains('hidden'); }
  function confirmOrder() {
    const plan = R().view.pending, u = unitObj(S.sel);
    if (!plan || !u || !plan.ok) return;
    let res;
    if (S.sel.type === 'fleet') res = call('naval.orderFleet', [u.id, plan.target], null);
    else {
      const size = orderSize(u);
      const sizeArg = size < u.size ? size : undefined;
      if (plan.kind === 'sea') res = call('naval.planInvasion', [u.id, plan.target, sizeArg], null);
      else res = call('military.order', [u.id, plan.target, sizeArg], null);
    }
    closeOrderBar();
    if (!res || res.ok === false) toast((res && res.reason) || 'Nie można wydać rozkazu', 'bad');
    else toast(res.reason || (plan.kind === 'sea' ? 'Desant zaplanowany' : 'Rozkaz wydany: ' + nodeName(plan.target) + ' (' + turnsText(plan.turns) + ')'), 'ok', 2200);
    R().view.preview = null;
    validateSelection();
    refreshAll();
  }

  // ===========================================================================
  // Panel prowincji
  // ===========================================================================
  function openNode(id) { if (isSeaNode(id)) openSea(id); else openProvince(id); }
  function openSea(id) {
    if (id == null || id < 0 || !seaStatic(id)) return;
    if (S.multi) { S.multi = null; syncMultiView(); }
    S.selProv = -1; R().view.selProv = -1; setRadarRing(-1);
    S.selSea = id; R().view.selSea = id;
    if (isMobile()) { closeDiplomacy(); if (!S.godTool) closeGodPanel(); }
    $('province-panel').classList.remove('hidden', 'sheet-collapsed', 'sheet-expanded');
    renderProvincePanel();
    R().requestDraw();
  }
  function renderSeaPanel() {
    const id = S.selSea, z = seaStatic(id); if (!z || !G()) return;
    const ports = (z.coast || []).length, nb = (z.nb || []).length;
    let html = '<div class="panel-head"><span class="sea-dot"></span><h2>' + esc(z.name) + '</h2><button class="close" data-act="close" title="Zamknij (Esc)" aria-label="Zamknij">' + icon('x') + '</button></div><div class="panel-body">';
    html += '<div class="section"><div class="kv"><span class="k">Typ</span><span class="v txt">Strefa morska</span>' +
      '<span class="k">Wybrzeże</span><span class="v">' + ports + ' ' + plural(ports, 'prowincja', 'prowincje', 'prowincji') + '</span>' +
      '<span class="k">Sąsiednie strefy</span><span class="v">' + nb + '</span></div></div>';
    html += provinceUnitsSection(id);
    html += '<div class="section"><div class="hint">' + (isTouch() ? 'Zaznacz swoją flotę i stuknij strefę morską' : 'Zaznacz swoją flotę i kliknij PPM na strefę morską') +
      ', aby tu popłynąć. Okręty artyleryjskie ostrzeliwują z morza prowincje wroga w zasięgu ' + fmtInt(WT.naval ? WT.naval.shellRangeKm(me()) : 320) + ' km — bez wchodzenia do portu.</div></div>';
    html += '</div>';
    const panel = $('province-panel'), scroll = panel.scrollTop;
    panel.innerHTML = html;
    panel.scrollTop = scroll;
    bindProvincePanel(id);
  }
  function openProvince(id) {
    if (id == null || id < 0) return;
    if (isSeaNode(id)) { openSea(id); return; }
    if (S.multi) { S.multi = null; syncMultiView(); }
    S.selSea = -1; R().view.selSea = -1;
    S.selProv = id; R().view.selProv = id;
    if (isMobile()) { closeDiplomacy(); if (!S.godTool) closeGodPanel(); }
    $('province-panel').classList.remove('hidden', 'sheet-collapsed', 'sheet-expanded');
    renderProvincePanel();
    R().requestDraw();
  }
  UI.openProvince = openProvince;
  function closeProvince() {
    S.selProv = -1; R().view.selProv = -1;
    S.selSea = -1; R().view.selSea = -1;
    setRadarRing(-1);
    $('province-panel').classList.add('hidden');
    R().requestDraw();
  }
  function renderProvincePanel() {
    if (S.selSea >= 0) { renderSeaPanel(); return; }
    const id = S.selProv; if (id < 0 || !G()) return;
    const ps = provStatic(id), pd = provDyn(id), owner = pd.owner, ctrl = pd.ctrl || owner;
    const mine = owner === me();
    let html = '<div class="panel-head">' + swatch(owner) + '<h2>' + esc(ps.name) + '</h2><button class="close" data-act="close" title="Zamknij (Esc)" aria-label="Zamknij">' + icon('x') + '</button></div><div class="panel-body">';
    html += provinceInfoSection(ps, pd, owner, ctrl);
    html += provinceUnitsSection(id);
    if (mine) html += buildingsSection(id, pd) + recruitSection(id, ctrl) + shipsSection(id, ps, pd) + gunshipSection(id, ps, pd) + airSection(id, ctrl);
    else html += '<div class="section"><button class="btn" data-act="diplo" style="width:100%;justify-content:center">Dyplomacja z: ' + esc(countryName(owner)) + '</button></div>';
    html += '</div>';
    const panel = $('province-panel');
    const scroll = panel.scrollTop;
    panel.innerHTML = html;
    panel.scrollTop = scroll;
    bindProvincePanel(id);
    setRadarRing(mine && ctrl === owner ? id : -1);
  }
  function provinceInfoSection(ps, pd, owner, ctrl) {
    let h = '<div class="section"><div class="kv">';
    h += '<span class="k">Właściciel</span><span class="v txt">' + esc(countryName(owner)) + ' ' + statusTags(owner) + '</span>';
    h += '<span class="k">Kontrola</span><span class="v txt">' + (ctrl !== owner ? '<span class="tag occ">Okupacja</span> ' + esc(countryName(ctrl)) : esc(countryName(ctrl))) + '</span>';
    h += '<span class="k">Populacja</span><span class="v">' + fmtNum(provPop(S.selProv), 2) + ' mln</span>';
    h += '<span class="k">Powierzchnia</span><span class="v">' + fmtInt(ps.areaKm2) + ' km²</span>';
    h += '<span class="k">Teren</span><span class="v txt">' + esc(TERRAIN_PL[ps.terrain] || ps.terrain || '—') + (ps.coastal ? ' · wybrzeże' : '') + '</span>';
    if (pd.dev != null) h += '<span class="k">Rozwój</span><span class="v">' + fmtNum(pd.dev, 2) + '</span>';
    if (pd.bombed > 0) h += '<span class="k">Po nalocie</span><span class="v neg">dochód −50% (' + turnsText(pd.bombed) + ')</span>';
    if (WT.air && owner === me() && ctrl === owner && eraOk('air')) {
      h += '<span class="k">Obrona plot.</span><span class="v">' + Math.round(100 * WT.air.interceptChance(S.selProv, null)) + '% zestrzeleń</span>';
      const rl = (pd.buildings || {}).radar || 0;
      if (rl) h += '<span class="k">Radar</span><span class="v">' + fmtInt(WT.air.radarRangeKm(rl, me())) + ' km</span>';
    }
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
      h += '<div class="army-row' + (sel ? ' sel' : '') + '" data-fleet="' + esc(f.id) + '"><span class="army-chip" style="background:#0b2034;color:#cfe8ff;border-color:' + countryColor(f.owner) + '">' + icon('ship') + f.ships + (f.gunships ? ' · ' + icon('aa') + f.gunships : '') +
        '</span><span>Flota: ' + esc(countryName(f.owner)) + '</span><span class="faint" style="margin-left:auto">' + esc(fleetStatus(f)) + '</span></div>';
    });
    const selF = S.sel && S.sel.type === 'fleet' ? unitObj(S.sel) : null;
    if (selF && selF.prov === id && selF.owner === me()) h += fleetActions(selF);
    const selA = S.sel && S.sel.type === 'army' ? unitObj(S.sel) : null;
    const myCount = armies.filter((a) => a.owner === me()).length;
    if (selA && selA.prov === id && selA.owner === me()) {
      h += '<div class="row-actions">' +
        (myCount > 1 ? '<button class="btn btn-sm" data-act="merge">Scal armie <kbd>M</kbd></button>' : '') +
        (selA.path && selA.path.length ? '<button class="btn btn-sm" data-act="cancel">Zatrzymaj</button>' : '') +
        (selA.embarked || !has('diplomacy.giveTroops') ? '' : '<button class="btn btn-sm" data-act="give">Przekaż armię…</button>') +
        '<button class="btn btn-sm btn-danger" data-act="disband">Rozwiąż</button></div>' +
        '<div class="hint">' + (isTouch() ? 'Przeciągnij armię na cel lub stuknij prowincję docelową, aby wydać rozkaz.' : 'Przeciągnij armię na mapie lub kliknij PPM na cel, aby wydać rozkaz.') + '</div>';
    } else if (myCount > 1) h += '<div class="row-actions"><button class="btn btn-sm" data-act="merge">Scal armie <kbd>M</kbd></button></div>';
    return h + '</div>';
  }
  function fleetStatus(f) {
    if (f.path && f.path.length) return 'w rejsie → ' + nodeName(f.path[f.path.length - 1]);
    if (f.shellTarget != null && f.gunships > 0) return 'ostrzał';
    if ((f.cargo || []).length) return 'ładunek: ' + f.cargo.length;
    return isSeaNode(f.prov) ? 'na morzu' : 'w porcie';
  }
  // Zaznaczona własna flota: cel ostrzału (okręty artyleryjskie) i wskazówka ruchu
  function fleetActions(f) {
    let h = '';
    if (f.gunships > 0 && WT.naval && WT.naval.orderShell) {
      const r = WT.naval.shellRangeKm(f.owner);
      h += '<div class="shell-box"><div class="shell-head">' + icon('aa') + '<b>' + f.gunships + '</b> ' + plural(f.gunships, 'okręt artyleryjski', 'okręty artyleryjskie', 'okrętów artyleryjskich') +
        '<span class="dim">zasięg ' + fmtInt(r) + ' km</span></div>';
      if (f.shellTarget != null) {
        const err = WT.naval.checkShell(f, f.shellTarget);
        h += '<div class="shell-target">Cel: <b>' + esc(provStatic(f.shellTarget).name) + '</b> · ' + fmtInt(WT.naval.distToProvince(f.prov, f.shellTarget)) + ' km' +
          (err ? '<div class="reason">' + esc(err) + '</div>' : '') + '</div>';
      }
      h += '<div class="row-actions"><button class="btn btn-sm btn-primary" data-act="shell">' + (f.shellTarget != null ? 'Zmień cel ostrzału' : 'Cel ostrzału') + '</button>' +
        (f.shellTarget != null ? '<button class="btn btn-sm" data-act="shell-stop">Przerwij ostrzał</button>' : '') + '</div></div>';
    }
    h += '<div class="hint">' + (isTouch() ? 'Stuknij prowincję nadmorską lub strefę morską, aby popłynąć.' : 'PPM na prowincję nadmorską lub strefę morską = rejs.') + '</div>';
    return h;
  }
  function buildingsSection(id, pd) {
    const B = (WT.economy && WT.economy.BUILDINGS) || null;
    if (!B) return '';
    let h = '<div class="section"><div class="section-title">Budynki</div>';
    Object.keys(B).forEach((type) => {
      if ((type === 'aa' || type === 'radar') && !eraOk(type)) return;   // brak w tej epoce
      const def = B[type], lvl = (pd.buildings || {})[type] || 0, max = def.max || 5;
      const can = call('economy.canBuild', [me(), id, type], { ok: false, reason: 'Niedostępne' }) || { ok: false };
      let pips = ''; for (let i = 0; i < max; i++) pips += '<i class="pip' + (i < lvl ? ' on' : '') + '"></i>';
      const price = can.cost != null ? can.cost : has('economy.buildCost') ? call('economy.buildCost', [me(), id, type], def.cost) : def.cost;
      const cost = isGod() ? 'darmo' : fmtNum(price, 1) + ' mld';
      h += '<div class="build-row"><div title="' + esc(def.desc || '') + '"><span class="build-ico">' + icon(BUILDING_ICONS[type] || 'landmark') + '</span><span class="build-txt"><span class="build-name">' + esc(def.name || type) + '</span><span class="pips">' + pips + '</span></span></div>' +
        '<span class="build-lvl">' + cost + (def.turns && !isGod() ? ' · ' + def.turns + 't' : '') + '</span>' +
        '<button class="btn btn-sm" data-build="' + type + '"' + (can.ok ? '' : ' disabled') + ' title="' + esc(can.ok ? 'Buduj ' + (def.name || type) + (def.desc ? ' — ' + def.desc : '') : can.reason || '') + '">' + ((pd.builds || {})[type] ? 'W budowie' : 'Buduj') + '</button></div>';
    });
    Object.keys(pd.builds || {}).forEach((type) => {
      const def = B[type] || {}, left = pd.builds[type], total = def.turns || left || 1;
      const pct = Math.round(100 * (1 - left / total));
      h += '<div class="hint">W budowie: <b>' + esc(def.name || type) + '</b> — ' + turnsText(left) + '</div><div class="progress"><i style="width:' + pct + '%"></i></div>';
    });
    h += '<div class="row-actions"><button class="btn btn-sm" data-act="multi">' + icon('select') + ' Buduj w wielu prowincjach</button></div>';
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
  function gunshipSection(id, ps, pd) {
    if (!ps.coastal || !WT.naval.buyGunships || !eraOk('gunships')) return '';
    const can = WT.naval.canBuyGunships(me(), id, S.gunN);
    return '<div class="section"><div class="section-title">Okręty artyleryjskie</div>' +
      '<div class="slider-row"><input type="range" id="gun-n" min="1" max="10" value="' + S.gunN + '"><span class="num" id="gun-n-val">' + S.gunN + ' okr.</span></div>' +
      '<div class="slider-row" style="margin-top:6px"><span class="dim">Koszt: <span class="num" id="gun-cost">' + gunCostText(S.gunN) + '</span></span>' +
      '<button class="btn btn-sm btn-ok" id="gun-go" style="margin-left:auto"' + (can.ok ? '' : ' disabled') + '>Kup okręty</button></div>' +
      '<div class="reason" id="gun-reason">' + (can.ok ? '' : esc(can.reason || '')) + '</div>' +
      '<div class="hint">Zaznacz flotę z okrętami artyleryjskimi, ustaw ją w strefie morskiej i wybierz „Cel ostrzału” — co turę ostrzeliwuje prowincję wroga w zasięgu ' + fmtInt(WT.naval.shellRangeKm(me())) + ' km: zabija do 15% wojsk, obniża rozwój i dochód, uszkadza forty. Forty odpowiadają ogniem.</div></div>';
  }
  function gunCostText(n) { return isGod() ? '0 (God Mode)' : fmtNum(WT.naval.gunshipCost(n), 1) + ' mld $'; }
  function bindGunships(id) {
    const s = $('gun-n'); if (!s) return;
    s.addEventListener('input', () => {
      S.gunN = +s.value;
      $('gun-n-val').textContent = S.gunN + ' okr.';
      $('gun-cost').textContent = gunCostText(S.gunN);
      const can = WT.naval.canBuyGunships(me(), id, S.gunN);
      $('gun-go').disabled = !can.ok; $('gun-reason').textContent = can.ok ? '' : (can.reason || '');
    });
    $('gun-go').addEventListener('click', () => {
      const f = WT.naval.buyGunships(me(), id, S.gunN);
      if (f) toast('Kupiono ' + S.gunN + ' okr. artyleryjskich — zaznacz flotę i wybierz „Cel ostrzału”', 'ok', 3500);
      else toast(WT.naval.canBuyGunships(me(), id, S.gunN).reason || 'Nie można kupić', 'bad');
      refreshAll();
    });
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
    bindGunships(id);
    bindAir(id);
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
    else if (act === 'give') openGiveArmyModal(id);
    else if (act === 'multi') startMulti([id]);
    else if (act === 'cancel' && S.sel) { call('military.cancel', [S.sel.id]); refreshAll(); }
    else if (act === 'shell' && S.sel && S.sel.type === 'fleet') startShellTarget(S.sel.id);
    else if (act === 'shell-stop' && S.sel && S.sel.type === 'fleet') { WT.naval.cancelShell(S.sel.id); toast('Ostrzał przerwany', '', 2000); refreshAll(); }
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
    if (isMobile() && S.selProv >= 0) closeProvince();
    if (cc && cc !== me()) S.diploCC = cc;
    $('diplo-panel').classList.remove('hidden', 'sheet-collapsed', 'sheet-expanded');
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
    let html = '<div class="panel-head"><h2>Dyplomacja</h2><button class="close" data-act="close" title="Zamknij (Esc)" aria-label="Zamknij">' + icon('x') + '</button></div><div class="panel-body">';
    html += '<div class="section dip-settings"><label class="check"><input type="checkbox" id="dip-nopacts"' + (settingsOf().autoRejectPacts ? ' checked' : '') + '> <span>Automatycznie odrzucaj pakty o nieagresji</span></label></div>';
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
        statusTags(cc) + threatDot(cc) + '<span class="relmini" title="Relacje: ' + r + '"><i class="' + (r >= 0 ? 'up' : 'down') + '" style="width:' + (Math.min(100, Math.abs(r)) / 2) + '%"></i></span>' +
        '<span class="rel ' + relClass(r) + '">' + (r > 0 ? '+' : '') + r + '</span></div>';
    }).join('') || '<div class="country-item faint">Brak wyników</div>';
  }
  function diploDetailHtml(cc) {
    const p = me(), c = liveCountry(cc), d = staticCountry(cc), r = Math.round(rel(p, cc));
    const war = atWar(p, cc), ally = allied(p, cc), pact = hasPact(p, cc), truce = hasTruce(p, cc);
    const armySum = armiesOf(cc).reduce((s, a) => s + (a.size || 0), 0);
    let h = '<div class="section diplo-card"><div class="section-title">' + swatch(cc) + esc(countryName(cc)) + '</div>';
    h += '<div class="kv"><span class="k">Relacje</span><span class="v ' + relClass(r) + '">' + (r > 0 ? '+' : '') + r + '</span></div>';
    h += '<div class="relbar"><i style="left:' + ((r + 100) / 2) + '%"></i></div>';
    h += '<div style="margin:6px 0">' + (statusTags(cc) || '<span class="tag">Neutralny</span>') + '</div>';
    h += threatBarHtml(cc);
    h += '<div class="kv">' +
      '<span class="k">Ustrój</span><span class="v txt">' + esc(d.gov || '—') + (c.ideology ? ' · ' + esc(IDEOLOGY_PL[c.ideology] || c.ideology) : '') + '</span>' +
      '<span class="k">PKB (start)</span><span class="v">' + (c.startGdp != null ? fmtInt(c.startGdp) + ' mld $' : d.gdp != null ? fmtInt(d.gdp) + ' mld $' : '—') + '</span>' +
      '<span class="k">Armia</span><span class="v">' + fmtInt(armySum) + '</span>' +
      '<span class="k">Prowincje</span><span class="v">' + provincesOf(cc).length + '</span>' +
      '<span class="k">Stabilność</span><span class="v">' + Math.round(c.stability || 0) + '%</span>' +
      (overlordOf(cc) ? '<span class="k">Suzeren</span><span class="v txt">' + swatch(overlordOf(cc)) + esc(countryName(overlordOf(cc))) + '</span>' : '') + '</div>';
    if (war && WT.vassal) h += warPointsLineHtml(cc);
    const vassalLink = overlordOf(cc) === p || overlordOf(p) === cc;
    const impCost = has('diplomacy.improveRelationsCost') ? call('diplomacy.improveRelationsCost', [p], 1) : 1 + 0.001 * (staticCountry(p).gdp || 0);
    h += '<div class="action-grid" style="margin-top:10px">';
    h += war ? '<button class="btn btn-ok" data-dip="peace-white">Biały pokój</button>' +
        (WT.vassal ? '<button class="btn btn-primary" data-dip="conference">Konferencja pokojowa</button>' : '<button class="btn btn-ok" data-dip="peace-annex">Pokój: aneksja</button>')
      : vassalLink ? '' : '<button class="btn btn-danger" data-dip="war"' + (truce ? ' disabled title="Obowiązuje rozejm"' : '') + '>Wypowiedz wojnę</button>';
    if (!vassalLink) {
      h += ally ? '<button class="btn" data-dip="break">Zerwij sojusz</button>' : '<button class="btn" data-dip="alliance"' + (war ? ' disabled' : '') + '>Zaproponuj sojusz</button>';
      if (!pact) h += '<button class="btn" data-dip="pact"' + (war ? ' disabled' : '') + '>Pakt o nieagresji</button>';
    }
    h += call('diplomacy.hasTrade', [p, cc], false) ? '<button class="btn" data-dip="trade-cancel">Zerwij handel</button>'
      : '<button class="btn" data-dip="trade"' + (war ? ' disabled' : '') + ' title="+3% dochodu dla obu stron; wymaga relacji ≥ 15">Umowa handlowa</button>';
    h += '<button class="btn" data-dip="improve" title="Koszt ok. ' + fmtNum(impCost, 1) + ' mld $">Popraw relacje</button>';
    h += '<button class="btn" data-dip="insult">Obraź</button>';
    h += '<button class="btn btn-ghost" data-dip="show">Pokaż na mapie</button>';
    return h + '</div>' + countryWarsHtml(cc) + reparationsHtml(cc) + vassalSectionHtml(cc) + aidSectionHtml(cc) + '</div>';
  }

  // ===========================================================================
  // Punkty wojenne, konferencja pokojowa, wasale
  // ===========================================================================
  function warPointsLineHtml(cc) {
    const pts = WT.vassal.warPoints(me(), cc), lim = WT.vassal.acceptLimit(me(), cc);
    return '<div class="war-points"><span class="wp-ico">' + icon('trophy') + '</span><span>Punkty wojenne: <b class="num">' + pts.total + '</b>' +
      '<span class="dim"> · okupacja ' + pts.occupation + ' + zniszczenia ' + pts.damage + (lim > pts.total ? ' · zmęczenie wroga: limit ' + lim : '') + '</span></span></div>';
  }
  function reparationsHtml(cc) {
    if (!WT.vassal) return '';
    const p = me(), list = WT.vassal.reparationsOf(cc).filter((r) => (r.from === cc && r.to === p) || (r.from === p && r.to === cc));
    if (!list.length) return '';
    return '<div class="kv" style="margin-top:8px">' + list.map((r) => '<span class="k">Reparacje</span><span class="v txt">' +
      (r.from === cc ? esc(countryName(cc)) + ' płaci tobie' : 'Płacisz: ' + esc(countryName(cc))) + ' ' + Math.round(r.pct * 100) + '% dochodu' +
      (r.paid ? ' (' + fmtNum(r.paid, 2) + ' mld/tura)' : '') + ' · do tury ' + r.until + '</span>').join('') + '</div>';
  }
  function vassalSectionHtml(cc) {
    const V = WT.vassal;
    if (!V || overlordOf(cc) !== me()) return '';
    const c = liveCountry(cc), trib = Math.round((c.tribute != null ? c.tribute : V.DEFAULT_TRIBUTE) * 100);
    const mMax = Math.max(0, Math.floor(c.treasury || 0)), tMax = Math.floor(V.vassalTroops(cc) / 1000);
    S.vasMoney = Math.max(1, Math.min(S.vasMoney || 10, Math.max(1, mMax)));
    S.vasTroopsK = Math.max(5, Math.min(S.vasTroopsK || 20, Math.max(5, tMax)));
    const an = V.canAnnex(me(), cc);
    let h = '<div class="section-title" style="margin-top:12px">' + icon('crown') + ' Zarządzanie wasalem</div>';
    h += '<div class="kv"><span class="k">Wasal od</span><span class="v">tury ' + (c.vassalSince != null ? c.vassalSince : '?') + '</span>' +
      '<span class="k">Skarbiec wasala</span><span class="v">' + fmtBn(c.treasury || 0) + '</span>' +
      '<span class="k">Trybut ostatnio</span><span class="v">' + fmtNum(c.tributePaid || 0, 2) + ' mld $</span>' +
      '<span class="k">Wojsko wasala</span><span class="v">' + fmtInt(V.vassalTroops(cc)) + '</span></div>';
    h += '<div class="vas-row"><span class="vas-lbl">Trybut</span><input type="range" id="vas-trib" min="0" max="' + Math.round(V.MAX_TRIBUTE * 100) + '" step="5" value="' + trib + '"><span class="num" id="vas-trib-val">' + trib + '% dochodu</span></div>';
    h += '<div class="vas-row"><span class="vas-lbl">Pieniądze</span><input type="range" id="vas-money" min="1" max="' + Math.max(1, mMax) + '" value="' + S.vasMoney + '"' + (mMax < 1 ? ' disabled' : '') + '>' +
      '<span class="num" id="vas-money-val">' + fmtInt(S.vasMoney) + ' mld $</span><button class="btn btn-sm btn-ok" id="vas-money-go"' + (mMax < 1 ? ' disabled title="Pusty skarbiec"' : '') + '>Zabierz</button></div>';
    h += '<div class="vas-row"><span class="vas-lbl">Wojsko</span><input type="range" id="vas-troops" min="5" max="' + Math.max(5, tMax) + '" value="' + S.vasTroopsK + '"' + (tMax < 5 ? ' disabled' : '') + '>' +
      '<span class="num" id="vas-troops-val">' + fmtInt(S.vasTroopsK) + ' tys.</span><button class="btn btn-sm btn-ok" id="vas-troops-go"' + (tMax < 5 ? ' disabled title="Wasal ma za mało wojska"' : '') + '>Przejmij</button></div>';
    h += '<div class="row-actions"><button class="btn btn-sm btn-primary" id="vas-annex"' + (an.ok ? '' : ' disabled') + ' title="' + esc(an.reason || '') + '">Przyłącz' + (an.ok ? ' (' + fmtBn(an.cost) + ')' : '') + '</button>' +
      '<button class="btn btn-sm" id="vas-release">Uwolnij</button></div>' +
      '<div class="hint">' + (an.ok ? '' : esc(an.reason) + ' ') + 'Wasal płaci trybut co turę, walczy w twoich wojnach (dołącza automatycznie) i nie prowadzi własnej polityki. Zabieranie pieniędzy i wojska obniża jego relacje z tobą.</div>';
    return h;
  }
  function bindVassalSection(cc) {
    const V = WT.vassal, tr = $('vas-trib'); if (!V || !tr) return;
    const p = me(), after = () => { R().invalidate(); refreshAll(); };
    tr.addEventListener('input', () => { $('vas-trib-val').textContent = tr.value + '% dochodu'; });
    tr.addEventListener('change', () => { resultToast(V.setTribute(p, cc, tr.value / 100)); });
    const m = $('vas-money'), t = $('vas-troops');
    m.addEventListener('input', () => { S.vasMoney = +m.value; $('vas-money-val').textContent = fmtInt(S.vasMoney) + ' mld $'; });
    t.addEventListener('input', () => { S.vasTroopsK = +t.value; $('vas-troops-val').textContent = fmtInt(S.vasTroopsK) + ' tys.'; });
    $('vas-money-go').addEventListener('click', () => { resultToast(V.takeMoney(p, cc, S.vasMoney)); after(); });
    $('vas-troops-go').addEventListener('click', () => { resultToast(V.takeTroops(p, cc, S.vasTroopsK * 1000)); after(); });
    $('vas-annex').addEventListener('click', () => confirmModal('Przyłączenie wasala', 'Przyłączyć <b>' + esc(countryName(cc)) + '</b>? Jego prowincje, armie i floty staną się twoje.', 'Przyłącz', () => {
      resultToast(V.annex(p, cc)); S.diploCC = null; after();
    }));
    $('vas-release').addEventListener('click', () => confirmModal('Uwolnienie wasala', 'Uwolnić <b>' + esc(countryName(cc)) + '</b>? Przestanie płacić trybut i walczyć w twoich wojnach.', 'Uwolnij', () => {
      resultToast(V.release(p, cc)); after();
    }, true));
  }

  /** Konferencja pokojowa (jak w AoH2): wybór warunków za punkty wojenne, podgląd żądanych prowincji na mapie. */
  function openConference(cc) {
    const V = WT.vassal, p = me();
    if (!V || !atWar(p, cc)) return;
    const err0 = V.checkTreaty(p, cc, { contribution: true });
    if (err0 && !/Wybierz/.test(err0)) { toast(err0, 'bad', 3500); return; }
    const pts = V.warPoints(p, cc), lim = V.acceptLimit(p, cc);
    const T = { provinces: [], contribution: false, reparations: false, disarm: false, vassal: false };
    const sync = () => { R().view.multi = T.provinces.slice(); R().requestDraw(); };
    const render = (el) => {
      const cost = V.treatyCost(p, cc, T), err = V.checkTreaty(p, cc, T), over = cost > lim;
      const vasErr = V.checkTreaty(p, cc, Object.assign({}, T, { vassal: true }));
      const pct = lim > 0 ? Math.min(100, Math.round(100 * cost / lim)) : 100;
      let h = '<div class="conf-head"><div><span class="lbl">Twoje punkty</span><b class="num">' + pts.total + '</b><span class="sub">okupacja ' + pts.occupation + ' · zniszczenia ' + pts.damage + '</span></div>' +
        '<div><span class="lbl">Limit (zmęczenie wroga)</span><b class="num">' + lim + '</b><span class="sub">zmęczenie wojną ' + Math.round(liveCountry(cc).warExhaustion || 0) + '%</span></div>' +
        '<div><span class="lbl">Koszt warunków</span><b class="num ' + (over ? 'neg' : 'pos') + '">' + cost + '</b><span class="sub">' + (over ? 'za dużo — wróg odrzuci' : 'wróg przyjmie') + '</span></div></div>' +
        '<div class="conf-bar' + (over ? ' over' : '') + '"><i style="width:' + pct + '%"></i></div>';
      h += '<div class="conf-cols"><div class="conf-col"><div class="section-title">Prowincje (' + T.provinces.length + '/' + pts.provinces.length + ')' +
        (pts.provinces.length ? '<span class="conf-sel"><button class="btn btn-sm btn-ghost" data-conf="all">Wszystkie</button><button class="btn btn-sm btn-ghost" data-conf="none">Żadna</button></span>' : '') + '</div><div class="conf-list">';
      h += pts.provinces.length ? pts.provinces.map((x) => '<label class="conf-item"><input type="checkbox" data-prov="' + x.id + '"' + (T.provinces.indexOf(x.id) >= 0 ? ' checked' : '') + '><span>' + esc(provStatic(x.id).name) + '</span><span class="num">' + x.value + ' pkt</span></label>').join('')
        : '<div class="hint">Nie okupujesz prowincji tego państwa. Zajmij je wojskiem, aby móc ich żądać i zdobyć punkty.</div>';
      h += '</div></div><div class="conf-col"><div class="section-title">Warunki</div>';
      const opt = (k, label, sub, c, dis) => '<label class="conf-item' + (dis ? ' disabled' : '') + '"><input type="checkbox" data-opt="' + k + '"' + (T[k] ? ' checked' : '') + (dis ? ' disabled' : '') + '><span>' + label + '<small>' + sub + '</small></span><span class="num">' + c + ' pkt</span></label>';
      h += opt('vassal', 'Wasalizacja', vasErr && !/Wybierz/.test(vasErr) && !T.vassal ? vasErr : 'pełna kontrola: trybut, pieniądze, wojsko, przyłączenie', V.vassalCost(cc, T.provinces), !T.vassal && vasErr && !/Wybierz/.test(vasErr));
      h += opt('reparations', 'Reparacje wojenne', Math.round(V.REPARATIONS_PCT * 100) + '% dochodu przez ' + V.REPARATIONS_TURNS + ' tur', V.COST.reparations, false);
      h += opt('contribution', 'Kontrybucja', 'jednorazowo połowa skarbca (' + fmtBn(Math.max(0, liveCountry(cc).treasury || 0) / 2) + ')', V.COST.contribution, false);
      h += opt('disarm', 'Rozbrojenie', 'armia wroga −60%', V.COST.disarm, false);
      h += '<div class="hint" style="margin-top:8px">Punkty: każda okupowana prowincja (ludność, rozwój, stolica ×2) + zadane straty, naloty i ostrzał. Wróg przyjmie traktat, gdy koszt ≤ limit.</div></div></div>';
      if (err && !/Wybierz/.test(err)) h += '<div class="reason">' + esc(err) + '</div>';
      el.querySelector('#conf-body').innerHTML = h;
      const go = el.querySelector('#conf-go'); if (go) go.disabled = !!err || over;
      el.querySelectorAll('[data-prov]').forEach((b) => b.addEventListener('change', () => {
        const id = +b.dataset.prov;
        T.provinces = b.checked ? T.provinces.concat([id]) : T.provinces.filter((x) => x !== id);
        sync(); render(el);
      }));
      el.querySelectorAll('[data-opt]').forEach((b) => b.addEventListener('change', () => { T[b.dataset.opt] = b.checked; render(el); }));
      el.querySelectorAll('[data-conf]').forEach((b) => b.addEventListener('click', () => {
        T.provinces = b.dataset.conf === 'all' ? pts.provinces.map((x) => x.id) : [];
        if (T.vassal && T.provinces.length >= provincesOf(cc).length) T.provinces.pop();
        sync(); render(el);
      }));
    };
    openModal({ title: icon('scroll') + ' Konferencja pokojowa: ' + esc(countryName(cc)), wide: true, body: '<div id="conf-body"></div>',
      buttons: [{ label: 'Anuluj' }, { label: 'Zaproponuj traktat', cls: 'btn-primary', close: false, onClick: (close) => {
        const res = V.proposeTreaty(p, cc, T);
        resultToast(res, 'Traktat przyjęty');
        if (res && res.accepted) { close(); R().invalidate(); refreshAll(); }
      } }],
      onOpen: (el) => { const b = el.querySelectorAll('.modal-foot .btn'); b[b.length - 1].id = 'conf-go'; render(el); },
      onClose: () => { R().view.multi = S.multi ? S.multi.slice() : null; R().requestDraw(); } });
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
        '<div class="war-score"><span>Wynik wojny: ' + (sc > 0 ? '+' : '') + sc + '</span><span>od tury ' + (w.start != null ? w.start : '?') + '</span></div>' +
        losingLineHtml(w) + '</div>';
    });
    return h + '</div>';
  }
  function bindDiplomacy() {
    const panel = $('diplo-panel');
    panel.querySelector('[data-act=close]').addEventListener('click', closeDiplomacy);
    $('dip-search').addEventListener('input', (e) => { S.diploQuery = e.target.value; $('dip-list').innerHTML = diploListHtml(); });
    $('dip-list').addEventListener('click', (e) => { const it = e.target.closest('[data-cc]'); if (it) { S.diploCC = it.dataset.cc; renderDiplomacy(); } });
    panel.querySelectorAll('[data-dip]').forEach((b) => b.addEventListener('click', () => diploAction(b.dataset.dip, S.diploCC)));
    bindAidSection(S.diploCC);
    bindVassalSection(S.diploCC);
    $('dip-nopacts').addEventListener('change', (e) => { settingsOf().autoRejectPacts = e.target.checked; toast(e.target.checked ? 'Pakty o nieagresji będą odrzucane automatycznie' : 'Propozycje paktów znów trafią do ciebie', '', 2200); });
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
      case 'conference': openConference(cc); return;
      case 'alliance': resultToast(call('diplomacy.proposeAlliance', [p, cc], null), 'Sojusz zawarty'); break;
      case 'break': resultToast(call('diplomacy.breakAlliance', [p, cc], null), 'Sojusz zerwany'); break;
      case 'pact': resultToast(call('diplomacy.proposePact', [p, cc], null), 'Pakt podpisany'); break;
      case 'trade': resultToast(call('diplomacy.proposeTrade', [p, cc], null), 'Umowa handlowa podpisana'); break;
      case 'trade-cancel': resultToast(call('diplomacy.cancelTrade', [p, cc], null), 'Umowa handlowa zerwana'); break;
      case 'improve': resultToast(call('diplomacy.improveRelations', [p, cc], null), 'Relacje poprawione'); break;
      case 'insult': resultToast(call('diplomacy.insult', [p, cc], null), 'Obrażono ' + name); break;
      case 'show': R().centerOnCountry(cc, 0.8); return;
    }
    after();
  }

  // ===========================================================================
  // Wsparcie innych państw (pieniądze, wojsko) + kto przegrywa wojnę
  // ===========================================================================
  /** Strona przegrywająca wojnę (wynik ≤ −10) albo null przy wyrównanej wojnie. */
  function losingSide(w) {
    const a = (w.attackers || [])[0]; if (!a) return null;
    const sc = Math.round(warScoreFor(w, a));
    if (sc <= -10) return { side: w.attackers, score: sc };
    if (sc >= 10) return { side: w.defenders, score: -sc };
    return null;
  }
  function losingLineHtml(w) {
    const l = losingSide(w);
    if (!l) return '<div class="hint">Wojna wyrównana.</div>';
    return '<div class="hint"><span class="neg">Przegrywa:</span> ' + l.side.map((c) => esc(countryName(c))).join(', ') + ' (' + l.score + ')</div>';
  }
  /** Wojny wybranego państwa z wynikiem z jego perspektywy (na karcie dyplomacji). */
  function countryWarsHtml(cc) {
    const wars = (G().wars || []).filter((w) => (w.attackers || []).concat(w.defenders || []).indexOf(cc) >= 0);
    if (!wars.length) return '';
    return '<div class="kv" style="margin-top:10px">' + wars.map((w) => {
      const foes = ((w.attackers || []).indexOf(cc) >= 0 ? w.defenders : w.attackers) || [];
      const sc = Math.round(warScoreFor(w, cc));
      const st = sc <= -10 ? '<span class="neg">przegrywa</span>' : sc >= 10 ? '<span class="pos">wygrywa</span>' : '<span class="dim">remis</span>';
      return '<span class="k">Wojna z</span><span class="v txt">' + foes.map((c) => esc(countryName(c))).join(', ') + ' · ' + (sc > 0 ? '+' : '') + sc + ' ' + st + '</span>';
    }).join('') + '</div>';
  }
  function aidMoneyMax() {
    const c = liveCountry(me()) || {};
    return isGod() ? 1000 : Math.max(0, Math.floor(c.treasury || 0));
  }
  function aidTroopsMaxK(sourceProv) {
    return Math.floor((call('diplomacy.availableTroops', [me(), sourceProv], 0) || 0) / 1000);
  }
  function aidSectionHtml(cc) {
    if (!has('diplomacy.giveMoney')) return '';
    const p = me(), war = atWar(p, cc);
    const mMax = aidMoneyMax(), tMax = aidTroopsMaxK();
    S.aidMoney = Math.max(1, Math.min(S.aidMoney || 10, Math.max(1, mMax)));
    S.aidTroopsK = Math.max(1, Math.min(S.aidTroopsK || 10, Math.max(1, tMax)));
    const troopReason = call('diplomacy.aidTroopsReason', [p, cc], null);
    let h = '<div class="section-title" style="margin-top:12px">Wsparcie</div>';
    if (war) return h + '<div class="hint">Nie można wspierać państwa, z którym jesteś w wojnie.</div>';
    h += '<div class="slider-row"><input type="range" id="aid-money" min="1" max="' + Math.max(1, mMax) + '" value="' + S.aidMoney + '"' + (mMax < 1 ? ' disabled' : '') + '>' +
      '<span class="num" id="aid-money-val">' + fmtInt(S.aidMoney) + ' mld $</span></div>' +
      '<div class="row-actions" style="margin-top:6px"><button class="btn btn-sm btn-ok" id="aid-money-go"' + (mMax < 1 ? ' disabled title="Pusty skarbiec"' : '') + '>Wyślij pieniądze</button>' +
      '<span class="faint">' + (isGod() ? 'God Mode: bez kosztu' : 'skarbiec: ' + fmtBn((liveCountry(p) || {}).treasury || 0)) + '</span></div>';
    h += '<div class="slider-row" style="margin-top:10px"><input type="range" id="aid-troops" min="1" max="' + Math.max(1, tMax) + '" value="' + S.aidTroopsK + '"' + (tMax < 1 || troopReason ? ' disabled' : '') + '>' +
      '<span class="num" id="aid-troops-val">' + fmtInt(S.aidTroopsK) + ' tys.</span></div>' +
      '<div class="row-actions" style="margin-top:6px"><button class="btn btn-sm btn-ok" id="aid-troops-go"' + (tMax < 1 || troopReason ? ' disabled' : '') + '>Przekaż wojsko</button>' +
      '<span class="faint">dostępne: ' + fmtInt(tMax) + ' tys.</span></div>';
    if (troopReason) h += '<div class="reason">' + esc(troopReason) + '</div>';
    else if (tMax < 1) h += '<div class="reason">Brak stojących armii do przekazania (zaokrętowane lub w walce się nie liczą).</div>';
    return h + '<div class="hint">Wojsko trafia do stolicy odbiorcy (albo do prowincji źródłowej, gdy leży na jego lub sojuszniczej ziemi).</div>';
  }
  function bindAidSection(cc) {
    const m = $('aid-money'), t = $('aid-troops');
    if (m) m.addEventListener('input', () => { S.aidMoney = +m.value; $('aid-money-val').textContent = fmtInt(S.aidMoney) + ' mld $'; });
    if (t) t.addEventListener('input', () => { S.aidTroopsK = +t.value; $('aid-troops-val').textContent = fmtInt(S.aidTroopsK) + ' tys.'; });
    const after = () => { validateSelection(); R().invalidate(); refreshAll(); };
    const mg = $('aid-money-go'), tg = $('aid-troops-go');
    if (mg) mg.addEventListener('click', () => { resultToast(call('diplomacy.giveMoney', [me(), cc, S.aidMoney], null), 'Wysłano pieniądze'); after(); });
    if (tg) tg.addEventListener('click', () => { resultToast(call('diplomacy.giveTroops', [me(), cc, S.aidTroopsK >= aidTroopsMaxK() ? call('diplomacy.availableTroops', [me()], 0) : S.aidTroopsK * 1000], null), 'Przekazano wojsko'); after(); });
  }
  /** Kandydaci do przyjęcia wojska: relacja ≥ 0, bez wojny z nami; najpierw sojusznicy i państwa w wojnie (przegrywające). */
  function aidCandidates() {
    const p = me();
    const warScoreOf = (cc) => (G().wars || []).reduce((m, w) => ((w.attackers || []).concat(w.defenders || []).indexOf(cc) >= 0 ? Math.min(m, warScoreFor(w, cc)) : m), 999);
    return aliveCountries().filter((cc) => cc !== p && !atWar(p, cc) && rel(p, cc) >= 0)
      .map((cc) => ({ cc, ally: allied(p, cc), score: warScoreOf(cc), r: rel(p, cc), reason: call('diplomacy.aidTroopsReason', [p, cc], null) }))
      .sort((a, b) => (b.ally - a.ally) || ((b.score < 999) - (a.score < 999)) || (a.score - b.score) || (b.r - a.r))
      .slice(0, 30);
  }
  function openGiveArmyModal(provId) {
    const a = unitObj(S.sel);
    if (!a || a.owner !== me() || a.embarked) return;
    const avail = call('diplomacy.availableTroops', [me(), provId], a.size) || 0;
    const maxK = Math.max(1, Math.floor(avail / 1000));
    let k = maxK;
    const cands = aidCandidates();
    const rows = cands.map((c) => {
      const war = c.score < 999 ? ' · wojna ' + (c.score > 0 ? '+' : '') + Math.round(c.score) : '';
      return '<div class="country-item" data-give="' + esc(c.cc) + '"' + (c.reason ? ' title="' + esc(c.reason) + '" style="opacity:.5"' : '') + '>' + swatch(c.cc) +
        '<span class="name">' + esc(countryName(c.cc)) + '</span>' + statusTags(c.cc) + '<span class="mono">' + (c.r > 0 ? '+' : '') + Math.round(c.r) + war + '</span></div>';
    }).join('') || '<div class="hint">Brak państw z relacjami ≥ 0, którym można przekazać wojsko.</div>';
    const body = '<div class="slider-row"><span class="dim">Ile:</span><input type="range" id="give-k" min="1" max="' + maxK + '" value="' + k + '"><span class="num" id="give-k-val">' + fmtInt(k) + ' tys.</span></div>' +
      '<div class="hint" style="margin:6px 0">Wybierz państwo (sojusznicy i państwa w wojnie na górze):</div><div class="country-list" style="max-height:300px">' + rows + '</div>';
    openModal({ title: 'Przekaż armię (' + esc(provStatic(provId).name) + ')', body, buttons: [{ label: 'Anuluj' }], onOpen: (el, close) => {
      const s = el.querySelector('#give-k');
      s.addEventListener('input', () => { k = +s.value; el.querySelector('#give-k-val').textContent = fmtInt(k) + ' tys.'; });
      el.querySelectorAll('[data-give]').forEach((row) => row.addEventListener('click', () => {
        const res = call('diplomacy.giveTroops', [me(), row.dataset.give, k >= maxK ? avail : k * 1000, provId], null);
        if (resultToast(res, 'Przekazano wojsko')) { close(); validateSelection(); R().invalidate(); refreshAll(); }
      }));
    } });
  }

  // ===========================================================================
  // Panel God Mode
  // ===========================================================================
  function toggleGodPanel() { if ($('god-panel').classList.contains('hidden')) openGodPanel(); else closeGodPanel(); }
  function openGodPanel() {
    if (!isGod()) return;
    closeDiplomacy();
    if (isMobile() && S.selProv >= 0) closeProvince();
    $('god-panel').classList.remove('hidden', 'sheet-collapsed', 'sheet-expanded');
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
    let h = '<div class="panel-head"><span class="god-badge">' + icon('sparkles') + 'GOD</span><h2>Narzędzia God Mode</h2><button class="close" data-act="close" title="Zamknij" aria-label="Zamknij">' + icon('x') + '</button></div><div class="panel-body">';
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
      if (S.godTool && isMobile()) $('god-panel').classList.add('sheet-collapsed');   // odsłoń mapę do klikania
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
  function updateCursor() { const c = $('map'); if (c) c.style.cursor = S.godTool || S.airSel || S.shellSel ? 'crosshair' : ''; }

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
    return '<div class="slot"><span class="slot-name">' + icon(slot === 'auto' ? 'clock' : 'save') + label + '</span><span class="slot-info">' + desc + '</span><span class="slot-actions">' + saveBtn +
      '<button class="btn btn-sm btn-primary" data-load="' + slot + '"' + (info ? '' : ' disabled') + '>Wczytaj</button>' + delBtn + '</span></div>';
  }
  function saveMenuHtml() {
    const list = saveList();
    const bySlot = {}; list.forEach((s) => { bySlot[s.slot] = s; });
    let h = '';
    for (let i = 1; i <= 5; i++) h += slotRowHtml(i, bySlot[i], 'Slot ' + i);
    const auto = bySlot.auto || bySlot.autosave || bySlot[0] || (autosaveExists() ? { player: '?', turn: '?', date: '' } : null);
    h += slotRowHtml('auto', auto, 'Autozapis');
    h += '<div class="row-actions" style="margin-top:12px"><button class="btn" id="sv-export"' + (S.inGame ? '' : ' disabled') + '>' + icon('download') + 'Eksportuj JSON</button>' +
      '<button class="btn" id="sv-import">' + icon('upload') + 'Importuj JSON…</button><input type="file" id="sv-file" accept=".json,application/json" class="hidden"></div>';
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
  const PROPOSAL_TITLES = { peace: 'Propozycja pokoju', alliance: 'Propozycja sojuszu', pact: 'Propozycja paktu o nieagresji',
    trade: 'Propozycja umowy handlowej', aidRequest: 'Prośba o pomoc', callToArms: 'Wezwanie do wojny' };
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
    if (pr.type === 'aidRequest' && !isGod()) {
      const tr = (liveCountry(me()) || {}).treasury || 0;
      t += '<br><span class="dim">Twój skarbiec: ' + fmtNum(tr, 1) + ' mld $' + (tr < pr.terms.amount ? ' — za mało, nie możesz pomóc' : '') + '</span>';
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
          (u.owner === me() ? '<div class="tt-row faint">' + (isTouch() ? 'Przeciągnij na cel lub stuknij armię, potem cel' : 'Przeciągnij na cel lub kliknij i PPM na cel') + '</div>' : '');
        return '<div class="tt-title">' + swatch(u.owner) + ' Flota: ' + esc(countryName(u.owner)) + '</div><div class="tt-row">Eskadry: <b class="num">' + fmtInt(u.ships) + '</b></div>' +
          ((u.cargo || []).length ? '<div class="tt-row">Ładunek: <b>' + u.cargo.length + ' ' + plural(u.cargo.length, 'armia', 'armie', 'armii') + '</b></div>' : '');
      }
    }
    if (id < 0) return '';
    const ps = provStatic(id);
    const owner = R().ownerOf(id), ctrl = R().ctrlOf(id);
    let h = '<div class="tt-title">' + esc(ps.name) + '</div><div class="tt-row">' + swatch(owner) + '<b>' + esc(countryName(owner)) + '</b></div>';
    if (ctrl !== owner) h += '<div class="tt-row"><span class="tag occ">Okupacja</span> ' + swatch(ctrl) + esc(countryName(ctrl)) + '</div>';
    h += '<div class="tt-row">' + esc(TERRAIN_PL[ps.terrain] || ps.terrain || '') + ' · ' + fmtNum(provPop(id), 2) + ' mln' + (ps.coastal ? ' · wybrzeże' : '') + '</div>';
    if (G()) {
      const armies = armiesIn(id);
      if (armies.length) {
        h += '<div class="tt-armies">' + armies.map((a) => {
          const c = countryColor(a.owner);
          return '<span class="army-chip" style="background:' + c + ';color:' + (R().luminance(c) > 0.62 ? '#111' : '#fff') + '">' + fmtK(a.size) + '</span>';
        }).join('') + '</div>';
      }
      const pv = R().view.preview;
      if (pv && pv.target === id) h += '<div class="tt-row" style="margin-top:4px;color:' + (pv.ok ? 'var(--accent)' : '#ff9c96') + '">' + esc(pv.ok ? (pv.kind === 'sea' ? 'Desant: ' : 'Ruch: ') + turnsText(pv.turns) + (isTouch() ? '' : ' — PPM aby wydać rozkaz') : pv.reason || '') + '</div>';
      const sf = S.shellSel ? G().fleets[S.shellSel] : null;
      if (sf) {
        const err = WT.naval.checkShell(sf, id);
        h += '<div class="tt-row" style="margin-top:4px;color:' + (err ? '#ff9c96' : '#ffb066') + '">' + esc(err || 'Ostrzał możliwy · ' + fmtInt(WT.naval.distToProvince(sf.prov, id)) + ' km') + '</div>';
      }
    }
    return h;
  }
  function seaTooltipHtml(id) {
    const z = seaStatic(id); if (!z) return '';
    let h = '<div class="tt-title">' + esc(z.name) + '</div><div class="tt-row">Strefa morska</div>';
    const fl = fleetsIn(id);
    if (fl.length) h += '<div class="tt-armies">' + fl.map((f) => '<span class="army-chip" style="background:#0b2034;color:#cfe8ff;border-color:' + countryColor(f.owner) + '">' + f.ships + (f.gunships ? ' · ' + f.gunships + ' art.' : '') + '</span>').join('') + '</div>';
    const pv = R().view.preview;
    if (pv && pv.target === id) h += '<div class="tt-row" style="margin-top:4px;color:' + (pv.ok ? '#8fa8ff' : '#ff9c96') + '">' + esc(pv.ok ? 'Rejs: ' + turnsText(pv.turns) + (isTouch() ? '' : ' — PPM aby wydać rozkaz') : pv.reason || '') + '</div>';
    return h;
  }
  function showTooltip(id, sx, sy, unit, sea) {
    const tt = $('tooltip');
    const seaId = id < 0 && S.inGame && sea >= 0 ? sea : -1;
    if ((id < 0 && !unit && seaId < 0) || R().isDraggingUnit()) { tt.classList.add('hidden'); S.lastHoverKey = ''; return; }
    const key = id + '|' + seaId + '|' + (unit ? unit.id : '') + '|' + (R().view.preview ? R().view.preview.target : '') + '|' + (S.shellSel || '');
    if (key !== S.lastHoverKey) { tt.innerHTML = unit || id >= 0 ? tooltipHtml(id, unit) : seaTooltipHtml(seaId); S.lastHoverKey = key; }
    tt.classList.remove('hidden');
    const w = tt.offsetWidth, h = tt.offsetHeight;
    let x = sx + 16, y = sy + 18;
    if (x + w > window.innerWidth - 8) x = sx - w - 12;
    if (y + h > window.innerHeight - 8) y = sy - h - 12;
    tt.style.left = x + 'px'; tt.style.top = y + 'px';
  }

  // ===========================================================================
  // Lotnictwo: bombowce w panelu prowincji, wybór celu nalotu, pierścień radaru
  // ===========================================================================
  function squadStatus(sq) {
    if (sq.phase === 'out') return 'leci na: ' + provStatic(sq.target).name + (sq.repeat ? ' (powtarzane)' : '');
    if (sq.phase === 'back') return 'wraca do bazy';
    return 'w bazie';
  }
  function airSection(id, ctrl) {
    if (!WT.air || ctrl !== me()) return '';
    const squads = WT.air.squadronsAt(id).filter((q) => q.owner === me());
    if (!squads.length && !eraOk('air')) return '';
    let h = '<div class="section"><div class="section-title">Lotnictwo</div>';
    squads.forEach((q) => {
      h += '<div class="air-row"><span class="air-ico">' + icon('plane') + '</span><span class="air-txt"><b>' + q.planes + '</b> ' + plural(q.planes, 'bombowiec', 'bombowce', 'bombowców') +
        '<span class="dim">' + esc(squadStatus(q)) + '</span></span><span class="air-btns">' +
        (q.phase === 'idle' ? '<button class="btn btn-sm btn-primary" data-air="target" data-sq="' + q.id + '">Cel nalotu</button>' : '') +
        (q.phase === 'out' ? '<button class="btn btn-sm" data-air="recall" data-sq="' + q.id + '">Zawróć</button>' : '') +
        (q.phase === 'idle' ? '<button class="btn btn-sm btn-ghost" data-air="disband" data-sq="' + q.id + '" title="Rozwiąż dywizjon">' + icon('x') + '</button>' : '') +
        '</span></div>';
    });
    if (squads.length) h += '<label class="air-repeat"><input type="checkbox" id="air-repeat"' + (S.airRepeat ? ' checked' : '') + '> Powtarzaj naloty na ten sam cel</label>';
    const can = WT.air.canBuildBombers(me(), id, S.planesN);
    h += '<div class="slider-row" style="margin-top:6px"><input type="range" id="air-n" min="1" max="' + WT.air.MAX_BUILD + '" value="' + S.planesN + '"><span class="num" id="air-n-val">' + S.planesN + ' szt.</span></div>' +
      '<div class="slider-row" style="margin-top:6px"><span class="dim">Koszt: <span class="num" id="air-cost">' + airCostText(S.planesN) + '</span></span>' +
      '<button class="btn btn-sm btn-ok" id="air-go" style="margin-left:auto"' + (can.ok ? '' : ' disabled') + '>Zbuduj bombowce</button></div>' +
      '<div class="reason" id="air-reason">' + (can.ok ? '' : esc(can.reason || '')) + '</div>' +
      '<div class="hint">Zasięg ' + fmtInt(WT.air.rangeKm(me())) + ' km. Bombowce niszczą rozwój i budynki prowincji wroga; działka plot. i radar wroga je zestrzeliwują.</div></div>';
    return h;
  }
  function airCostText(n) { return isGod() ? '0 (God Mode)' : fmtNum(WT.air.planeCost(me(), n), 1) + ' mld $'; }
  function bindAir(id) {
    const panel = $('province-panel');
    panel.querySelectorAll('[data-air]').forEach((b) => b.addEventListener('click', () => onAirAction(b.dataset.air, b.dataset.sq)));
    const rep = $('air-repeat'); if (rep) rep.addEventListener('change', () => { S.airRepeat = rep.checked; });
    const s = $('air-n'); if (!s) return;
    s.addEventListener('input', () => {
      S.planesN = +s.value;
      $('air-n-val').textContent = S.planesN + ' szt.';
      $('air-cost').textContent = airCostText(S.planesN);
      const can = WT.air.canBuildBombers(me(), id, S.planesN);
      $('air-go').disabled = !can.ok; $('air-reason').textContent = can.ok ? '' : (can.reason || '');
    });
    $('air-go').addEventListener('click', () => {
      const sq = WT.air.buildBombers(me(), id, S.planesN);
      if (sq) toast('Zbudowano ' + S.planesN + ' ' + plural(S.planesN, 'bombowiec', 'bombowce', 'bombowców'), 'ok', 2500);
      else toast(WT.air.canBuildBombers(me(), id, S.planesN).reason || 'Nie można zbudować', 'bad');
      refreshAll();
    });
  }
  function onAirAction(act, sqId) {
    if (act === 'target') startAirTarget(sqId);
    else if (act === 'recall') { WT.air.recall(sqId); toast('Dywizjon zawraca do bazy', '', 2000); refreshAll(); }
    else if (act === 'disband') confirmModal('Rozwiązanie dywizjonu', 'Rozwiązać dywizjon bombowców?', 'Rozwiąż', () => { WT.air.disband(sqId); refreshAll(); }, true);
  }
  function startAirTarget(sqId) {
    const sq = (G().squadrons || {})[sqId]; if (!sq) return;
    deselect(); closeOrderBar();
    if (S.multi) exitMulti();
    S.airSel = sqId;
    const b = provStatic(sq.base);
    R().view.airRange = { x: b.cx, y: b.cy, r: WT.air.rangeKm(sq.owner) / (MAP().kmPerUnit || 4) };
    if (isMobile()) $('province-panel').classList.add('sheet-collapsed');
    updateCursor();
    R().requestDraw();
    toast((isTouch() ? 'Stuknij' : 'Kliknij') + ' prowincję wroga w zasięgu (okrąg), aby ją zbombardować. Esc = anuluj', '', 3500);
  }
  function stopAirTarget() {
    S.airSel = null; R().view.airRange = null;
    updateCursor(); R().requestDraw();
  }
  function doRaid(prov) {
    if (prov < 0) { stopAirTarget(); return; }
    const res = WT.air.orderRaid(S.airSel, prov, S.airRepeat);
    if (!res.ok) { toast(res.reason, 'bad', 3000); return; }   // tryb celowania zostaje — można wskazać inny cel
    stopAirTarget();
    toast(res.reason, 'ok', 3000);
    refreshAll();
  }
  // Ostrzał z morza: tryb wyboru celu (jak nalot) — okrąg zasięgu dział wokół floty
  function startShellTarget(fleetId) {
    const f = G().fleets[fleetId]; if (!f) return;
    stopAirTarget();
    closeOrderBar(); R().view.preview = null;
    S.shellSel = fleetId;
    const p = R().portPoint(f.prov);
    R().view.shellRange = { x: p[0], y: p[1], r: WT.naval.shellRangeKm(f.owner) / (MAP().kmPerUnit || 4) };
    if (isMobile()) $('province-panel').classList.add('sheet-collapsed');
    updateCursor();
    R().requestDraw();
    toast((isTouch() ? 'Stuknij' : 'Kliknij') + ' prowincję wroga w zasięgu dział (okrąg). Esc = anuluj', '', 3500);
  }
  function stopShellTarget() {
    S.shellSel = null; if (R()) R().view.shellRange = null;
    updateCursor(); if (R()) R().requestDraw();
  }
  function doShell(prov) {
    if (prov < 0) { stopShellTarget(); return; }
    const res = WT.naval.orderShell(S.shellSel, prov);
    if (!res.ok) { toast(res.reason, 'bad', 3000); return; }   // tryb celowania zostaje
    stopShellTarget();
    toast(res.reason, 'ok', 3000);
    refreshAll();
  }
  /** Zasięg radaru wybranej własnej prowincji jako okrąg na mapie. */
  function setRadarRing(id) {
    const lvl = id >= 0 && WT.air ? ((provDyn(id).buildings || {}).radar || 0) : 0;
    const p = id >= 0 ? provStatic(id) : null;
    R().view.radarRing = lvl ? { x: p.cx, y: p.cy, r: WT.air.radarRangeKm(lvl, me()) / (MAP().kmPerUnit || 4) } : null;
    R().requestDraw();
  }

  // ===========================================================================
  // Ustawienia gry i agresywność
  // ===========================================================================
  function settingsOf() { return call('state.settings', [], null) || (G().settings = G().settings || { autoRejectPacts: false, aiAggression: 50 }); }
  function openSettings() {
    if (!S.inGame || !G()) return;
    const st = settingsOf();
    const body = '<label class="check"><input type="checkbox" id="set-nopacts"' + (st.autoRejectPacts ? ' checked' : '') + '> <span>Automatycznie odrzucaj pakty o nieagresji</span></label>' +
      '<div class="aggr-row" style="margin-top:14px"><span class="aggr-lbl">Agresywność AI</span><input type="range" id="set-aggr" min="0" max="100" step="5" value="' + st.aiAggression + '">' +
      '<span class="aggr-val" id="set-aggr-val">' + aggressionLabel(st.aiAggression) + '</span></div>' +
      '<div class="hint" style="margin-top:8px">Agresywność wpływa na to, jak często i przy jak słabych relacjach AI wypowiada wojny, jakiej przewagi potrzebuje do ataku i jak łatwo zgadza się na biały pokój. 0 = brak nowych wojen AI.</div>';
    openModal({ title: icon('sliders') + ' Ustawienia gry', body, onOpen: (el) => {
      el.querySelector('#set-nopacts').addEventListener('change', (e) => { settingsOf().autoRejectPacts = e.target.checked; });
      const ag = el.querySelector('#set-aggr');
      ag.addEventListener('input', () => { el.querySelector('#set-aggr-val').textContent = aggressionLabel(+ag.value); });
      ag.addEventListener('change', () => { settingsOf().aiAggression = +ag.value; refreshAll(); });
      syncRangesIn(el);
    } });
  }
  UI.openSettings = openSettings;
  function threatLevel(v) { return v >= 100 ? ['W wojnie', 'war'] : v >= 70 ? ['Bardzo wysoka', 'war'] : v >= 45 ? ['Wysoka', 'high'] : v >= 25 ? ['Umiarkowana', 'mid'] : ['Niska', 'low']; }
  function threatBarHtml(cc) {
    const v = WT.ai && WT.ai.aggressionOf ? WT.ai.aggressionOf(cc, me()) : 0, lv = threatLevel(v);
    return '<div class="threat"><div class="threat-head"><span class="k">Agresywność wobec ciebie</span><span class="threat-lbl ' + lv[1] + '">' + lv[0] + ' · ' + Math.min(100, v) + '</span></div>' +
      '<div class="threat-bar"><i class="' + lv[1] + '" style="width:' + Math.min(100, v) + '%"></i></div></div>';
  }
  function threatDot(cc) {
    const v = WT.ai && WT.ai.aggressionOf ? WT.ai.aggressionOf(cc, me()) : 0, lv = threatLevel(v);
    return v >= 45 && v < 100 ? '<span class="threat-dot ' + lv[1] + '" title="Agresywność: ' + lv[0] + '"></span>' : '';
  }

  // ===========================================================================
  // Nauka: budżet badań, punkty, drzewko technologii
  // ===========================================================================
  function openScience() {
    if (!S.inGame || !G() || !WT.tech) return;
    if (S.modals.some((m) => m.science)) return;
    const close = openModal({ title: icon('flask') + ' Nauka i technologie', wide: true, body: '<div class="sci-wrap" id="sci-wrap"></div>', onOpen: (el) => renderScience(el) });
    S.modals[S.modals.length - 1].science = true;
    return close;
  }
  UI.openScience = openScience;
  function renderScience(el) {
    const cc = me(), c = WT.tech.ensure(liveCountry(cc)), pts = WT.tech.pointsPerTurn(cc), spend = WT.tech.spending(cc);
    const ratePct = Math.round(c.researchRate * 100), uni = WT.tech.universityLevels(cc);
    let h = '<div class="sci-stats">' +
      sciStat('Technologia', fmtNum(c.tech, 2), 'mnożnik siły armii i floty') +
      sciStat('Punkty nauki', fmtInt(Math.floor(c.rp)), isGod() ? 'God Mode: odkrycia za darmo' : '+' + fmtNum(pts.total, 1) + ' na turę') +
      sciStat('Z budżetu', '+' + fmtNum(pts.budget, 1), fmtNum(spend, 2) + ' mld $/tydz.') +
      sciStat('Z uniwersytetów', '+' + fmtNum(pts.universities, 1), uni + ' ' + plural(uni, 'poziom', 'poziomy', 'poziomów') + ' · +2 pkt/poziom') + '</div>';
    h += '<div class="sci-budget"><span>Budżet na badania</span><input type="range" id="sci-rate" min="0" max="' + Math.round(WT.tech.MAX_RATE * 100) + '" value="' + ratePct + '">' +
      '<span class="num" id="sci-rate-val">' + ratePct + '% dochodu</span></div>' +
      '<div class="hint">Więcej punktów: wyższy budżet (malejące zyski) i uniwersytety w prowincjach (panel prowincji → Budynki → Uniwersytet, lub masowo przez zaznaczanie wielu prowincji).</div>';
    h += '<div class="sci-tree">';
    WT.tech.BRANCHES.forEach((b) => {
      h += '<div class="sci-branch"><div class="sci-branch-title">' + esc(b.name) + '</div>';
      WT.tech.TREE.filter((t) => t.branch === b.id).forEach((t) => { h += techCard(cc, c, t); });
      h += '</div>';
    });
    el.querySelector('#sci-wrap').innerHTML = h + '</div>';
    const rate = el.querySelector('#sci-rate');
    rate.addEventListener('input', () => { el.querySelector('#sci-rate-val').textContent = rate.value + '% dochodu'; });
    rate.addEventListener('change', () => { WT.tech.setRate(cc, rate.value / 100); renderScience(el); refreshAll(); });
    el.querySelectorAll('[data-tech]').forEach((btn) => btn.addEventListener('click', () => {
      const res = WT.tech.research(cc, btn.dataset.tech);
      toast(res.reason, res.ok ? 'ok' : 'bad', 2500);
      renderScience(el); refreshAll();
    }));
    syncRangesIn(el);
  }
  function sciStat(label, value, sub) {
    return '<div class="sci-stat"><span class="lbl">' + label + '</span><span class="val num">' + value + '</span><span class="sub">' + esc(sub) + '</span></div>';
  }
  function techCard(cc, c, t) {
    const done = !!c.techs[t.id], chk = done ? null : WT.tech.canResearch(cc, t.id);
    const locked = !done && t.req.some((r) => !c.techs[r]);
    const state = done ? 'done' : chk.ok ? 'ready' : locked ? 'locked' : 'saving';
    const progress = state === 'saving' ? Math.min(100, Math.round(100 * c.rp / t.cost)) : 0;
    return '<div class="tech-card ' + state + '"><div class="tech-head"><b>' + esc(t.name) + '</b>' +
      (done ? '<span class="tag ally">Odkryte</span>' : '<span class="tech-cost num">' + t.cost + ' pkt</span>') + '</div>' +
      '<div class="tech-desc">' + esc(t.desc) + '</div>' +
      (locked ? '<div class="tech-req">Wymaga: ' + esc(t.req.map((r) => WT.tech.get(r).name).join(', ')) + '</div>' : '') +
      (state === 'saving' ? '<div class="progress"><i style="width:' + progress + '%"></i></div>' : '') +
      (state === 'ready' ? '<button class="btn btn-sm btn-primary" data-tech="' + t.id + '">Badaj</button>' : '') + '</div>';
  }

  // ===========================================================================
  // Ranking państw
  // ===========================================================================
  const RANK_COLS = [
    { key: 'area', label: 'Powierzchnia', unit: 'tys. km²', fmt: (v) => fmtInt(v / 1000) },
    { key: 'provinces', label: 'Prowincje', fmt: fmtInt },
    { key: 'pop', label: 'Ludność', unit: 'mln', fmt: (v) => fmtNum(v, 1) },
    { key: 'gdp', label: 'PKB', unit: 'mld $', fmt: (v) => fmtInt(v) },
    { key: 'income', label: 'Dochód', unit: 'mld $/tydz.', fmt: (v) => fmtNum(v, 2) },
    { key: 'treasury', label: 'Skarbiec', unit: 'mld $', fmt: (v) => fmtNum(v, 1) },
    { key: 'army', label: 'Armia', unit: 'tys.', fmt: (v) => fmtInt(v / 1000) },
    { key: 'navy', label: 'Flota', unit: 'esk.', fmt: fmtInt },
    { key: 'planes', label: 'Bombowce', fmt: fmtInt },
    { key: 'power', label: 'Siła militarna', fmt: (v) => fmtInt(v / 1000) },
    { key: 'tech', label: 'Technologia', fmt: (v) => fmtNum(v, 2) },
    { key: 'stability', label: 'Stabilność', unit: '%', fmt: fmtInt }
  ];
  function rankingRows() {
    return aliveCountries().map((cc) => {
      const c = liveCountry(cc) || {}, provs = provincesOf(cc);
      const army = armiesOf(cc).reduce((s, a) => s + a.size, 0);
      const navy = Object.values(G().fleets || {}).filter((f) => f.owner === cc).reduce((s, f) => s + f.ships, 0);
      const planes = WT.air ? WT.air.planesOf(cc) : 0;
      return {
        cc, area: provs.reduce((s, id) => s + (provStatic(id).areaKm2 || 0), 0), provinces: provs.length,
        pop: provs.reduce((s, id) => s + (provStatic(id).pop || 0), 0), gdp: call('economy.countryGdp', [cc], 0) || 0,
        income: (call('economy.income', [cc], { total: 0 }) || { total: 0 }).total, treasury: c.treasury || 0,
        army, navy, planes, tech: c.tech || 0, stability: c.stability || 0,
        // siła militarna: wojsko × technologia + flota i lotnictwo przeliczone na ekwiwalent żołnierzy
        power: (army + navy * 8000 + planes * 3000) * (c.tech || 1)
      };
    });
  }
  function openRanking() {
    if (!S.inGame || !G()) return;
    S.rankSort = S.rankSort || { key: 'gdp', dir: -1 };
    openModal({ title: icon('trophy') + ' Ranking państw', wide: true, body: '<div class="rank-wrap" id="rank-wrap"></div>', onOpen: (el) => renderRanking(el) });
  }
  function renderRanking(el) {
    const { key, dir } = S.rankSort, rows = rankingRows();
    rows.sort((a, b) => (a[key] - b[key]) * dir || countryName(a.cc).localeCompare(countryName(b.cc), 'pl'));
    const place = {}; RANK_COLS.forEach((c) => { rows.slice().sort((a, b) => b[c.key] - a[c.key]).forEach((r, i) => { (place[r.cc] = place[r.cc] || {})[c.key] = i + 1; }); });
    let h = '<table class="rank-table"><thead><tr><th class="rk-n">#</th><th class="rk-name">Państwo</th>';
    RANK_COLS.forEach((c) => {
      h += '<th data-sort="' + c.key + '" class="' + (c.key === key ? 'sorted' : '') + '">' + c.label + (c.unit ? '<small>' + c.unit + '</small>' : '') + (c.key === key ? (dir < 0 ? ' ▾' : ' ▴') : '') + '</th>';
    });
    h += '</tr></thead><tbody>';
    rows.forEach((r, i) => {
      h += '<tr class="' + (r.cc === me() ? 'me' : '') + '" data-cc="' + r.cc + '"><td class="rk-n">' + (i + 1) + '</td><td class="rk-name">' + swatch(r.cc) + esc(countryName(r.cc)) + '</td>';
      RANK_COLS.forEach((c) => { const top = place[r.cc][c.key] <= 3; h += '<td class="num' + (c.key === key ? ' sorted' : '') + (top ? ' top' : '') + '">' + c.fmt(r[c.key]) + '</td>'; });
      h += '</tr>';
    });
    h += '</tbody></table>';
    const wrap = el.querySelector('#rank-wrap'), meRow = rows.findIndex((r) => r.cc === me());
    wrap.innerHTML = '<div class="hint">Twoje miejsce (' + esc(RANK_COLS.find((c) => c.key === key).label) + '): <b>' + (meRow + 1) + ' / ' + rows.length + '</b>. Kliknij nagłówek, aby sortować; wiersz — dyplomacja z państwem.</div>' + h;
    wrap.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
      const k = th.dataset.sort;
      S.rankSort = { key: k, dir: S.rankSort.key === k ? -S.rankSort.dir : -1 };
      renderRanking(el);
    }));
    wrap.querySelectorAll('tr[data-cc]').forEach((tr) => tr.addEventListener('click', () => {
      if (tr.dataset.cc === me()) return;
      closeTopModal(); openDiplomacy(tr.dataset.cc);
    }));
  }
  UI.openRanking = openRanking;

  // ===========================================================================
  // Zaznaczanie wielu prowincji i masowa budowa
  // ===========================================================================
  function startMulti(initial) {
    if (!S.inGame) return;
    deselect();
    closeOrderBar();
    if (isMobile()) { closeDiplomacy(); closeGodPanel(); }
    S.multi = (initial || []).filter((id) => id >= 0 && provDyn(id).owner === me());
    syncMultiView();
    $('province-panel').classList.remove('hidden', 'sheet-collapsed', 'sheet-expanded');
    renderMultiPanel();
    if (isTouch()) toast('Stuknij prowincje, aby je zaznaczyć', '', 2200);
  }
  function exitMulti() {
    S.multi = null;
    syncMultiView();
    if (S.selProv >= 0) renderProvincePanel(); else $('province-panel').classList.add('hidden');
  }
  function syncMultiView() {
    R().view.multi = S.multi ? S.multi.slice() : null;
    const b = $('zc-multi');
    if (b) { b.classList.toggle('active', !!S.multi); b.setAttribute('aria-pressed', S.multi ? 'true' : 'false'); }
    R().requestDraw();
  }
  function toggleMulti(prov) {
    if (prov < 0) return;
    if (provDyn(prov).owner !== me()) { toast('Zaznaczać można tylko własne prowincje', 'bad', 1800); return; }
    if (!S.multi) startMulti([]);   // Shift+klik na armii poza trybem zaznaczania
    const i = S.multi.indexOf(prov);
    if (i >= 0) S.multi.splice(i, 1); else S.multi.push(prov);
    syncMultiView();
    renderMultiPanel();
  }
  function setMulti(ids) { S.multi = ids; syncMultiView(); renderMultiPanel(); }
  /** Szybkie zestawy: wszystkie kontrolowane, nadmorskie, przygraniczne (sąsiad innego państwa). */
  function multiPreset(kind) {
    const mine = provincesOf(me()).filter((id) => provDyn(id).ctrl === me());
    if (kind === 'all') return mine;
    if (kind === 'coast') return mine.filter((id) => provStatic(id).coastal);
    if (kind === 'border') return mine.filter((id) => (provStatic(id).nb || []).some((n) => provDyn(n).owner !== me()));
    return [];
  }
  function renderMultiPanel() {
    if (!S.multi || !G()) return;
    const B = (WT.economy && WT.economy.BUILDINGS) || {}, n = S.multi.length;
    let html = '<div class="panel-head">' + icon('select') + '<h2>Zaznaczone prowincje: ' + n + '</h2><button class="close" data-mact="exit" title="Zakończ zaznaczanie (Esc)" aria-label="Zakończ">' + icon('x') + '</button></div><div class="panel-body">';
    html += '<div class="section"><div class="hint">' + (isTouch() ? 'Stuknij' : 'Kliknij') + ' prowincję, aby ją dodać lub usunąć' + (isTouch() ? '.' : ' (Shift+klik działa też poza tym trybem).') + '</div>' +
      '<div class="row-actions multi-presets"><button class="btn btn-sm" data-mact="all">Wszystkie moje</button><button class="btn btn-sm" data-mact="coast">Nadmorskie</button>' +
      '<button class="btn btn-sm" data-mact="border">Przygraniczne</button><button class="btn btn-sm" data-mact="clear"' + (n ? '' : ' disabled') + '>Wyczyść</button></div></div>';
    html += '<div class="section"><div class="section-title">Buduj na wszystkich</div>';
    Object.keys(B).forEach((type) => { html += multiBuildRow(type, B[type], n); });
    html += '</div></div>';
    const panel = $('province-panel'), scroll = panel.scrollTop;
    panel.innerHTML = html;
    panel.scrollTop = scroll;
    panel.querySelectorAll('[data-mact]').forEach((b) => b.addEventListener('click', () => onMultiAction(b.dataset.mact)));
    panel.querySelectorAll('[data-mbuild]').forEach((b) => b.addEventListener('click', () => doBuildMany(b.dataset.mbuild)));
  }
  function multiBuildRow(type, def, n) {
    const plan = n ? call('economy.bulkPlan', [me(), S.multi, type], null) : null;
    const k = plan ? plan.eligible.length : 0;
    const price = isGod() ? 'darmo' : fmtNum(plan ? plan.cost : 0, 1) + ' mld';
    const skipped = plan ? Object.keys(plan.skipped).map((r) => plan.skipped[r] + '× ' + r).join(' · ') : '';
    return '<div class="build-row"><div title="' + esc(def.desc || '') + '"><span class="build-ico">' + icon(BUILDING_ICONS[type] || 'landmark') + '</span><span class="build-txt"><span class="build-name">' + esc(def.name || type) + '</span>' +
      '<span class="dim multi-count">' + k + ' z ' + n + '</span></span></div>' +
      '<span class="build-lvl">' + price + (def.turns && !isGod() ? ' · ' + def.turns + 't' : '') + '</span>' +
      '<button class="btn btn-sm" data-mbuild="' + type + '"' + (k ? '' : ' disabled') + '>Buduj (' + k + ')</button></div>' +
      (skipped ? '<div class="reason multi-skip">Pominięte: ' + esc(skipped) + '</div>' : '');
  }
  function onMultiAction(act) {
    if (act === 'exit') exitMulti();
    else if (act === 'clear') setMulti([]);
    else setMulti(multiPreset(act));
  }
  function doBuildMany(type) {
    const def = (WT.economy.BUILDINGS || {})[type] || {};
    const res = call('economy.buildMany', [me(), S.multi, type], null);
    if (!res) { toast('Nie można budować', 'bad'); return; }
    if (res.built.length) {
      toast((isGod() ? 'Zbudowano: ' : 'Rozpoczęto budowę: ') + (def.name || type) + ' w ' + res.built.length + ' ' + plural(res.built.length, 'prowincji', 'prowincjach', 'prowincjach') +
        (isGod() ? '' : ' za ' + fmtNum(res.cost, 1) + ' mld $') + (res.noMoney ? ' — zabrakło środków na ' + res.noMoney : ''), res.noMoney ? '' : 'ok', 3200);
    } else toast(res.noMoney ? 'Brak środków na budowę' : 'Żadna z zaznaczonych prowincji nie może tego zbudować', 'bad');
    if (R().getMode() === 'economic') R().invalidate();
    refreshAll();
  }

  // ===========================================================================
  // Obsługa zdarzeń mapy (WT.render.handlers)
  // ===========================================================================
  function canDragUnit(u) {
    if (!S.inGame || !G() || u.owner !== me()) return false;
    return u.type === 'fleet' || u.type === 'army';
  }
  function onUnitClick(u, shift) {
    if (!S.inGame) return;
    const land = !isSeaNode(u.prov);
    if (S.godTool) { if (land) applyGodTool(u.prov); return; }
    if (S.airSel) { if (land) doRaid(u.prov); return; }
    if (S.shellSel) { if (land) doShell(u.prov); return; }
    if (S.multi || shift) { if (land) toggleMulti(u.prov); return; }
    if (u.type === 'army' && u.owner === me() && !(S.sel && S.sel.id === u.id)) {
      const lead = primaryArmyAt(u.prov);
      if (lead && !(G().armies[u.id] && G().armies[u.id].path.length === 0)) u = { type: 'army', id: lead.id, owner: lead.owner, prov: lead.prov };
    }
    if (u.owner === me()) {
      if (S.sel && S.sel.id === u.id) { deselect(); openNode(u.prov); }
      else selectUnit(u);
    } else openNode(u.prov);
  }
  function onMapClick(prov, ev, sea) {
    if (!S.inGame) { if (prov >= 0) selectStartCountry(R().ownerOf(prov), false); return; }
    if (S.godTool) { applyGodTool(prov); return; }
    if (S.airSel) { doRaid(prov); return; }
    if (S.shellSel) { doShell(prov); return; }
    // Shift/Ctrl+klik albo aktywny tryb zaznaczania: dodaj/usuń prowincję z zaznaczenia wielu
    const additive = ev && (ev.shiftKey || ev.ctrlKey || ev.metaKey);
    if (S.multi || (additive && prov >= 0)) {
      if (!S.multi) startMulti(S.selProv >= 0 && S.selProv !== prov && provDyn(S.selProv).owner === me() ? [S.selProv] : []);
      toggleMulti(prov);
      return;
    }
    if (orderBarOpen()) closeOrderBar();
    const wasSel = unitObj(S.sel);
    if (S.sel) deselect();
    // Kliknięcie prowincji z własną armią zaznacza całą (stojącą) armię; ponowne kliknięcie — odznacza.
    const lead = prov >= 0 ? primaryArmyAt(prov) : null;
    if (lead && !(wasSel && wasSel.id === lead.id)) { selectUnit({ type: 'army', id: lead.id, owner: lead.owner, prov: lead.prov }); return; }
    if (prov >= 0) openProvince(prov); else if (sea >= 0) openSea(sea); else closeProvince();
  }
  /** Główna armia gracza w prowincji: stojąca (największa), inaczej największa maszerująca. */
  function primaryArmyAt(prov) {
    const mine = armiesIn(prov).filter((a) => a.owner === me() && !a.embarked);
    if (!mine.length) return null;
    const standing = mine.filter((a) => !(a.path && a.path.length));
    return (standing.length ? standing : mine).reduce((b, a) => (a.size > b.size ? a : b));
  }
  UI.primaryArmyAt = primaryArmyAt;
  /** Cel rozkazu pod kursorem: prowincja albo (dla floty) strefa morska. */
  function orderTarget(prov, sea) { return prov >= 0 ? prov : (S.sel && S.sel.type === 'fleet' && sea >= 0 ? sea : -1); }
  function onRightClick(prov, sx, sy, sea) {
    if (!S.inGame) return;
    if (S.shellSel) { stopShellTarget(); return; }
    const t = orderTarget(prov, sea);
    if (S.sel && t >= 0) openOrderBar(t);
    else if (orderBarOpen()) closeOrderBar();
  }
  function onDragStart(u) { selectUnit(u); }
  // Dotyk: stuknięcie. Gdy własna jednostka jest zaznaczona, stuknięcie innej prowincji (lub obcej armii) = wybór celu.
  function onTap(prov, sx, sy, unit, sea) {
    if (!S.inGame) { onMapClick(prov); return; }
    const at = unit && !isSeaNode(unit.prov) ? unit.prov : prov;   // jednostka na morzu nie wskazuje prowincji
    if (S.godTool) { if (at >= 0) applyGodTool(at); return; }
    if (S.multi) { if (at >= 0) toggleMulti(at); return; }
    if (S.airSel) { doRaid(at); return; }
    if (S.shellSel) { doShell(at); return; }
    const selU = unitObj(S.sel);
    if (unit) {
      if (unit.owner === me() || !selU || selU.owner !== me()) { onUnitClick(unit); return; }
      prov = unit.prov;
    }
    const t = unit ? prov : orderTarget(prov, sea);
    if (selU && selU.owner === me() && t >= 0 && t !== selU.prov) { openOrderBar(t); return; }
    onMapClick(prov, null, sea);
  }
  // Dotyk: przytrzymanie = tooltip z informacjami (zamiast hovera), nad palcem.
  function onLongPress(prov, sx, sy, unit, sea) {
    S.lastHoverKey = '';
    showTooltip(prov, sx, sy, unit, sea);
    const tt = $('tooltip');
    if (tt.classList.contains('hidden')) return;
    const w = tt.offsetWidth, h = tt.offsetHeight, top = $('topbar').getBoundingClientRect().bottom || 0;
    const x = Math.max(8, Math.min(window.innerWidth - w - 8, sx - w / 2));
    let y = sy - h - 30;
    if (y < top + 6) y = Math.min(window.innerHeight - h - 8, sy + 34);
    tt.style.left = x + 'px'; tt.style.top = y + 'px';
  }
  function onDragCancel() { R().view.preview = null; R().requestDraw(); }
  function onDragDrop(u, prov, sea) {
    const t = prov >= 0 ? prov : (u.type === 'fleet' && sea >= 0 ? sea : -1);
    if (t >= 0 && S.sel) openOrderBar(t);
    else R().view.preview = null;
  }
  // Ruch kursora: podgląd rejsu floty także nad strefą morską, potem tooltip
  function onHover(id, sx, sy, unit, sea) {
    if (S.sel && S.sel.type === 'fleet' && !S.godTool && !S.shellSel && id < 0) {
      const t = sea >= 0 ? sea : -1, pv = R().view.preview;
      if ((pv ? pv.target : -1) !== t) updatePreview(t);
    }
    showTooltip(id, sx, sy, unit, sea);
  }
  function onHoverChange(prov) {
    if (S.sel && !S.godTool && !S.shellSel && !S.airSel) updatePreview(prov);
  }
  function bindRenderHandlers() {
    Object.assign(R().handlers, {
      canDragUnit, unitClick: onUnitClick, click: onMapClick, rightClick: onRightClick,
      dragStart: onDragStart, dragDrop: onDragDrop, hoverChange: onHoverChange, hover: onHover,
      tap: onTap, longPress: onLongPress, dragCancel: onDragCancel
    });
  }

  // ===========================================================================
  // Przyciski zoomu na ekranie (+, −, wyśrodkuj na moim państwie)
  // ===========================================================================
  function bindZoomControls() {
    $('zc-in').addEventListener('click', () => R().zoomAnimated(1.6));
    $('zc-out').addEventListener('click', () => R().zoomAnimated(1 / 1.6));
    $('zc-multi').innerHTML = icon('select');
    $('zc-multi').addEventListener('click', () => {
      if (!S.inGame) return;
      if (S.multi) exitMulti(); else startMulti(S.selProv >= 0 && provDyn(S.selProv).owner === me() ? [S.selProv] : []);
    });
    $('zc-home').addEventListener('click', () => {
      if (S.inGame && me()) R().centerOnCountry(me(), 0.8);
      else centerStartView();
    });
  }

  // ===========================================================================
  // Telefon: panele jako bottom sheet — przeciągnięcie uchwytu w dół zamyka/zwija, w górę rozwija,
  // stuknięcie w nagłówek przełącza zwinięty ↔ normalny.
  // ===========================================================================
  function bindSheets() {
    ['province-panel', 'diplo-panel', 'god-panel'].forEach((id) => {
      const el = $(id);
      let st = null;
      el.addEventListener('pointerdown', (e) => {
        if (!isMobile() || (e.pointerType === 'mouse' && e.button !== 0)) return;
        if (!e.target.closest('.panel-head') || e.target.closest('button, input, select, a, label')) return;
        st = { id: e.pointerId, y0: e.clientY, dy: 0, t0: performance.now() };
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignoruj */ }
        el.classList.add('sheet-dragging');
      });
      el.addEventListener('pointermove', (e) => {
        if (!st || e.pointerId !== st.id) return;
        st.dy = e.clientY - st.y0;
        el.style.transform = 'translateY(' + Math.max(-60, st.dy) + 'px)';
      });
      // Gest na uchwycie zmienia układ arkusza — kliknięcie syntetyzowane po nim trafiłoby w przycisk,
      // który właśnie pojawił się pod palcem. Połykamy jedno takie kliknięcie (ok. 500 ms).
      let swallowUntil = 0;
      el.addEventListener('click', (e) => {
        if (performance.now() > swallowUntil) return;
        swallowUntil = 0;
        e.preventDefault(); e.stopPropagation();
      }, true);
      const end = (e) => {
        if (!st || e.pointerId !== st.id) return;
        const dy = st.dy, v = dy / Math.max(1, performance.now() - st.t0);
        st = null;
        swallowUntil = performance.now() + 500;
        el.classList.remove('sheet-dragging');
        el.style.transform = '';
        const collapsed = el.classList.contains('sheet-collapsed'), expanded = el.classList.contains('sheet-expanded');
        if (Math.abs(dy) < 8) { el.classList.toggle('sheet-collapsed', !collapsed); el.classList.remove('sheet-expanded'); return; }
        if (dy > 70 || v > 0.5) {
          if (expanded) el.classList.remove('sheet-expanded');
          else {
            const c = el.querySelector('[data-act=close]');
            swallowUntil = 0;   // to kliknięcie zamyka arkusz celowo — nie połykać
            if (c) c.click();
            swallowUntil = performance.now() + 500;
            el.classList.remove('sheet-collapsed');
          }
        } else if (dy < -40 || v < -0.5) {
          if (collapsed) el.classList.remove('sheet-collapsed'); else el.classList.add('sheet-expanded');
        }
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
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
    if (S.airSel) { stopAirTarget(); return; }
    if (S.shellSel) { stopShellTarget(); return; }
    if (S.multi) { exitMulti(); return; }
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
    if (e.code === 'KeyN') { openScience(); return; }
    if (e.code === 'KeyB') { if (S.multi) exitMulti(); else startMulti(S.selProv >= 0 && provDyn(S.selProv).owner === me() ? [S.selProv] : []); return; }
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
    decorateChrome();
    bindRangeStyling();
    bindRenderHandlers();
    bindStart();
    bindTopbar();
    bindMapModes();
    bindLog();
    bindZoomControls();
    bindSheets();
    bindKeys();
    bindGameEvents();
  };
  UI.fatal = function (msg) { const f = $('fatal'); f.textContent = msg; f.classList.remove('hidden'); };
})();
