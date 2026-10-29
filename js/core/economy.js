var WT = (typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (global.WT = global.WT || {}));

/* WT.economy — dochody, wydatki, budynki, rekrutacja, okręty, bankructwo. Kwoty w mld USD, 1 tura = 1 tydzień. */
WT.economy = (function () {
  var U = WT.util, S = WT.state;

  var WEEKS = 52;
  var ADMIN_RATE = 0.08;              // stałe wydatki cywilne (% PKB/rok) — podatek < 8% daje deficyt
  var ARMY_UPKEEP_PER_K = 0.0012;     // mld/tydz. za 1000 żołnierzy (× skala kosztów)
  var NAVY_UPKEEP = 0.02;             // mld/tydz. za eskadrę (× skala kosztów)
  var GUNSHIP_UPKEEP_SHARE = 2;       // okręt artyleryjski kosztuje w utrzymaniu jak 2 eskadry
  var BUILDING_UPKEEP = 0.003;        // mld/tydz. za poziom budynku
  var RECRUIT_COST_PER_K = 0.025;     // mld za 1000 żołnierzy (× skala kosztów)
  var SHIP_COST = 1.2;                // mld za eskadrę
  var OCCUPIER_SHARE = 0.3;
  var AID_SHARE = 0.015;
  var FACTORY_BONUS = 0.15, PORT_BONUS = 0.05;
  var BOMBED_INCOME = 0.5;
  var TRADE_BONUS = 0.03, MAX_TRADES = 6;   // umowa handlowa: +3% dochodu podatkowego, liczone maks. 6 umów            // prowincja po nalocie (licznik `bombed`) daje połowę dochodu
  var MANPOWER_REGEN = 0.2;           // tys./tydz. na 1 mln mieszkańców (0.02% populacji)
  var MANPOWER_CAP = 25;              // tys. na 1 mln (2.5% populacji)
  var TAX_MIN = 0.05, TAX_MAX = 0.40;

  var BUILDINGS = {
    factory:  { name: 'Fabryka', cost: 1.0, rate: 0.02,  turns: 6, max: 5, desc: '+15% dochodu prowincji' },
    fort:     { name: 'Fort',    cost: 1.5, rate: 0.006, turns: 4, max: 5, desc: '+25% obrony, oblężenie 1 tura/poziom' },
    port:     { name: 'Port',    cost: 1.0, rate: 0.005, turns: 4, max: 3, desc: 'budowa okrętów, +5% dochodu' },
    barracks: { name: 'Koszary', cost: 0.8, rate: 0.004, turns: 3, max: 3, desc: '+25% rezerw, -10% kosztu rekrutacji' },
    aa:       { name: 'Działka plot.', cost: 1.2, rate: 0.004, turns: 3, max: 5, desc: 'zestrzeliwują bombowce (12%/poziom, maks. 75%), pomagają sąsiednim prowincjom' },
    university: { name: 'Uniwersytet', cost: 2.0, rate: 0.008, turns: 6, max: 5, desc: '+2 pkt nauki na turę za poziom' },
    radar:    { name: 'Radar',   cost: 1.5, rate: 0.003, turns: 4, max: 3, desc: 'wykrywa lecące bombowce (350 km +200 km/poziom), +35% skuteczności działek' }
  };

  function G() { return WT.G; }
  function techMod(cc, key) { return WT.tech ? WT.tech.mod(cc, key) : 1; }
  function isGodFor(cc) { return !!(WT.god && WT.god.enabled() && cc === G().player); }
  function hostileArmiesIn(cc, provId) {
    return S.armiesIn(provId).some(function (a) { return WT.diplomacy.atWar(a.owner, cc); });
  }

  // =====================================================================
  // Wskaźniki
  // =====================================================================

  function provGdp(provId) { var p = G().provinces[provId]; return p.gdp * p.dev; }

  function countryGdp(cc) {
    var sum = 0, own = S.provincesOf(cc);
    for (var i = 0; i < own.length; i++) sum += provGdp(own[i]);
    return sum;
  }
  function countryPop(cc) {
    var sum = 0, own = S.provincesOf(cc);
    for (var i = 0; i < own.length; i++) sum += S.provPop(own[i]);
    return sum;
  }
  function gdpPerCapita(cc) {
    var pop = countryPop(cc);
    return pop > 0 ? countryGdp(cc) / pop * 1000 : 0;
  }
  /** Mnożnik kosztów wojska: bogate kraje płacą więcej, biedne mniej (Indie/Chiny utrzymają duże armie). */
  /** Mnożnik cen budynków i jednostek w scenariuszu historycznym (1 dla 2026). */
  function priceScale() { var e = G() && G().era; return e && e.priceScale ? e.priceScale : 1; }

  /** Skala kosztów wojska wg zamożności; scenariusze historyczne mają stałą skalę epoki (era.costScale). */
  function costScale(cc) {
    var era = G() && G().era;
    if (era && era.costScale) return era.costScale;
    return U.clamp(gdpPerCapita(cc) / 30000, 0.25, 1.5);
  }
  function stabilityMod(c) { return 0.5 + 0.5 * c.stability / 100; }

  // =====================================================================
  // Dochody i wydatki
  // =====================================================================

  function income(cc) {
    var c = S.country(cc), res = { tax: 0, factories: 0, occupation: 0, aid: 0, total: 0 };
    if (!c) return res;
    var mod = stabilityMod(c), incomeMod = techMod(cc, 'income'), own = S.provincesOf(cc), ctrl = S.controlledBy(cc), i;
    for (i = 0; i < own.length; i++) {
      var p = G().provinces[own[i]];
      if (p.ctrl !== cc) continue;     // okupowana prowincja nic nie daje właścicielowi
      var base = provGdp(own[i]) * c.taxRate / WEEKS * mod * incomeMod * (p.bombed > 0 ? BOMBED_INCOME : 1);
      res.tax += base;
      res.factories += base * (FACTORY_BONUS * techMod(cc, 'factory') * p.buildings.factory + PORT_BONUS * p.buildings.port);
    }
    for (i = 0; i < ctrl.length; i++) {
      if (G().provinces[ctrl[i]].owner !== cc) res.occupation += provGdp(ctrl[i]) * c.taxRate / WEEKS * OCCUPIER_SHARE;
    }
    res.aid = foreignAid(cc);
    res.trade = (res.tax + res.factories) * TRADE_BONUS * Math.min(MAX_TRADES, WT.diplomacy.tradesOf ? WT.diplomacy.tradesOf(cc).length : 0);
    res.total = res.tax + res.factories + res.occupation + res.aid + res.trade;
    return res;
  }

  /**
   * Pomoc zagraniczna dla napadniętych: każdy przyjaciel (relacja >= 50, niewalczący z agresorem)
   * przekazuje 1.5% swoich tygodniowych wpływów podatkowych; łącznie maks. 60% PKB/tydz. biorcy × podatek.
   */
  function foreignAid(cc) {
    var aggressors = attackersAgainst(cc);
    if (!aggressors.length) return 0;
    var D = WT.diplomacy, total = 0;
    S.countriesAlive().forEach(function (donor) {
      if (donor === cc || D.relation(donor, cc) < 50) return;
      if (aggressors.some(function (a) { return a === donor || D.atWar(donor, a) || D.allied(donor, a); })) return;
      var dc = S.country(donor);
      total += countryGdp(donor) * dc.taxRate / WEEKS * AID_SHARE;
    });
    return Math.min(total, countryGdp(cc) * 0.6 * S.country(cc).taxRate / WEEKS);
  }

  function attackersAgainst(cc) {
    var out = [];
    WT.diplomacy.warsOf(cc).forEach(function (w) {
      if (w.defenders.indexOf(cc) >= 0) out = out.concat(w.attackers);
    });
    return out;
  }

  function armySoldiers(cc) {
    return S.armiesOf(cc).reduce(function (s, a) { return s + a.size; }, 0);
  }
  function navyShips(cc) {
    return S.fleetsOf(cc).reduce(function (s, f) { return s + f.ships + GUNSHIP_UPKEEP_SHARE * (f.gunships || 0); }, 0);
  }
  function buildingLevels(cc) {
    return S.provincesOf(cc).reduce(function (s, id) {
      var b = G().provinces[id].buildings;
      return s + Object.keys(BUILDINGS).reduce(function (t, k) { return t + (b[k] || 0); }, 0);
    }, 0);
  }

  function expenses(cc) {
    var scale = costScale(cc);
    var res = {
      army: (WT.warfare ? WT.warfare.upkeepSoldiers(cc) : armySoldiers(cc)) / 1000 * ARMY_UPKEEP_PER_K * scale,
      navy: navyShips(cc) * NAVY_UPKEEP * scale,
      buildings: buildingLevels(cc) * BUILDING_UPKEEP * techMod(cc, 'upkeep'),
      admin: countryGdp(cc) * ADMIN_RATE / WEEKS * techMod(cc, 'admin'),
      air: WT.air ? WT.air.upkeep(cc) : 0,
      research: WT.tech ? WT.tech.spending(cc) : 0
    };
    res.total = res.army + res.navy + res.buildings + res.admin + res.air + res.research;
    return res;
  }

  function balance(cc) { return income(cc).total - expenses(cc).total; }

  function setTax(cc, rate) { S.country(cc).taxRate = U.round(U.clamp(rate, TAX_MIN, TAX_MAX), 3); }

  /** Pobiera opłatę ze skarbca (God Mode gracza: za darmo). */
  function pay(cc, amount) {
    if (isGodFor(cc)) return;
    S.country(cc).treasury -= amount;
  }
  function canAfford(cc, amount) { return isGodFor(cc) || S.country(cc).treasury >= amount; }

  // =====================================================================
  // Budynki
  // =====================================================================

  function buildCost(cc, provId, type) {
    var b = BUILDINGS[type], level = G().provinces[provId].buildings[type] || 0;
    return U.round((b.cost * priceScale() + provGdp(provId) * b.rate) * (1 + 0.5 * level), 2);
  }

  function canBuild(cc, provId, type) {
    var b = BUILDINGS[type], p = G().provinces[provId];
    if (!b) return { ok: false, reason: 'Nieznany typ budynku.' };
    if ((type === 'aa' || type === 'radar') && !S.era(type)) return { ok: false, reason: b.name + ': niedostępne w tej epoce.' };
    if (!p || p.owner !== cc) return { ok: false, reason: 'To nie jest twoja prowincja.' };
    if (p.ctrl !== cc) return { ok: false, reason: 'Prowincja jest okupowana.' };
    var inProgress = buildsOf(p)[type];
    if (inProgress) return { ok: false, reason: b.name + ': budowa już trwa (' + inProgress + ' t.).' };
    if ((p.buildings[type] || 0) >= b.max) return { ok: false, reason: b.name + ': osiągnięto maksymalny poziom (' + b.max + ').' };
    if (type === 'port' && !S.provStatic(provId).coastal) return { ok: false, reason: 'Port wymaga prowincji nadmorskiej.' };
    var cost = buildCost(cc, provId, type);
    if (!canAfford(cc, cost)) return { ok: false, reason: 'Brak środków: potrzeba ' + U.fmtMoney(cost) + '.' };
    return { ok: true, reason: b.name + ' za ' + U.fmtMoney(cost) + ', ' + b.turns + ' tur.', cost: cost };
  }

  function build(cc, provId, type) {
    var chk = canBuild(cc, provId, type);
    if (!chk.ok) return false;
    pay(cc, chk.cost);
    var p = G().provinces[provId];
    if (isGodFor(cc)) p.buildings[type]++;
    else buildsOf(p)[type] = BUILDINGS[type].turns;
    return true;
  }

  /** Budowy w toku: { typ: pozostałe tury } — różne typy budują się równolegle, ten sam typ tylko raz naraz. */
  function buildsOf(p) {
    if (!p.builds) p.builds = {};
    return p.builds;
  }

  /** Podsumowanie masowej budowy: ile prowincji się kwalifikuje, łączny koszt, powody pominięcia. */
  function bulkPlan(cc, provIds, type) {
    var plan = { type: type, eligible: [], cost: 0, skipped: {} };
    provIds.forEach(function (id) {
      var chk = canBuild(cc, id, type);
      if (chk.ok || /^Brak środków/.test(chk.reason)) {
        plan.eligible.push(id);
        plan.cost = U.round(plan.cost + buildCost(cc, id, type), 2);
      } else {
        plan.skipped[chk.reason] = (plan.skipped[chk.reason] || 0) + 1;
      }
    });
    return plan;
  }

  /** Buduje `type` we wszystkich podanych prowincjach, w których to możliwe (najtańsze najpierw, póki starcza pieniędzy). */
  function buildMany(cc, provIds, type) {
    var plan = bulkPlan(cc, provIds, type), built = [], spent = 0, noMoney = 0;
    plan.eligible.slice().sort(function (a, b) { return buildCost(cc, a, type) - buildCost(cc, b, type); })
      .forEach(function (id) {
        var cost = buildCost(cc, id, type);
        if (build(cc, id, type)) { built.push(id); spent += cost; } else noMoney++;
      });
    return { built: built, cost: U.round(spent, 2), noMoney: noMoney, skipped: plan.skipped };
  }

  function progressBuildings(cc) {
    S.provincesOf(cc).forEach(function (id) {
      var p = G().provinces[id], builds = buildsOf(p);
      if (p.ctrl !== cc) return;
      Object.keys(builds).forEach(function (type) {
        if (--builds[type] > 0) return;
        delete builds[type];
        p.buildings[type]++;
        if (cc === G().player) S.addLog('Ukończono: ' + BUILDINGS[type].name + ' (poz. ' + p.buildings[type] + ') w ' + S.provStatic(id).name + '.', cc);
      });
    });
  }

  // =====================================================================
  // Rekrutacja i okręty
  // =====================================================================

  /** type: 'inf' | 'arm' | 'art' (wojska szybkie ×3, wsparcie ×2 kosztu piechoty). */
  function recruitCost(cc, provId, sizeK, type) {
    var barracks = G().provinces[provId] ? G().provinces[provId].buildings.barracks : 0;
    var mult = WT.warfare && type ? (WT.warfare.COST_MULT[type] || 1) : 1;
    return U.round(sizeK * mult * RECRUIT_COST_PER_K * costScale(cc) * (1 - 0.1 * barracks) * techMod(cc, 'recruitCost'), 3);
  }

  function canRecruit(cc, provId, sizeK, type) {
    var p = G().provinces[provId], c = S.country(cc);
    if (!(sizeK > 0)) return { ok: false, reason: 'Podaj liczbę żołnierzy.' };
    if (!p || p.owner !== cc) return { ok: false, reason: 'Rekrutować można tylko we własnej prowincji.' };
    if (p.ctrl !== cc) return { ok: false, reason: 'Prowincja jest okupowana.' };
    if (hostileArmiesIn(cc, provId)) return { ok: false, reason: 'W prowincji stoją wrogie wojska.' };
    if (!isGodFor(cc) && c.manpower < sizeK) return { ok: false, reason: 'Za mało rezerw: dostępne ' + Math.floor(c.manpower) + ' tys.' };
    var cost = recruitCost(cc, provId, sizeK, type);
    if (!canAfford(cc, cost)) return { ok: false, reason: 'Brak środków: potrzeba ' + U.fmtMoney(cost) + '.' };
    return { ok: true, reason: 'Koszt ' + U.fmtMoney(cost) + '.', cost: cost };
  }

  function recruit(cc, provId, sizeK, type) {
    var chk = canRecruit(cc, provId, sizeK, type);
    if (!chk.ok) return null;
    pay(cc, chk.cost);
    if (!isGodFor(cc)) S.country(cc).manpower -= sizeK;
    var army = S.createArmy(cc, provId, sizeK * 1000);
    army.moved = 99;
    if (WT.warfare) { army.mix = WT.warfare.mixFor(type || 'inf'); army.org = 0.8; }   // świeży rekrut: niepełna organizacja
    // rekruci dołączają do stojącej armii (która zachowuje swoje punkty ruchu)
    return (WT.military && WT.military.merge(provId, cc)) || army;
  }

  function buildShipsCost(n) { return U.round(n * SHIP_COST * priceScale(), 2); }

  function canBuildShips(cc, provId, n) {
    var p = G().provinces[provId];
    if (!(n > 0)) return { ok: false, reason: 'Podaj liczbę eskadr.' };
    if (!p || p.owner !== cc || p.ctrl !== cc) return { ok: false, reason: 'Okręty buduje się we własnej, kontrolowanej prowincji.' };
    if (!S.provStatic(provId).coastal || p.buildings.port < 1) return { ok: false, reason: 'Wymagany port.' };
    if (!canAfford(cc, buildShipsCost(n))) return { ok: false, reason: 'Brak środków: potrzeba ' + U.fmtMoney(buildShipsCost(n)) + '.' };
    return { ok: true, reason: 'Koszt ' + U.fmtMoney(buildShipsCost(n)) + '.' };
  }

  function buildShips(cc, provId, n) {
    if (!canBuildShips(cc, provId, n).ok) return null;
    pay(cc, buildShipsCost(n));
    var existing = S.fleetsIn(provId).filter(function (f) { return f.owner === cc && !f.path.length && !f.cargo.length; })[0];
    if (existing) { existing.ships += n; return existing; }
    return S.createFleet(cc, provId, n);
  }

  // =====================================================================
  // Tura ekonomiczna
  // =====================================================================

  function processTurn(cc) {
    var c = S.country(cc);
    if (!c || !c.alive) return;
    applyBalance(c);
    progressBuildings(cc);
    regenManpower(c);
    updateStability(c);
    growDevelopment(cc);
    if (c.treasury < 0) handleDebt(c);
  }

  function applyBalance(c) {
    var inc = income(c.cc).total, exp = expenses(c.cc).total;
    c.lastIncome = U.round(inc, 3);
    c.lastExpense = U.round(exp, 3);
    var net = inc - exp;
    if (isGodFor(c.cc)) net = Math.max(0, net);   // God Mode: skarbiec gracza nie spada
    c.treasury = U.round(c.treasury + net, 3);
  }

  function regenManpower(c) {
    var regen = 0, cap = 0;
    S.provincesOf(c.cc).forEach(function (id) {
      var p = G().provinces[id], pop = S.provPop(id);
      cap += pop * MANPOWER_CAP * (1 + 0.1 * p.buildings.barracks);
      if (p.ctrl === c.cc) regen += pop * MANPOWER_REGEN * (1 + 0.25 * p.buildings.barracks) * techMod(c.cc, 'manpower');
    });
    c.manpower = Math.min(cap, c.manpower + regen);
  }

  function occupiedShare(cc) {
    var own = S.provincesOf(cc);
    if (!own.length) return 0;
    var occ = own.filter(function (id) { return G().provinces[id].ctrl !== cc; }).length;
    return occ / own.length;
  }

  function stabilityTarget(c) {
    var t = 70 + (0.15 - c.taxRate) * 200 - c.warExhaustion * 0.4 - occupiedShare(c.cc) * 30;
    if (c.ideology === 'autorytaryzm' || c.ideology === 'komunizm') t += 5;
    return U.clamp(t, 0, 100);
  }

  function updateStability(c) {
    var t = stabilityTarget(c), step = 2;
    c.stability = U.clamp(c.stability + U.clamp(t - c.stability, -step, step), 0, 100);
  }

  function growDevelopment(cc) {
    var atPeace = WT.diplomacy.enemiesOf(cc).length === 0;
    S.provincesOf(cc).forEach(function (id) {
      var p = G().provinces[id];
      if (p.ctrl !== cc) return;
      var g = atPeace ? 0.0006 : 0.0002;
      p.dev = Math.min(3, p.dev + g * (1 + 0.1 * p.buildings.factory) * techMod(cc, 'devGrowth'));
    });
  }

  /** Dług: przy dodatnim bilansie tylko spłacany (spadek stabilności), przy ujemnym — bankructwo. */
  function handleDebt(c) {
    if (c.lastIncome - c.lastExpense >= 0) { c.stability = Math.max(0, c.stability - 1); return; }
    handleBankruptcy(c);
  }

  /** Bankructwo: demobilizacja 10% armii (lub floty), spadek stabilności. */
  function handleBankruptcy(c) {
    var armies = S.armiesOf(c.cc);
    armies.forEach(function (a) {
      a.size = Math.floor(a.size * 0.9);
      if (a.size < 500) S.removeArmy(a.id);
    });
    if (!armies.length) S.fleetsOf(c.cc).forEach(function (f) { f.ships = Math.max(0, f.ships - Math.max(1, f.ships * 0.1)); if (f.gunships) f.gunships = Math.max(0, f.gunships - 1); if (f.ships < 0.5 && !f.gunships) S.removeFleet(f.id); });
    c.stability = Math.max(0, c.stability - 3);
    if (c.cc === G().player) S.addLog('Bankructwo! Skarb pusty — demobilizacja 10% wojska, spadek stabilności.', c.cc);
  }

  return {
    BUILDINGS: BUILDINGS, TAX_MIN: TAX_MIN, TAX_MAX: TAX_MAX,
    income: income, expenses: expenses, balance: balance, setTax: setTax,
    canBuild: canBuild, build: build, buildCost: buildCost, buildsOf: buildsOf, bulkPlan: bulkPlan, buildMany: buildMany,
    recruitCost: recruitCost, canRecruit: canRecruit, recruit: recruit,
    buildShipsCost: buildShipsCost, canBuildShips: canBuildShips, buildShips: buildShips,
    processTurn: processTurn,
    provGdp: provGdp, countryGdp: countryGdp, countryPop: countryPop, gdpPerCapita: gdpPerCapita,
    costScale: costScale, priceScale: priceScale, armySoldiers: armySoldiers, navyShips: navyShips, canAfford: canAfford, pay: pay
  };
})();

if (typeof module !== 'undefined') module.exports = WT.economy;
