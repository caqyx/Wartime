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
      if (staggered(i, AIR_CHECK_EVERY)) manageAir(cc);
      if (staggered(i, RESEARCH_CHECK_EVERY)) manageResearch(cc);
      if (staggered(i, COURT_CHECK_EVERY)) courtPlayer(cc, ctx);
      if (staggered(i, TRADE_CHECK_EVERY)) seekTrade(cc, ctx);
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
      maxNewWars: aggr() <= 0 ? 0 : Math.max(1, Math.round((1 + Math.floor(turn() / 40)) * aggr())),
      aiWars: G().wars.filter(function (w) { return w.attackers[0] !== G().player; }).length,
      maxAiWars: Math.round(Math.min(14, 3 + Math.floor(turn() / 12)) * Math.max(0.2, aggr())),
      playerOffers: 0, playerGifts: 0
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
      if ((p.builds && p.builds.factory) || p.ctrl !== cc || p.buildings.factory >= 5) return;
      var g = E().provGdp(id) / (1 + p.buildings.factory);
      if (g > bestGdp) { bestGdp = g; best = id; }
    });
    if (best < 0) return null;
    if (c.capital >= 0 && (G().provinces[c.capital].buildings.university || 0) < 2 && !(G().provinces[c.capital].builds || {}).university && U.chance(0.15)) return { prov: c.capital, type: 'university' };
    if (c.capital >= 0 && G().provinces[c.capital].buildings.barracks < 1 && !(G().provinces[c.capital].builds || {}).barracks && U.chance(0.2)) return { prov: c.capital, type: 'barracks' };
    return { prov: best, type: 'factory' };
  }

  // =====================================================================
  // Lotnictwo: obrona przed bombowcami wroga, budowa bombowców, naloty na najbogatsze prowincje
  // =====================================================================

  var AIR_CHECK_EVERY = 2, AIR_MIN_GDP = 150, AIR_GDP_PER_PLANE = 250, AIR_MAX_PLANES = 40;

  function manageAir(cc) {
    var enemies = D().enemiesOf(cc);
    if (!enemies.length || !WT.air) return;
    var c = S.country(cc);
    defendAgainstBombers(cc, c, enemies);
    var gdp = E().countryGdp(cc);
    if (gdp < AIR_MIN_GDP) return;
    buildAirForce(cc, c, gdp);
    WT.air.squadronsOf(cc).forEach(function (sq) { if (sq.phase === 'idle' && sq.planes >= 2) launchRaid(sq, enemies); });
  }

  function defendAgainstBombers(cc, c, enemies) {
    var threat = enemies.some(function (e) { return WT.air.planesOf(e) > 0; });
    var cap = c.capital;
    if (!threat || cap < 0 || G().provinces[cap].ctrl !== cc) return;
    var b = G().provinces[cap].buildings;
    var type = (b.aa || 0) < 2 ? 'aa' : (b.radar || 0) < 1 ? 'radar' : (b.aa || 0) < 4 ? 'aa' : null;
    if (!type || !E().canBuild(cc, cap, type).ok) return;
    if (c.treasury - E().buildCost(cc, cap, type) > reserveFor(c)) E().build(cc, cap, type);
  }

  function buildAirForce(cc, c, gdp) {
    var target = Math.min(AIR_MAX_PLANES, Math.floor(gdp / AIR_GDP_PER_PLANE)), have = WT.air.planesOf(cc);
    var cap = c.capital;
    if (have >= target || cap < 0 || G().provinces[cap].ctrl !== cc) return;
    var n = Math.min(5, target - have);
    if (c.treasury - WT.air.planeCost(cc, n) > 2 * reserveFor(c)) WT.air.buildBombers(cc, cap, n);
  }

  /** Cel: wroga prowincja w zasięgu o największym PKB, z uwzględnieniem jej działek. */
  function launchRaid(sq, enemies) {
    var best = -1, bestScore = 0;
    enemies.forEach(function (e) {
      S.controlledBy(e).forEach(function (id) {
        if (S.dist(sq.base, id) > WT.air.rangeKm(sq.owner)) return;
        var aa = G().provinces[id].buildings.aa || 0;
        var score = E().provGdp(id) * (1 - Math.min(WT.air.MAX_INTERCEPT, 1 - Math.pow(0.88, aa)));
        if (score > bestScore) { bestScore = score; best = id; }
      });
    });
    if (best >= 0) WT.air.orderRaid(sq.id, best, false);
  }

  // =====================================================================
  // Nauka: budżet badań i wybór technologii
  // =====================================================================

  var RESEARCH_CHECK_EVERY = 4;

  function manageResearch(cc) {
    if (!WT.tech) return;
    var c = WT.tech.ensure(S.country(cc)), atWar = D().enemiesOf(cc).length > 0;
    var rate = E().balance(cc) < 0 ? 0.02 : atWar ? 0.04 : E().gdpPerCapita(cc) > 20000 ? 0.08 : 0.05;
    if (Math.abs(rate - c.researchRate) > 0.001) WT.tech.setRate(cc, rate);
    var next = WT.tech.nextFor(cc, atWar);
    if (next && c.rp >= next.cost) WT.tech.research(cc, next.id);
  }

  // =====================================================================
  // Dyplomacja wobec gracza: propozycje (sojusz, handel, pakt, prośba o pomoc) i prezenty
  // =====================================================================

  var COURT_CHECK_EVERY = 3, COURT_START_TURN = 3;
  var OFFER_COOLDOWN = 30, GIFT_COOLDOWN = 26;   // tury między ofertami / prezentami jednego państwa
  var PLAYER_OFFER_GAP = 4;                       // min. tury między dowolnymi dwiema ofertami dla gracza
  var TRADE_CHECK_EVERY = 10, MAX_AI_TRADES = 4;

  function courtPlayer(cc, ctx) {
    var me = G().player;
    if (!me || cc === me || !S.country(me) || !S.country(me).alive || turn() < COURT_START_TURN) return;
    if (D().atWar(cc, me)) return;
    var c = S.country(cc), rel = D().relation(cc, me);
    var gapOk = turn() - (G().lastPlayerOffer != null ? G().lastPlayerOffer : -99) >= PLAYER_OFFER_GAP;
    if (gapOk && ctx.playerOffers < 1 && turn() - (c.ai.lastOffer || -99) >= OFFER_COOLDOWN) {
      var offer = pickOffer(cc, me, rel);
      if (offer && D().addProposal(cc, me, offer.type, offer.terms)) { c.ai.lastOffer = turn(); G().lastPlayerOffer = turn(); ctx.playerOffers++; }
    }
    if (ctx.playerGifts < 1 && turn() - (c.ai.lastGift || -99) >= GIFT_COOLDOWN && wantsFavor(cc, me, rel)) {
      var amount = giftAmount(cc, c);
      if (amount > 0 && D().giveMoney(cc, me, amount).ok) { c.ai.lastGift = turn(); ctx.playerGifts++; }
    }
  }

  /** Najpilniejsza oferta dla gracza (albo null): prośba o pomoc > sojusz > handel > pakt. */
  function pickOffer(cc, me, rel) {
    var losing = losingWarAgainst(cc, me);
    if (losing && rel >= 25 && U.chance(0.5)) {
      return { type: 'aidRequest', terms: { enemy: losing, amount: U.round(Math.min(25, 1 + E().countryGdp(cc) * 0.006), 1) } };
    }
    if (!D().allied(cc, me) && rel >= 50 && D().alliesOf(cc).length < D().MAX_ALLIANCES && wantsAlliance(cc, me, rel) && U.chance(0.4)) {
      return { type: 'alliance', terms: {} };
    }
    if (!D().hasTrade(cc, me) && rel >= 20 && U.chance(0.35)) return { type: 'trade', terms: {} };
    var neighbors = S.countryNeighbors(cc).indexOf(me) >= 0;
    if (neighbors && !S.settings().autoRejectPacts && !D().hasPact(cc, me) && rel >= -15 && rel < 45 && Mil().power(me) > Mil().power(cc) && U.chance(0.3)) {
      return { type: 'pact', terms: {} };
    }
    return null;
  }

  /** Wróg, z którym cc przegrywa wojnę (wynik ≤ −15), o ile gracz nie jest po jego stronie. */
  function losingWarAgainst(cc, me) {
    var found = null;
    D().warsOf(cc).forEach(function (w) {
      if (found) return;
      var side = D().sideOf(w, cc), enemies = side === 'attackers' ? w.defenders : w.attackers;
      if (enemies.indexOf(me) >= 0 || D().scoreOf(w, cc) > -15) return;
      found = enemies[0];
    });
    return found;
  }

  function wantsAlliance(cc, me, rel) {
    if (rel >= 80 || D().commonEnemyOrThreat(cc, me)) return true;
    return D().enemiesOf(cc).length > 0 && Mil().power(me) > 0.5 * Mil().power(cc);
  }

  /** Prezent „na dobre relacje”: państwo zależy na graczu (sąsiad, wspólny wróg, silny partner). */
  function wantsFavor(cc, me, rel) {
    if (rel < 10 || rel >= 75) return false;
    return S.countryNeighbors(cc).indexOf(me) >= 0 || D().commonEnemyOrThreat(cc, me) || Mil().power(me) > 1.5 * Mil().power(cc);
  }

  function giftAmount(cc, c) {
    var amount = U.round(U.clamp(E().countryGdp(cc) * 0.002, 0.5, 15), 1);
    return c.treasury - amount > 3 * reserveFor(c) ? amount : 0;
  }

  /** Umowy handlowe między państwami AI (przyjaciele i sąsiedzi o dobrych relacjach). */
  function seekTrade(cc) {
    if (D().tradesOf(cc).length >= MAX_AI_TRADES || D().enemiesOf(cc).length) return;
    var partner = S.countryNeighbors(cc).filter(function (o) {
      return o !== G().player && !D().hasTrade(cc, o) && D().relation(cc, o) >= 30 && D().tradesOf(o).length < MAX_AI_TRADES;
    })[0];
    if (partner) D().proposeTrade(cc, partner);
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
    if (my >= 40 && age >= 4 && proposeAiTreaty(cc, partner)) return;
    if (my >= 40 && age >= 4) D().proposePeace(cc, partner, 'annex');
    else if (my >= 25 && age >= 20) D().proposePeace(cc, partner, 'demand');
    else if ((my <= 10 && age >= 15) || ex >= 60 || age > 52) D().proposePeace(cc, partner, 'white');
  }

  /**
   * Zwycięskie AI układa traktat jak gracz: okupowane prowincje (od najcenniejszych), przy upadku wroga
   * (utracona stolica, >50% ziem) wasalizacja, za resztę punktów reparacje/kontrybucja.
   */
  function proposeAiTreaty(cc, partner) {
    var V = WT.vassal;
    if (!V || partner === G().player) return false;
    var pts = V.warPoints(cc, partner), limit = V.acceptLimit(cc, partner);
    if (pts.total <= 0) return false;
    var terms = { provinces: [] }, budget = limit;
    var collapse = D().capitalLost(partner) && D().occupiedShare(partner) > 0.5;
    var keep = S.provincesOf(partner).length;
    if (collapse && keep > 1 && U.chance(0.6)) {
      // wasal: zostawia mu większość ziem, bierze tylko to, na co starczy punktów po wasalizacji
      var vc = V.vassalCost(partner, []);
      if (vc <= budget) { terms.vassal = true; budget -= vc; }
    }
    pts.provinces.forEach(function (p) {
      if (keep - terms.provinces.length <= 1) return;
      var extra = terms.vassal ? Math.max(0, V.vassalCost(partner, terms.provinces.concat([p.id])) - V.vassalCost(partner, terms.provinces)) : 0;
      if (p.value + extra <= budget) { terms.provinces.push(p.id); budget -= p.value + extra; }
    });
    if (budget >= V.COST.reparations) { terms.reparations = true; budget -= V.COST.reparations; }
    if (budget >= V.COST.contribution) terms.contribution = true;
    if (!terms.provinces.length && !terms.vassal) return false;
    return V.proposeTreaty(cc, partner, terms).accepted;
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
    var k = aggr(), mine = Mil().power(cc), nbs = neighborsOf(ctx, cc);
    if (k <= 0) return null;
    // agresywność: próg relacji (−25 standard, −5 przy maks.), wymagana przewaga i szansa na wojnę
    var relLimit = -25 + 20 * (k - 1), ratio = WAR_POWER_RATIO / Math.sqrt(Math.max(0.25, k));
    for (var i = 0; i < nbs.length; i++) {
      var t = nbs[i], rel = D().relation(cc, t);
      if (rel > relLimit || !S.country(t).alive || D().checkDeclareWar(cc, t)) continue;
      if (t === G().player && turn() < PLAYER_GRACE_TURNS) continue;
      if (mine < ratio * coalitionPower(t, cc)) continue;
      var p = WAR_CHANCE * WAR_CHECK_EVERY * (1 + (-rel - 25) / 50) * (1 + turn() / 150) * Math.pow(k, 1.5);
      if (U.chance(p)) return t;
    }
    return null;
  }

  function aggr() { return D().aggression(); }

  /**
   * Wskaźnik agresywności państwa wobec `target` (0–100): wrogie relacje, przewaga militarna,
   * niedawne wojny i trwające walki, skalowane ustawieniem agresywności AI.
   */
  function aggressionOf(cc, target) {
    if (!S.country(cc) || !S.country(cc).alive || cc === target) return 0;
    if (D().atWar(cc, target)) return 100;
    var c = S.country(cc), rel = D().relation(cc, target);
    var hostility = U.clamp(50 - rel, 0, 150) / 150 * 50;                       // do 50 pkt za relacje
    var edge = U.clamp(Mil().power(cc) / Math.max(1, Mil().power(target)) / 2, 0, 1) * 20;
    var warlike = (turn() - (c.ai.lastWar != null ? c.ai.lastWar : -99) < 26 ? 15 : 0) + (D().enemiesOf(cc).length ? 10 : 0);
    var regime = c.ideology === 'autorytaryzm' || c.ideology === 'teokracja' ? 5 : 0;
    var neighbor = S.countryNeighbors(cc).indexOf(target) >= 0 ? 1 : 0.7;
    return Math.round(U.clamp((hostility + edge + warlike + regime) * neighbor * (0.5 + 0.5 * aggr()), 0, 99));
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
    manageGunships(cc);
    var fleets = S.fleetsOf(cc).filter(function (f) { return !f.path.length && !f.cargo.length; });
    if (!fleets.length) return;
    var hasLandFront = frontierProvinces(cc).length > 0;
    if (hasLandFront && !U.chance(0.15)) return;
    var fleet = fleets.reduce(function (b, f) { return f.ships > b.ships ? f : b; });
    var army = invasionArmyAt(cc, fleet.prov);
    if (army) launchInvasion(cc, army, fleet);
    else gatherFleetToArmy(cc, fleet);
  }

  // ---------- Okręty artyleryjskie: zakup w stolicy/porcie i ostrzał najbliższej wrogiej prowincji nadmorskiej ----------

  var GUNSHIP_MIN_NAVY = 6, GUNSHIP_TARGET_SHARE = 0.25, GUNSHIP_MAX_HOPS = 8;

  function manageGunships(cc) {
    var c = S.country(cc), navy = S.fleetsOf(cc).reduce(function (s, f) { return s + f.ships; }, 0);
    var guns = S.fleetsOf(cc).reduce(function (s, f) { return s + (f.gunships || 0); }, 0);
    if (navy >= GUNSHIP_MIN_NAVY && guns < navy * GUNSHIP_TARGET_SHARE) buyGunshipsAI(cc, c);
    S.fleetsOf(cc).forEach(function (f) {
      if (!(f.gunships > 0) || f.path.length || f.cargo.length) return;
      if (f.shellTarget != null || (!S.isSea(f.prov) && D().atWar(cc, G().provinces[f.prov].ctrl))) return;   // już ostrzeliwuje
      var target = shellingTarget(cc, f);
      if (target >= 0) N().orderFleet(f.id, target);
    });
  }

  function buyGunshipsAI(cc, c) {
    var port = S.provincesOf(cc).filter(function (id) { return N().canBuyGunships(cc, id, 2).ok; })[0];
    if (port == null) return;
    if (c.treasury - N().gunshipCost(2) > 2 * reserveFor(c)) N().buyGunships(cc, port, 2);
  }

  /** Najbliższa (po morzu) wroga prowincja nadmorska bez silniejszej floty wroga. */
  function shellingTarget(cc, f) {
    var cands = [];
    D().enemiesOf(cc).forEach(function (e) {
      S.controlledBy(e).forEach(function (id) { if (N().isPort(id)) cands.push({ prov: id, d: S.nodeDist(f.prov, id) }); });
    });
    cands.sort(function (a, b) { return a.d - b.d; });
    var mine = f.ships + 1.5 * f.gunships;
    for (var k = 0; k < cands.length && k < 6; k++) {
      var id = cands[k].prov, path = N().seaPath(f.prov, id);
      if (!path || path.length > GUNSHIP_MAX_HOPS) continue;
      var enemyShips = S.fleetsIn(id).filter(function (o) { return D().atWar(o.owner, cc); })
        .reduce(function (s, o) { return s + o.ships + 1.5 * (o.gunships || 0); }, 0);
      if (enemyShips <= mine) return id;
    }
    return -1;
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

  return { runAll: runAll, aggressionOf: aggressionOf };
})();

if (typeof module !== 'undefined') module.exports = WT.ai;
