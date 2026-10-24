var WT = (typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (global.WT = global.WT || {}));

/* WT.state — tworzenie nowej gry, indeksy (nieserializowane), gettery, rejestr armii/flot, dziennik. */
WT.state = (function () {
  var U = WT.util;
  var START_DATE = '2026-01-05';
  var MONTHS = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca',
    'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
  var DEFAULT_TECH = 0.6;

  // Indeksy przebudowywane z G (nie trafiają do zapisu).
  var idx = { map: null, landAdj: [], seaAdj: [], byOwner: {}, byCtrl: {}, armiesAt: {}, fleetsAt: {} };

  function G() { return WT.G; }
  function M() { return U.mapData(); }

  // =====================================================================
  // Nowa gra
  // =====================================================================

  function newGame(opts) {
    opts = opts || {};
    var seed = (opts.seed != null ? opts.seed : Math.floor(Math.random() * 1e9)) >>> 0;
    var g = createEmptyState(opts, seed);
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
    if (!g.countries[g.player]) g.player = countriesAlive()[0];
    addLog('Rozpoczęto grę jako ' + g.countries[g.player].name + '. ' + dateStr() + '.', g.player);
    return g;
  }

  function createEmptyState(opts, seed) {
    return {
      version: 1, turn: 0, date: START_DATE,
      player: opts.player, god: !!opts.god,
      seed: seed, rngState: seed,
      countries: {}, provinces: [], armies: {}, fleets: {}, squadrons: {}, trades: [],
      nextId: 100, rel: {}, wars: [], alliances: [], pacts: [], truces: [],
      proposals: [], log: [], gameOver: false
    };
  }

  function createProvinces(g) {
    var provs = M().provinces;
    for (var i = 0; i < provs.length; i++) {
      g.provinces.push({
        owner: provs[i].cc, ctrl: provs[i].cc,
        buildings: { factory: 0, fort: 0, port: 0, barracks: 0, aa: 0, radar: 0, university: 0 },
        builds: {}, unrest: 0, dev: 1.0, gdp: 0, siege: null
      });
    }
  }

  function collectCountryPops() {
    var pops = {}, provs = M().provinces;
    for (var i = 0; i < provs.length; i++) pops[provs[i].cc] = (pops[provs[i].cc] || 0) + (provs[i].pop || 0);
    return pops;
  }

  function createCountries(g) {
    var pops = collectCountryPops(), data = U.countryData();
    Object.keys(pops).sort().forEach(function (cc) {
      g.countries[cc] = makeCountry(cc, data[cc], pops[cc]);
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

  function assignCapitals(g) {
    Object.keys(g.countries).forEach(function (cc) { g.countries[cc].capital = findCapital(g.countries[cc]); });
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
  function distributeGdp(g) {
    Object.keys(g.countries).forEach(function (cc) {
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

  function createInitialRelations(g) {
    Object.keys(g.countries).forEach(function (cc) {
      var c = g.countries[cc];
      c.friends.forEach(function (o) { if (g.countries[o]) mergeRelation(g, cc, o, U.randInt(40, 70)); });
      c.rivals.forEach(function (o) { if (g.countries[o]) mergeRelation(g, cc, o, -U.randInt(40, 80)); });
    });
    Object.keys(g.countries).forEach(function (cc) {
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

  function placeStartingArmies(g) {
    Object.keys(g.countries).forEach(function (cc) {
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

  function placeStartingForts(g) {
    Object.keys(g.countries).forEach(function (cc) {
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

  function placeStartingFleets(g) {
    Object.keys(g.countries).forEach(function (cc) {
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
    var root = U.root();
    (root.START_WARS || []).forEach(function (w) {
      if (g.countries[w[0]] && g.countries[w[1]]) WT.diplomacy.startWar([w[0]], [w[1]], true);
    });
    (root.START_OCCUPATIONS || []).forEach(applyStartOccupation);
    fortifyFrontLines(g);
  }

  function applyStartOccupation(occ) {
    if (!G().countries[occ.by] || !G().countries[occ.cc]) return;
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
  function seaNeighbors(id) { return idx.seaAdj[id]; }
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
    fleet.cargo.forEach(function (aid) { var a = G().armies[aid]; if (a) a.prov = provId; });
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
    findCapital: findCapital, addLog: addLog, involvesPlayer: involvesPlayer
  };
})();

if (typeof module !== 'undefined') module.exports = WT.state;
