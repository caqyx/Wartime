var WT = (typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (global.WT = global.WT || {}));

/* WT.naval — graf morski (seaLinks), ruch flot, bitwy morskie, desanty. */
WT.naval = (function () {
  var U = WT.util, S = WT.state, D = function () { return WT.diplomacy; }, Mil = function () { return WT.military; };

  var FLEET_MOVES = 3;               // węzły morskie na turę
  var SHIP_CAPACITY = 10000;         // żołnierzy na eskadrę
  // Okręty artyleryjskie (f.gunships): kupowane w porcie, ostrzeliwują wrogą prowincję, w której stoi flota.
  var GUNSHIP_COST = 2.5;            // mld za okręt
  var GUNSHIP_BATTLE = 1.5;          // siła w bitwie morskiej względem eskadry transportowej
  var SHELL_SOLDIERS = 1500;         // żołnierzy na okręt na turę (× technologia)
  var SHELL_MAX_ARMY = 0.15;         // maks. strata armii w prowincji na turę
  var SHELL_DEV = 0.008, SHELL_MAX_DEV = 0.12, SHELL_FORT = 0.04;
  var FORT_RETURN_FIRE = 0.03;       // szansa zatopienia okrętu na poziom fortu
  var SHELL_RANGE_KM = 320;          // zasięg ostrzału z dystansu (od floty do portu/środka prowincji)

  function G() { return WT.G; }
  function name(cc) { return S.country(cc).name; }
  function isPort(provId) { return !S.isSea(provId) && !!S.provStatic(provId).coastal && S.seaNeighbors(provId).length > 0; }
  /** Węzeł grafu morskiego: strefa morska albo prowincja nadmorska. */
  function isNode(id) { return S.isSea(id) ? !!S.seaZone(id) : isPort(id); }

  // =====================================================================
  // Graf morski
  // =====================================================================

  /** Dijkstra po seaLinks. Zwraca węzły bez startowego; [] gdy from===to; null gdy brak drogi. */
  function seaPath(fromProv, toProv) {
    if (fromProv === toProv) return [];
    if (!isNode(fromProv) || !isNode(toProv)) return null;
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

  function fleetMoves(cc) { return FLEET_MOVES + (WT.tech && cc ? WT.tech.add(cc, 'fleetSpeed') : 0); }
  function seaTurns(path, cc) { return Math.ceil(path.length / fleetMoves(cc)); }

  // =====================================================================
  // Rozkazy flot
  // =====================================================================

  function orderFleet(fleetId, destProv) {
    var f = G().fleets[fleetId];
    if (!f) return { ok: false, reason: 'Nie ma takiej floty.' };
    if (!isNode(destProv)) return { ok: false, reason: 'Cel nie jest morzem ani prowincją nadmorską.' };
    var path = seaPath(f.prov, destProv);
    if (!path) return { ok: false, reason: 'Brak drogi morskiej do celu.' };
    f.path = path;
    f.landAt = null;
    var t = seaTurns(path, f.owner);
    return { ok: true, reason: 'Rejs: ' + path.length + ' węzłów, ok. ' + t + ' tur.' + (f.gunships ? ' Okręty artyleryjskie ostrzelają wrogą prowincję u celu.' : ''), turns: t };
  }

  function cargoSize(f) {
    return f.cargo.reduce(function (s, id) { return s + (G().armies[id] ? G().armies[id].size : 0); }, 0);
  }
  function freeCapacity(f) { return Math.max(0, Math.floor(f.ships * SHIP_CAPACITY * techMod(f.owner, 'shipCapacity') - cargoSize(f))); }
  function techMod(cc, key) { return WT.tech ? WT.tech.mod(cc, key) : 1; }

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
    if (amount > cap) return { ok: false, reason: 'Flota pomieści maks. ' + U.fmtK(cap) + ' żołnierzy (1 eskadra = ' + U.fmtK(SHIP_CAPACITY * techMod(army.owner, 'shipCapacity')) + ').' };
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
    if (S.isSea(f.prov)) return { ok: false, reason: 'Flota jest na morzu — wyślij ją do prowincji nadmorskiej.' };
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
    for (var step = 0, n = fleetMoves(f.owner); step < n && f.path.length; step++) {
      S.moveFleet(f, f.path.shift());
      if (hostileFleets(f).length) { navalBattle(f); if (!G().fleets[f.id] || !f.path.length) return; }
    }
    if (!f.path.length && f.landAt === f.prov && !S.isSea(f.prov)) land(f);
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
    else { f.path = []; f.landAt = null; if (f.prov === f.home && !S.isSea(f.prov)) land(f); }
  }

  // =====================================================================
  // Bitwy morskie
  // =====================================================================

  function fleetStrength(fleets) {
    var s = 0;
    fleets.forEach(function (f) { s += (f.ships + GUNSHIP_BATTLE * (f.gunships || 0)) * S.country(f.owner).tech * techMod(f.owner, 'fleet'); });
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
      if (fl.gunships) fl.gunships = Math.floor(fl.gunships * (1 - frac) + U.rand());
      if (lost) fl.cargo.forEach(function (id) { var a = G().armies[id]; if (a) a.size = Math.floor(a.size * 0.5); });
      if (isEmptyFleet(fl)) { S.removeFleet(fl.id); return; }
      if (lost) retreatFleet(fl);
    });
  }

  function isEmptyFleet(fl) { return fl.ships < 0.5 && !(fl.gunships > 0); }

  // =====================================================================
  // Okręty artyleryjskie: zakup i ostrzał wybrzeża
  // =====================================================================

  function gunshipCost(n) { return U.round(n * GUNSHIP_COST * WT.economy.priceScale(), 2); }

  function canBuyGunships(cc, provId, n) {
    var p = G().provinces[provId];
    if (!S.era('gunships')) return { ok: false, reason: 'Okręty artyleryjskie niedostępne w tej epoce.' };
    if (!(n >= 1)) return { ok: false, reason: 'Podaj liczbę okrętów.' };
    if (!p || p.owner !== cc || p.ctrl !== cc) return { ok: false, reason: 'Okręty kupuje się we własnej, kontrolowanej prowincji.' };
    if (!S.provStatic(provId).coastal || (p.buildings.port || 0) < 1) return { ok: false, reason: 'Wymagany port.' };
    if (!WT.economy.canAfford(cc, gunshipCost(n))) return { ok: false, reason: 'Brak środków: potrzeba ' + U.fmtMoney(gunshipCost(n)) + '.' };
    return { ok: true, reason: n + ' okr. artyleryjskich za ' + U.fmtMoney(gunshipCost(n)) + '.' };
  }

  /** Okręty dołączają do stojącej w porcie floty (albo tworzą nową flotę bez eskadr transportowych). */
  function buyGunships(cc, provId, n) {
    n = Math.floor(n);
    if (!canBuyGunships(cc, provId, n).ok) return null;
    WT.economy.pay(cc, gunshipCost(n));
    var f = S.fleetsIn(provId).filter(function (x) { return x.owner === cc && !x.path.length && !x.cargo.length; })[0];
    if (!f) { f = S.createFleet(cc, provId, 0); }
    f.gunships = (f.gunships || 0) + n;
    return f;
  }

  // ---------- Ostrzał z dystansu: flota w strefie morskiej (albo w porcie) ostrzeliwuje wskazaną prowincję w zasięgu ----------

  /** Zasięg dział okrętowych (technologie: artyleria okrętowa, pociski manewrujące). */
  function shellRangeKm(cc) { return SHELL_RANGE_KM + (WT.tech && cc ? WT.tech.add(cc, 'shellRange') : 0); }

  /** Odległość floty od prowincji: do jej portu (jeśli nadmorska) albo do środka — liczy się bliższy punkt. */
  function distToProvince(node, provId) {
    var a = S.nodePoint(node), ps = S.provStatic(provId), k = U.mapData().kmPerUnit || 4;
    var pts = [[ps.cx, ps.cy]].concat(ps.port ? [ps.port] : []);
    return Math.min.apply(null, pts.map(function (q) { return Math.hypot(q[0] - a[0], q[1] - a[1]) * k; }));
  }

  function checkShell(f, target) {
    if (!f) return 'Nie ma takiej floty.';
    if (!(f.gunships > 0)) return 'Flota nie ma okrętów artyleryjskich.';
    if (target == null || target < 0 || S.isSea(target) || !G().provinces[target]) return 'Wskaż prowincję lądową.';
    if (!D().atWar(f.owner, G().provinces[target].ctrl)) return 'Ostrzeliwać można tylko prowincje państw, z którymi jesteś w wojnie.';
    var d = distToProvince(f.prov, target), r = shellRangeKm(f.owner);
    if (d > r) return 'Poza zasięgiem dział: ' + Math.round(d) + ' km (maks. ' + r + ' km od floty).';
    return null;
  }

  /** Stały cel ostrzału: flota co turę ostrzeliwuje prowincję, dopóki stoi w zasięgu i trwa wojna. */
  function orderShell(fleetId, target) {
    var f = G().fleets[fleetId], err = checkShell(f, target);
    if (err) return { ok: false, reason: err };
    f.shellTarget = target;
    return { ok: true, reason: 'Cel ostrzału: ' + S.provStatic(target).name + ' (' + f.gunships + ' okr.). Ostrzał co turę na końcu tury.' };
  }
  function cancelShell(fleetId) {
    var f = G().fleets[fleetId];
    if (!f || f.shellTarget == null) return false;
    f.shellTarget = null;
    return true;
  }

  /** Po ruchu flot: wskazany cel w zasięgu, inaczej prowincja wroga, przy której stoi flota. */
  function shellAll() {
    Object.keys(G().fleets).forEach(function (id) {
      var f = G().fleets[id];
      if (!f || !(f.gunships > 0) || f.path.length) return;
      if (f.shellTarget != null) {
        if (!checkShell(f, f.shellTarget)) { shellProvince(f, f.shellTarget); return; }
        if (G().provinces[f.shellTarget] && !D().atWar(f.owner, G().provinces[f.shellTarget].ctrl)) f.shellTarget = null;   // wojna skończona
      }
      var p = S.isSea(f.prov) ? null : G().provinces[f.prov];
      if (p && D().atWar(f.owner, p.ctrl)) shellProvince(f, f.prov);
    });
  }

  function shellProvince(f, target) {
    var provId = target != null ? target : f.prov, p = G().provinces[provId], defender = p.ctrl;
    var resist = techMod(defender, 'coastDef');
    var power = f.gunships * S.country(f.owner).tech * techMod(f.owner, 'shellDamage') * resist * U.randRange(0.8, 1.2);
    var killed = shellArmies(f.owner, provId, power);
    var devBefore = p.dev;
    p.dev = Math.max(0.3, p.dev - Math.min(SHELL_MAX_DEV, SHELL_DEV * power));
    p.bombed = Math.max(p.bombed || 0, 2);
    var fortHit = p.buildings.fort > 0 && U.chance(Math.min(0.5, SHELL_FORT * power));
    if (fortHit) p.buildings.fort--;
    var sunk = 0, fire = FORT_RETURN_FIRE * (p.buildings.fort || 0) / resist;
    for (var i = 0; i < f.gunships; i++) if (U.chance(fire)) sunk++;
    f.gunships -= sunk;
    var r = { attacker: f.owner, defender: defender, prov: provId, killed: killed, devLoss: U.round(devBefore - p.dev, 3), fortHit: fortHit, sunk: sunk, ships: f.gunships + sunk };
    logShelling(r);
    WT.events.emit('shelling', r);
    if (isEmptyFleet(f)) S.removeFleet(f.id);
    return r;
  }

  /** Straty wrogich armii w prowincji: proporcjonalnie do liczebności, maks. 15% na turę. */
  function shellArmies(owner, provId, power) {
    var enemies = S.armiesIn(provId).filter(function (a) { return !a.embarked && D().atWar(owner, a.owner); });
    var total = enemies.reduce(function (s, a) { return s + a.size; }, 0);
    if (!total) return 0;
    var loss = Math.min(total * SHELL_MAX_ARMY, power * SHELL_SOLDIERS), killed = 0;
    enemies.forEach(function (a) {
      var l = Math.floor(loss * a.size / total);
      a.size -= l; killed += l;
      if (a.size < Mil().MIN_ARMY) S.removeArmy(a.id);
    });
    return killed;
  }

  function logShelling(r) {
    if (!S.involvesPlayer(r.attacker, r.defender)) return;
    S.addLog('Ostrzał z morza: ' + name(r.attacker) + ' ostrzeliwuje ' + S.provStatic(r.prov).name + ' (' + name(r.defender) + '). ' +
      'Straty wojska: ' + U.fmtK(r.killed) + ', rozwój −' + r.devLoss.toFixed(2) + (r.fortHit ? ', uszkodzony fort' : '') +
      (r.sunk ? '; forty zatopiły ' + r.sunk + ' okr.' : '') + '.', r.attacker === G().player ? r.attacker : r.defender);
  }

  function retreatFleet(fl) {
    fl.path = [];
    if (fl.cargo.length) returnHome(fl);
    else fl.landAt = null;
  }

  function logNavalBattle(r) {
    if (!S.involvesPlayer(r.attacker, r.defender)) return;
    S.addLog('Bitwa morska: ' + S.nodeName(r.prov) + ': ' + name(r.attacker) + ' vs ' + name(r.defender) +
      '. Zwycięstwo: ' + name(r.winnerCc) + '.', G().player);
  }

  return {
    FLEET_MOVES: FLEET_MOVES, SHIP_CAPACITY: SHIP_CAPACITY, GUNSHIP_COST: GUNSHIP_COST, SHELL_RANGE_KM: SHELL_RANGE_KM,
    isNode: isNode, shellRangeKm: shellRangeKm, distToProvince: distToProvince, checkShell: checkShell, orderShell: orderShell, cancelShell: cancelShell,
    fleetMoves: fleetMoves, gunshipCost: gunshipCost, canBuyGunships: canBuyGunships, buyGunships: buyGunships, shellAll: shellAll, shellProvince: shellProvince,
    isPort: isPort, seaPath: seaPath, seaTurns: seaTurns, orderFleet: orderFleet,
    freeCapacity: freeCapacity, cargoSize: cargoSize, planInvasion: planInvasion, unload: unload,
    moveFleets: moveFleets, navalBattle: navalBattle
  };
})();

if (typeof module !== 'undefined') module.exports = WT.naval;
