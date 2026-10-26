var WT = (typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (global.WT = global.WT || {}));

/* WT.air — bombowce (naloty niszczące gospodarkę prowincji), obrona przeciwlotnicza i radar.
 * Dywizjon: { id, owner, base, planes, phase: 'idle'|'out'|'back', target, x, y, repeat, spotted }.
 * Pozycja (x, y) w jednostkach mapy; w locie dywizjon przesuwa się co turę o SPEED_KM po prostej. */
WT.air = (function () {
  var U = WT.util, S = WT.state;
  function D() { return WT.diplomacy; }
  function E() { return WT.economy; }

  var RANGE_KM = 1800;              // zasięg bojowy od bazy do celu
  var SPEED_KM = 1100;              // km na turę (tydzień)
  var PLANE_COST = 0.6;             // mld za bombowiec (× skala kosztów kraju, min. 0.5)
  var PLANE_UPKEEP = 0.012;         // mld/tydz. za bombowiec (× skala kosztów)
  var MAX_BUILD = 50;
  var AA_KILL = 0.12;               // szansa zestrzelenia bombowca przez 1 poziom działek
  var AA_NEIGHBOR_SHARE = 0.5;      // działka w sąsiednich prowincjach obrońcy pomagają w połowie
  var RADAR_AA_BONUS = 1.35;        // cel w zasięgu radaru obrońcy — działka są przygotowane
  var MAX_INTERCEPT = 0.75;         // obrona nigdy nie gwarantuje zestrzelenia wszystkich
  var RADAR_BASE_KM = 350, RADAR_PER_LEVEL_KM = 200;
  var DEV_LOSS_PER_PLANE = 0.012, MAX_DEV_LOSS = 0.3, MIN_DEV = 0.3;
  var BUILDING_HIT = 0.06;          // szansa zniszczenia poziomu budynku na bombowiec, który przeleciał
  var APPROACH_KM = 250;            // pierwsza tura lotu kończy się przed celem — radar obrońcy ma turę na ostrzeżenie
  var DISRUPT_TURNS = 3;            // tyle tur prowincja daje połowę dochodu po nalocie
  var HIT_ORDER = ['factory', 'university', 'port', 'barracks', 'radar', 'aa', 'fort'];

  function G() { return WT.G; }
  function M() { return U.mapData(); }
  function squads() { if (!G().squadrons) G().squadrons = {}; return G().squadrons; }
  function name(cc) { return S.country(cc).name; }
  function isPlayer(cc) { return cc === G().player; }
  function isGodFor(cc) { return !!(WT.god && WT.god.enabled() && isPlayer(cc)); }
  function kmPerUnit() { return M().kmPerUnit || 4; }
  function center(provId) { var p = M().provinces[provId]; return [p.cx, p.cy]; }
  function kmBetween(x1, y1, x2, y2) { var dx = x2 - x1, dy = y2 - y1; return Math.sqrt(dx * dx + dy * dy) * kmPerUnit(); }
  function provName(id) { return S.provStatic(id).name; }

  // =====================================================================
  // Budowa i utrzymanie
  // =====================================================================

  function planeCost(cc, n) { return U.round(n * PLANE_COST * Math.max(0.5, E().costScale(cc)) * E().priceScale() * (WT.tech ? WT.tech.mod(cc, 'planeCost') : 1), 2); }
  function speedKm(cc) { return SPEED_KM * (WT.tech && cc ? WT.tech.mod(cc, 'bomberSpeed') : 1); }

  function canBuildBombers(cc, provId, n) {
    var p = G().provinces[provId];
    if (!S.era('air')) return { ok: false, reason: 'Lotnictwo niedostępne w tej epoce.' };
    if (!(n >= 1)) return { ok: false, reason: 'Podaj liczbę bombowców.' };
    if (n > MAX_BUILD) return { ok: false, reason: 'Maks. ' + MAX_BUILD + ' bombowców naraz.' };
    if (!p || p.owner !== cc || p.ctrl !== cc) return { ok: false, reason: 'Lotnisko musi być we własnej, niekontrolowanej przez wroga prowincji.' };
    var cost = planeCost(cc, n);
    if (!E().canAfford(cc, cost)) return { ok: false, reason: 'Brak środków: potrzeba ' + U.fmtMoney(cost) + '.' };
    return { ok: true, cost: cost, reason: n + ' bombowców za ' + U.fmtMoney(cost) + '.' };
  }

  /** Nowe bombowce dołączają do stojącego w bazie dywizjonu (albo tworzą nowy). */
  function buildBombers(cc, provId, n) {
    n = Math.floor(n);
    var chk = canBuildBombers(cc, provId, n);
    if (!chk.ok) return null;
    E().pay(cc, chk.cost);
    var sq = idleSquadAt(cc, provId);
    if (sq) { sq.planes += n; return sq; }
    return createSquad(cc, provId, n);
  }

  function createSquad(cc, provId, planes) {
    var id = 'b' + (G().nextId++), c = center(provId);
    var sq = { id: id, owner: cc, base: provId, planes: planes, phase: 'idle', target: -1, x: c[0], y: c[1], repeat: false, spotted: false };
    squads()[id] = sq;
    return sq;
  }

  function idleSquadAt(cc, provId) {
    var all = squads();
    for (var id in all) if (all[id].owner === cc && all[id].base === provId && all[id].phase === 'idle') return all[id];
    return null;
  }

  function squadronsOf(cc) { var all = squads(), out = []; for (var id in all) if (all[id].owner === cc) out.push(all[id]); return out; }
  function squadronsAt(provId) { var all = squads(), out = []; for (var id in all) if (all[id].base === provId) out.push(all[id]); return out; }
  function planesOf(cc) { return squadronsOf(cc).reduce(function (s, q) { return s + q.planes; }, 0); }
  function upkeep(cc) { return planesOf(cc) * PLANE_UPKEEP * E().costScale(cc); }

  function disband(id) { if (!squads()[id]) return false; delete squads()[id]; return true; }

  // =====================================================================
  // Rozkazy
  // =====================================================================

  function techMod(cc, key) { return WT.tech && cc ? WT.tech.mod(cc, key) : 1; }
  function techAdd(cc, key) { return WT.tech && cc ? WT.tech.add(cc, key) : 0; }
  /** Zasięg bombowców kraju (technologia „Bombowce strategiczne” +600 km). */
  function rangeKm(cc) { return RANGE_KM + techAdd(cc, 'bomberRange'); }
  /** Tury do zrzutu: pierwsza tura kończy się APPROACH_KM przed celem, uderzenie najwcześniej w drugiej. */
  function flightTurns(fromProv, toProv, cc) {
    var v = speedKm(cc), d = S.dist(fromProv, toProv), first = Math.min(v, Math.max(0, d - APPROACH_KM));
    return 1 + Math.max(1, Math.ceil((d - first) / v));
  }

  function checkRaid(sq, target) {
    if (!sq) return 'Nie ma takiego dywizjonu.';
    if (target == null || target < 0 || !G().provinces[target]) return 'Wybierz prowincję.';
    var ctrl = G().provinces[target].ctrl;
    if (!D().atWar(sq.owner, ctrl)) return 'Bombardować można tylko prowincje państw, z którymi jesteś w wojnie.';
    if (S.dist(sq.base, target) > rangeKm(sq.owner)) return 'Poza zasięgiem: ' + Math.round(S.dist(sq.base, target)) + ' km (maks. ' + rangeKm(sq.owner) + ' km od bazy).';
    if (sq.phase === 'back') return 'Dywizjon wraca do bazy.';
    return null;
  }

  /** Nalot: dywizjon leci do celu (kilka tur, jeśli daleko), bombarduje i wraca. repeat = ponawiaj naloty. */
  function orderRaid(squadId, target, repeat) {
    var sq = squads()[squadId], err = checkRaid(sq, target);
    if (err) return { ok: false, reason: err };
    sq.target = target; sq.phase = 'out'; sq.repeat = !!repeat; sq.spotted = false; sq.airborne = false;
    var t = flightTurns(sq.base, target, sq.owner);
    return { ok: true, turns: t, reason: 'Nalot na ' + provName(target) + ': ' + sq.planes + ' bombowców, dolot ok. ' + t + ' ' + (t === 1 ? 'tura' : 'tury') + '.' };
  }

  function recall(squadId) {
    var sq = squads()[squadId];
    if (!sq || sq.phase === 'idle') return false;
    sq.phase = 'back'; sq.repeat = false;
    return true;
  }

  // =====================================================================
  // Tura: lot, nalot, radar
  // =====================================================================

  function processTurn() {
    var all = squads();
    Object.keys(all).forEach(function (id) {
      var sq = all[id];
      if (!sq || !validateSquad(sq)) return;
      if (sq.phase === 'out') flyOut(sq);
      else if (sq.phase === 'back') flyBack(sq);
    });
    detectWithRadar();
    recoverProvinces();
  }

  /** Baza utracona → przenosiny do najbliższej własnej prowincji; brak prowincji → dywizjon przepada. */
  function validateSquad(sq) {
    if (!S.country(sq.owner) || !S.country(sq.owner).alive) { delete squads()[sq.id]; return false; }
    var bp = G().provinces[sq.base];
    if (bp.ctrl !== sq.owner) {
      var own = S.controlledBy(sq.owner).filter(function (id) { return G().provinces[id].owner === sq.owner; });
      if (!own.length) { delete squads()[sq.id]; return false; }
      sq.base = own.reduce(function (b, id) { return S.dist(id, sq.base) < S.dist(b, sq.base) ? id : b; });
      if (sq.phase === 'idle') { var c = center(sq.base); sq.x = c[0]; sq.y = c[1]; }
    }
    if (sq.phase === 'out' && !D().atWar(sq.owner, G().provinces[sq.target].ctrl)) { sq.phase = 'back'; sq.repeat = false; }
    return true;
  }

  /** Przesuwa (x, y) w stronę punktu o co najwyżej `km`; true = dotarł. */
  function moveToward(sq, tx, ty, km) {
    var d = kmBetween(sq.x, sq.y, tx, ty);
    if (d <= km) { sq.x = tx; sq.y = ty; return true; }
    var f = km / d;
    sq.x += (tx - sq.x) * f; sq.y += (ty - sq.y) * f;
    return false;
  }

  function flyOut(sq) {
    var t = center(sq.target);
    if (!sq.airborne) {   // start: dolot do punktu przed celem, zrzut w następnej turze
      sq.airborne = true;
      moveToward(sq, t[0], t[1], Math.min(speedKm(sq.owner), Math.max(0, kmBetween(sq.x, sq.y, t[0], t[1]) - APPROACH_KM)));
      return;
    }
    if (!moveToward(sq, t[0], t[1], speedKm(sq.owner))) return;
    bombProvince(sq);
    if (squads()[sq.id]) { sq.phase = 'back'; sq.spotted = false; }
  }

  function flyBack(sq) {
    var b = center(sq.base);
    if (!moveToward(sq, b[0], b[1], speedKm(sq.owner))) return;
    sq.phase = 'idle';
    if (sq.repeat && !checkRaid(sq, sq.target)) { sq.phase = 'out'; sq.airborne = false; sq.spotted = false; return; }
    sq.repeat = false; sq.target = -1;
    var twin = idleSquadAt(sq.owner, sq.base);   // scalenie z dywizjonem stojącym w tej samej bazie
    if (twin && twin !== sq) { twin.planes += sq.planes; delete squads()[sq.id]; }
  }

  // ---------- Nalot ----------

  /** Szansa zestrzelenia pojedynczego bombowca nad prowincją (działka celu + sąsiadów, radar). */
  function interceptChance(provId, attacker) {
    var p = G().provinces[provId], defender = p.ctrl;
    var level = p.buildings.aa || 0, help = 0;
    S.landNeighbors(provId).forEach(function (n) {
      var q = G().provinces[n];
      if (q.ctrl === defender || D().friendly(q.ctrl, defender)) help = Math.max(help, q.buildings.aa || 0);
    });
    level += AA_NEIGHBOR_SHARE * help;
    if (radarCovers(defender, center(provId)[0], center(provId)[1])) level *= RADAR_AA_BONUS;
    var kill = Math.min(0.9, AA_KILL * techMod(defender, 'aaKill'));
    var chance = Math.min(MAX_INTERCEPT + techAdd(defender, 'aaCap'), 1 - Math.pow(1 - kill, level));
    return chance * techMod(attacker, 'stealth');
  }

  function bombProvince(sq) {
    var provId = sq.target, p = G().provinces[provId], defender = p.ctrl;
    var chance = interceptChance(provId, sq.owner), shot = 0;
    for (var i = 0; i < sq.planes; i++) if (U.chance(chance)) shot++;
    var hits = sq.planes - shot;
    sq.planes = hits;
    var damage = applyDamage(provId, hits, techMod(sq.owner, 'bombDamage') * techMod(defender, 'bombResist'));
    var report = { attacker: sq.owner, defender: defender, prov: provId, planes: hits + shot, shot: shot, hits: hits, devLoss: damage.devLoss, destroyed: damage.destroyed };
    logRaid(report);
    WT.events.emit('bombing', report);
    if (!hits) delete squads()[sq.id];
    return report;
  }

  function applyDamage(provId, hits, power) {
    power = power || 1;
    var p = G().provinces[provId], res = { devLoss: 0, destroyed: [] };
    if (!hits) return res;
    var before = p.dev;
    p.dev = Math.max(MIN_DEV, p.dev - Math.min(MAX_DEV_LOSS * power, hits * DEV_LOSS_PER_PLANE * power));
    res.devLoss = U.round(before - p.dev, 3);
    p.bombed = Math.max(p.bombed || 0, DISRUPT_TURNS);
    for (var i = 0; i < hits; i++) {
      if (!U.chance(BUILDING_HIT * power)) continue;
      var type = HIT_ORDER.filter(function (t) { return (p.buildings[t] || 0) > 0; })[0];
      if (!type) break;
      p.buildings[type]--;
      res.destroyed.push(type);
    }
    return res;
  }

  function logRaid(r) {
    if (!S.involvesPlayer(r.attacker, r.defender)) return;
    var B = E().BUILDINGS, lost = r.destroyed.map(function (t) { return B[t].name; }).join(', ');
    S.addLog('Nalot: ' + name(r.attacker) + ' bombarduje ' + provName(r.prov) + ' (' + name(r.defender) + '). ' +
      'Zestrzelono ' + r.shot + ' z ' + r.planes + ' bombowców; rozwój -' + r.devLoss.toFixed(2) +
      (lost ? '; zniszczono: ' + lost : '') + '.', isPlayer(r.attacker) ? r.attacker : r.defender);
  }

  /** Po nalocie prowincja przez kilka tur daje połowę dochodu (licznik `bombed`). */
  function recoverProvinces() {
    G().provinces.forEach(function (p) { if (p.bombed > 0) p.bombed--; });
  }

  // ---------- Radar ----------

  function radarRangeKm(level, cc) { return level > 0 ? Math.round((RADAR_BASE_KM + RADAR_PER_LEVEL_KM * (level - 1)) * techMod(cc, 'radarRange')) : 0; }

  /** Stacje radarowe kraju (i jego sojuszników): [{ x, y, km }]. */
  function radarStations(cc) {
    var out = [];
    G().provinces.forEach(function (p, id) {
      var lvl = p.buildings.radar || 0;
      if (!lvl || !(p.ctrl === cc || D().allied(p.ctrl, cc))) return;
      var c = center(id);
      out.push({ prov: id, x: c[0], y: c[1], km: radarRangeKm(lvl, p.ctrl) });
    });
    return out;
  }

  function radarCovers(cc, x, y, stations) {
    stations = stations || radarStations(cc);
    for (var i = 0; i < stations.length; i++) if (kmBetween(stations[i].x, stations[i].y, x, y) <= stations[i].km) return true;
    return false;
  }

  function inFlight(sq) { return sq.phase === 'out' || sq.phase === 'back'; }

  /** Dywizjony widoczne dla kraju: własne zawsze, cudze lecące — tylko w zasięgu jego radarów. */
  function visibleFor(cc) {
    var stations = radarStations(cc), out = [];
    var all = squads();
    for (var id in all) {
      var sq = all[id];
      if (sq.owner === cc) out.push(sq);
      else if (inFlight(sq) && D().atWar(sq.owner, cc) && radarCovers(cc, sq.x, sq.y, stations)) out.push(sq);
    }
    return out;
  }

  /** Raport radaru dla gracza: pierwsze wykrycie wrogiego dywizjonu w danym locie. */
  function detectWithRadar() {
    var me = G().player;
    if (!me || !S.country(me) || !S.country(me).alive) return;
    var stations = radarStations(me);
    if (!stations.length) return;
    var all = squads();
    for (var id in all) {
      var sq = all[id];
      if (sq.owner === me || sq.phase !== 'out' || sq.spotted || !D().atWar(sq.owner, me)) continue;
      if (!radarCovers(me, sq.x, sq.y, stations)) continue;
      sq.spotted = true;
      var report = { attacker: sq.owner, planes: sq.planes, target: sq.target, turns: Math.max(1, Math.ceil(kmBetween(sq.x, sq.y, center(sq.target)[0], center(sq.target)[1]) / speedKm(sq.owner))) };
      S.addLog('Radar: wykryto ' + sq.planes + ' bombowców (' + name(sq.owner) + ') lecących na ' + provName(sq.target) + '.', me);
      WT.events.emit('radar', report);
    }
  }

  return {
    RANGE_KM: RANGE_KM, SPEED_KM: SPEED_KM, MAX_BUILD: MAX_BUILD, MAX_INTERCEPT: MAX_INTERCEPT,
    planeCost: planeCost, canBuildBombers: canBuildBombers, buildBombers: buildBombers,
    squadronsOf: squadronsOf, squadronsAt: squadronsAt, planesOf: planesOf, upkeep: upkeep, disband: disband,
    rangeKm: rangeKm, speedKm: speedKm, flightTurns: flightTurns, checkRaid: checkRaid, orderRaid: orderRaid, recall: recall,
    processTurn: processTurn, interceptChance: interceptChance, bombProvince: bombProvince,
    radarRangeKm: radarRangeKm, radarStations: radarStations, radarCovers: radarCovers, visibleFor: visibleFor
  };
})();

if (typeof module !== 'undefined') module.exports = WT.air;
