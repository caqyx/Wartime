var WT = (typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (global.WT = global.WT || {}));

/*
 * WT.vassal — punkty wojenne, konferencja pokojowa (traktat) i wasale (styl Age of History II).
 *  - Punkty wojenne gracza wobec wroga = wartość okupowanych przez niego (i jego wasali) prowincji wroga
 *    + punkty za zniszczenia (zabici żołnierze, naloty, ostrzał z morza).
 *  - Traktat: wybrane prowincje, kontrybucja, reparacje, rozbrojenie, wasalizacja — każdy warunek ma koszt w punktach.
 *    Wróg przyjmuje traktat, jeśli koszt ≤ punkty (× zmęczenie wojną).
 *  - Wasal (country.overlord): płaci trybut, walczy w wojnach suzerena, nie prowadzi własnej polityki;
 *    suzeren może zabierać mu pieniądze i wojsko, zmieniać trybut, uwolnić go albo przyłączyć.
 */
WT.vassal = (function () {
  var U = WT.util, S = WT.state;
  var D = function () { return WT.diplomacy; }, E = function () { return WT.economy; }, Mil = function () { return WT.military; };

  var DEFAULT_TRIBUTE = 0.15, MAX_TRIBUTE = 0.5;     // część tygodniowego dochodu wasala
  var ANNEX_AFTER = 10;                               // tur jako wasal przed przyłączeniem
  var REPARATIONS_TURNS = 26, REPARATIONS_PCT = 0.2;  // reparacje: 20% dochodu przez pół roku
  var CONTRIBUTION_SHARE = 0.5, DISARM_SHARE = 0.6;
  var COST = { contribution: 10, reparations: 15, disarm: 12 };
  var VASSAL_MIN = 25, VASSAL_SHARE = 0.5;            // wasalizacja: połowa wartości pozostawionych prowincji
  var KILL_PTS = 1 / 2500, DEV_PTS = 25, BUILDING_PTS = 2;

  function G() { return WT.G; }
  function name(cc) { var c = S.country(cc); return c ? c.name : cc; }
  function isPlayer(cc) { return cc === G().player; }
  function alive(cc) { var c = S.country(cc); return !!(c && c.alive); }
  function plural(n, one, few, many) {
    var t = n % 10, h = n % 100;
    return n === 1 ? one : (t >= 2 && t <= 4 && (h < 12 || h > 14)) ? few : many;
  }
  function fmtInt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

  // =====================================================================
  // Wasale — zapytania
  // =====================================================================

  function overlordOf(cc) {
    var c = S.country(cc);
    return c && c.alive && c.overlord && alive(c.overlord) ? c.overlord : null;
  }
  function isVassalOf(v, o) { return !!o && overlordOf(v) === o; }
  function vassalsOf(cc) { return S.countriesAlive().filter(function (v) { return overlordOf(v) === cc; }); }
  function related(a, b) { return isVassalOf(a, b) || isVassalOf(b, a); }
  /** Prowincja kontrolowana przez `cc` albo jego wasala. */
  function heldBy(cc, provId) { var ctrl = G().provinces[provId].ctrl; return ctrl === cc || isVassalOf(ctrl, cc); }

  // =====================================================================
  // Punkty wojenne
  // =====================================================================

  /** Wartość prowincji w punktach: ludność (pierwiastek), rozwój; stolica ×2. */
  function provValue(id) {
    var p = G().provinces[id], c = S.country(p.owner);
    var v = (3 + 6 * Math.sqrt(Math.max(0, S.provPop(id)))) * (0.6 + 0.4 * Math.min(2, p.dev || 1));
    if (c && c.capital === id) v *= 2;
    return Math.max(1, Math.round(v));
  }

  /** Punkty za zniszczenia zadane `victim` przez `by` (w trwającej wojnie). */
  function addDamage(by, victim, pts) {
    if (!(pts > 0) || !by || !victim || by === victim) return;
    var war = D().warBetween(by, victim);
    if (!war) return;
    var key = by + '>' + victim;
    war.dmg = war.dmg || {};
    war.dmg[key] = U.round((war.dmg[key] || 0) + pts, 2);
  }
  function onBattle(a, b, lostA, lostB) { addDamage(a, b, lostB * KILL_PTS); addDamage(b, a, lostA * KILL_PTS); }
  function onBombing(r) { addDamage(r.attacker, ownerAt(r.prov), (r.devLoss || 0) * DEV_PTS + (r.destroyed || []).length * BUILDING_PTS); }
  function onShelling(r) { addDamage(r.attacker, ownerAt(r.prov), (r.killed || 0) * KILL_PTS + (r.devLoss || 0) * DEV_PTS + (r.fortHit ? BUILDING_PTS : 0)); }
  function ownerAt(provId) { return G().provinces[provId] ? G().provinces[provId].owner : null; }

  /** Punkty `me` wobec `target`: { total, occupation, damage, provinces: [{id, value}] } (prowincje do przejęcia). */
  function warPoints(me, target) {
    var res = { total: 0, occupation: 0, damage: 0, provinces: [] };
    var war = D().warBetween(me, target);
    if (!war) return res;
    S.provincesOf(target).forEach(function (id) {
      if (!heldBy(me, id)) return;
      var v = provValue(id);
      res.provinces.push({ id: id, value: v });
      res.occupation += v;
    });
    res.provinces.sort(function (x, y) { return y.value - x.value; });
    var dmg = war.dmg || {};
    res.damage = Math.round((dmg[me + '>' + target] || 0) + vassalsOf(me).reduce(function (s, v) { return s + (dmg[v + '>' + target] || 0); }, 0));
    res.total = res.occupation + res.damage;
    return res;
  }

  // =====================================================================
  // Traktat pokojowy (konferencja)
  // =====================================================================

  /** terms: { provinces: [id], contribution, reparations, disarm, vassal } */
  function vassalCost(target, taking) {
    var t = {}; (taking || []).forEach(function (id) { t[id] = 1; });
    var sum = S.provincesOf(target).reduce(function (s, id) { return t[id] ? s : s + provValue(id); }, 0);
    return Math.max(VASSAL_MIN, Math.round(sum * VASSAL_SHARE));
  }
  function treatyCost(me, target, terms) {
    terms = terms || {};
    var cost = 0;
    (terms.provinces || []).forEach(function (id) { cost += provValue(id); });
    if (terms.contribution) cost += COST.contribution;
    if (terms.reparations) cost += COST.reparations;
    if (terms.disarm) cost += COST.disarm;
    if (terms.vassal) cost += vassalCost(target, terms.provinces);
    return Math.round(cost);
  }
  /** Limit kosztu, który wróg zaakceptuje: punkty × (1 + zmęczenie wojną / 200). */
  function acceptLimit(me, target) {
    return Math.floor(warPoints(me, target).total * (1 + (S.country(target).warExhaustion || 0) / 200));
  }
  function checkTreaty(me, target, terms) {
    terms = terms || {};
    if (!D().atWar(me, target)) return 'Nie jesteście w stanie wojny.';
    var lord = overlordOf(target);
    if (lord && D().atWar(me, lord)) return 'Negocjuj z suzerenem: ' + name(lord) + ' (wasal zawiera pokój razem z nim).';
    if (overlordOf(me) && D().atWar(overlordOf(me), target)) return 'Pokój w tej wojnie zawiera twój suzeren: ' + name(overlordOf(me)) + '.';
    var provs = terms.provinces || [];
    for (var i = 0; i < provs.length; i++) {
      var p = G().provinces[provs[i]];
      if (!p || p.owner !== target || !heldBy(me, provs[i])) return 'Możesz żądać tylko prowincji wroga okupowanych przez ciebie lub twoich wasali.';
    }
    if (terms.vassal) {
      if (overlordOf(me) === target) return 'Nie możesz zwasalizować własnego suzerena.';
      if (provs.length >= S.provincesOf(target).length) return 'Wasal musi zachować co najmniej jedną prowincję.';
    }
    if (!provs.length && !terms.contribution && !terms.reparations && !terms.disarm && !terms.vassal) return 'Wybierz warunki pokoju.';
    return null;
  }

  /** Propozycja traktatu dla AI: przyjmuje, gdy koszt ≤ limit. */
  function proposeTreaty(me, target, terms) {
    var err = checkTreaty(me, target, terms);
    if (err) return { accepted: false, reason: err };
    if (isPlayer(target)) {
      // gracz decyduje sam (okno propozycji); AI składa tylko warunki mieszczące się w limicie
      var prop = D().addProposal(me, target, 'treaty', terms);
      return { accepted: false, proposed: !!prop, reason: 'Żądania przekazane graczowi.' };
    }
    var cost = treatyCost(me, target, terms), pts = warPoints(me, target).total, limit = acceptLimit(me, target);
    if (pts <= 0) return { accepted: false, reason: name(target) + ' odrzuca: nie masz punktów wojennych (zdobywaj prowincje i zadawaj straty).' };
    if (cost > limit) return { accepted: false, reason: name(target) + ' odrzuca: warunki kosztują ' + cost + ' pkt, a twoje punkty pozwalają na ' + limit + ' pkt.' };
    D().concludePeace(me, target, 'treaty', me, terms);
    return { accepted: true, reason: name(target) + ' przyjmuje traktat pokojowy (' + cost + ' z ' + limit + ' pkt).' };
  }

  /** Opis warunków traktatu (okno propozycji dla gracza, dziennik). */
  function describeTerms(terms) {
    var t = [], n = (terms.provinces || []).length;
    if (n) t.push('oddanie ' + n + ' ' + plural(n, 'prowincji', 'prowincji', 'prowincji') + ': ' + terms.provinces.map(function (id) { return S.provStatic(id).name; }).join(', '));
    if (terms.vassal) t.push('zostaniesz wasalem (trybut, udział w wojnach suzerena, brak własnej polityki)');
    if (terms.reparations) t.push('reparacje ' + Math.round(REPARATIONS_PCT * 100) + '% dochodu przez ' + REPARATIONS_TURNS + ' tur');
    if (terms.contribution) t.push('kontrybucja: połowa skarbca');
    if (terms.disarm) t.push('rozbrojenie: armia −' + Math.round(DISARM_SHARE * 100) + '%');
    return t.join('; ');
  }
  /** Prowincje z traktatu, które zwycięzca nadal okupuje (stan mógł się zmienić od złożenia propozycji). */
  function stillValid(winner, loser, terms) {
    var t = Object.assign({}, terms);
    t.provinces = (terms.provinces || []).filter(function (id) { var p = G().provinces[id]; return p && p.owner === loser && heldBy(winner, id); });
    if (t.vassal && t.provinces.length >= S.provincesOf(loser).length) t.provinces.pop();
    return t;
  }

  /**
   * Warunki układane przez AI: przy upadku wroga (utracona stolica, >50% ziem) wasalizacja z szansą `vassalChance`,
   * potem okupowane prowincje od najcenniejszych, za resztę punktów reparacje i kontrybucja. null = brak sensownych żądań.
   */
  function buildTerms(me, target, vassalChance) {
    var pts = warPoints(me, target), budget = acceptLimit(me, target);
    if (pts.total <= 0) return null;
    var terms = { provinces: [] }, keep = S.provincesOf(target).length;
    var collapse = D().capitalLost(target) && D().occupiedShare(target) > 0.5;
    if (collapse && keep > 1 && !checkTreaty(me, target, { vassal: true }) && U.chance(vassalChance)) {
      var vc = vassalCost(target, []);
      if (vc <= budget) { terms.vassal = true; budget -= vc; }
    }
    pts.provinces.forEach(function (p) {
      if (keep - terms.provinces.length <= 1) return;
      // przy wasalizacji zabrana prowincja obniża koszt wasala (mniej ziem mu zostaje)
      var cost = p.value + (terms.vassal ? vassalCost(target, terms.provinces.concat([p.id])) - vassalCost(target, terms.provinces) : 0);
      if (cost <= budget) { terms.provinces.push(p.id); budget -= cost; }
    });
    if (budget >= COST.reparations) { terms.reparations = true; budget -= COST.reparations; }
    if (budget >= COST.contribution) terms.contribution = true;
    return terms.provinces.length || terms.vassal ? terms : null;
  }

  /** Sprawdzenie odtworzenia państwa `cc` przez `o` na prowincjach `provs` (błąd albo null). */
  function checkRelease(o, cc, provs) {
    if (!alive(o)) return 'Państwo nie istnieje.';
    if (overlordOf(o)) return 'Jako wasal nie możesz tworzyć państw.';
    if (S.nationCandidates().indexOf(cc) < 0) return name(cc) + ' już istnieje lub nie ma ziem na mapie.';
    if (!provs || !provs.length) return 'Zaznacz prowincje dla nowego państwa.';
    for (var i = 0; i < provs.length; i++) {
      var p = G().provinces[provs[i]];
      if (!p || p.owner !== o || p.ctrl !== o) return 'Oddać można tylko własne, kontrolowane prowincje.';
    }
    if (S.provincesOf(o).length - provs.length < 1) return 'Musisz zachować co najmniej jedną prowincję.';
    return null;
  }
  /**
   * Odtworzenie upadłego / nieistniejącego państwa jako wasala: dostaje wskazane prowincje, milicję
   * (ok. 3 tys. na mln ludności) i technologię suzerena; od razu dołącza do jego wojen.
   */
  function releaseNation(o, cc, provs) {
    var err = checkRelease(o, cc, provs);
    if (err) return { ok: false, reason: err };
    var pop = provs.reduce(function (s, id) { return s + S.provPop(id); }, 0);
    var army = Math.round(U.clamp(pop * 3000, 3000, 50000));
    var c = S.spawnCountry(cc, provs, { army: army, tech: S.country(o).tech });
    makeVassal(cc, o, true);
    D().setRel(cc, o, 70);
    D().warsOf(o).forEach(function (w) { if (!D().sideOf(w, cc)) D().joinWar(w, cc, D().sideOf(w, o)); });
    D().refreshCountries();
    S.addLog(name(o) + ' odtwarza państwo ' + c.name + ' (' + provs.length + ' ' + plural(provs.length, 'prowincja', 'prowincje', 'prowincji') + ') jako swojego wasala.', o);
    WT.events.emit('released', { cc: cc, overlord: o, provinces: provs.slice() });
    return { ok: true, reason: c.name + ' powstaje jako twój wasal (' + provs.length + ' ' + plural(provs.length, 'prowincja', 'prowincje', 'prowincji') + ', ' + fmtInt(army) + ' żołnierzy).' };
  }

  /** Wasal zrywa zależność: wojna z suzerenem (pozostali wasale suzerena go bronią). */
  function declareIndependence(v) {
    var o = overlordOf(v);
    if (!o) return { ok: false, reason: 'Nie jesteś wasalem.' };
    var c = S.country(v);
    c.overlord = null; c.vassalSince = null;
    G().truces = G().truces.filter(function (t) { return !((t.a === v && t.b === o) || (t.a === o && t.b === v)); });
    D().reindex();
    D().startWar([v], [o], true);
    c.stability = Math.max(0, c.stability - 5);
    S.addLog(name(v) + ' ogłasza niepodległość i wypowiada wojnę suzerenowi: ' + name(o) + '!', v);
    WT.events.emit('independence', { vassal: v, overlord: o });
    return { ok: true, reason: 'Ogłoszono niepodległość — wojna z: ' + name(o) + '.' };
  }

  /** Wykonanie warunków (wywoływane z diplomacy.concludePeace przed zakończeniem wojny). */
  function applyTreaty(winner, loser, terms) {
    terms = terms || {};
    var parts = [], taken = [];
    (terms.provinces || []).forEach(function (id) {
      var p = G().provinces[id];
      if (p && p.owner === loser && heldBy(winner, id)) { S.setOwner(id, winner); taken.push(id); }
    });
    if (taken.length) { parts.push(taken.length + ' ' + plural(taken.length, 'prowincja', 'prowincje', 'prowincji')); WT.events.emit('annex', { loser: loser, provinces: taken }); }
    if (terms.contribution) parts.push('kontrybucja ' + U.fmtMoney(payContribution(loser, winner)));
    if (terms.reparations) {
      reparations().push({ from: loser, to: winner, pct: REPARATIONS_PCT, until: G().turn + REPARATIONS_TURNS });
      parts.push('reparacje ' + Math.round(REPARATIONS_PCT * 100) + '% dochodu przez ' + REPARATIONS_TURNS + ' tur');
    }
    if (terms.disarm) parts.push('rozbrojenie (−' + fmtInt(disarm(loser)) + ' żołnierzy)');
    if (terms.vassal) { makeVassal(loser, winner, true); parts.push('wasalizacja'); }
    if (WT.world) { WT.world.onConquest(winner, taken); if (terms.vassal) WT.world.addAE(winner, 10); }
    S.addLog('Traktat: ' + name(loser) + ' przyjmuje warunki ' + name(winner) + ': ' + (parts.join(', ') || 'brak') + '.', winner);
  }
  function payContribution(loser, winner) {
    var c = S.country(loser);
    var amount = U.round(Math.max(0, c.treasury) * CONTRIBUTION_SHARE + E().countryGdp(loser) * 0.003, 2);
    c.treasury -= amount;
    S.country(winner).treasury += amount;
    return amount;
  }
  function disarm(cc) {
    var lost = 0;
    S.armiesOf(cc).forEach(function (a) {
      var l = Math.round(a.size * DISARM_SHARE);
      a.size -= l; lost += l;
      if (a.size < Mil().MIN_ARMY) { lost += a.size; S.removeArmy(a.id); }
    });
    return lost;
  }
  function reparations() { if (!G().reparations) G().reparations = []; return G().reparations; }
  function reparationsOf(cc) { return reparations().filter(function (r) { return r.from === cc || r.to === cc; }); }

  // =====================================================================
  // Wasale — zmiany statusu i kontrola
  // =====================================================================

  function makeVassal(v, o, silent) {
    var c = S.country(v);
    vassalsOf(v).forEach(function (x) { release(v, x, true); });   // wasale pokonanego odzyskują niezależność
    c.overlord = o; c.vassalSince = G().turn; c.tribute = DEFAULT_TRIBUTE;
    G().alliances = G().alliances.filter(function (al) { return al[0] !== v && al[1] !== v; });
    G().pacts = G().pacts.filter(function (t) { return t.a !== v && t.b !== v; });
    D().setRel(v, o, Math.max(D().relation(v, o), 20));
    D().reindex();
    if (!silent) S.addLog(name(v) + ' zostaje wasalem: ' + name(o) + '.', o);
    WT.events.emit('vassal', { vassal: v, overlord: o });
  }
  function checkControl(o, v) {
    if (!alive(v)) return 'Państwo nie istnieje.';
    if (!isVassalOf(v, o)) return name(v) + ' nie jest twoim wasalem.';
    return null;
  }
  function release(o, v, silent) {
    var err = checkControl(o, v);
    if (err) return { ok: false, reason: err };
    var c = S.country(v);
    c.overlord = null; c.vassalSince = null;
    D().reindex();
    D().changeRel(v, o, 25);
    if (!silent) S.addLog(name(o) + ' uwalnia wasala: ' + name(v) + '.', o);
    return { ok: true, reason: name(v) + ' odzyskuje niezależność (relacje +25).' };
  }
  function setTribute(o, v, rate) {
    var err = checkControl(o, v);
    if (err) return { ok: false, reason: err };
    S.country(v).tribute = U.clamp(+rate || 0, 0, MAX_TRIBUTE);
    return { ok: true, reason: 'Trybut: ' + Math.round(S.country(v).tribute * 100) + '% dochodu wasala.' };
  }
  function takeMoney(o, v, amount) {
    var err = checkControl(o, v);
    if (err) return { ok: false, reason: err };
    var c = S.country(v), max = Math.max(0, Math.floor(c.treasury * 10) / 10);
    amount = U.round(Math.min(+amount || 0, max), 1);
    if (amount <= 0) return { ok: false, reason: 'Skarbiec wasala jest pusty.' };
    c.treasury -= amount;
    S.country(o).treasury += amount;
    D().changeRel(v, o, -Math.min(15, Math.ceil(amount / Math.max(1, max) * 15)));
    S.addLog('Z skarbca wasala ' + name(v) + ' zabrano ' + U.fmtMoney(amount) + '.', o);
    return { ok: true, reason: 'Zabrano ' + U.fmtMoney(amount) + ' ze skarbca: ' + name(v) + '.' };
  }
  /** Żołnierze wasala, których można przejąć (armie w kraju, niezaokrętowane). */
  function vassalTroops(v) {
    return S.armiesOf(v).filter(function (a) { return !a.embarked; }).reduce(function (s, a) { return s + a.size; }, 0);
  }
  /** Przejęcie wojska wasala: powstaje armia suzerena w stolicy wasala (od największych armii). */
  function takeTroops(o, v, soldiers) {
    var err = checkControl(o, v);
    if (err) return { ok: false, reason: err };
    var cap = S.country(v).capital, avail = vassalTroops(v);
    soldiers = Math.min(Math.round(+soldiers || 0), avail);
    if (soldiers < Mil().MIN_ARMY) return { ok: false, reason: 'Za mało wojska (min. ' + fmtInt(Mil().MIN_ARMY) + ').' };
    if (cap < 0) return { ok: false, reason: 'Wasal nie ma stolicy.' };
    var got = 0;
    S.armiesOf(v).filter(function (a) { return !a.embarked; }).sort(function (a, b) { return b.size - a.size; }).forEach(function (a) {
      if (got >= soldiers) return;
      var t = Math.min(soldiers - got, a.size);
      if (a.size - t < Mil().MIN_ARMY) t = a.size;   // bez resztek poniżej minimum
      a.size -= t; got += t;
      if (a.size <= 0) S.removeArmy(a.id);
    });
    S.createArmy(o, cap, got);
    Mil().merge(cap, o);
    D().changeRel(v, o, -5);
    S.addLog(name(o) + ' przejmuje ' + fmtInt(got) + ' żołnierzy wasala ' + name(v) + '.', o);
    return { ok: true, reason: 'Przejęto ' + fmtInt(got) + ' żołnierzy — armia stoi w stolicy wasala (' + S.provStatic(cap).name + ').' };
  }
  function annexCost(v) { return U.round(E().countryGdp(v) * 0.02, 1); }
  function canAnnex(o, v) {
    var err = checkControl(o, v);
    if (err) return { ok: false, reason: err };
    var wait = (S.country(v).vassalSince || 0) + ANNEX_AFTER - G().turn;
    if (wait > 0) return { ok: false, reason: 'Przyłączenie możliwe za ' + wait + ' ' + plural(wait, 'turę', 'tury', 'tur') + '.' };
    if (D().enemiesOf(v).length) return { ok: false, reason: 'Wasal jest w stanie wojny.' };
    var cost = annexCost(v);
    if (!E().canAfford(o, cost)) return { ok: false, reason: 'Brak środków: potrzeba ' + U.fmtMoney(cost) + '.' };
    return { ok: true, cost: cost, reason: 'Koszt: ' + U.fmtMoney(cost) + '.' };
  }
  /** Przyłączenie wasala: prowincje, armie i floty przechodzą na suzerena. */
  function annex(o, v) {
    var chk = canAnnex(o, v);
    if (!chk.ok) return chk;
    E().pay(o, chk.cost);
    var n = 0, annexed = S.provincesOf(v);
    if (WT.world) WT.world.onConquest(o, annexed, 0.3);
    annexed.forEach(function (id) { S.setOwner(id, o); n++; });
    S.armiesOf(v).forEach(function (a) { var size = a.size, prov = a.prov; S.removeArmy(a.id); if (!a.embarked) S.createArmy(o, prov, size); });
    S.fleetsOf(v).forEach(function (f) { f.owner = o; });
    S.country(o).treasury += Math.max(0, S.country(v).treasury);
    vassalsOf(v).forEach(function (x) { S.country(x).overlord = o; });
    S.rebuildIndex();
    D().afterBorderChange();
    Mil().mergeAll();
    S.addLog(name(o) + ' przyłącza wasala: ' + name(v) + ' (' + n + ' ' + plural(n, 'prowincja', 'prowincje', 'prowincji') + ').', o);
    return { ok: true, reason: name(v) + ' przyłączony (' + n + ' ' + plural(n, 'prowincja', 'prowincje', 'prowincji') + ').' };
  }

  // =====================================================================
  // Tura: trybut i reparacje
  // =====================================================================

  function processTurn() {
    S.countriesAlive().forEach(function (v) {
      var c = S.country(v);
      if (c.overlord && !overlordOf(v)) { c.overlord = null; c.vassalSince = null; }   // suzeren upadł
      var o = overlordOf(v);
      if (o && !isPlayer(o)) c.tribute = D().enemiesOf(o).length ? 0.25 : DEFAULT_TRIBUTE;   // AI-suzeren podnosi trybut na czas wojny
      c.tributePaid = o ? transfer(v, o, Math.max(0, c.lastIncome || 0) * (c.tribute != null ? c.tribute : DEFAULT_TRIBUTE)) : 0;
    });
    G().reparations = reparations().filter(function (r) {
      if (r.until <= G().turn || !alive(r.from) || !alive(r.to)) return false;
      r.paid = transfer(r.from, r.to, Math.max(0, S.country(r.from).lastIncome || 0) * r.pct);
      return true;
    });
  }
  function transfer(from, to, amount) {
    amount = U.round(amount, 3);
    if (amount <= 0) return 0;
    S.country(from).treasury -= amount;
    S.country(to).treasury += amount;
    return amount;
  }

  return {
    DEFAULT_TRIBUTE: DEFAULT_TRIBUTE, MAX_TRIBUTE: MAX_TRIBUTE, ANNEX_AFTER: ANNEX_AFTER, COST: COST,
    REPARATIONS_TURNS: REPARATIONS_TURNS, REPARATIONS_PCT: REPARATIONS_PCT,
    overlordOf: overlordOf, isVassalOf: isVassalOf, vassalsOf: vassalsOf, related: related,
    provValue: provValue, addDamage: addDamage, onBattle: onBattle, onBombing: onBombing, onShelling: onShelling, warPoints: warPoints,
    vassalCost: vassalCost, treatyCost: treatyCost, acceptLimit: acceptLimit, checkTreaty: checkTreaty, proposeTreaty: proposeTreaty, applyTreaty: applyTreaty,
    reparationsOf: reparationsOf, describeTerms: describeTerms, checkRelease: checkRelease, releaseNation: releaseNation, stillValid: stillValid, buildTerms: buildTerms, declareIndependence: declareIndependence,
    makeVassal: makeVassal, release: release, setTribute: setTribute, takeMoney: takeMoney, vassalTroops: vassalTroops, takeTroops: takeTroops,
    annexCost: annexCost, canAnnex: canAnnex, annex: annex,
    processTurn: processTurn
  };
})();

if (typeof module !== 'undefined') module.exports = WT.vassal;
