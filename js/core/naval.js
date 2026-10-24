var WT = (typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (global.WT = global.WT || {}));

/* WT.naval — graf morski (seaLinks), ruch flot, bitwy morskie, desanty. */
WT.naval = (function () {
  var U = WT.util, S = WT.state, D = function () { return WT.diplomacy; }, Mil = function () { return WT.military; };

  var FLEET_MOVES = 3;               // węzły morskie na turę
  var SHIP_CAPACITY = 10000;         // żołnierzy na eskadrę

  function G() { return WT.G; }
  function name(cc) { return S.country(cc).name; }
  function isPort(provId) { return !!S.provStatic(provId).coastal && S.seaNeighbors(provId).length > 0; }

  // =====================================================================
  // Graf morski
  // =====================================================================

  /** Dijkstra po seaLinks. Zwraca węzły bez startowego; [] gdy from===to; null gdy brak drogi. */
  function seaPath(fromProv, toProv) {
    if (fromProv === toProv) return [];
    if (!isPort(fromProv) || !isPort(toProv)) return null;
    var dist = {}, came = {}, done = {}, pq = new U.PriorityQueue();
    dist[fromProv] = 0;
    pq.push(fromProv, 0);
    while (pq.size()) {
      var cur = pq.pop();
      if (done[cur]) continue;
      if (cur === toProv) return rebuildSeaPath(came, fromProv, toProv);
      done[cur] = true;
      relaxSeaEdges(cur, dist, came, done, pq);
    }
    return null;
  }

  function relaxSeaEdges(cur, dist, came, done, pq) {
    var edges = S.seaNeighbors(cur);
    for (var i = 0; i < edges.length; i++) {
      var e = edges[i], nd = dist[cur] + e.d;
      if (done[e.to] || (dist[e.to] != null && nd >= dist[e.to])) continue;
      dist[e.to] = nd; came[e.to] = cur;
      pq.push(e.to, nd);
    }
  }

  function rebuildSeaPath(came, from, to) {
    var path = [to], cur = to;
    while (came[cur] !== from) { cur = came[cur]; path.push(cur); }
    return path.reverse();
  }

  function seaTurns(path) { return Math.ceil(path.length / FLEET_MOVES); }

  // =====================================================================
  // Rozkazy flot
  // =====================================================================

  function orderFleet(fleetId, destProv) {
    var f = G().fleets[fleetId];
    if (!f) return { ok: false, reason: 'Nie ma takiej floty.' };
    if (!isPort(destProv)) return { ok: false, reason: 'Cel nie jest prowincją nadmorską.' };
    var path = seaPath(f.prov, destProv);
    if (!path) return { ok: false, reason: 'Brak drogi morskiej do celu.' };
    f.path = path;
    f.landAt = null;
    return { ok: true, reason: 'Rejs: ' + path.length + ' węzłów, ok. ' + seaTurns(path) + ' tur.', turns: seaTurns(path) };
  }

  function cargoSize(f) {
    return f.cargo.reduce(function (s, id) { return s + (G().armies[id] ? G().armies[id].size : 0); }, 0);
  }
  function freeCapacity(f) { return Math.max(0, Math.floor(f.ships * SHIP_CAPACITY - cargoSize(f))); }

  function bestTransport(cc, provId) {
    return S.fleetsIn(provId).filter(function (f) { return f.owner === cc; })
      .sort(function (a, b) { return freeCapacity(b) - freeCapacity(a); })[0] || null;
  }

  function checkInvasion(army, destProv) {
    if (!army) return 'Nie ma takiej armii.';
    if (army.embarked) return 'Armia jest już na okrętach.';
    if (!isPort(army.prov)) return 'Armia musi stać w prowincji nadmorskiej.';
    if (!isPort(destProv)) return 'Cel desantu musi być prowincją nadmorską.';
    if (destProv === army.prov) return 'Armia już tam jest.';
    if (!Mil().canEnter(army.owner, destProv)) return 'Brak dostępu do celu (wymagana wojna lub sojusz).';
    return null;
  }

  /** Desant: armia wsiada na własną flotę w swojej prowincji, flota płynie i wysadza wojsko w celu. */
  function planInvasion(armyId, destProv, size) {
    var army = G().armies[armyId], err = checkInvasion(army, destProv);
    if (err) return { ok: false, reason: err };
    var fleet = bestTransport(army.owner, army.prov);
    if (!fleet) return { ok: false, reason: 'Brak własnej floty w prowincji ' + S.provStatic(army.prov).name + '.' };
    var path = seaPath(army.prov, destProv);
    if (!path) return { ok: false, reason: 'Brak drogi morskiej do celu.' };
    var cap = freeCapacity(fleet);
    var amount = Math.round(size && size < army.size - Mil().MIN_REMAINDER ? size : army.size);
    if (amount > cap) return { ok: false, reason: 'Flota pomieści maks. ' + U.fmtK(cap) + ' żołnierzy (1 eskadra = 10k).' };
    var mover = Mil().splitForOrder(army, amount);
    if (!mover) return { ok: false, reason: 'Wyślij co najmniej ' + Mil().MIN_ARMY + ' żołnierzy.' };
    embark(mover, fleet);
    fleet.path = path; fleet.landAt = destProv; fleet.home = army.prov;
    return { ok: true, reason: 'Desant: ' + U.fmtK(mover.size) + ', ok. ' + seaTurns(path) + ' tur.', armyId: mover.id, fleetId: fleet.id, turns: seaTurns(path) };
  }

  function embark(army, fleet) {
    army.path = [];
    S.embarkArmy(army, fleet.id);
    fleet.cargo.push(army.id);
  }

  /** Wysadzenie ładunku w bieżącej prowincji floty (jeśli jest dostęp). */
  function unload(fleetId) {
    var f = G().fleets[fleetId];
    if (!f || !f.cargo.length) return { ok: false, reason: 'Flota nie przewozi wojsk.' };
    if (!Mil().canEnter(f.owner, f.prov)) return { ok: false, reason: 'Brak dostępu do tej prowincji.' };
    land(f);
    return { ok: true, reason: 'Wojska wysadzone.' };
  }

  // =====================================================================
  // Faza ruchu flot
  // =====================================================================

  function moveFleets() {
    var ids = U.shuffle(Object.keys(G().fleets).sort());
    ids.forEach(function (id) { var f = G().fleets[id]; if (f) moveFleet(f); });
    resolveEncounters();
  }

  function moveFleet(f) {
    for (var step = 0; step < FLEET_MOVES && f.path.length; step++) {
      S.moveFleet(f, f.path.shift());
      if (hostileFleets(f).length) { navalBattle(f); if (!G().fleets[f.id] || !f.path.length) return; }
    }
    if (!f.path.length && f.landAt === f.prov) land(f);
  }

  function hostileFleets(f) {
    return S.fleetsIn(f.prov).filter(function (o) { return D().atWar(o.owner, f.owner); });
  }

  function resolveEncounters() {
    Object.keys(G().fleets).forEach(function (id) {
      var f = G().fleets[id];
      if (f && hostileFleets(f).length) navalBattle(f);
    });
  }

  function land(f) {
    var dest = f.prov;
    if (!Mil().canEnter(f.owner, dest)) { returnHome(f); return; }
    var landed = f.cargo.map(function (id) { return G().armies[id]; }).filter(Boolean);
    f.cargo = []; f.landAt = null;
    landed.forEach(function (a) { S.disembarkArmy(a, dest); a.moved = 99; a.path = []; });
    if (!landed.length) return;
    if (S.involvesPlayer(f.owner, G().provinces[dest].ctrl)) S.addLog('Desant: ' + name(f.owner) + ' ląduje w ' + S.provStatic(dest).name + ' (' + U.fmtK(landed.reduce(function (s, a) { return s + a.size; }, 0)) + ').', f.owner);
    Mil().engageAt(dest, landed[0], { landing: true });
    landed.forEach(function (a) { if (G().armies[a.id] && a.prov === dest) Mil().mergeIfIdle(a); });
  }

  function returnHome(f) {
    var path = seaPath(f.prov, f.home);
    if (path && path.length) { f.path = path; f.landAt = f.home; }
    else { f.path = []; f.landAt = null; if (f.prov === f.home) land(f); }
  }

  // =====================================================================
  // Bitwy morskie
  // =====================================================================

  function fleetStrength(fleets) {
    var s = 0;
    fleets.forEach(function (f) { s += f.ships * S.country(f.owner).tech; });
    return s * U.randRange(0.85, 1.15);
  }

  function navalBattle(f) {
    var node = f.prov, enemies = hostileFleets(f);
    var mine = S.fleetsIn(node).filter(function (o) { return o.owner === f.owner || (D().friendly(o.owner, f.owner) && enemies.some(function (e) { return D().atWar(o.owner, e.owner); })); });
    var sa = fleetStrength(mine), sb = fleetStrength(enemies);
    var aWins = sa > sb, winners = aWins ? mine : enemies, losers = aWins ? enemies : mine;
    var ratio = Math.min(1, (aWins ? sb : sa) / Math.max(0.01, aWins ? sa : sb));
    var lf = U.randRange(0.3, 0.5);
    damageFleets(winners, lf * ratio * 0.6, false);
    damageFleets(losers, lf, true);
    var result = { naval: true, prov: node, attacker: f.owner, defender: enemies[0].owner,
      winnerCc: winners[0].owner, loserCc: losers[0].owner, shipsA: U.round(sa, 1), shipsB: U.round(sb, 1) };
    logNavalBattle(result);
    WT.events.emit('battle', result);
    return result;
  }

  function damageFleets(fleets, frac, lost) {
    fleets.forEach(function (fl) {
      fl.ships = U.round(fl.ships * (1 - frac), 2);
      if (lost) fl.cargo.forEach(function (id) { var a = G().armies[id]; if (a) a.size = Math.floor(a.size * 0.5); });
      if (fl.ships < 0.5) { S.removeFleet(fl.id); return; }
      if (lost) retreatFleet(fl);
    });
  }

  function retreatFleet(fl) {
    fl.path = [];
    if (fl.cargo.length) returnHome(fl);
    else fl.landAt = null;
  }

  function logNavalBattle(r) {
    if (!S.involvesPlayer(r.attacker, r.defender)) return;
    S.addLog('Bitwa morska przy ' + S.provStatic(r.prov).name + ': ' + name(r.attacker) + ' vs ' + name(r.defender) +
      '. Zwycięstwo: ' + name(r.winnerCc) + '.', G().player);
  }

  return {
    FLEET_MOVES: FLEET_MOVES, SHIP_CAPACITY: SHIP_CAPACITY,
    isPort: isPort, seaPath: seaPath, seaTurns: seaTurns, orderFleet: orderFleet,
    freeCapacity: freeCapacity, cargoSize: cargoSize, planInvasion: planInvasion, unload: unload,
    moveFleets: moveFleets, navalBattle: navalBattle
  };
})();

if (typeof module !== 'undefined') module.exports = WT.naval;
