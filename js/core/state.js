var WT = (typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (global.WT = global.WT || {}));

/* WT.state — tworzenie nowej gry, indeksy (nieserializowane), gettery, rejestr armii/flot, dziennik. */
WT.state = (function () {
  var U = WT.util;
  var START_DATE = '2026-01-05';
  var MONTHS = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca',
    'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
  var DEFAULT_TECH = 0.6;
  var VOID = 'XXX';                  // pseudo-państwo „poza grą” (wyłączone kontynenty): martwe, nieprzechodnie
  var SEA_BASE = 100000;             // węzły stref morskich: SEA_BASE + numer strefy (numery prowincji się nie zmieniają)
  var CONTINENTS = ['EU', 'AS', 'AF'];

  // Indeksy przebudowywane z G (nie trafiają do zapisu).
  var idx = { map: null, landAdj: [], seaAdj: [], zoneAdj: [], byOwner: {}, byCtrl: {}, armiesAt: {}, fleetsAt: {} };

  function G() { return WT.G; }
  function M() { return U.mapData(); }

  // =====================================================================
  // Nowa gra
  // =====================================================================

  /** Scenariusz z data/scenarios.js (1385, 1914, 1939) albo null dla 2026. */
  function scenarioData(id) {
    var all = U.root().SCENARIOS || {};
    return id && id !== '2026' && all[id] ? all[id] : null;
  }

  function newGame(opts) {
    opts = opts || {};
    var seed = (opts.seed != null ? opts.seed : Math.floor(Math.random() * 1e9)) >>> 0;
    var g = createEmptyState(opts, seed);
    var sc = scenarioData(opts.scenario);
    if (sc) { g.scenario = sc.id; g.date = sc.date; g.era = sc.era; g.popScale = sc.popScale; }
    WT.G = g;
    buildStaticGraphs();
    createProvinces(g);
    createCountries(g);
    if (WT.tech) WT.tech.ensureAll();
    rebuildIndex();
    assignCapitals(g);
    distributeGdp(g);
    createInitialRelations(g);
    placeStartingForts(g);
    if (opts.startWars) applyStartConflicts(g);
    placeStartingArmies(g);
    placeStartingFleets(g);
    // państwo nieistniejące w tej epoce: gra zaczyna się powstaniem na jego ziemiach rdzennych
    if (opts.player && !(g.countries[opts.player] && g.countries[opts.player].alive)) startUprising(g, opts.player);
    if (!g.countries[g.player] || !g.countries[g.player].alive) g.player = countriesAlive()[0];
    addLog('Rozpoczęto grę jako ' + g.countries[g.player].name + '. ' + dateStr() + '.', g.player);
    return g;
  }

  // ---------- Państwa nieistniejące: ziemie rdzenne, odtworzenie (wasal), powstanie gracza ----------

  /** Dane państwa: ze scenariusza, gdy w nim występuje, inaczej z danych 2026. */
  function nationData(cc) {
    var sc = scenarioData(G().scenario);
    return (sc && sc.countries[cc]) || U.countryData()[cc] || null;
  }
  function nationName(cc) {
    var c = G().countries[cc], d = nationData(cc);
    return (c && c.name) || (d && d.name) || cc;
  }
  /** Ziemie rdzenne: granice państwa w scenariuszu (jeśli tam istnieje), inaczej granice z 2026; bez lądu poza grą. */
  function coresOf(cc) {
    var sc = scenarioData(G().scenario), useSc = sc && sc.countries[cc], out = [];
    M().provinces.forEach(function (p, i) {
      var o = useSc ? sc.owners[i] : p.cc;
      if (o === cc && G().provinces[i] && G().provinces[i].owner !== VOID) out.push(i);
    });
    return out;
  }
  /** Państwa, których teraz nie ma (upadłe albo nieistniejące w epoce), a mają ziemie rdzenne na mapie. */
  function nationCandidates() {
    var g = G(), seen = {}, out = [];
    var sc = scenarioData(g.scenario);
    Object.keys(g.countries).concat(Object.keys(U.countryData()), sc ? Object.keys(sc.countries) : []).forEach(function (cc) {
      if (seen[cc] || cc === VOID) return;
      seen[cc] = 1;
      var c = g.countries[cc];
      if (c && (c.alive || c.void)) return;
      if (!c && sameNationExists(cc)) return;
      if (coresOf(cc).length) out.push(cc);
    });
    return out;
  }
  /** Państwo z 2026 istnieje w scenariuszu pod innym kodem (np. Niemcy = Cesarstwo Niemieckie): jego stolica to stolica tamtego. */
  function sameNationExists(cc) {
    var d = U.countryData()[cc], g = G();
    if (d && Object.keys(g.countries).some(function (k) { return g.countries[k].alive && g.countries[k].name === d.name; })) return true;
    if (!d || !d.capitalLonLat) return false;
    var xy = U.project(d.capitalLonLat[0], d.capitalLonLat[1]), id = U.provinceAt(xy[0], xy[1]);
    if (id < 0) return false;
    var o = G().countries[G().provinces[id].owner];
    return !!(o && o.alive && o.capital === id);
  }
  /**
   * Tworzy (odtwarza) państwo `cc` na prowincjach `provs`. opts: { treasury, army, tech }.
   * Relacje liczone od nowa (stare relacje upadłego państwa są usuwane).
   */
  function spawnCountry(cc, provs, opts) {
    opts = opts || {};
    var g = G(), old = g.countries[cc], d = nationData(cc);
    var pop = provs.reduce(function (s, id) { return s + provPop(id); }, 0);
    var c = makeCountry(cc, d, pop);
    if (old) { c.name = old.name; c.color = old.color; }
    if (opts.tech != null) c.tech = Math.max(c.tech, opts.tech);
    Object.keys(g.rel).forEach(function (k) { var x = k.split('|'); if (x[0] === cc || x[1] === cc) delete g.rel[k]; });
    g.countries[cc] = c;
    if (WT.tech) WT.tech.ensureAll();
    provs.forEach(function (id) { setOwner(id, cc); });
    c.startGdp = provs.reduce(function (s, id) { return s + (g.provinces[id].gdp || 0); }, 0);
    c.treasury = U.round(opts.treasury != null ? opts.treasury : c.startGdp * 0.03, 2);
    c.capital = findCapital(c);
    if (c.capital < 0) c.capital = provs[0];
    createInitialRelations(g, [cc]);
    if (opts.army >= 1000) createArmy(cc, c.capital, opts.army);
    if (WT.diplomacy) WT.diplomacy.reindex();
    return c;
  }
  /** Prowincja startowa powstania: rdzenna z historyczną stolicą, inaczej najludniejsza. */
  function uprisingStart(cc, cores) {
    var d = nationData(cc), inCores = function (i) { return cores.indexOf(i) >= 0; };
    if (d && d.capitalLonLat) {
      var xy = U.project(d.capitalLonLat[0], d.capitalLonLat[1]);
      var id = U.provinceAt(xy[0], xy[1], inCores);
      if (id < 0) id = U.nearestProvince(xy[0], xy[1], inCores);
      if (id >= 0) return id;
    }
    return cores.reduce(function (b, i) { return provPop(i) > provPop(b) ? i : b; }, cores[0]);
  }
  /** Podgląd powstania dla ekranu startowego: ziemie rdzenne, prowincja startowa, okupanci (cc → liczba prowincji), armia. */
  function uprisingPreview(cc) {
    var cores = coresOf(cc);
    if (!cores.length) return null;
    var start = uprisingStart(cc, cores), occ = {};
    cores.forEach(function (i) { var o = G().provinces[i].owner; occ[o] = (occ[o] || 0) + 1; });
    return { cores: cores, start: start, occupier: G().provinces[start].owner, occupiers: occ,
      army: Math.round(U.clamp(provPop(start) * 12000, 25000, 80000)) };
  }
  /**
   * Powstanie: gracz zaczyna w jednej prowincji rdzennej (stolica historyczna) z armią ochotników,
   * w wojnie z okupantem tej prowincji. Cel: odzyskać wszystkie ziemie rdzenne (g.goal).
   */
  function startUprising(g, cc) {
    var cores = coresOf(cc);
    if (!cores.length) return false;
    var start = uprisingStart(cc, cores), occupier = g.provinces[start].owner;
    var army = uprisingPreview(cc).army;
    var occ = g.countries[occupier];
    var c = spawnCountry(cc, [start], { army: army, tech: occ ? occ.tech * 0.95 : null });
    c.treasury = U.round(Math.max(c.treasury, (occ ? occ.startGdp : 100) * 0.01), 2);   // fundusz powstańczy (diaspora, sponsorzy)
    c.manpower = Math.max(c.manpower, Math.round(cores.reduce(function (s, i) { return s + provPop(i); }, 0) * 8));
    c.stability = 80;
    // garnizon okupanta wycofuje się z prowincji powstania
    (idx.armiesAt[start] || []).slice().forEach(function (id) {
      var a = g.armies[id];
      if (!a || a.owner === cc) return;
      var home = WT.military ? WT.military.nearestOwnProvince(a.owner, start) : -1;
      if (home < 0) removeArmy(id); else moveArmy(a, home);
    });
    // dezercja: część żołnierzy okupanta stacjonujących na ziemiach rdzennych przechodzi do powstańców
    var defect = 0, cap = army * 2;
    cores.forEach(function (i) {
      (idx.armiesAt[i] || []).slice().forEach(function (id) {
        var a = g.armies[id];
        if (!a || a.owner !== occupier || defect >= cap) return;
        var n = Math.min(Math.round(a.size * 0.25), cap - defect);
        a.size -= n; defect += n;
        if (a.size < 1000) removeArmy(id);
      });
    });
    if (defect >= 1000) createArmy(cc, start, defect);
    if (occ && occ.alive && WT.diplomacy) {
      WT.diplomacy.startWar([cc], [occupier], true);
      WT.diplomacy.setRel(cc, occupier, -90);
      // rywale okupanta sympatyzują z powstaniem (pomoc finansowa AI dla przegrywających przyjaciół)
      (occ.rivals || []).forEach(function (r) { if (g.countries[r] && g.countries[r].alive && r !== cc) WT.diplomacy.setRel(cc, r, 55); });
    }
    if (WT.military) WT.military.merge(start, cc);
    g.goal = { type: 'independence', cc: cc, cores: cores, done: false, start: start };
    addLog(c.name + ' powstaje! Powstańcy opanowali ' + M().provinces[start].name + (defect >= 1000 ? ' (zdezerterowało ' + Math.round(defect / 1000) + ' tys. żołnierzy okupanta)' : '') + '. Cel: odzyskać ' + cores.length + ' ' +
      (cores.length === 1 ? 'prowincję' : 'prowincji') + ' ziem rdzennych.', cc);
    return true;
  }
  /** Postęp celu gracza: niepodległość (ziemie rdzenne), potem podbój świata (udział prowincji gracza i jego wasali). */
  function goalProgress() {
    var g = G(), gl = g.goal, mine = function (i) { var o = g.provinces[i].owner; return o === g.player || (WT.vassal && WT.vassal.overlordOf(o) === g.player); };
    var res = { goal: gl || null };
    if (gl) res.cores = { have: gl.cores.filter(function (i) { return g.provinces[i].owner === gl.cc; }).length, total: gl.cores.length };
    var total = 0, have = 0;
    g.provinces.forEach(function (p, i) { if (p.owner === VOID) return; total++; if (mine(i)) have++; });
    res.world = { have: have, total: total };
    return res;
  }
  /** Sprawdzenie celu (koniec tury): komplet ziem rdzennych = niepodległość odzyskana. */
  function checkGoal() {
    var g = G(), gl = g.goal;
    if (!gl || gl.done || gl.cc !== g.player || !g.countries[gl.cc] || !g.countries[gl.cc].alive) return;
    var pr = goalProgress();
    if (pr.cores.have < pr.cores.total) return;
    gl.done = true; gl.doneTurn = g.turn;
    addLog(g.countries[gl.cc].name + ' odzyskuje niepodległość: wszystkie ziemie rdzenne wolne! Teraz — podbój świata.', gl.cc);
    if (WT.events) WT.events.emit('goal', { type: 'independence', cc: gl.cc });
  }

  function createEmptyState(opts, seed) {
    return {
      version: 1, turn: 0, date: START_DATE,
      player: opts.player, god: !!opts.god,
      seed: seed, rngState: seed,
      countries: {}, provinces: [], armies: {}, fleets: {}, squadrons: {}, trades: [],
      nextId: 100, rel: {}, wars: [], alliances: [], pacts: [], truces: [],
      proposals: [], log: [], gameOver: false,
      settings: makeSettings(opts),
      scenario: '2026', era: null, popScale: null,
      continents: activeContinents(opts.continents)
    };
  }

  /** Ustawienia rozgrywki: auto-odrzucanie paktów i agresywność AI (0–100, 50 = standard). */
  function makeSettings(opts) {
    var a = opts && opts.aiAggression != null ? +opts.aiAggression : 50;
    return { autoRejectPacts: !!(opts && opts.autoRejectPacts), aiAggression: U.clamp(isNaN(a) ? 50 : a, 0, 100) };
  }
  function settings() {
    var g = G();
    if (!g.settings) g.settings = makeSettings({});
    return g.settings;
  }

  function activeContinents(list) {
    var on = (list || CONTINENTS).filter(function (c) { return CONTINENTS.indexOf(c) >= 0; });
    return on.length ? on : CONTINENTS.slice();
  }

  /** Właściciel startowy: scenariusz albo dzisiejsze państwo; wyłączony kontynent -> VOID. */
  function startOwner(g, i) {
    var p = M().provinces[i];
    if (p.ct && (g.continents || CONTINENTS).indexOf(p.ct) < 0) return VOID;
    var sc = scenarioData(g.scenario);
    return sc ? sc.owners[i] : p.cc;
  }

  function createProvinces(g) {
    var provs = M().provinces;
    for (var i = g.provinces.length; i < provs.length; i++) {
      var own = startOwner(g, i);
      g.provinces.push({
        owner: own, ctrl: own,
        buildings: { factory: 0, fort: 0, port: 0, barracks: 0, aa: 0, radar: 0, university: 0 },
        builds: {}, unrest: 0, dev: 1.0, gdp: 0, siege: null
      });
    }
  }

  /** Ludność prowincji w mln — w scenariuszach historycznych przeskalowana do epoki (wg kontynentu). */
  function provPop(id) {
    var p = M().provinces[id], k = G() && G().popScale ? (G().popScale[p.ct] || 0.2) : 1;
    return (p.pop || 0) * k;
  }

  function collectCountryPops() {
    var pops = {};
    G().provinces.forEach(function (p, i) { pops[p.owner] = (pops[p.owner] || 0) + provPop(i); });
    return pops;
  }

  /** Dane państw: scenariusz historyczny albo COUNTRY_DATA (2026). */
  function countryDataFor(g) {
    var sc = scenarioData(g.scenario);
    return sc ? sc.countries : U.countryData();
  }

  /** „Poza grą”: martwe pseudo-państwo bez armii, nieprzechodnie (brak wojny i sojuszu z kimkolwiek). */
  function makeVoidCountry() {
    var c = makeCountry(VOID, { name: 'Poza grą', color: '#2b3442', gdp: 0, army: 0, navy: 0, friends: [], rivals: [] }, 0);
    c.alive = false; c.void = true; c.baseArmy = 0;
    return c;
  }

  /** Czy funkcja jest dostępna w epoce scenariusza (air, radar, aa, gunships); 2026 — wszystko. */
  function era(feature) {
    var e = G() && G().era;
    return !e || e[feature] !== false;
  }

  /**
   * Rozszerzenie zapisanej gry o prowincje dopisane później na końcu mapy (np. Afryka):
   * nowe prowincje i państwa startują jak w nowej grze, stan istniejących zostaje bez zmian.
   * Zwraca listę dodanych państw.
   */
  function extendWorld(g) {
    if (g.provinces.length >= M().provinces.length) return [];
    createProvinces(g);
    var pops = collectCountryPops(), data = countryDataFor(g);
    var added = Object.keys(pops).filter(function (cc) { return !g.countries[cc]; }).sort();
    added.forEach(function (cc) { g.countries[cc] = cc === VOID ? makeVoidCountry() : makeCountry(cc, data[cc], pops[cc]); });
    added = added.filter(function (cc) { return cc !== VOID; });
    if (WT.tech) WT.tech.ensureAll();
    buildStaticGraphs();
    rebuildIndex();
    assignCapitals(g, added);
    distributeGdp(g, added);
    createInitialRelations(g, added);
    placeStartingForts(g, added);
    placeStartingArmies(g, added);
    placeStartingFleets(g, added);
    if (added.length) addLog('Świat rozszerzony: ' + added.length + ' nowych państw (Afryka).', g.player);
    return added;
  }

  function createCountries(g) {
    var pops = collectCountryPops(), data = countryDataFor(g);
    Object.keys(pops).sort().forEach(function (cc) {
      g.countries[cc] = cc === VOID ? makeVoidCountry() : makeCountry(cc, data[cc], pops[cc]);
    });
  }

  function defaultCountryData(cc, pop) {
    return { name: cc, color: U.hashColor(cc), gdp: Math.max(1, pop * 5), pop: pop,
      army: Math.max(2, pop * 2), navy: 0, tech: DEFAULT_TECH, ideology: 'autorytaryzm',
      gov: 'nieznany', friends: [], rivals: [] };
  }

  function makeCountry(cc, d, mapPop) {
    var def = defaultCountryData(cc, mapPop);
    d = d || def;
    var pop = mapPop || d.pop || 1;
    var gdp = d.gdp != null ? d.gdp : def.gdp;
    var army = d.army != null ? d.army : def.army;
    return {
      cc: cc, name: d.name || cc, color: d.color || def.color, alive: true,
      capital: -1, treasury: U.round(gdp * 0.03, 2), taxRate: 0.15, stability: 70,
      manpower: Math.round(pop * 15),
      tech: d.tech != null ? d.tech : DEFAULT_TECH,
      ideology: d.ideology || def.ideology, gov: d.gov || def.gov,
      warExhaustion: 0, lastIncome: 0, lastExpense: 0,
      startGdp: gdp, pop: pop, baseArmy: Math.round(army * 1000), navy: d.navy || 0,
      friends: d.friends || [], rivals: d.rivals || [],
      capitalLonLat: d.capitalLonLat || null, capitalName: d.capital || null,
      losses: 0, ai: { lastWar: -99, lastProposal: -99, lastAlliance: -99, lastOffer: -99, lastGift: -99 }
    };
  }

  function allCc(g, ccs) { return ccs || Object.keys(g.countries); }

  function assignCapitals(g, ccs) {
    allCc(g, ccs).forEach(function (cc) { if (cc !== VOID) g.countries[cc].capital = findCapital(g.countries[cc]); });
  }

  function findCapital(c) {
    var own = idx.byOwner[c.cc] || [];
    if (!own.length) return -1;
    var ownsIt = function (i) { return G().provinces[i].owner === c.cc; };
    if (c.capitalLonLat) {
      var xy = U.project(c.capitalLonLat[0], c.capitalLonLat[1]);
      var id = U.provinceAt(xy[0], xy[1], ownsIt);
      if (id >= 0) return id;
      return U.nearestProvince(xy[0], xy[1], ownsIt);
    }
    if (c.capitalName) {
      var low = c.capitalName.toLowerCase();
      for (var i = 0; i < own.length; i++) if (M().provinces[own[i]].name.toLowerCase().indexOf(low) >= 0) return own[i];
    }
    return largestProvince(own);
  }

  function largestProvince(ids) {
    var best = ids[0];
    for (var i = 1; i < ids.length; i++) if ((M().provinces[ids[i]].pop || 0) > (M().provinces[best].pop || 0)) best = ids[i];
    return best;
  }

  // PKB kraju rozkładany na prowincje wg populacji (stolica z premią 1.5×).
  function distributeGdp(g, ccs) {
    allCc(g, ccs).forEach(function (cc) {
      if (cc === VOID) return;
      var c = g.countries[cc], own = idx.byOwner[cc] || [];
      var weights = own.map(function (id) {
        var w = (M().provinces[id].pop || 0) + 0.01;
        return id === c.capital ? w * 1.5 : w;
      });
      var sum = weights.reduce(function (a, b) { return a + b; }, 0);
      own.forEach(function (id, i) { g.provinces[id].gdp = c.startGdp * weights[i] / sum; });
      if (c.capital >= 0) g.provinces[c.capital].dev = 1.2;
    });
  }

  function createInitialRelations(g, ccs) {
    allCc(g, ccs).forEach(function (cc) {
      var c = g.countries[cc];
      c.friends.forEach(function (o) { if (g.countries[o]) mergeRelation(g, cc, o, U.randInt(40, 70)); });
      c.rivals.forEach(function (o) { if (g.countries[o]) mergeRelation(g, cc, o, -U.randInt(40, 80)); });
    });
    allCc(g, ccs).forEach(function (cc) {
      countryNeighbors(cc).forEach(function (o) {
        var k = U.key(cc, o);
        if (g.rel[k] == null) g.rel[k] = U.randInt(-10, 15) + (g.countries[cc].ideology === g.countries[o].ideology ? 10 : 0);
      });
    });
  }

  function mergeRelation(g, a, b, v) {
    var k = U.key(a, b);
    g.rel[k] = g.rel[k] == null ? v : Math.round((g.rel[k] + v) / 2);
  }

  // ---------- Armie startowe: 50% w stolicy, reszta na granicach z rywalami / w największych prowincjach ----------

  function placeStartingArmies(g, ccs) {
    allCc(g, ccs).forEach(function (cc) {
      var c = g.countries[cc];
      if (c.capital < 0 || c.baseArmy < 1000) return;
      var chunks = splitStartingArmy(c);
      chunks.forEach(function (ch) { createArmy(cc, ch.prov, ch.size); });
    });
  }

  function splitStartingArmy(c) {
    var total = c.baseArmy, sites = startingArmySites(c);
    var minChunk = 5000;
    var rest = Math.round(total * 0.5);
    var per = sites.length ? Math.floor(rest / sites.length) : 0;
    if (per < minChunk) { sites = []; per = 0; }
    var chunks = sites.map(function (p) { return { prov: p, size: per }; });
    chunks.unshift({ prov: c.capital, size: total - per * sites.length });
    return chunks;
  }

  /** Prowincje kontrolowane (także okupowane) przy granicy z rywalami/wrogami; inaczej największe. */
  function startingArmySites(c) {
    var own = (idx.byCtrl[c.cc] || []).filter(function (id) { return id !== c.capital; });
    var rivals = {};
    c.rivals.forEach(function (r) { rivals[r] = true; });
    var isRivalProv = function (n) {
      var p = G().provinces[n];
      return rivals[p.owner] || rivals[p.ctrl] || (p.ctrl !== c.cc && WT.diplomacy.atWar(c.cc, p.ctrl));
    };
    var border = own.filter(function (id) { return idx.landAdj[id].some(isRivalProv); });
    var byPop = function (a, b) { return (M().provinces[b].pop || 0) - (M().provinces[a].pop || 0); };
    var sites = border.length ? border.sort(byPop) : own.slice().sort(byPop);
    return sites.slice(0, WT.diplomacy.enemiesOf(c.cc).length ? 8 : 4);
  }

  // ---------- Forty startowe: stolice (poz. 1); linia frontu wojen startowych — umocnienia ----------

  function placeStartingForts(g, ccs) {
    allCc(g, ccs).forEach(function (cc) {
      var cap = g.countries[cc].capital;
      if (cap >= 0) g.provinces[cap].buildings.fort = 1;
    });
  }

  function fortifyFrontLines(g) {
    g.provinces.forEach(function (p, id) {
      if (p.ctrl !== p.owner) return;
      var front = idx.landAdj[id].some(function (n) { return WT.diplomacy.atWar(p.ctrl, g.provinces[n].ctrl); });
      if (front) p.buildings.fort = Math.max(p.buildings.fort, 3);
    });
    // stolice państw w trwających wojnach są umocnione (obrona Kijowa itp.)
    Object.keys(g.countries).forEach(function (cc) {
      var cap = g.countries[cc].capital;
      if (cap >= 0 && WT.diplomacy.enemiesOf(cc).length) g.provinces[cap].buildings.fort = Math.max(g.provinces[cap].buildings.fort, 4);
    });
  }

  // ---------- Floty startowe wg `navy` (duże marynarki dzielone na 2 bazy) ----------

  function placeStartingFleets(g, ccs) {
    allCc(g, ccs).forEach(function (cc) {
      var c = g.countries[cc];
      if (c.navy <= 0) return;
      var coastal = (idx.byOwner[cc] || []).filter(function (id) { return M().provinces[id].coastal && idx.seaAdj[id].length; });
      if (!coastal.length) return;
      var bases = fleetBases(c, coastal);
      var first = bases.length > 1 ? Math.ceil(c.navy * 0.6) : c.navy;
      createFleetAt(cc, bases[0], first);
      if (bases.length > 1) createFleetAt(cc, bases[1], c.navy - first);
    });
  }

  function fleetBases(c, coastal) {
    var main = coastal.indexOf(c.capital) >= 0 ? c.capital : largestProvince(coastal);
    if (c.navy < 10 || coastal.length < 2) return [main];
    var far = coastal.reduce(function (best, id) { return dist(main, id) > dist(main, best) ? id : best; }, main);
    return dist(main, far) > 800 ? [main, far] : [main];
  }

  function createFleetAt(cc, provId, ships) {
    G().provinces[provId].buildings.port = Math.max(1, G().provinces[provId].buildings.port);
    return createFleet(cc, provId, ships);
  }

  // ---------- Konflikty startowe 2026 ----------

  function applyStartConflicts(g) {
    var root = U.root(), sc = scenarioData(g.scenario);
    var alive = function (cc) { return g.countries[cc] && g.countries[cc].alive; };
    ((sc ? sc.wars : root.START_WARS) || []).forEach(function (w) {
      if (alive(w[0]) && alive(w[1])) WT.diplomacy.startWar([w[0]], [w[1]], true);
    });
    if (sc) (sc.occupations || []).forEach(function (o) {
      if (!alive(o.by) || !alive(o.cc)) return;
      o.provinces.forEach(function (id) { if (g.provinces[id].owner === o.cc && id !== g.countries[o.cc].capital) setCtrl(id, o.by); });
    });
    else (root.START_OCCUPATIONS || []).forEach(applyStartOccupation);
    fortifyFrontLines(g);
  }

  function applyStartOccupation(occ) {
    var cs = G().countries;
    if (!cs[occ.by] || !cs[occ.cc] || !cs[occ.by].alive || !cs[occ.cc].alive) return;
    occ.lonlat.forEach(function (ll) {
      // punkt już w granicach okupanta (np. Krym w danych NE) — nie szukaj zastępczej prowincji
      var here = U.provinceAtLonLat(ll[0], ll[1]);
      if (here >= 0 && G().provinces[here].owner === occ.by) return;
      var id = U.provinceAtLonLat(ll[0], ll[1], function (i) { return G().provinces[i].owner === occ.cc; });
      if (id >= 0 && id !== G().countries[occ.cc].capital) setCtrl(id, occ.by);
    });
  }

  // =====================================================================
  // Indeksy
  // =====================================================================

  function buildStaticGraphs() {
    var map = M();
    if (idx.map === map) return;
    idx.map = map;
    var n = map.provinces.length, land = [], sea = [], i;
    for (i = 0; i < n; i++) { land.push((map.provinces[i].nb || []).slice()); sea.push([]); }
    (map.straits || []).forEach(function (s) {
      if (land[s[0]].indexOf(s[1]) < 0) land[s[0]].push(s[1]);
      if (land[s[1]].indexOf(s[0]) < 0) land[s[1]].push(s[0]);
    });
    (map.seaLinks || []).forEach(function (l) {
      var d = l[2] != null ? l[2] : distStatic(l[0], l[1]);
      sea[l[0]].push({ to: l[1], d: d });
      sea[l[1]].push({ to: l[0], d: d });
    });
    idx.landAdj = land; idx.seaAdj = sea;
    idx.zoneAdj = buildZoneGraph(map, sea);
  }

  /** Strefy morskie: krawędzie strefa–strefa i strefa–prowincja nadmorska (w obie strony), w km. */
  function buildZoneGraph(map, sea) {
    var zones = map.seas || [], adj = zones.map(function () { return []; });
    zones.forEach(function (z, k) {
      var id = SEA_BASE + k;
      z.nb.forEach(function (j) {
        if (j <= k) return;
        var d = nodeDist(id, SEA_BASE + j);
        adj[k].push({ to: SEA_BASE + j, d: d }); adj[j].push({ to: id, d: d });
      });
      z.coast.forEach(function (p) { var d = nodeDist(id, p); adj[k].push({ to: p, d: d }); sea[p].push({ to: id, d: d }); });
    });
    return adj;
  }

  // ---------- węzły morskie (strefy) i lądowe (porty) ----------
  function isSea(id) { return id >= SEA_BASE; }
  function seaZone(id) { return (M().seas || [])[id - SEA_BASE] || null; }
  function seaZoneCount() { return (M().seas || []).length; }
  /** Punkt węzła na mapie: środek strefy albo port prowincji (gdy brak — jej środek). */
  function nodePoint(id) {
    if (isSea(id)) { var z = seaZone(id); return [z.cx, z.cy]; }
    var p = M().provinces[id];
    return p.port || [p.cx, p.cy];
  }
  function nodeName(id) { return isSea(id) ? seaZone(id).name : M().provinces[id].name; }
  function nodeDist(a, b) {
    var pa = nodePoint(a), pb = nodePoint(b), dx = pa[0] - pb[0], dy = pa[1] - pb[1];
    return Math.sqrt(dx * dx + dy * dy) * (M().kmPerUnit || 4.1);
  }

  /** Odbudowuje wszystkie indeksy z WT.G (po wczytaniu gry). */
  function rebuildIndex() {
    buildStaticGraphs();
    var g = G();
    idx.byOwner = {}; idx.byCtrl = {}; idx.armiesAt = {}; idx.fleetsAt = {};
    g.provinces.forEach(function (p, id) {
      (idx.byOwner[p.owner] = idx.byOwner[p.owner] || []).push(id);
      (idx.byCtrl[p.ctrl] = idx.byCtrl[p.ctrl] || []).push(id);
    });
    Object.keys(g.armies).forEach(function (id) { if (!g.armies[id].embarked) indexAdd(idx.armiesAt, g.armies[id].prov, id); });
    Object.keys(g.fleets).forEach(function (id) { indexAdd(idx.fleetsAt, g.fleets[id].prov, id); });
    if (WT.diplomacy) WT.diplomacy.reindex();
  }

  function indexAdd(map, k, v) { (map[k] = map[k] || []).push(v); }
  function indexRemove(map, k, v) {
    var arr = map[k];
    if (!arr) return;
    U.removeFromArray(arr, v);
    if (!arr.length) delete map[k];
  }

  // =====================================================================
  // Gettery
  // =====================================================================

  function provStatic(id) { return M().provinces[id]; }
  function prov(id) { return G().provinces[id]; }
  function country(cc) { return G().countries[cc]; }
  function countriesAlive() { return Object.keys(G().countries).filter(function (cc) { return G().countries[cc].alive; }); }
  function provincesOf(cc) { return (idx.byOwner[cc] || []).slice(); }
  function controlledBy(cc) { return (idx.byCtrl[cc] || []).slice(); }
  function landNeighbors(id) { return idx.landAdj[id]; }
  function seaNeighbors(id) { return isSea(id) ? (idx.zoneAdj[id - SEA_BASE] || []) : idx.seaAdj[id]; }
  function provinceCount() { return G().provinces.length; }
  function provincesWithArmies() { return Object.keys(idx.armiesAt).map(Number); }

  function armiesIn(provId) {
    var ids = idx.armiesAt[provId];
    return ids ? ids.map(function (id) { return G().armies[id]; }) : [];
  }
  function fleetsIn(provId) {
    var ids = idx.fleetsAt[provId];
    return ids ? ids.map(function (id) { return G().fleets[id]; }) : [];
  }
  function armiesOf(cc) {
    var out = [], a = G().armies;
    for (var id in a) if (a[id].owner === cc) out.push(a[id]);
    return out;
  }
  function fleetsOf(cc) {
    var out = [], f = G().fleets;
    for (var id in f) if (f[id].owner === cc) out.push(f[id]);
    return out;
  }

  /** Państwa graniczące lądem (wg właścicieli prowincji). */
  function countryNeighbors(cc) {
    var seen = {}, out = [];
    (idx.byOwner[cc] || []).forEach(function (id) {
      idx.landAdj[id].forEach(function (n) {
        var o = G().provinces[n].owner;
        if (o !== cc && !seen[o]) { seen[o] = true; out.push(o); }
      });
    });
    return out;
  }

  function distStatic(a, b) {
    var pa = M().provinces[a], pb = M().provinces[b];
    var dx = pa.cx - pb.cx, dy = pa.cy - pb.cy;
    return Math.sqrt(dx * dx + dy * dy) * (M().kmPerUnit || 4.1);
  }
  function dist(a, b) { return distStatic(a, b); }

  function dateStr() {
    var d = new Date(G().date + 'T00:00:00Z');
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }
  function advanceDate(days) {
    var d = new Date(G().date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    G().date = d.toISOString().slice(0, 10);
  }

  // =====================================================================
  // Mutacje utrzymujące indeksy
  // =====================================================================

  function newId(prefix) { return prefix + (G().nextId++); }

  function setOwner(provId, cc) {
    var p = G().provinces[provId];
    if (p.owner !== cc) {
      indexRemove(idx.byOwner, p.owner, provId);
      indexAdd(idx.byOwner, cc, provId);
      p.owner = cc;
      p.acq = G().turn;          // tura przejęcia (niepokoje po podboju)
      p.builds = {};           // budowy poprzedniego właściciela przepadają
    }
    setCtrl(provId, cc);
  }
  function setCtrl(provId, cc) {
    var p = G().provinces[provId];
    if (p.ctrl === cc) return;
    indexRemove(idx.byCtrl, p.ctrl, provId);
    indexAdd(idx.byCtrl, cc, provId);
    p.ctrl = cc;
    p.siege = null;
  }

  function createArmy(cc, provId, size) {
    var a = { id: newId('a'), owner: cc, prov: provId, size: Math.round(size), path: [], moved: 0, embarked: null, prevProv: provId };
    G().armies[a.id] = a;
    indexAdd(idx.armiesAt, provId, a.id);
    return a;
  }
  function removeArmy(armyId) {
    var a = G().armies[armyId];
    if (!a) return;
    if (!a.embarked) indexRemove(idx.armiesAt, a.prov, armyId);
    else if (G().fleets[a.embarked]) U.removeFromArray(G().fleets[a.embarked].cargo, armyId);
    delete G().armies[armyId];
  }
  function moveArmy(army, provId) {
    if (!army.embarked) indexRemove(idx.armiesAt, army.prov, army.id);
    army.prevProv = army.prov;
    army.prov = provId;
    if (!army.embarked) indexAdd(idx.armiesAt, provId, army.id);
  }
  /** Zaokrętowanie (armia znika z mapy lądowej) / wysadzenie. */
  function embarkArmy(army, fleetId) {
    if (!army.embarked) indexRemove(idx.armiesAt, army.prov, army.id);
    army.embarked = fleetId;
  }
  function disembarkArmy(army, provId) {
    army.embarked = null;
    army.prevProv = army.prov;
    army.prov = provId;
    indexAdd(idx.armiesAt, provId, army.id);
  }

  function createFleet(cc, provId, ships) {
    var f = { id: newId('f'), owner: cc, prov: provId, ships: ships, path: [], cargo: [], landAt: null, home: provId };
    G().fleets[f.id] = f;
    indexAdd(idx.fleetsAt, provId, f.id);
    return f;
  }
  function removeFleet(fleetId) {
    var f = G().fleets[fleetId];
    if (!f) return;
    f.cargo.slice().forEach(removeArmy);
    indexRemove(idx.fleetsAt, f.prov, fleetId);
    delete G().fleets[fleetId];
  }
  function moveFleet(fleet, provId) {
    indexRemove(idx.fleetsAt, fleet.prov, fleet.id);
    fleet.prov = provId;
    indexAdd(idx.fleetsAt, provId, fleet.id);
    // armie na pokładzie zachowują ostatnią prowincję lądową, dopóki flota stoi w strefie morskiej
    if (!isSea(provId)) fleet.cargo.forEach(function (aid) { var a = G().armies[aid]; if (a) a.prov = provId; });
  }

  // ---------- Dziennik ----------

  function addLog(text, cc) {
    var entry = { turn: G().turn, text: text };
    if (cc) entry.cc = cc;
    G().log.push(entry);
    if (G().log.length > 200) G().log.splice(0, G().log.length - 200);
    WT.events.emit('log', entry);
    return entry;
  }
  /** Czy zdarzenie dotyczy gracza (do toastów/logów bitew). */
  function involvesPlayer() {
    for (var i = 0; i < arguments.length; i++) if (arguments[i] === G().player) return true;
    return false;
  }

  return {
    newGame: newGame, rebuildIndex: rebuildIndex,
    provStatic: provStatic, prov: prov, country: country, countriesAlive: countriesAlive,
    provincesOf: provincesOf, controlledBy: controlledBy,
    armiesIn: armiesIn, fleetsIn: fleetsIn, armiesOf: armiesOf, fleetsOf: fleetsOf,
    dateStr: dateStr, advanceDate: advanceDate, dist: dist,
    landNeighbors: landNeighbors, seaNeighbors: seaNeighbors, countryNeighbors: countryNeighbors,
    provinceCount: provinceCount, provincesWithArmies: provincesWithArmies,
    newId: newId, setOwner: setOwner, setCtrl: setCtrl,
    createArmy: createArmy, removeArmy: removeArmy, moveArmy: moveArmy,
    embarkArmy: embarkArmy, disembarkArmy: disembarkArmy,
    createFleet: createFleet, removeFleet: removeFleet, moveFleet: moveFleet,
    findCapital: findCapital, addLog: addLog, extendWorld: extendWorld,
    nationData: nationData, nationName: nationName, coresOf: coresOf, nationCandidates: nationCandidates, spawnCountry: spawnCountry,
    startUprising: startUprising, uprisingPreview: uprisingPreview, goalProgress: goalProgress, checkGoal: checkGoal,
    VOID: VOID, SEA_BASE: SEA_BASE, CONTINENTS: CONTINENTS, scenarioData: scenarioData, provPop: provPop, era: era,
    isSea: isSea, seaZone: seaZone, seaZoneCount: seaZoneCount, nodePoint: nodePoint, nodeName: nodeName, nodeDist: nodeDist, involvesPlayer: involvesPlayer, settings: settings
  };
})();

if (typeof module !== 'undefined') module.exports = WT.state;
