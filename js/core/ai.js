var WT = (typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (global.WT = global.WT || {}));

/* WT.ai — decyzje państw komputerowych: ekonomia, rekrutacja, dyplomacja, ruchy armii i flot. */
WT.ai = (function () {
  var U = WT.util, S = WT.state;
  var E = function () { return WT.economy; }, D = function () { return WT.diplomacy; };
  var Mil = function () { return WT.military; }, N = function () { return WT.naval; };

  var WAR_CHANCE = 0.003;            // na turę na kandydata
  var WAR_CHECK_EVERY = 4;
  var WAR_POWER_RATIO = 1.6;
  var WAR_COOLDOWN = 30;
  var PLAYER_GRACE_TURNS = 8;
  var REINFORCE_FREEZE_SHARE = 0.05;    // udział rekrutów w armii, od którego armia AI w wojnie traci ruch w turze uzupełnień

  function G() { return WT.G; }
  function turn() { return G().turn; }
  function staggered(i, every) { return (turn() + i) % every === 0; }

  // =====================================================================
  // Główna pętla
  // =====================================================================

  function runAll() {
    var ctx = buildContext();
    driftRelations(ctx);
    ctx.order.forEach(function (cc, i) {
      if (!S.country(cc).alive) return;
      manageEconomy(cc, i);
      manageRecruitment(cc, ctx, i);
      manageDiplomacy(cc, ctx, i);
      if (staggered(i, AID_CHECK_EVERY)) manageAid(cc, ctx);
      manageArmies(cc, ctx, i);
      manageFleets(cc, ctx, i);
    });
  }

  function buildContext() {
    Mil().invalidatePower();
    var alive = S.countriesAlive();
    var ai = alive.filter(function (cc) { return cc !== G().player; }).sort();
    return {
      alive: alive,
      order: U.shuffle(ai.slice()),
      index: indexOf(ai),
      soldiers: soldiersByCountry(),
      neighbors: {},
      newWars: 0,
      maxNewWars: 1 + Math.floor(turn() / 40),
      aiWars: G().wars.filter(function (w) { return w.attackers[0] !== G().player; }).length,
      maxAiWars: Math.min(14, 3 + Math.floor(turn() / 12))
    };
  }

  function indexOf(list) { var m = {}; list.forEach(function (cc, i) { m[cc] = i; }); return m; }

  function soldiersByCountry() {
    var map = {}, armies = G().armies;
    for (var id in armies) map[armies[id].owner] = (map[armies[id].owner] || 0) + armies[id].size;
    return map;
  }

  function neighborsOf(ctx, cc) {
    if (!ctx.neighbors[cc]) ctx.neighbors[cc] = S.countryNeighbors(cc);
    return ctx.neighbors[cc];
  }

  // =====================================================================
  // Relacje: incydenty graniczne, wrogość w czasie wojny, powolne wygaszanie
  // =====================================================================

  function driftRelations(ctx) {
    for (var k = 0; k < 3; k++) borderIncident(ctx);
    G().wars.forEach(function (w) {
      w.attackers.forEach(function (a) { w.defenders.forEach(function (d) { D().changeRel(a, d, -1); }); });
    });
    if (turn() % 10 === 0) decayRelations();
  }

  function borderIncident(ctx) {
    var a = U.pick(ctx.alive);
    var b = a && U.pick(neighborsOf(ctx, a));
    if (b) D().changeRel(a, b, U.randInt(-12, 8));
  }

  function decayRelations() {
    var rel = G().rel;
    Object.keys(rel).forEach(function (k) {
      if (rel[k] > 40) rel[k]--;
      else if (rel[k] < -60) rel[k]++;
    });
  }

  // =====================================================================
  // Ekonomia
  // =====================================================================

  function manageEconomy(cc, i) {
    var c = S.country(cc), bal = E().balance(cc);
    adjustTax(c, bal);
    if (staggered(i, 3)) maybeBuild(cc, c);
  }

  function adjustTax(c, bal) {
    if ((bal < 0 || c.treasury < 0) && c.taxRate < 0.3) E().setTax(c.cc, c.taxRate + 0.01);
    else if (bal > 0 && c.stability < 50 && c.taxRate > 0.12) E().setTax(c.cc, c.taxRate - 0.01);
    else if (bal > 0 && c.treasury > E().countryGdp(c.cc) * 0.1 && c.taxRate > 0.15) E().setTax(c.cc, c.taxRate - 0.01);
  }

  function reserveFor(c) { return Math.max(1, 8 * Math.max(0.05, c.lastExpense)); }

  function maybeBuild(cc, c) {
    var choice = D().enemiesOf(cc).length ? chooseWarBuilding(cc, c) : chooseEconomyBuilding(cc, c);
    if (!choice) return;
    var cost = E().buildCost(cc, choice.prov, choice.type);
    if (c.treasury - cost > reserveFor(c)) E().build(cc, choice.prov, choice.type);
  }

  function chooseWarBuilding(cc, c) {
    var cap = c.capital;
    if (cap >= 0 && E().canBuild(cc, cap, 'fort').ok && G().provinces[cap].buildings.fort < 2) return { prov: cap, type: 'fort' };
    return null;
  }

  function chooseEconomyBuilding(cc, c) {
    var best = -1, bestGdp = 0;
    S.provincesOf(cc).forEach(function (id) {
      var p = G().provinces[id];
      if (p.build || p.ctrl !== cc || p.buildings.factory >= 5) return;
      var g = E().provGdp(id) / (1 + p.buildings.factory);
      if (g > bestGdp) { bestGdp = g; best = id; }
    });
    if (best < 0) return null;
    if (c.capital >= 0 && G().provinces[c.capital].buildings.barracks < 1 && !G().provinces[c.capital].build && U.chance(0.2)) return { prov: c.capital, type: 'barracks' };
    return { prov: best, type: 'factory' };
  }

  // =====================================================================
  // Rekrutacja
  // =====================================================================

  function manageRecruitment(cc, ctx, i) {
    var c = S.country(cc), atWar = D().enemiesOf(cc).length > 0;
    if (!atWar && !staggered(i, 4)) return;
    var target = Math.max(5000, c.baseArmy * (atWar ? 1.5 : 1));
    var deficitK = (target - (ctx.soldiers[cc] || 0)) / 1000;
    if (deficitK < 2) return;
    var site = recruitSite(cc, c, atWar);
    if (site < 0) return;
    var k = Math.floor(Math.min(deficitK, c.manpower, affordableK(cc, c, site, atWar)));
    if (k < 2) return;
    var army = E().recruit(cc, site, k);
    if (!army) return;
    ctx.soldiers[cc] = (ctx.soldiers[cc] || 0) + k * 1000;
    // Balans AI: w wojnie armia przyjmująca uzupełnienia (stoi w miejscu rekrutacji) reorganizuje się przez turę.
    // Gracz nie ma tej kary — u niego rekruci dołączają, a armia zachowuje ruch.
    if (atWar && k * 1000 >= REINFORCE_FREEZE_SHARE * army.size) army.moved = Math.max(army.moved, Mil().MOVE_POINTS);
  }

  function affordableK(cc, c, site, atWar) {
    var perK = E().recruitCost(cc, site, 1);
    var byCash = (c.treasury - reserveFor(c)) / Math.max(0.0001, perK);
    var upkeepK = 0.0012 * E().costScale(cc);
    var bal = c.lastIncome - c.lastExpense;
    var budget = atWar ? bal + Math.max(0, c.treasury) / 20 : bal * 0.6;   // w wojnie dopuszczalny deficyt
    var byUpkeep = Math.max(0, budget) / upkeepK;
    return Math.max(0, Math.min(byCash, byUpkeep));
  }

  function recruitSite(cc, c, atWar) {
    var ok = function (id) { return id >= 0 && E().canRecruit(cc, id, 1).ok; };
    if (atWar) {
      var front = frontierProvinces(cc).filter(ok);
      if (front.length) return front.reduce(function (b, id) { return (S.provStatic(id).pop || 0) > (S.provStatic(b).pop || 0) ? id : b; });
    }
    if (ok(c.capital)) return c.capital;
    var own = S.provincesOf(cc).filter(ok);
    return own.length ? own[0] : -1;
  }

  // =====================================================================
  // Dyplomacja: pokój, sojusze, nowe wojny
  // =====================================================================

  function manageDiplomacy(cc, ctx, i) {
    D().warsOf(cc).forEach(function (w) { handlePeace(cc, w); });
    if (staggered(i, 5)) seekAlliance(cc, ctx);
    if (staggered(i, WAR_CHECK_EVERY)) considerWar(cc, ctx);
    if (staggered(i, 10)) maybeOfferPactToPlayer(cc, ctx);
  }

  /** Państwo bojące się silniejszego sąsiada-gracza proponuje mu pakt o nieagresji. */
  function maybeOfferPactToPlayer(cc, ctx) {
    var player = G().player, c = S.country(cc);
    if (!S.country(player) || !S.country(player).alive || turn() - c.ai.lastProposal < 20) return;
    if (neighborsOf(ctx, cc).indexOf(player) < 0 || D().hasPact(cc, player) || D().atWar(cc, player) || D().allied(cc, player)) return;
    var rel = D().relation(cc, player);
    if (rel < -20 || rel > 40 || Mil().power(player) < 1.5 * Mil().power(cc)) return;
    if (D().addProposal(cc, player, 'pact', {})) c.ai.lastProposal = turn();
  }

  function enemyLeader(war, cc) {
    var side = D().sideOf(war, cc);
    return war[side === 'attackers' ? 'defenders' : 'attackers'][0];
  }

  function handlePeace(cc, war) {
    var partner = enemyLeader(war, cc);
    if (!partner || !D().atWar(cc, partner)) return;
    D().warScore(war);
    var my = D().scoreOf(war, cc), age = turn() - war.start;
    if (partner === G().player) offerPeaceToPlayer(cc, partner, war, my, age);
    else negotiateWithAi(cc, partner, my, age);
  }

  function negotiateWithAi(cc, partner, my, age) {
    var ex = S.country(cc).warExhaustion;
    if (my >= 40 && age >= 4) D().proposePeace(cc, partner, 'annex');
    else if (my >= 25 && age >= 20) D().proposePeace(cc, partner, 'demand');
    else if ((my <= 10 && age >= 15) || ex >= 60 || age > 52) D().proposePeace(cc, partner, 'white');
  }

  function offerPeaceToPlayer(cc, player, war, my, age) {
    var c = S.country(cc);
    if (turn() - c.ai.lastProposal < 6) return;
    var collapse = D().capitalLost(cc) && D().occupiedShare(cc) > 0.5;
    var p = null;
    if (my >= 45) p = D().addProposal(cc, player, 'peace', { kind: 'annex', winner: cc });
    else if (my <= -50 || collapse) p = D().addProposal(cc, player, 'peace', { kind: 'annex', winner: player });
    else if ((my <= -15 && age >= 10) || c.warExhaustion >= 60) p = D().addProposal(cc, player, 'peace', { kind: 'white', winner: null });
    if (p) c.ai.lastProposal = turn();
  }

  function threatsTo(cc, ctx) {
    var mine = Mil().power(cc);
    var threats = D().enemiesOf(cc);
    neighborsOf(ctx, cc).forEach(function (n) {
      if (threats.indexOf(n) < 0 && D().relation(cc, n) < -30 && Mil().power(n) > 1.2 * mine) threats.push(n);
    });
    return threats;
  }

  var ALLIANCE_GRACE_TURNS = 16;

  function seekAlliance(cc, ctx) {
    var c = S.country(cc);
    if (D().alliesOf(cc).length >= 3 || turn() - c.ai.lastAlliance < 10) return;
    // świat startuje bez sojuszy: w pokoju bloki tworzą się powoli, dopiero po kilku miesiącach
    var atWar = D().enemiesOf(cc).length > 0;
    if (!atWar && (turn() < ALLIANCE_GRACE_TURNS || !U.chance(0.25))) return;
    var threats = threatsTo(cc, ctx);
    if (!threats.length) return;
    var partner = bestAlliancePartner(cc, threats, ctx);
    if (!partner) return;
    c.ai.lastAlliance = turn();
    if (partner === G().player && D().relation(cc, partner) < 60) return;
    D().proposeAlliance(cc, partner);
  }

  function bestAlliancePartner(cc, threats, ctx) {
    var best = null, bestRel = 50;
    ctx.alive.forEach(function (p) {
      if (p === cc || D().allied(cc, p) || D().atWar(cc, p) || threats.indexOf(p) >= 0) return;
      var rel = D().relation(cc, p);
      if (rel <= bestRel) return;
      var shares = threats.some(function (t) { return D().atWar(p, t) || D().relation(p, t) < -20; });
      if (shares) { best = p; bestRel = rel; }
    });
    return best;
  }

  function considerWar(cc, ctx) {
    var c = S.country(cc);
    if (ctx.newWars >= ctx.maxNewWars || ctx.aiWars >= ctx.maxAiWars) return;
    if (D().enemiesOf(cc).length || c.stability < 35 || c.warExhaustion > 20) return;
    if (turn() - c.ai.lastWar < WAR_COOLDOWN) return;
    var target = pickWarTarget(cc, ctx);
    if (!target) return;
    if (D().declareWar(cc, target).ok) {
      ctx.newWars++; ctx.aiWars++;
      c.ai.lastWar = turn();
    }
  }

  function pickWarTarget(cc, ctx) {
    var mine = Mil().power(cc), nbs = neighborsOf(ctx, cc);
    for (var i = 0; i < nbs.length; i++) {
      var t = nbs[i], rel = D().relation(cc, t);
      if (rel > -25 || !S.country(t).alive || D().checkDeclareWar(cc, t)) continue;
      if (t === G().player && turn() < PLAYER_GRACE_TURNS) continue;
      if (mine < WAR_POWER_RATIO * coalitionPower(t, cc)) continue;
      var p = WAR_CHANCE * WAR_CHECK_EVERY * (1 + (-rel - 25) / 50) * (1 + turn() / 150);
      if (U.chance(p)) return t;
    }
    return null;
  }

  /** Siła celu wraz z sojusznikami, którzy zapewne przyjdą mu z pomocą. */
  function coalitionPower(target, attacker) {
    return D().alliesOf(target).reduce(function (s, a) {
      return a !== attacker && D().relation(a, target) > 30 ? s + Mil().power(a) : s;
    }, Mil().power(target));
  }

  // =====================================================================
  // Wsparcie: bogate AI czasem finansuje przegrywającego przyjaciela/sojusznika walczącego z jego rywalem
  // =====================================================================

  var AID_CHECK_EVERY = 8, AID_COOLDOWN = 16, AID_CHANCE = 0.35;

  function manageAid(cc, ctx) {
    var c = S.country(cc);
    if (turn() - (c.ai.lastAid != null ? c.ai.lastAid : -99) < AID_COOLDOWN) return;
    if (D().enemiesOf(cc).length || c.lastIncome - c.lastExpense <= 0) return;
    var gdp = E().countryGdp(cc);
    var surplus = c.treasury - Math.max(1.5 * reserveFor(c), gdp * 0.015);   // ponad ~12 tygodni wydatków
    if (surplus < 2) return;
    var r = pickAidRecipient(cc, ctx);
    if (!r || !U.chance(AID_CHANCE)) return;
    var amount = U.round(Math.min(surplus * 0.2, E().countryGdp(r) * 0.03, gdp * 0.005 + 2), 1);
    if (amount >= 1 && D().giveMoney(cc, r, amount).ok) c.ai.lastAid = turn();
  }

  /** Przyjaciel (relacja ≥ 50) lub sojusznik, który przegrywa (wynik ≤ −15) wojnę z rywalem darczyńcy. */
  function pickAidRecipient(cc, ctx) {
    var best = null, bestScore = 0;
    for (var k = 0; k < G().wars.length; k++) {
      var w = G().wars[k];
      if (D().sideOf(w, cc)) continue;
      [w.attackers, w.defenders].forEach(function (side, si) {
        var foes = si === 0 ? w.defenders : w.attackers;
        if (!foes.some(function (e) { return D().relation(cc, e) < -30 && !D().allied(cc, e); })) return;
        side.forEach(function (r) {
          if (r === cc || !S.country(r).alive || D().atWar(cc, r)) return;
          var rel = D().relation(cc, r);
          if (rel < 50 && !D().allied(cc, r)) return;
          var score = -(w.score[r] || 0);
          if (score >= 15 && score + rel / 10 > bestScore) { best = r; bestScore = score + rel / 10; }
        });
      });
    }
    return best;
  }

  // =====================================================================
  // Armie
  // =====================================================================

  function manageArmies(cc, ctx, i) {
    mergeStacks(cc);
    if (!D().enemiesOf(cc).length) { if (staggered(i, 5)) returnHome(cc); return; }
    var plan = buildFrontPlan(cc);
    S.armiesOf(cc).forEach(function (a) {
      if (a.path.length || a.embarked || a.moved >= Mil().MOVE_POINTS) return;
      if (Mil().isHostileTerritory(cc, a.prov)) return;          // trwa oblężenie
      var mover = detachFromCapitalGarrison(a, ctx.soldiers[cc] || 0);
      if (!mover) return;
      if (plan.frontier[mover.prov]) attackFromFrontier(mover, plan);
      else advanceToFront(mover, plan);
    });
  }

  /** Stolica w czasie wojny zatrzymuje garnizon = 25% całej armii kraju; nadwyżka rusza na front. */
  function detachFromCapitalGarrison(army, totalSoldiers) {
    if (army.prov !== S.country(army.owner).capital) return army;
    var garrison = Math.max(10000, Math.round(totalSoldiers * 0.25));
    var surplus = army.size - garrison;
    return surplus >= 5000 ? Mil().split(army, surplus) : null;
  }

  function mergeStacks(cc) {
    var seen = {};
    S.armiesOf(cc).forEach(function (a) {
      if (a.embarked || a.path.length || seen[a.prov]) return;
      seen[a.prov] = true;
      Mil().merge(a.prov, cc);
    });
  }

  function returnHome(cc) {
    var cap = S.country(cc).capital;
    S.armiesOf(cc).forEach(function (a) {
      if (a.embarked || a.path.length || G().provinces[a.prov].owner === cc || cap < 0) return;
      var path = Mil().findPath(a, cap);
      if (path) a.path = path;
    });
  }

  /** Cele ataku sąsiadujące z prowincją: kontrolowane przez wroga lub z wrogimi armiami. */
  function targetsAround(cc, provId) {
    return S.landNeighbors(provId).filter(function (n) {
      return Mil().canEnter(cc, n) && (Mil().isHostileTerritory(cc, n) || Mil().hostileArmies(cc, n).length > 0);
    });
  }

  function isFriendlyControlled(cc, provId) {
    var ctrl = G().provinces[provId].ctrl;
    return ctrl === cc || D().friendly(cc, ctrl);
  }

  function frontierProvinces(cc) {
    return S.controlledBy(cc).filter(function (id) { return targetsAround(cc, id).length > 0; });
  }

  /** Front + BFS po własnym terytorium: next[p] = kolejny krok w stronę najbliższego frontu. */
  function buildFrontPlan(cc) {
    var frontier = {}, next = {}, queue = frontierProvinces(cc);
    queue.forEach(function (id) { frontier[id] = true; next[id] = -1; });
    for (var qi = 0; qi < queue.length; qi++) {
      var cur = queue[qi], nbs = S.landNeighbors(cur);
      for (var j = 0; j < nbs.length; j++) {
        var n = nbs[j];
        if (next[n] !== undefined || !isFriendlyControlled(cc, n) || !Mil().canEnter(cc, n)) continue;
        next[n] = cur;
        queue.push(n);
      }
    }
    return { frontier: frontier, next: next, hasFront: queue.length > 0 && Object.keys(frontier).length > 0 };
  }

  function advanceToFront(army, plan) {
    var path = [], cur = army.prov;
    while (plan.next[cur] !== undefined && plan.next[cur] >= 0 && path.length < 4) {
      cur = plan.next[cur];
      path.push(cur);
    }
    if (path.length) army.path = path;
  }

  function provinceDefense(cc, provId) {
    var def = 0;
    Mil().hostileArmies(cc, provId).forEach(function (a) { def += a.size * S.country(a.owner).tech; });
    var p = G().provinces[provId];
    return def * (1 + 0.25 * p.buildings.fort + ({ hills: 0.15, mountains: 0.35, forest: 0.1, jungle: 0.2 }[S.provStatic(provId).terrain] || 0));
  }

  function targetValue(cc, provId, def) {
    var p = G().provinces[provId], ps = S.provStatic(provId);
    var v = (ps.pop || 0) + 0.5;
    if (p.owner === cc) v *= 2.5;                                        // wyzwolenie własnej ziemi
    var owner = S.country(p.owner);
    if (owner && owner.capital === provId) v *= 3;
    if (def === 0) v *= 2;
    return v * U.randRange(0.8, 1.2);
  }

  /** Słabszy kraj broni się: odbija własne ziemie i bije wrogie armie, ale nie podbija ziem wroga. */
  function isDefensive(cc) {
    var enemies = D().enemiesOf(cc).reduce(function (s, e) { return s + Mil().power(e); }, 0);
    return Mil().power(cc) < 0.8 * enemies;
  }

  function allowedTarget(cc, provId, fromProv, defensive) {
    if (!defensive) return true;
    var isFriendlyLand = function (id) { var o = G().provinces[id].owner; return o === cc || D().friendly(cc, o); };
    if (isFriendlyLand(provId)) return true;
    return isFriendlyLand(fromProv) && Mil().hostileArmies(cc, provId).length > 0;
  }

  function attackFromFrontier(army, plan) {
    var cc = army.owner, myUnit = S.country(cc).tech, defensive = isDefensive(cc);
    var cands = targetsAround(cc, army.prov).filter(function (t) { return allowedTarget(cc, t, army.prov, defensive); }).map(function (t) {
      var def = provinceDefense(cc, t);
      return { prov: t, def: def, need: Math.max(4000, def / myUnit * 1.5), value: targetValue(cc, t, def) };
    }).filter(function (c) { return army.size * myUnit > c.def * 1.25 && army.size * myUnit > counterThreat(cc, c.prov, army.prov) * 0.8; })
      .sort(function (a, b) { return b.value - a.value; });
    if (cands.length) dispatchAttacks(army, cands);
    else consolidateIfThreatened(army);
  }

  /** Największa wroga armia mogąca kontratakować cel (sąsiedzi celu poza prowincją wyjścia). */
  function counterThreat(cc, target, from) {
    return S.landNeighbors(target).reduce(function (m, n) {
      return n === from ? m : Math.max(m, provinceDefense(cc, n));
    }, 0);
  }

  /** Słaba armia na froncie wobec przeważającego wroga dołącza do większej własnej armii obok. */
  function consolidateIfThreatened(army) {
    var cc = army.owner, mine = army.size * S.country(cc).tech;
    var threat = S.landNeighbors(army.prov).reduce(function (m, n) { return Math.max(m, provinceDefense(cc, n)); }, 0);
    if (threat < 1.5 * mine) return;
    var best = null;
    S.landNeighbors(army.prov).forEach(function (n) {
      if (G().provinces[n].ctrl !== cc) return;
      S.armiesIn(n).forEach(function (o) { if (o.owner === cc && o.size > army.size && (!best || o.size > best.size)) best = o; });
    });
    if (best) army.path = [best.prov];
  }

  /** Główna armia atakuje najlepszy cel; przy dużej przewadze wydziela do 2 oddziałów na kolejne cele. */
  function dispatchAttacks(army, cands) {
    for (var k = 0; k < cands.length && k < 3; k++) {
      var c = cands[k], last = k === cands.length - 1 || k === 2;
      if (!last && army.size > 2.5 * c.need) {
        var det = Mil().split(army, c.need);
        if (det) { det.path = [c.prov]; continue; }
      }
      army.path = [c.prov];
      return;
    }
  }

  // =====================================================================
  // Floty i desanty
  // =====================================================================

  function manageFleets(cc, ctx, i) {
    if (!staggered(i, 3) || !D().enemiesOf(cc).length) return;
    var fleets = S.fleetsOf(cc).filter(function (f) { return !f.path.length && !f.cargo.length; });
    if (!fleets.length) return;
    var hasLandFront = frontierProvinces(cc).length > 0;
    if (hasLandFront && !U.chance(0.15)) return;
    var fleet = fleets.reduce(function (b, f) { return f.ships > b.ships ? f : b; });
    var army = invasionArmyAt(cc, fleet.prov);
    if (army) launchInvasion(cc, army, fleet);
    else gatherFleetToArmy(cc, fleet);
  }

  function invasionArmyAt(cc, provId) {
    return S.armiesIn(provId).filter(function (a) { return a.owner === cc && !a.path.length && a.moved < Mil().MOVE_POINTS && a.size >= 5000; })[0] || null;
  }

  function launchInvasion(cc, army, fleet) {
    var target = pickInvasionTarget(cc, army.prov);
    if (!target) return;
    var size = Math.min(N().freeCapacity(fleet), Math.round(army.size * 0.7));
    if (size < 4000 || size < target.def / S.country(cc).tech * 1.6) return;
    N().planInvasion(army.id, target.prov, size);
  }

  function pickInvasionTarget(cc, fromProv) {
    var cands = [];
    D().enemiesOf(cc).forEach(function (e) {
      S.controlledBy(e).forEach(function (id) {
        if (N().isPort(id) && Mil().canEnter(cc, id)) cands.push({ prov: id, d: S.dist(fromProv, id) });
      });
    });
    cands.sort(function (a, b) { return a.d - b.d; });
    for (var k = 0; k < cands.length && k < 6; k++) {
      var path = N().seaPath(fromProv, cands[k].prov);
      if (path && path.length <= 12) return { prov: cands[k].prov, def: provinceDefense(cc, cands[k].prov) };
    }
    return null;
  }

  function gatherFleetToArmy(cc, fleet) {
    var best = null;
    S.armiesOf(cc).forEach(function (a) {
      if (a.embarked || a.path.length || !N().isPort(a.prov) || G().provinces[a.prov].ctrl !== cc) return;
      if (!best || a.size > best.size) best = a;
    });
    if (best && best.prov !== fleet.prov) N().orderFleet(fleet.id, best.prov);
  }

  return { runAll: runAll };
})();

if (typeof module !== 'undefined') module.exports = WT.ai;
