var WT = (typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (global.WT = global.WT || {}));

/* WT.military — armie, dostęp do terytorium, pathfinding A*, ruch, bitwy, oblężenia i okupacja. */
WT.military = (function () {
  var U = WT.util, S = WT.state, D = function () { return WT.diplomacy; };

  var MOVE_POINTS = 2;
  var MIN_ARMY = 200;                       // mniejsze resztki armii są rozwiązywane
  var MIN_REMAINDER = 1000;                 // rozkaz nie zostawia w prowincji mniejszej resztki — wysyła całość
  var TERRAIN_COST = { mountains: 1, jungle: 1 };
  var TERRAIN_DEFENSE = { hills: 0.15, mountains: 0.35, forest: 0.1, jungle: 0.2 };
  var TERRAIN_PATH_FACTOR = { mountains: 1.6, jungle: 1.6, hills: 1.15, forest: 1.1 };
  var LANDING_PENALTY = 0.25;
  var FRONTAGE_MIN = 100000, FRONTAGE_RATIO = 2.5;
  var ATTRITION = 0.005;                    // straty/turę armii na terytorium wroga (zaopatrzenie)
  var MAX_ASTAR_EXPANSIONS = 6000;

  function G() { return WT.G; }
  function name(cc) { return S.country(cc).name; }
  function terrain(provId) { return S.provStatic(provId).terrain || 'plains'; }

  // =====================================================================
  // Dostęp do terytorium
  // =====================================================================

  /** Czy armia cc może wejść do prowincji: własna/sojusznicza/wroga w stanie wojny. Neutralna — nie. */
  function canEnter(cc, provId) {
    var p = G().provinces[provId], d = D();
    if (p.owner === cc || p.ctrl === cc) return true;
    if (d.friendly(cc, p.owner) || d.friendly(cc, p.ctrl)) return true;
    if (WT.land && WT.land.hasAccess(cc, p.owner) && p.ctrl === p.owner) return true;   // pakt o przejściu wojsk
    return d.atWar(cc, p.owner) || d.atWar(cc, p.ctrl);
  }
  /** Prowincja kontrolowana przez wroga (wejście kończy ruch, kosztuje 2). */
  function isHostileTerritory(cc, provId) { return D().atWar(cc, G().provinces[provId].ctrl); }

  function moveCost(cc, provId) {
    return (isHostileTerritory(cc, provId) ? 2 : 1) + (TERRAIN_COST[terrain(provId)] || 0);
  }

  function hostileArmies(cc, provId) {
    return S.armiesIn(provId).filter(function (a) { return D().atWar(a.owner, cc); });
  }

  // =====================================================================
  // Pathfinding (A*, koszt = km × czynnik terenu, heurystyka = odległość w linii prostej)
  // =====================================================================

  function edgeCost(a, b) { return S.dist(a, b) * (TERRAIN_PATH_FACTOR[terrain(b)] || 1); }

  function findPathFor(cc, from, dest) {
    if (from === dest) return [];
    if (!canEnter(cc, dest)) return null;
    var open = new U.PriorityQueue(), gScore = {}, came = {}, closed = {}, expansions = 0;
    gScore[from] = 0;
    open.push(from, S.dist(from, dest));
    while (open.size() && expansions++ < MAX_ASTAR_EXPANSIONS) {
      var cur = open.pop();
      if (cur === dest) return reconstructPath(came, from, dest);
      if (closed[cur]) continue;
      closed[cur] = true;
      expandNeighbors(cc, cur, dest, open, gScore, came, closed);
    }
    return null;
  }

  function expandNeighbors(cc, cur, dest, open, gScore, came, closed) {
    var nbs = S.landNeighbors(cur);
    for (var i = 0; i < nbs.length; i++) {
      var n = nbs[i];
      if (closed[n] || !canEnter(cc, n)) continue;
      var g = gScore[cur] + edgeCost(cur, n);
      if (gScore[n] != null && g >= gScore[n]) continue;
      gScore[n] = g; came[n] = cur;
      open.push(n, g + S.dist(n, dest));
    }
  }

  function reconstructPath(came, from, dest) {
    var path = [dest], cur = dest;
    while (came[cur] !== from) { cur = came[cur]; path.push(cur); }
    return path.reverse();
  }

  function findPath(army, destProv) {
    if (!army || army.embarked) return null;
    return findPathFor(army.owner, army.prov, destProv);
  }

  /** Szacowana liczba tur przejścia trasą (dla UI). */
  function estimateTurns(cc, path) {
    var turns = path.length ? 1 : 0, pts = 0;
    for (var i = 0; i < path.length; i++) {
      var cost = moveCost(cc, path[i]);
      if (pts > 0 && pts + cost > MOVE_POINTS) { turns++; pts = 0; }
      pts += cost;
      if (isHostileTerritory(cc, path[i])) pts = MOVE_POINTS;
    }
    return turns;
  }

  // =====================================================================
  // Rozkazy
  // =====================================================================

  function order(armyId, destProv, sizeSoldiers) {
    var army = G().armies[armyId];
    if (!army) return { ok: false, reason: 'Nie ma takiej armii.' };
    if (army.embarked) return { ok: false, reason: 'Armia jest na okrętach.' };
    if (destProv === army.prov) { army.path = []; return { ok: true, reason: 'Armia pozostaje na miejscu.', armyId: armyId }; }
    var path = findPath(army, destProv);
    if (!path) return { ok: false, reason: noPathReason(army, destProv) };
    var mover = splitForOrder(army, sizeSoldiers);
    if (!mover) return { ok: false, reason: 'Wyślij co najmniej ' + MIN_ARMY + ' żołnierzy.' };
    mover.path = path;
    var turns = estimateTurns(army.owner, path);
    return { ok: true, reason: 'Marsz: ' + path.length + ' prow., ok. ' + turns + ' tur.', armyId: mover.id, turns: turns };
  }

  function noPathReason(army, destProv) {
    var p = G().provinces[destProv];
    if (!canEnter(army.owner, destProv)) return 'Brak dostępu: ' + name(p.owner) + ' nie jest z tobą w wojnie ani w sojuszu.';
    return 'Brak drogi lądowej (cel za morzem lub odcięty).';
  }

  /**
   * Oddział do wysłania rozkazem: cała armia, gdy po odłączeniu zostałaby resztka (< MIN_REMAINDER),
   * inaczej odłączona część. null tylko wtedy, gdy wysyłana część jest mniejsza niż MIN_ARMY.
   */
  function splitForOrder(army, size) {
    if (!size || size >= army.size - MIN_REMAINDER) return army;
    if (size < MIN_ARMY) return null;
    return split(army, size);
  }

  function split(army, size) {
    size = Math.round(size);
    if (size < MIN_ARMY || army.size - size < MIN_ARMY) return null;
    army.size -= size;
    var part = S.createArmy(army.owner, army.prov, size);
    part.moved = army.moved;
    return part;
  }

  function cancel(armyId) {
    var a = G().armies[armyId];
    if (a) a.path = [];
    return !!a;
  }

  var FRESH = 99;                           // moved świeżo zrekrutowanej / wycofanej / wysadzonej armii
  function isIdle(a) { return !a.embarked && !a.path.length; }

  /**
   * Łączy bezczynne (bez trasy, nie na okrętach) armie kraju w prowincji. Zostaje największa armia,
   * która ma jeszcze ruch (moved < 99); świeżo zrekrutowani dołączają do niej i NIE odbierają jej punktów ruchu.
   * Zwraca połączoną armię (albo jedyną bezczynną / null).
   */
  function merge(provId, cc) {
    var idle = S.armiesIn(provId).filter(function (a) { return a.owner === cc && isIdle(a); });
    if (idle.length < 2) return idle[0] || null;
    var active = idle.filter(function (a) { return a.moved < FRESH; });
    var pool = active.length ? active : idle;
    var main = pool.reduce(function (b, a) { return a.size > b.size ? a : b; });
    var moved = pool.reduce(function (m, a) { return Math.max(m, a.moved); }, 0);
    for (var i = 0; i < idle.length; i++) {
      if (idle[i] === main) continue;
      main.size += idle[i].size;
      S.removeArmy(idle[i].id);
    }
    main.moved = moved;
    return main;
  }

  /** Automatyczne scalenie po zatrzymaniu się armii (gdy stoi bezczynnie). */
  function mergeIfIdle(army) {
    if (!army || !G().armies[army.id] || !isIdle(army)) return army;
    return merge(army.prov, army.owner) || army;
  }

  /** Scala bezczynne armie wszystkich państw we wszystkich prowincjach (koniec tury, wczytanie gry). */
  function mergeAll() {
    S.provincesWithArmies().forEach(function (pid) {
      var list = S.armiesIn(pid);
      if (list.length < 2) return;
      var count = {};
      list.forEach(function (a) { if (isIdle(a)) count[a.owner] = (count[a.owner] || 0) + 1; });
      Object.keys(count).forEach(function (cc) { if (count[cc] > 1) merge(pid, cc); });
    });
  }

  /** Rozwiązanie armii: połowa żołnierzy wraca do rezerw. */
  function disband(armyId) {
    var a = G().armies[armyId];
    if (!a) return false;
    S.country(a.owner).manpower += a.size / 1000 * 0.5;
    S.removeArmy(armyId);
    return true;
  }

  // =====================================================================
  // Siła i bitwy
  // =====================================================================

  var powerCache = { g: null, turn: -1, map: null };
  /** Siła militarna kraju (żołnierze × tech), cache na turę. */
  function power(cc) {
    if (powerCache.g !== G() || powerCache.turn !== G().turn) refreshPower();
    return powerCache.map[cc] || 0;
  }
  function refreshPower() {
    var map = {}, armies = G().armies;
    for (var id in armies) {
      var a = armies[id], c = S.country(a.owner);
      map[a.owner] = (map[a.owner] || 0) + a.size * c.tech;
    }
    powerCache = { g: G(), turn: G().turn, map: map };
  }
  function invalidatePower() { powerCache.turn = -1; }

  function morale(cc) { return 0.6 + 0.4 * S.country(cc).stability / 100; }

  function defenseBonus(defenders, provId, opts) {
    var p = G().provinces[provId], owners = defenders.map(function (a) { return a.owner; });
    var fortFriendly = owners.some(function (o) { return D().friendly(o, p.ctrl); });
    var bonus = 1 + (TERRAIN_DEFENSE[terrain(provId)] || 0);
    if (fortFriendly) bonus += 0.25 * p.buildings.fort * (WT.tech ? WT.tech.mod(p.ctrl, 'fort') : 1);
    if (opts && opts.landing) bonus += LANDING_PENALTY;
    return bonus;
  }

  function sideStrength(armies, multiplier) {
    var s = 0;
    armies.forEach(function (a) { s += a.size * S.country(a.owner).tech * morale(a.owner); });
    return s * multiplier * U.randRange(0.85, 1.15);
  }

  function totalSize(armies) { return armies.reduce(function (s, a) { return s + a.size; }, 0); }
  function mainOwner(armies) {
    return armies.reduce(function (b, a) { return !b || a.size > b.size ? a : b; }, null).owner;
  }

  /**
   * Bitwa w prowincji. Obrońca: bonus fortu (jeśli jego strona kontroluje prowincję), terenu i desantu.
   * Przegrany traci 20–35% (przy przytłaczającej przewadze — całość), wygrany proporcjonalnie.
   */
  function battle(attackers, defenders, provId, opts) {
    var sizeA = totalSize(attackers), sizeD = totalSize(defenders);
    var engA = engagedFraction(sizeA, sizeD), engD = engagedFraction(sizeD, sizeA);
    var strA = sideStrength(attackers, engA), strD = sideStrength(defenders, engD * defenseBonus(defenders, provId, opts));
    var attWins = strA > strD;
    var fr = lossFractions(attWins ? strA : strD, attWins ? strD : strA);
    var lossesA = applyLosses(attackers, (attWins ? fr.winner : fr.loser) * engA);
    var lossesD = applyLosses(defenders, (attWins ? fr.loser : fr.winner) * engD);
    var ownerA = mainOwner(attackers), ownerD = mainOwner(defenders);
    var result = { winner: attWins ? 'attackers' : 'defenders', winnerCc: attWins ? ownerA : ownerD,
      loserCc: attWins ? ownerD : ownerA, attacker: ownerA, defender: ownerD, prov: provId,
      sizeA: sizeA, sizeD: sizeD, lossesA: lossesA, lossesD: lossesD, annihilated: fr.loser >= 1 };
    D().recordLosses(ownerA, ownerD, lossesA, lossesD);
    addExhaustion(ownerA, lossesA); addExhaustion(ownerD, lossesD);
    removeDead(attackers.concat(defenders));
    retreatLosers(attWins ? defenders : attackers);
    logBattle(result);
    WT.events.emit('battle', result);
    return result;
  }

  /**
   * Szerokość frontu: w bitwie walczy co najwyżej max(100k, 2.5× liczebność wroga) żołnierzy.
   * Dzięki temu wielka armia nie anihiluje małych oddziałów jednym ruchem, a straty liczone są od walczących.
   */
  function engagedFraction(own, enemy) {
    if (own <= 0) return 1;
    return Math.min(1, Math.max(FRONTAGE_MIN, FRONTAGE_RATIO * enemy) / own);
  }

  function lossFractions(winnerStr, loserStr) {
    var ratio = Math.min(1, loserStr / Math.max(1, winnerStr));
    if (ratio < 0.15) return { loser: 1, winner: U.randRange(0.02, 0.06) };
    var loser = U.randRange(0.2, 0.35);
    return { loser: loser, winner: loser * ratio * 0.6 };
  }

  function applyLosses(armies, frac) {
    var lost = 0;
    armies.forEach(function (a) {
      var l = Math.min(a.size, Math.round(a.size * frac));
      a.size -= l; lost += l;
    });
    return lost;
  }

  function addExhaustion(cc, lost) {
    var c = S.country(cc), base = Math.max(10000, c.pop * 15000);
    c.warExhaustion = Math.min(100, c.warExhaustion + Math.min(10, lost / base * 50));
  }

  function removeDead(armies) {
    armies.forEach(function (a) { if (G().armies[a.id] && a.size < MIN_ARMY) S.removeArmy(a.id); });
  }

  function retreatLosers(armies) {
    armies.forEach(function (a) { if (G().armies[a.id] && !a.embarked) retreat(a); });
  }

  function isSafeFor(cc, provId) {
    var p = G().provinces[provId];
    return (p.ctrl === cc || D().friendly(cc, p.ctrl)) && !hostileArmies(cc, provId).length;
  }

  /** Odwrót do najbliższej bezpiecznej (własnej/sojuszniczej, bez wroga) prowincji; brak → armia ginie. */
  function retreat(army) {
    var dest = isSafeFor(army.owner, army.prevProv) && army.prevProv !== army.prov && isAdjacent(army.prov, army.prevProv)
      ? army.prevProv : findSafeProvince(army.owner, army.prov, 10);
    army.path = [];
    army.moved = 99;
    if (dest < 0) { S.removeArmy(army.id); return false; }
    S.moveArmy(army, dest);
    merge(dest, army.owner);
    return true;
  }

  function findSafeProvince(cc, start, maxDepth) {
    var seen = {}, frontier = [start];
    seen[start] = true;
    for (var depth = 0; depth < maxDepth && frontier.length; depth++) {
      var next = [];
      for (var i = 0; i < frontier.length; i++) {
        var nbs = S.landNeighbors(frontier[i]);
        for (var j = 0; j < nbs.length; j++) {
          var n = nbs[j];
          if (seen[n] || !canEnter(cc, n)) continue;
          if (isSafeFor(cc, n)) return n;
          seen[n] = true; next.push(n);
        }
      }
      frontier = next;
    }
    return -1;
  }

  function isAdjacent(a, b) { return S.landNeighbors(a).indexOf(b) >= 0; }

  function logBattle(r) {
    if (!S.involvesPlayer(r.attacker, r.defender)) return;
    var txt = 'Bitwa: ' + S.provStatic(r.prov).name + ' — ' + name(r.attacker) + ' (' + U.fmtK(r.sizeA) + ') atakuje ' +
      name(r.defender) + ' (' + U.fmtK(r.sizeD) + '). Zwycięstwo: ' + name(r.winnerCc) + '. Straty: ' +
      U.fmtK(r.lossesA) + ' / ' + U.fmtK(r.lossesD) + (r.annihilated ? ' (armia przegranego rozbita).' : '.');
    S.addLog(txt, G().player);
  }

  // =====================================================================
  // Faza ruchu (wywoływana przez WT.turn.end)
  // =====================================================================

  function moveAll() {
    var byOwner = collectMovers();
    var owners = U.shuffle(Object.keys(byOwner).sort());
    var progress = true;
    for (var round = 0; round < 4 && progress; round++) {
      progress = false;
      for (var i = 0; i < owners.length; i++) {
        var list = byOwner[owners[i]];
        for (var j = 0; j < list.length; j++) if (G().armies[list[j].id] && stepArmy(list[j])) progress = true;
      }
    }
  }

  function collectMovers() {
    var byOwner = {}, armies = G().armies;
    for (var id in armies) {
      var a = armies[id];
      if (a.path.length && !a.embarked && a.moved < MOVE_POINTS) (byOwner[a.owner] = byOwner[a.owner] || []).push(a);
    }
    return byOwner;
  }

  /** Jeden krok armii po trasie. Zwraca true, gdy armia się przesunęła. */
  function stepArmy(army) {
    if (!army.path.length || army.embarked || army.moved >= MOVE_POINTS) return false;
    var next = army.path[0];
    if (!isAdjacent(army.prov, next) || !canEnter(army.owner, next)) { army.path = []; return false; }
    var cost = moveCost(army.owner, next);
    if (army.moved > 0 && army.moved + cost > MOVE_POINTS) return false;
    var hostile = isHostileTerritory(army.owner, next);
    S.moveArmy(army, next);
    army.path.shift();
    army.moved += cost;
    if (hostile) army.moved = Math.max(army.moved, MOVE_POINTS);
    engageAt(next, army);
    if (!army.path.length) mergeIfIdle(army);      // dotarła do celu → dołącza do stojącej tam armii
    return true;
  }

  /** Bitwa, jeśli w prowincji stoją wojska wroga przybywającej armii. */
  function engageAt(provId, army, opts) {
    var enemies = hostileArmies(army.owner, provId);
    if (!enemies.length) return null;
    var attackers = S.armiesIn(provId).filter(function (a) {
      return a.owner === army.owner || (D().friendly(a.owner, army.owner) &&
        enemies.some(function (e) { return D().atWar(a.owner, e.owner); }));
    });
    if (attackers.indexOf(army) < 0) attackers.push(army);
    return battle(attackers, enemies, provId, opts);
  }

  /** Wyniszczenie: armie stojące na ziemi wroga (wg właściciela prowincji) tracą 0.5% stanu na turę. */
  function applyAttrition() {
    var armies = G().armies;
    Object.keys(armies).forEach(function (id) {
      var a = armies[id];
      if (!a || a.embarked || !D().atWar(a.owner, G().provinces[a.prov].owner)) return;
      a.size = Math.floor(a.size * (1 - ATTRITION * (WT.tech ? WT.tech.mod(a.owner, 'attrition') : 1)));
      if (a.size < MIN_ARMY) S.removeArmy(id);
    });
  }

  function resetMoves() {
    var armies = G().armies;
    for (var id in armies) armies[id].moved = 0;
  }

  // =====================================================================
  // Oblężenia i okupacja
  // =====================================================================

  function resolveOccupations() {
    S.provincesWithArmies().forEach(resolveProvince);
    G().provinces.forEach(function (p, id) { if (p.siege && !S.armiesIn(id).length) p.siege = null; });
  }

  function resolveProvince(provId) {
    var p = G().provinces[provId], armies = S.armiesIn(provId);
    var occupiers = armies.filter(function (a) { return D().atWar(a.owner, p.ctrl); });
    if (!occupiers.length) { p.siege = null; return; }
    var defended = armies.some(function (a) { return occupiers.indexOf(a) < 0 && occupiers.some(function (o) { return D().atWar(o.owner, a.owner); }); });
    if (defended) return;
    var occ = mainOwner(occupiers);
    if (!siegeComplete(p, occ)) return;
    occupy(provId, occ);
  }

  /** Fort poziomu f wymaga f pełnych tur oblężenia (licząc od tury przybycia). */
  function siegeComplete(p, occ) {
    var fort = p.buildings.fort;
    if (!fort || !D().atWar(occ, p.ctrl)) return true;
    if (!p.siege || p.siege.by !== occ) p.siege = { by: occ, t: 0 };
    p.siege.t++;
    return p.siege.t > fort;
  }

  function occupy(provId, occ) {
    var p = G().provinces[provId], prev = p.ctrl;
    var newCtrl = D().atWar(occ, p.owner) ? occ : p.owner;   // sojusznik właściciela = wyzwolenie
    S.setCtrl(provId, newCtrl);
    if (S.involvesPlayer(occ, prev, p.owner)) {
      var verb = newCtrl === p.owner ? 'wyzwala' : 'zajmuje';
      S.addLog(name(occ) + ' ' + verb + ': ' + S.provStatic(provId).name + '.', occ);
    }
    WT.events.emit('occupy', { prov: provId, by: newCtrl, from: prev });
  }

  /** Po pokoju: armie stojące na terytorium bez prawa wstępu wracają do najbliższej własnej prowincji. */
  function expelTrespassers() {
    var armies = G().armies;
    Object.keys(armies).forEach(function (id) {
      var a = armies[id];
      if (!a || a.embarked || canEnter(a.owner, a.prov)) return;
      var home = nearestOwnProvince(a.owner, a.prov);
      a.path = [];
      if (home < 0) S.removeArmy(id); else { S.moveArmy(a, home); merge(home, a.owner); }
    });
  }

  function nearestOwnProvince(cc, from) {
    var own = S.controlledBy(cc).filter(function (id) { return G().provinces[id].owner === cc; });
    var best = -1, bd = Infinity;
    own.forEach(function (id) { var d = S.dist(from, id); if (d < bd) { bd = d; best = id; } });
    return best;
  }

  function warScore(war) { return D().warScore(war); }

  return {
    MOVE_POINTS: MOVE_POINTS,
    canEnter: canEnter, isHostileTerritory: isHostileTerritory, moveCost: moveCost, hostileArmies: hostileArmies,
    findPath: findPath, findPathFor: findPathFor, estimateTurns: estimateTurns,
    order: order, split: split, splitForOrder: splitForOrder, cancel: cancel, merge: merge, mergeIfIdle: mergeIfIdle, mergeAll: mergeAll, disband: disband, MIN_ARMY: MIN_ARMY, MIN_REMAINDER: MIN_REMAINDER,
    power: power, invalidatePower: invalidatePower, battle: battle, retreat: retreat, engageAt: engageAt,
    moveAll: moveAll, stepArmy: stepArmy, resetMoves: resetMoves, applyAttrition: applyAttrition, engagedFraction: engagedFraction,
    resolveOccupations: resolveOccupations, occupy: occupy, expelTrespassers: expelTrespassers,
    nearestOwnProvince: nearestOwnProvince, isSafeFor: isSafeFor, warScore: warScore
  };
})();

if (typeof module !== 'undefined') module.exports = WT.military;
