var WT = (typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (global.WT = global.WT || {}));

/* WT.tech — nauka: budżet na badania (% dochodu), uniwersytety, punkty nauki i drzewko technologii.
 * Kraj: researchRate (0–0.30 tygodniowego dochodu), rp (zgromadzone punkty), techs { id: true }, techMods { klucz: wartość }.
 * Efekty drzewka są zbierane do techMods przy odkryciu — logika gry czyta je w O(1) przez mod()/add(). */
WT.tech = (function () {
  var U = WT.util, S = WT.state;
  function E() { return WT.economy; }

  var DEFAULT_RATE = 0.05, MAX_RATE = 0.30;
  var RP_PER_SQRT_BN = 10;          // punkty z budżetu = 10 × √(mld na turę) — malejące przychody dla potęg
  var RP_PER_UNIVERSITY = 2;        // punkty na turę za poziom uniwersytetu

  var BRANCHES = [
    { id: 'mil', name: 'Wojsko' }, { id: 'def', name: 'Obrona' }, { id: 'air', name: 'Lotnictwo' },
    { id: 'nav', name: 'Marynarka' }, { id: 'eco', name: 'Gospodarka' }
  ];

  // add: efekt dodawany, mul: efekt mnożony; tech: przyrost poziomu technologii (siła w bitwach)
  var TREE = [
    { id: 'mil1', branch: 'mil', name: 'Nowoczesna piechota', cost: 60, req: [], tech: 0.04, desc: '+0,04 technologii (siła armii i floty)' },
    { id: 'mil2', branch: 'mil', name: 'Logistyka', cost: 110, req: ['mil1'], mul: { attrition: 0.5 }, tech: 0.02, desc: 'wyniszczenie na ziemi wroga −50%, +0,02 technologii' },
    { id: 'mil3', branch: 'mil', name: 'Broń precyzyjna', cost: 200, req: ['mil2'], tech: 0.06, desc: '+0,06 technologii' },
    { id: 'mil4', branch: 'mil', name: 'Pole walki sieciocentryczne', cost: 360, req: ['mil3'], tech: 0.08, desc: '+0,08 technologii' },
    { id: 'def1', branch: 'def', name: 'Umocnienia', cost: 70, req: [], mul: { fort: 1.4 }, desc: 'forty +40% skuteczności (35% obrony na poziom)' },
    { id: 'def2', branch: 'def', name: 'Zintegrowana OPL', cost: 140, req: ['def1'], mul: { aaKill: 1.25 }, add: { aaCap: 0.05 }, desc: 'działka zestrzeliwują o 25% skuteczniej, limit 80%' },
    { id: 'def3', branch: 'def', name: 'Radary dalekiego zasięgu', cost: 150, req: ['def2'], mul: { radarRange: 1.4 }, desc: 'zasięg radarów +40%' },
    { id: 'air1', branch: 'air', name: 'Bombowce strategiczne', cost: 110, req: [], add: { bomberRange: 600 }, desc: 'zasięg bombowców +600 km' },
    { id: 'air2', branch: 'air', name: 'Bomby kierowane', cost: 170, req: ['air1'], mul: { bombDamage: 1.5 }, desc: 'naloty niszczą o 50% więcej' },
    { id: 'air3', branch: 'air', name: 'Technologia stealth', cost: 320, req: ['air2'], mul: { stealth: 0.6 }, desc: 'wroga OPL zestrzeliwuje o 40% mniej twoich bombowców' },
    { id: 'nav1', branch: 'nav', name: 'Nowoczesne okręty', cost: 90, req: [], mul: { fleet: 1.2 }, desc: 'siła floty w bitwach +20%' },
    { id: 'nav2', branch: 'nav', name: 'Okręty desantowe', cost: 130, req: ['nav1'], mul: { shipCapacity: 1.5 }, desc: 'eskadra przewozi 15 tys. żołnierzy zamiast 10 tys.' },
    { id: 'eco1', branch: 'eco', name: 'Automatyzacja', cost: 80, req: [], mul: { factory: 4 / 3 }, desc: 'fabryki dają +20% zamiast +15% dochodu' },
    { id: 'eco2', branch: 'eco', name: 'Cyfrowa administracja', cost: 140, req: ['eco1'], mul: { admin: 0.8 }, desc: 'koszty administracji −20%' },
    { id: 'eco3', branch: 'eco', name: 'Gospodarka wiedzy', cost: 190, req: ['eco2'], mul: { research: 1.25 }, desc: 'punkty nauki +25%' },
    { id: 'eco4', branch: 'eco', name: 'Nowoczesna medycyna', cost: 120, req: ['eco1'], mul: { manpower: 1.3 }, desc: 'odnawianie rezerw +30%' }
  ];
  var BY_ID = {};
  TREE.forEach(function (t) { BY_ID[t.id] = t; });

  function G() { return WT.G; }
  function isGodFor(cc) { return !!(WT.god && WT.god.enabled() && cc === G().player); }

  /** Uzupełnia pola nauki (nowa gra i stare zapisy). */
  function ensure(c) {
    if (c.researchRate == null) c.researchRate = DEFAULT_RATE;
    if (c.rp == null) c.rp = 0;
    if (!c.techs) c.techs = {};
    if (!c.techMods) rebuildMods(c);
    return c;
  }
  function ensureAll() { Object.keys(G().countries).forEach(function (cc) { ensure(G().countries[cc]); }); }

  function rebuildMods(c) {
    var mods = {};
    Object.keys(c.techs || {}).forEach(function (id) {
      var t = BY_ID[id]; if (!t) return;
      Object.keys(t.mul || {}).forEach(function (k) { mods[k] = (mods[k] != null ? mods[k] : 1) * t.mul[k]; });
      Object.keys(t.add || {}).forEach(function (k) { mods[k] = (mods[k] || 0) + t.add[k]; });
    });
    c.techMods = mods;
  }

  /** Mnożnik efektu (1, gdy brak), np. mod(cc, 'fort'). */
  function mod(cc, key) {
    var c = G() && G().countries[cc];
    var v = c && c.techMods ? c.techMods[key] : null;
    return v != null ? v : 1;
  }
  /** Efekt dodawany (0, gdy brak), np. add(cc, 'bomberRange'). */
  function add(cc, key) {
    var c = G() && G().countries[cc];
    return c && c.techMods && c.techMods[key] ? c.techMods[key] : 0;
  }
  function has(cc, id) { var c = G().countries[cc]; return !!(c && c.techs && c.techs[id]); }

  // ---------- Budżet i punkty ----------

  function setRate(cc, rate) { ensure(S.country(cc)).researchRate = U.round(U.clamp(+rate || 0, 0, MAX_RATE), 3); }

  /** Wydatek na badania (mld/tydz.) — część dodatniego dochodu. W God Mode gracza nic nie kosztuje (jak reszta wydatków). */
  function spending(cc) {
    var c = ensure(S.country(cc));
    return Math.max(0, E().income(cc).total) * c.researchRate;
  }

  function universityLevels(cc) {
    return S.provincesOf(cc).reduce(function (s, id) {
      var p = G().provinces[id];
      return s + (p.ctrl === cc ? (p.buildings.university || 0) : 0);
    }, 0);
  }

  function pointsPerTurn(cc) {
    var budget = RP_PER_SQRT_BN * Math.sqrt(spending(cc)), uni = RP_PER_UNIVERSITY * universityLevels(cc);
    var k = mod(cc, 'research');
    return { budget: U.round(budget * k, 2), universities: U.round(uni * k, 2), total: U.round((budget + uni) * k, 2) };
  }

  // ---------- Odkrycia ----------

  function canResearch(cc, id) {
    var t = BY_ID[id], c = ensure(S.country(cc));
    if (!t) return { ok: false, reason: 'Nieznana technologia.' };
    if (c.techs[id]) return { ok: false, reason: 'Już odkryte.' };
    var missing = t.req.filter(function (r) { return !c.techs[r]; });
    if (missing.length) return { ok: false, reason: 'Wymaga: ' + missing.map(function (r) { return BY_ID[r].name; }).join(', ') + '.' };
    if (!isGodFor(cc) && c.rp < t.cost) return { ok: false, reason: 'Potrzeba ' + t.cost + ' pkt nauki (masz ' + Math.floor(c.rp) + ').' };
    return { ok: true, reason: t.name + ' za ' + t.cost + ' pkt.' };
  }

  function research(cc, id) {
    var chk = canResearch(cc, id);
    if (!chk.ok) return chk;
    var t = BY_ID[id], c = S.country(cc);
    if (!isGodFor(cc)) c.rp = U.round(c.rp - t.cost, 2);
    c.techs[id] = true;
    if (t.tech) c.tech = U.round(c.tech + t.tech, 3);
    rebuildMods(c);
    if (cc === G().player) S.addLog('Odkryto technologię: ' + t.name + ' (' + t.desc + ').', cc);
    WT.events.emit('tech', { cc: cc, id: id });
    return { ok: true, reason: 'Odkryto: ' + t.name + '.' };
  }

  /** Tura: punkty nauki dla wszystkich państw (wydatek na badania jest w economy.expenses). */
  function processTurn() {
    S.countriesAlive().forEach(function (cc) {
      var c = ensure(S.country(cc));
      c.rp = U.round(c.rp + pointsPerTurn(cc).total, 2);
    });
  }

  /** Kolejna technologia dla AI: najtańsza dostępna, w wojnie preferowane wojsko/obrona. */
  function nextFor(cc, atWar) {
    var c = ensure(S.country(cc)), best = null, bestScore = Infinity;
    TREE.forEach(function (t) {
      if (c.techs[t.id] || t.req.some(function (r) { return !c.techs[r]; })) return;
      var score = t.cost * (atWar && (t.branch === 'mil' || t.branch === 'def') ? 0.6 : 1);
      if (score < bestScore) { bestScore = score; best = t; }
    });
    return best;
  }

  return {
    TREE: TREE, BRANCHES: BRANCHES, MAX_RATE: MAX_RATE, DEFAULT_RATE: DEFAULT_RATE,
    ensure: ensure, ensureAll: ensureAll, mod: mod, add: add, has: has, get: function (id) { return BY_ID[id]; },
    setRate: setRate, spending: spending, pointsPerTurn: pointsPerTurn, universityLevels: universityLevels,
    canResearch: canResearch, research: research, processTurn: processTurn, nextFor: nextFor
  };
})();

if (typeof module !== 'undefined') module.exports = WT.tech;
