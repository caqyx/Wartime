var WT = (typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (global.WT = global.WT || {}));

/* WT.diplomacy — relacje, wojny, pokój, sojusze, pakty, rozejmy, propozycje, eliminacja państw. */
WT.diplomacy = (function () {
  var U = WT.util, S = WT.state;

  var TRUCE_TURNS = 20, PACT_TURNS = 52, PROPOSAL_TTL = 3, MAX_ALLIANCES = 4;
  var idx = { warPairs: {}, coBell: {}, allied: {} };

  function G() { return WT.G; }
  function name(cc) { var c = S.country(cc); return c ? c.name : cc; }
  function isPlayer(cc) { return cc === G().player; }
  function power(cc) { return WT.military.power(cc); }

  // =====================================================================
  // Indeks wojen/sojuszy (szybkie atWar/allied w pathfindingu)
  // =====================================================================

  function reindex() {
    idx.warPairs = {}; idx.coBell = {}; idx.allied = {};
    G().wars.forEach(function (w) {
      w.attackers.forEach(function (a) {
        w.defenders.forEach(function (d) { idx.warPairs[U.key(a, d)] = w.id; });
      });
      markCoBelligerents(w.attackers);
      markCoBelligerents(w.defenders);
    });
    G().alliances.forEach(function (al) { idx.allied[U.key(al[0], al[1])] = true; });
    // wasal i suzeren traktowani jak sojusznicy (przejście wojsk, wspólna obrona)
    Object.keys(G().countries).forEach(function (cc) {
      var c = G().countries[cc];
      if (c.alive && c.overlord && G().countries[c.overlord] && G().countries[c.overlord].alive) idx.allied[U.key(cc, c.overlord)] = true;
    });
  }
  function V() { return WT.vassal || null; }
  function overlordOf(cc) { return V() ? V().overlordOf(cc) : null; }
  function vassalsOf(cc) { return V() ? V().vassalsOf(cc) : []; }
  function markCoBelligerents(side) {
    for (var i = 0; i < side.length; i++) for (var j = i + 1; j < side.length; j++) idx.coBell[U.key(side[i], side[j])] = true;
  }

  // =====================================================================
  // Zapytania
  // =====================================================================

  function relation(a, b) { return a === b ? 100 : (G().rel[U.key(a, b)] || 0); }
  function changeRel(a, b, delta) {
    if (a === b) return;
    var k = U.key(a, b);
    G().rel[k] = Math.round(U.clamp((G().rel[k] || 0) + delta, -100, 100));
  }
  function setRel(a, b, v) { if (a !== b) G().rel[U.key(a, b)] = Math.round(U.clamp(v, -100, 100)); }
  function atWar(a, b) { return a !== b && idx.warPairs[U.key(a, b)] != null; }
  function allied(a, b) { return a !== b && !!idx.allied[U.key(a, b)]; }
  /** Sojusznik lub współwalczący po tej samej stronie wojny (prawo przejścia). */
  function friendly(a, b) { return a === b || allied(a, b) || !!idx.coBell[U.key(a, b)]; }
  function findTreaty(list, a, b) {
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if ((t.a === a && t.b === b) || (t.a === b && t.b === a)) return t;
    }
    return null;
  }
  function hasPact(a, b) { return !!findTreaty(G().pacts, a, b); }
  function hasTruce(a, b) { return !!findTreaty(G().truces, a, b); }
  function alliesOf(cc) {
    return G().alliances.filter(function (al) { return al[0] === cc || al[1] === cc; })
      .map(function (al) { return al[0] === cc ? al[1] : al[0]; });
  }
  function enemiesOf(cc) {
    var out = [];
    G().wars.forEach(function (w) {
      var side = sideOf(w, cc);
      if (!side) return;
      w[side === 'attackers' ? 'defenders' : 'attackers'].forEach(function (e) { if (out.indexOf(e) < 0) out.push(e); });
    });
    return out;
  }
  function sideOf(war, cc) {
    if (war.attackers.indexOf(cc) >= 0) return 'attackers';
    if (war.defenders.indexOf(cc) >= 0) return 'defenders';
    return null;
  }
  function otherSide(side) { return side === 'attackers' ? 'defenders' : 'attackers'; }
  function warBetween(a, b) {
    var id = idx.warPairs[U.key(a, b)];
    if (id == null) return null;
    for (var i = 0; i < G().wars.length; i++) if (G().wars[i].id === id) return G().wars[i];
    return null;
  }
  function warsOf(cc) { return G().wars.filter(function (w) { return sideOf(w, cc); }); }
  function isLeader(war, cc) { return war.attackers[0] === cc || war.defenders[0] === cc; }

  // =====================================================================
  // Wojna
  // =====================================================================

  function startWar(attackers, defenders, silent) {
    var war = { id: S.newId('w'), attackers: attackers.slice(), defenders: defenders.slice(),
      start: G().turn, score: {}, losses: {} };
    attackers.concat(defenders).forEach(function (cc) { war.score[cc] = 0; war.losses[cc] = 0; });
    G().wars.push(war);
    reindex();
    attackers.forEach(function (a) { defenders.forEach(function (d) { removePactAndTruce(a, d); setRel(a, d, Math.min(relation(a, d), -50)); }); });
    if (!silent) S.addLog(name(attackers[0]) + ' wypowiada wojnę: ' + name(defenders[0]) + '!', attackers[0]);
    joinVassalLinks(war);
    WT.events.emit('war', { war: war, attacker: attackers[0], defender: defenders[0] });
    return war;
  }

  /** Wasale walczą u boku suzerena; suzeren broni zaatakowanego wasala. */
  function joinVassalLinks(war) {
    war.attackers.slice().forEach(function (a) { vassalsOf(a).forEach(function (v) { if (!sideOf(war, v)) joinWar(war, v, 'attackers'); }); });
    war.defenders.slice().forEach(function (d) {
      var lord = overlordOf(d);
      if (lord && !sideOf(war, lord)) joinWar(war, lord, 'defenders');
      vassalsOf(d).forEach(function (v) { if (!sideOf(war, v)) joinWar(war, v, 'defenders'); });
    });
  }

  function checkDeclareWar(a, b) {
    var ca = S.country(a), cb = S.country(b);
    if (a === b) return 'Nie można wypowiedzieć wojny samemu sobie.';
    if (!ca || !cb || !ca.alive || !cb.alive) return 'Państwo nie istnieje.';
    if (overlordOf(b) === a) return name(b) + ' jest twoim wasalem.';
    if (overlordOf(a) === b) return name(b) + ' jest twoim suzerenem.';
    if (overlordOf(a)) return 'Wasal nie wypowiada wojen samodzielnie (suzeren: ' + name(overlordOf(a)) + ').';
    if (atWar(a, b)) return 'Już jesteście w stanie wojny.';
    if (allied(a, b)) return 'Jesteście w sojuszu — najpierw go zerwij.';
    var truce = findTreaty(G().truces, a, b);
    if (truce) return 'Obowiązuje rozejm do tury ' + truce.until + '.';
    if (hasPact(a, b)) return 'Obowiązuje pakt o nieagresji — najpierw go zerwij.';
    return null;
  }

  function declareWar(a, b) {
    var err = checkDeclareWar(a, b);
    if (err) return { ok: false, reason: err };
    var war = startWar([a], [b]);
    S.country(a).stability = Math.max(0, S.country(a).stability - 3);
    alliesOf(b).forEach(function (o) { changeRel(a, o, -15); });
    callAlliesToDefend(war, b, a);
    return { ok: true, reason: 'Wypowiedziano wojnę: ' + name(b) + '.', warId: war.id };
  }

  function callAlliesToDefend(war, defender, attacker) {
    alliesOf(defender).forEach(function (ally) {
      if (ally === attacker || sideOf(war, ally) || allied(ally, attacker)) return;
      if (isPlayer(ally)) {
        addProposal(defender, ally, 'callToArms', { warId: war.id, side: 'defenders', enemy: attacker });
      } else if (aiAnswersCallToArms(ally, defender)) {
        joinWar(war, ally, 'defenders');
      } else {
        S.addLog(name(ally) + ' odmawia udziału w wojnie po stronie ' + name(defender) + '.', ally);
        changeRel(ally, defender, -20);
      }
    });
  }

  function aiAnswersCallToArms(ally, defender) {
    if (relation(ally, defender) <= 30) return false;
    var myPower = power(ally);
    return !enemiesOf(ally).some(function (e) { return power(e) > myPower; });
  }

  function joinWar(war, cc, side) {
    if (sideOf(war, cc)) return false;
    war[side].push(cc);
    war.score[cc] = 0; war.losses[cc] = 0;
    war[otherSide(side)].forEach(function (e) { removePactAndTruce(cc, e); setRel(cc, e, Math.min(relation(cc, e), -40)); });
    reindex();
    S.addLog(name(cc) + ' przystępuje do wojny po stronie ' + name(war[side][0]) + '.', cc);
    WT.events.emit('war', { war: war, joined: cc, side: side });
    vassalsOf(cc).forEach(function (v) { if (!sideOf(war, v)) joinWar(war, v, side); });
    return true;
  }

  function removePactAndTruce(a, b) {
    G().pacts = G().pacts.filter(function (t) { return !((t.a === a && t.b === b) || (t.a === b && t.b === a)); });
    G().truces = G().truces.filter(function (t) { return !((t.a === a && t.b === b) || (t.a === b && t.b === a)); });
  }

  // =====================================================================
  // Wynik wojny
  // =====================================================================

  /** Liczy wynik wojny: okupacje (ważone populacją), stolice liderów, straty. war.score[cc] z perspektywy cc. */
  function warScore(war) {
    var sideMap = {};
    war.attackers.forEach(function (c) { sideMap[c] = 'A'; });
    war.defenders.forEach(function (c) { sideMap[c] = 'D'; });
    var occ = occupationShares(sideMap);
    var capA = capitalHeldBy(war.defenders[0], sideMap, 'A');
    var capD = capitalHeldBy(war.attackers[0], sideMap, 'D');
    var lossA = sumLosses(war, war.attackers), lossD = sumLosses(war, war.defenders);
    var lossTerm = (lossD - lossA) / (lossA + lossD + 5000);
    var a = U.clamp(Math.round(60 * (occ.A - occ.D) + 20 * capA - 20 * capD + 20 * lossTerm), -100, 100);
    war.attackers.forEach(function (c) { war.score[c] = a; });
    war.defenders.forEach(function (c) { war.score[c] = -a; });
    return war.score;
  }

  function occupationShares(sideMap) {
    var total = { A: 0, D: 0 }, held = { A: 0, D: 0 };
    G().provinces.forEach(function (p, id) {
      var os = sideMap[p.owner];
      if (!os) return;
      var pop = (S.provStatic(id).pop || 0) + 0.05;
      total[os] += pop;
      var cs = sideMap[p.ctrl];
      if (cs && cs !== os) held[cs] += pop;
    });
    return { A: total.D ? held.A / total.D : 0, D: total.A ? held.D / total.A : 0 };
  }

  function capitalHeldBy(leader, sideMap, side) {
    var c = S.country(leader);
    if (!c || c.capital < 0) return 0;
    return sideMap[G().provinces[c.capital].ctrl] === side ? 1 : 0;
  }
  function sumLosses(war, members) { return members.reduce(function (s, c) { return s + (war.losses[c] || 0); }, 0); }
  function scoreOf(war, cc) { return war.score[cc] || 0; }

  /** Zapis strat z bitwy do wojny między stronami. */
  function recordLosses(a, b, lostA, lostB) {
    var war = warBetween(a, b);
    if (war) { war.losses[a] = (war.losses[a] || 0) + lostA; war.losses[b] = (war.losses[b] || 0) + lostB; }
    if (war && V()) V().onBattle(a, b, lostA, lostB);
    S.country(a).losses += lostA; S.country(b).losses += lostB;
  }

  function capitalLost(cc) {
    var c = S.country(cc);
    return c.capital >= 0 && G().provinces[c.capital].ctrl !== cc;
  }
  function occupiedShare(cc) {
    var own = S.provincesOf(cc);
    if (!own.length) return 1;
    return own.filter(function (id) { return G().provinces[id].ctrl !== cc; }).length / own.length;
  }

  // =====================================================================
  // Pokój
  // =====================================================================

  /** from proponuje pokój; przy "annex"/"demand" from jest zwycięzcą. */
  function proposePeace(from, to, type) {
    var war = warBetween(from, to);
    if (!war) return { accepted: false, reason: 'Nie jesteście w stanie wojny.' };
    if (['white', 'annex', 'demand'].indexOf(type) < 0) return { accepted: false, reason: 'Nieznany typ pokoju.' };
    var lord = overlordOf(to);
    if (lord && atWar(from, lord)) return { accepted: false, reason: 'Negocjuj z suzerenem: ' + name(lord) + ' (wasal zawiera pokój razem z nim).' };
    if (overlordOf(from) && atWar(overlordOf(from), to)) return { accepted: false, reason: 'Pokój zawiera suzeren: ' + name(overlordOf(from)) + '.' };
    if (isPlayer(to)) {
      addProposal(from, to, 'peace', { kind: type, winner: type === 'white' ? null : from });
      return { accepted: false, reason: 'Propozycja przekazana graczowi.' };
    }
    var verdict = evaluatePeace(to, from, type, war);
    if (verdict.accept) concludePeace(from, to, type, type === 'white' ? null : from);
    return { accepted: verdict.accept, reason: verdict.reason };
  }

  /** Ocena AI: evaluator otrzymuje propozycję od proposer. */
  function evaluatePeace(evaluator, proposer, type, war) {
    warScore(war);
    var my = scoreOf(war, evaluator), ex = S.country(evaluator).warExhaustion;
    var age = G().turn - war.start;
    if (type === 'white') {
      if (war.attackers[0] === evaluator && age < 8 && my > -20) return { accept: false, reason: name(evaluator) + ': dopiero zaczęliśmy tę wojnę.' };
      var calm = 15 * (1 - aggression());   // spokojniejsze AI łatwiej przyjmuje biały pokój
      if (my <= 10 + calm || ex >= 60 || (age > 52 && my < 30)) return { accept: true, reason: name(evaluator) + ' przyjmuje biały pokój.' };
      return { accept: false, reason: name(evaluator) + ' odrzuca: wygrywamy tę wojnę (wynik ' + my + ').' };
    }
    if (type === 'annex') {
      var collapse = capitalLost(evaluator) && occupiedShare(evaluator) > 0.5;
      if (age < 20 && !collapse) return { accept: false, reason: name(evaluator) + ': wojna trwa dopiero ' + age + ' tur — nie skapitulujemy.' };
      if (-my >= 50 || collapse) return { accept: true, reason: name(evaluator) + ' kapituluje i oddaje okupowane prowincje.' };
      return { accept: false, reason: name(evaluator) + ' odrzuca: wynik wojny ' + (-my) + ' (wymagane 50 albo utrata stolicy i >50% prowincji).' };
    }
    if (-my >= 25 || ex >= 50) return { accept: true, reason: name(evaluator) + ' przyjmuje żądania i płaci reparacje.' };
    return { accept: false, reason: name(evaluator) + ' odrzuca żądania (wynik ' + (-my) + ', wymagane 25).' };
  }

  /**
   * Zawarcie pokoju między a i b. kind: white | annex | demand; winner: cc zwycięzcy (dla annex/demand).
   * Jeśli obaj są liderami — kończy całą wojnę; inaczej odrębny pokój wychodzącego uczestnika.
   */
  function concludePeace(a, b, kind, winner, terms) {
    var war = warBetween(a, b);
    if (!war) return false;
    var loser = winner ? (winner === a ? b : a) : null;
    var winSide = winner ? sideOf(war, winner) : null;
    if (kind === 'annex' && loser) annexOccupied(war, loser, winSide);
    if (kind === 'demand' && loser) payReparations(loser, winner);
    if (kind === 'treaty' && loser && V()) V().applyTreaty(winner, loser, terms);
    var exiting = exitingParticipants(war, a, b);
    signTruces(war, exiting);
    removeFromWar(war, exiting);
    reindex();
    changeRel(a, b, 10);
    afterBorderChange();
    logPeace(a, b, kind, winner);
    WT.events.emit('peace', { a: a, b: b, kind: kind, winner: winner });
    return true;
  }

  function exitingParticipants(war, a, b) {
    if (isLeader(war, a) && isLeader(war, b)) return war.attackers.concat(war.defenders);
    var out = [isLeader(war, a) ? b : a];
    // wasale wychodzą z wojny razem z suzerenem (także nowy wasal razem z dotychczasowymi)
    [a, b].forEach(function (x) { vassalsOf(x).forEach(function (v) { if (out.indexOf(x) >= 0 && sideOf(war, v) && out.indexOf(v) < 0) out.push(v); }); });
    return out;
  }

  function annexOccupied(war, loser, winSide) {
    var winners = war[winSide], taken = [];
    S.provincesOf(loser).forEach(function (id) {
      var ctrl = G().provinces[id].ctrl;
      if (winners.indexOf(ctrl) >= 0) { S.setOwner(id, ctrl); taken.push(id); }
    });
    if (taken.length) WT.events.emit('annex', { loser: loser, provinces: taken });
  }

  function payReparations(loser, winner) {
    var amount = Math.max(0, S.country(loser).treasury * 0.3) + WT.economy.countryGdp(loser) * 0.005;
    amount = U.round(amount, 2);
    S.country(loser).treasury -= amount;
    S.country(winner).treasury += amount;
    S.addLog(name(loser) + ' płaci ' + U.fmtMoney(amount) + ' reparacji dla ' + name(winner) + '.', loser);
  }

  function signTruces(war, exiting) {
    var until = G().turn + TRUCE_TURNS;
    exiting.forEach(function (x) {
      var side = sideOf(war, x);
      war[otherSide(side)].forEach(function (e) {
        if (!findTreaty(G().truces, x, e)) G().truces.push({ a: x, b: e, until: until });
      });
    });
  }

  function removeFromWar(war, members) {
    members.forEach(function (m) {
      U.removeFromArray(war.attackers, m);
      U.removeFromArray(war.defenders, m);
    });
    if (!war.attackers.length || !war.defenders.length) U.removeFromArray(G().wars, war);
  }

  function logPeace(a, b, kind, winner) {
    var txt = { white: 'biały pokój', annex: 'pokój z aneksją okupowanych ziem', demand: 'pokój z reparacjami', treaty: 'traktat pokojowy' }[kind];
    S.addLog('Pokój: ' + name(a) + ' – ' + name(b) + ' (' + txt + (winner ? ', zwycięzca: ' + name(winner) : '') + ').', a);
  }

  /** Po pokoju/aneksji: przywrócenie kontroli, wyrzucenie wojsk z obcych ziem, stolice, eliminacje. */
  function afterBorderChange() {
    restoreOccupations();
    WT.military.expelTrespassers();
    refreshCountries();
  }

  function restoreOccupations() {
    G().provinces.forEach(function (p, id) {
      if (p.ctrl !== p.owner && !atWar(p.ctrl, p.owner)) S.setCtrl(id, p.owner);
    });
  }

  // =====================================================================
  // Eliminacja i stolice
  // =====================================================================

  function refreshCountries() {
    Object.keys(G().countries).forEach(function (cc) {
      var c = G().countries[cc];
      if (!c.alive) return;
      var own = S.provincesOf(cc);
      if (!own.length) { eliminate(cc); return; }
      if (c.capital < 0 || G().provinces[c.capital].owner !== cc) relocateCapital(c, own);
    });
  }

  function relocateCapital(c, own) {
    var best = own.reduce(function (b, id) { return WT.economy.provGdp(id) > WT.economy.provGdp(b) ? id : b; }, own[0]);
    c.capital = best;
    if (isPlayer(c.cc)) S.addLog('Nowa stolica: ' + S.provStatic(best).name + '.', c.cc);
  }

  function eliminate(cc) {
    var c = S.country(cc);
    c.alive = false;
    S.armiesOf(cc).forEach(function (a) { S.removeArmy(a.id); });
    S.fleetsOf(cc).forEach(function (f) { S.removeFleet(f.id); });
    G().wars.slice().forEach(function (w) { if (sideOf(w, cc)) removeFromWar(w, [cc]); });
    G().alliances = G().alliances.filter(function (al) { return al[0] !== cc && al[1] !== cc; });
    G().pacts = G().pacts.filter(function (t) { return t.a !== cc && t.b !== cc; });
    G().proposals = G().proposals.filter(function (p) { return p.from !== cc && p.to !== cc; });
    S.controlledBy(cc).forEach(function (id) { S.setCtrl(id, G().provinces[id].owner); });
    reindex();
    S.addLog(c.name + ' przestaje istnieć.', cc);
    WT.events.emit('eliminated', { cc: cc });
    if (isPlayer(cc)) { G().gameOver = true; WT.events.emit('gameover', { cc: cc }); }
  }

  // =====================================================================
  // Sojusze, pakty, relacje
  // =====================================================================

  function checkPair(a, b) {
    var ca = S.country(a), cb = S.country(b);
    if (a === b) return 'To to samo państwo.';
    if (!ca || !cb || !ca.alive || !cb.alive) return 'Państwo nie istnieje.';
    return null;
  }

  function proposeAlliance(a, b) {
    var err = checkPair(a, b);
    if (err) return { accepted: false, reason: err };
    if (allied(a, b)) return { accepted: false, reason: overlordOf(a) === b || overlordOf(b) === a ? 'Wasal i suzeren już walczą razem.' : 'Już jesteście sojusznikami.' };
    if (overlordOf(a) || overlordOf(b)) return { accepted: false, reason: 'Wasal nie zawiera własnych sojuszy (decyduje suzeren).' };
    if (atWar(a, b)) return { accepted: false, reason: 'Jesteście w stanie wojny.' };
    if (isPlayer(b)) { addProposal(a, b, 'alliance', {}); return { accepted: false, reason: 'Propozycja przekazana graczowi.' }; }
    var verdict = evaluateAlliance(b, a);
    if (verdict.accept) formAlliance(a, b);
    return { accepted: verdict.accept, reason: verdict.reason };
  }

  function evaluateAlliance(evaluator, proposer) {
    var rel = relation(evaluator, proposer);
    if (rel <= 50) return { accept: false, reason: name(evaluator) + ': relacje za słabe (' + rel + ', wymagane > 50).' };
    if (alliesOf(evaluator).length >= MAX_ALLIANCES) return { accept: false, reason: name(evaluator) + ' ma już zbyt wiele sojuszy.' };
    if (rel >= 85 || commonEnemyOrThreat(evaluator, proposer)) return { accept: true, reason: name(evaluator) + ' zawiera sojusz obronny.' };
    return { accept: false, reason: name(evaluator) + ': nie widzimy wspólnego zagrożenia.' };
  }

  function commonEnemyOrThreat(a, b) {
    var ea = enemiesOf(a), eb = enemiesOf(b);
    if (ea.some(function (e) { return eb.indexOf(e) >= 0; })) return true;
    return S.countriesAlive().some(function (t) {
      return t !== a && t !== b && relation(a, t) < -30 && relation(b, t) < -30;
    });
  }

  function formAlliance(a, b) {
    if (allied(a, b) || atWar(a, b)) return false;
    G().alliances.push([a, b]);
    reindex();
    changeRel(a, b, 10);
    S.addLog('Sojusz obronny: ' + name(a) + ' – ' + name(b) + '.', a);
    WT.events.emit('alliance', { a: a, b: b });
    return true;
  }

  function breakAlliance(a, b) {
    if (!allied(a, b)) return { ok: false, reason: 'Nie jesteście sojusznikami.' };
    G().alliances = G().alliances.filter(function (al) { return U.key(al[0], al[1]) !== U.key(a, b); });
    reindex();
    changeRel(a, b, -30);
    S.addLog(name(a) + ' zrywa sojusz z ' + name(b) + '.', a);
    return { ok: true, reason: 'Sojusz zerwany.' };
  }

  function proposePact(a, b) {
    var err = checkPair(a, b);
    if (err) return { accepted: false, reason: err };
    if (hasPact(a, b)) return { accepted: false, reason: 'Pakt już obowiązuje.' };
    if (overlordOf(a) || overlordOf(b)) return { accepted: false, reason: 'Wasal nie zawiera własnych paktów (decyduje suzeren).' };
    if (atWar(a, b)) return { accepted: false, reason: 'Jesteście w stanie wojny.' };
    if (isPlayer(b)) { addProposal(a, b, 'pact', {}); return { accepted: false, reason: 'Propozycja przekazana graczowi.' }; }
    var rel = relation(a, b), fear = power(a) > 1.5 * power(b);
    if (rel >= 0 || fear) { makePact(a, b); return { accepted: true, reason: name(b) + ' podpisuje pakt o nieagresji.' }; }
    return { accepted: false, reason: name(b) + ' odrzuca pakt (relacje ' + rel + ').' };
  }

  function makePact(a, b) {
    if (hasPact(a, b)) return;
    G().pacts.push({ a: a, b: b, until: G().turn + PACT_TURNS });
    changeRel(a, b, 5);
    S.addLog('Pakt o nieagresji: ' + name(a) + ' – ' + name(b) + ' (do tury ' + (G().turn + PACT_TURNS) + ').', a);
  }

  /** Zerwanie paktu: -50 relacji z partnerem, -15 z resztą świata, -20 stabilności. */
  function breakPact(a, b) {
    if (!hasPact(a, b)) return { ok: false, reason: 'Brak paktu.' };
    G().pacts = G().pacts.filter(function (t) { return !((t.a === a && t.b === b) || (t.a === b && t.b === a)); });
    changeRel(a, b, -50);
    S.countriesAlive().forEach(function (o) { if (o !== a && o !== b) changeRel(a, o, -15); });
    S.country(a).stability = Math.max(0, S.country(a).stability - 20);
    S.addLog(name(a) + ' zrywa pakt o nieagresji z ' + name(b) + '!', a);
    return { ok: true, reason: 'Pakt zerwany (-20 stabilności, spadek relacji).' };
  }

  // =====================================================================
  // Umowy handlowe: +3% dochodu podatkowego obu stron (economy.income().trade)
  // =====================================================================

  var TRADE_MIN_REL = 15, TRADE_BREAK_REL = -20;

  function trades() { if (!G().trades) G().trades = []; return G().trades; }
  function hasTrade(a, b) { return trades().some(function (t) { return (t.a === a && t.b === b) || (t.a === b && t.b === a); }); }
  function tradesOf(cc) {
    return trades().filter(function (t) { return t.a === cc || t.b === cc; }).map(function (t) { return t.a === cc ? t.b : t.a; });
  }

  function proposeTrade(a, b) {
    var err = checkPair(a, b);
    if (err) return { accepted: false, reason: err };
    if (hasTrade(a, b)) return { accepted: false, reason: 'Umowa handlowa już obowiązuje.' };
    if (atWar(a, b)) return { accepted: false, reason: 'Jesteście w stanie wojny.' };
    if (isPlayer(b)) { addProposal(a, b, 'trade', {}); return { accepted: false, reason: 'Propozycja przekazana graczowi.' }; }
    var rel = relation(a, b);
    if (rel < TRADE_MIN_REL) return { accepted: false, reason: name(b) + ' odrzuca umowę handlową (relacje ' + rel + ', wymagane ' + TRADE_MIN_REL + ').' };
    makeTrade(a, b);
    return { accepted: true, reason: name(b) + ' podpisuje umowę handlową (+3% dochodu dla obu stron).' };
  }

  function makeTrade(a, b) {
    if (hasTrade(a, b)) return;
    trades().push({ a: a, b: b, since: G().turn });
    changeRel(a, b, 5);
    S.addLog('Umowa handlowa: ' + name(a) + ' – ' + name(b) + '.', a);
  }

  function cancelTrade(a, b, silent) {
    if (!hasTrade(a, b)) return { ok: false, reason: 'Brak umowy handlowej.' };
    G().trades = trades().filter(function (t) { return !((t.a === a && t.b === b) || (t.a === b && t.b === a)); });
    if (!silent) { changeRel(a, b, -10); S.addLog(name(a) + ' zrywa umowę handlową z ' + name(b) + '.', a); }
    return { ok: true, reason: 'Umowa handlowa zerwana.' };
  }

  /** Umowy wygasają przy wojnie, złych relacjach albo zniknięciu państwa. */
  function pruneTrades() {
    trades().slice().forEach(function (t) {
      var dead = !S.country(t.a).alive || !S.country(t.b).alive;
      if (dead || atWar(t.a, t.b) || relation(t.a, t.b) < TRADE_BREAK_REL) cancelTrade(t.a, t.b, true);
    });
  }

  /** Agresywność AI z ustawień jako mnożnik: 0 (pokojowe) … 1 (standard) … 2 (bardzo agresywne). */
  function aggression() { return S.settings().aiAggression / 50; }

  function improveRelationsCost(a) { return U.round(1 + WT.economy.countryGdp(a) * 0.001, 2); }

  function improveRelations(a, b) {
    var err = checkPair(a, b);
    if (err) return { ok: false, reason: err };
    if (atWar(a, b)) return { ok: false, reason: 'Nie w trakcie wojny.' };
    var cost = improveRelationsCost(a);
    if (!WT.economy.canAfford(a, cost)) return { ok: false, reason: 'Brak środków: potrzeba ' + U.fmtMoney(cost) + '.' };
    WT.economy.pay(a, cost);
    changeRel(a, b, 8);
    return { ok: true, reason: 'Relacje z ' + name(b) + ' poprawione (+8) za ' + U.fmtMoney(cost) + '.' };
  }

  function insult(a, b) {
    var err = checkPair(a, b);
    if (err) return { ok: false, reason: err };
    changeRel(a, b, -25);
    return { ok: true, reason: name(b) + ' została znieważona (-25 relacji).' };
  }

  // =====================================================================
  // Wsparcie innych państw: przelewy pieniędzy i przekazywanie wojska
  // =====================================================================

  var AID_MIN_SOLDIERS = 500;

  /** Wspólne warunki wsparcia; zwraca powód odmowy albo null. */
  function checkAid(from, to) {
    var err = checkPair(from, to);
    if (err) return err;
    if (atWar(from, to)) return 'Nie można wspierać państwa, z którym jesteś w stanie wojny.';
    return null;
  }

  /** Przelew mld USD ze skarbca (God Mode gracza: skarbiec się nie zmniejsza). Relacje rosną z kwotą względem PKB odbiorcy. */
  function giveMoney(from, to, amount) {
    var err = checkAid(from, to);
    if (err) return { ok: false, reason: err };
    amount = U.round(+amount || 0, 2);
    if (!(amount > 0)) return { ok: false, reason: 'Podaj kwotę większą od zera.' };
    if (!WT.economy.canAfford(from, amount)) return { ok: false, reason: 'Brak środków: w skarbcu ' + U.fmtMoney(Math.max(0, S.country(from).treasury)) + '.' };
    WT.economy.pay(from, amount);
    S.country(to).treasury = U.round(S.country(to).treasury + amount, 3);
    var gdp = Math.max(1, WT.economy.countryGdp(to));
    var delta = Math.round(U.clamp(amount / gdp * 400, 1, 20));
    changeRel(from, to, delta);
    S.addLog(name(from) + ' przekazuje ' + U.fmtMoney(amount) + ' wsparcia dla: ' + name(to) + '.', from);
    return { ok: true, reason: 'Przekazano ' + U.fmtMoney(amount) + ' dla: ' + name(to) + ' (relacje +' + delta + ').', relDelta: delta };
  }

  /** Czy armia może oddać żołnierzy: stoi na lądzie i w jej prowincji nie ma wroga (nie walczy). */
  function canDonateFrom(army) {
    return !army.embarked && !WT.military.hostileArmies(army.owner, army.prov).length;
  }

  /** Armie, z których pobierane jest wojsko: z sourceProv (najpierw stojące) albo największe stojące armie kraju. */
  function donorArmies(cc, sourceProv) {
    var list = sourceProv != null && sourceProv >= 0
      ? S.armiesIn(sourceProv).filter(function (a) { return a.owner === cc; })
      : S.armiesOf(cc).filter(function (a) { return !a.path.length; });
    return list.filter(canDonateFrom).sort(function (a, b) {
      return (a.path.length ? 1 : 0) - (b.path.length ? 1 : 0) || b.size - a.size;
    });
  }

  /** Liczba żołnierzy, których cc może przekazać (opcjonalnie z jednej prowincji). */
  function availableTroops(cc, sourceProv) {
    return donorArmies(cc, sourceProv).reduce(function (s, a) { return s + a.size; }, 0);
  }

  function aidTroopsReason(from, to) {
    var err = checkAid(from, to);
    if (err) return err;
    var rel = relation(from, to);
    if (rel < 0) return name(to) + ': relacje za słabe (' + rel + ', wymagane ≥ 0).';
    var foe = enemiesOf(to).filter(function (e) { return e !== from && friendly(from, e); })[0];
    if (foe) return name(to) + ' jest w wojnie z twoim sojusznikiem (' + name(foe) + ').';
    return null;
  }

  /** Prowincja, w której pojawi się przekazane wojsko: źródłowa (jeśli przyjazna odbiorcy), stolica, największa kontrolowana. */
  function aidDestination(to, sourceProv) {
    if (sourceProv != null && sourceProv >= 0) {
      var p = G().provinces[sourceProv];
      var friendlyLand = p.owner === to || p.ctrl === to || friendly(to, p.ctrl);
      if (friendlyLand && !atWar(to, p.ctrl) && WT.military.canEnter(to, sourceProv)) return sourceProv;
    }
    var c = S.country(to);
    if (c.capital >= 0 && G().provinces[c.capital].ctrl === to) return c.capital;
    var own = S.controlledBy(to);
    if (!own.length) return -1;
    return own.reduce(function (b, id) { return (S.provStatic(id).pop || 0) > (S.provStatic(b).pop || 0) ? id : b; }, own[0]);
  }

  /**
   * Przekazanie żołnierzy innemu państwu. Wojsko pobierane z armii w sourceProv albo z największych stojących armii
   * (bez zaokrętowanych i walczących). Odbiorca dostaje armię (scaloną z istniejącą) — tech odbiorcy.
   */
  function giveTroops(from, to, soldiers, sourceProv) {
    var err = aidTroopsReason(from, to);
    if (err) return { ok: false, reason: err };
    var sources = donorArmies(from, sourceProv);
    var avail = sources.reduce(function (s, a) { return s + a.size; }, 0);
    var n = Math.min(Math.round(+soldiers || 0), avail);
    if (n < AID_MIN_SOLDIERS) return { ok: false, reason: avail < AID_MIN_SOLDIERS ? 'Brak dostępnego wojska (armie zaokrętowane, w walce lub brak armii).' : 'Za mały oddział (min. ' + AID_MIN_SOLDIERS + ' żołnierzy).' };
    var srcProv = sourceProv != null && sourceProv >= 0 ? sourceProv : sources[0].prov;
    var dest = aidDestination(to, srcProv);
    if (dest < 0) return { ok: false, reason: name(to) + ' nie kontroluje żadnej prowincji.' };
    takeSoldiers(sources, n);
    var army = S.createArmy(to, dest, n);
    army.moved = 99;
    WT.military.engageAt(dest, army);
    if (G().armies[army.id]) WT.military.mergeIfIdle(army);
    WT.military.invalidatePower();
    var recipientSize = S.armiesOf(to).reduce(function (s, a) { return s + a.size; }, 0);
    var delta = Math.round(U.clamp(n / 1000 * 0.4 + 40 * n / Math.max(1, recipientSize), 2, 25));
    changeRel(from, to, delta);
    var where = S.provStatic(dest).name;
    S.addLog(name(from) + ' przekazuje ' + U.fmtK(n) + ' żołnierzy dla: ' + name(to) + ' (' + where + ').', from);
    return { ok: true, reason: 'Przekazano ' + U.fmtK(n) + ' żołnierzy dla: ' + name(to) + ' — ' + where + ' (relacje +' + delta + ').', prov: dest, soldiers: n, relDelta: delta };
  }

  function takeSoldiers(sources, n) {
    var MIN = WT.military.MIN_ARMY;
    for (var i = 0; i < sources.length && n > 0; i++) {
      var a = sources[i], take = Math.min(a.size, n);
      if (a.size - take < MIN) { n -= a.size; S.removeArmy(a.id); continue; }
      a.size -= take; n -= take;
    }
  }

  // =====================================================================
  // Propozycje AI → gracz
  // =====================================================================

  var PROPOSAL_TEXT = {
    peace: function (p) {
      var k = p.terms.kind;
      if (k === 'white') return name(p.from) + ' proponuje biały pokój.';
      if (p.terms.winner === p.from) return name(p.from) + ' żąda ' + (k === 'annex' ? 'oddania okupowanych prowincji' : 'reparacji') + ' w zamian za pokój.';
      return name(p.from) + ' oferuje kapitulację (' + (k === 'annex' ? 'oddanie okupowanych prowincji' : 'reparacje') + ').';
    },
    alliance: function (p) { return name(p.from) + ' proponuje sojusz obronny.'; },
    pact: function (p) { return name(p.from) + ' proponuje pakt o nieagresji.'; },
    callToArms: function (p) { return name(p.from) + ' wzywa do wojny przeciw ' + name(p.terms.enemy) + ' (sojusz obronny).'; },
    trade: function (p) { return name(p.from) + ' proponuje umowę handlową (+3% dochodu dla obu stron).'; },
    land: function (p) { return name(p.from) + ' proponuje umowę terytorialną: ' + (WT.land ? WT.land.describe(p.terms) : '') + '.'; },
    access: function (p) { return name(p.from) + ' proponuje pakt o przejściu wojsk (obie strony mogą wprowadzać armie na tereny drugiej przez ' + (WT.land ? WT.land.ACCESS_TURNS : 40) + ' tur).'; },
    treaty: function (p) { return name(p.from) + ' żąda traktatu pokojowego: ' + (WT.vassal ? WT.vassal.describeTerms(p.terms) : '') + '.'; },
    aidRequest: function (p) { return name(p.from) + ' przegrywa wojnę z: ' + name(p.terms.enemy) + ' i prosi o ' + U.fmtMoney(p.terms.amount) + ' wsparcia (lepsze relacje).'; }
  };

  function addProposal(from, to, type, terms) {
    var dup = G().proposals.some(function (p) { return p.from === from && p.to === to && p.type === type; });
    if (dup) return null;
    if (type === 'pact' && isPlayer(to) && S.settings().autoRejectPacts) {
      S.addLog('Automatycznie odrzucono pakt o nieagresji od: ' + name(from) + '.', to);
      return { id: null, autoRejected: true };   // traktowane jak złożona oferta (cooldown AI), bez okna dla gracza
    }
    var p = { id: S.newId('p'), from: from, to: to, type: type, terms: terms || {}, turn: G().turn };
    p.text = PROPOSAL_TEXT[type](p);
    G().proposals.push(p);
    S.addLog('Propozycja: ' + p.text, from);
    WT.events.emit('proposal', p);
    return p;
  }

  function answerProposal(id, accept) {
    var p = null;
    G().proposals = G().proposals.filter(function (x) { if (x.id === id) { p = x; return false; } return true; });
    if (!p) return { ok: false, reason: 'Propozycja wygasła.' };
    if (!accept) return declineProposal(p);
    return acceptProposal(p);
  }

  function acceptProposal(p) {
    if (p.type === 'peace') {
      if (!atWar(p.from, p.to)) return { ok: false, reason: 'Wojna już się zakończyła.' };
      concludePeace(p.from, p.to, p.terms.kind, p.terms.winner);
      return { ok: true, reason: 'Pokój zawarty.' };
    }
    if (p.type === 'land' && WT.land) {
      var lerr = WT.land.checkDeal(p.terms);
      if (lerr) return { ok: false, reason: 'Umowa nieaktualna: ' + lerr };
      WT.land.executeDeal(p.terms);
      return { ok: true, reason: 'Umowa terytorialna zawarta: ' + WT.land.describe(p.terms) + '.' };
    }
    if (p.type === 'access' && WT.land) {
      var aerr = WT.land.checkAccess(p.from, p.to);
      if (aerr) return { ok: false, reason: aerr };
      WT.land.makeAccess(p.from, p.to);
      return { ok: true, reason: 'Pakt o przejściu wojsk zawarty (' + WT.land.ACCESS_TURNS + ' tur).' };
    }
    if (p.type === 'treaty') {
      if (!atWar(p.from, p.to) || !V()) return { ok: false, reason: 'Wojna już się zakończyła.' };
      var t = V().stillValid(p.from, p.to, p.terms);
      concludePeace(p.from, p.to, 'treaty', p.from, t);
      return { ok: true, reason: 'Pokój zawarty na warunkach: ' + name(p.from) + (t.vassal ? ' — jesteś teraz wasalem.' : '.') };
    }
    if (p.type === 'alliance') return formAlliance(p.from, p.to) ? { ok: true, reason: 'Sojusz zawarty.' } : { ok: false, reason: 'Nie można zawrzeć sojuszu.' };
    if (p.type === 'pact') { makePact(p.from, p.to); return { ok: true, reason: 'Pakt podpisany.' }; }
    if (p.type === 'trade') {
      if (atWar(p.from, p.to)) return { ok: false, reason: 'Jesteście w stanie wojny.' };
      makeTrade(p.from, p.to);
      return { ok: true, reason: 'Umowa handlowa podpisana (+3% dochodu).' };
    }
    if (p.type === 'aidRequest') {
      var res = giveMoney(p.to, p.from, p.terms.amount);
      if (res.ok) changeRel(p.from, p.to, 5);   // wdzięczność ponad zwykły efekt daru
      return res;
    }
    if (p.type === 'callToArms') {
      var war = G().wars.filter(function (w) { return w.id === p.terms.warId; })[0];
      if (!war || !S.country(p.to).alive) return { ok: false, reason: 'Ta wojna już się zakończyła.' };
      joinWar(war, p.to, p.terms.side);
      return { ok: true, reason: 'Przystąpiono do wojny.' };
    }
    return { ok: false, reason: 'Nieznana propozycja.' };
  }

  function declineProposal(p) {
    if (p.type === 'callToArms') { changeRel(p.from, p.to, -25); return { ok: true, reason: 'Odmówiono — relacje z ' + name(p.from) + ' spadają.' }; }
    if (p.type === 'aidRequest') { changeRel(p.from, p.to, -6); return { ok: true, reason: 'Odmówiono pomocy — relacje z ' + name(p.from) + ' spadają.' }; }
    changeRel(p.from, p.to, -3);
    return { ok: true, reason: 'Propozycja odrzucona.' };
  }

  // =====================================================================
  // Tura dyplomatyczna
  // =====================================================================

  function processTurn() {
    var t = G().turn;
    G().pacts = G().pacts.filter(function (x) { return x.until > t; });
    G().truces = G().truces.filter(function (x) { return x.until > t; });
    G().proposals = G().proposals.filter(function (p) { return t - p.turn < PROPOSAL_TTL; });
    G().wars.forEach(warScore);
    if (V()) V().processTurn();
    if (WT.land) WT.land.processTurn();
    S.checkGoal();
    pruneTrades();
    refreshCountries();
  }

  return {
    reindex: reindex, relation: relation, changeRel: changeRel, setRel: setRel,
    atWar: atWar, allied: allied, friendly: friendly, hasPact: hasPact, hasTruce: hasTruce,
    enemiesOf: enemiesOf, alliesOf: alliesOf, warBetween: warBetween, warsOf: warsOf, sideOf: sideOf, isLeader: isLeader,
    declareWar: declareWar, checkDeclareWar: checkDeclareWar, startWar: startWar, joinWar: joinWar,
    warScore: warScore, scoreOf: scoreOf, recordLosses: recordLosses, capitalLost: capitalLost, occupiedShare: occupiedShare,
    proposePeace: proposePeace, evaluatePeace: evaluatePeace, concludePeace: concludePeace,
    proposeAlliance: proposeAlliance, evaluateAlliance: evaluateAlliance, commonEnemyOrThreat: commonEnemyOrThreat, MAX_ALLIANCES: MAX_ALLIANCES, formAlliance: formAlliance, breakAlliance: breakAlliance,
    proposePact: proposePact, makePact: makePact, breakPact: breakPact,
    aggression: aggression, proposeTrade: proposeTrade, makeTrade: makeTrade, cancelTrade: cancelTrade, hasTrade: hasTrade, tradesOf: tradesOf,
    improveRelations: improveRelations, improveRelationsCost: improveRelationsCost, insult: insult,
    giveMoney: giveMoney, giveTroops: giveTroops, availableTroops: availableTroops, aidTroopsReason: aidTroopsReason, aidDestination: aidDestination,
    addProposal: addProposal, answerProposal: answerProposal,
    afterBorderChange: afterBorderChange, refreshCountries: refreshCountries, eliminate: eliminate,
    processTurn: processTurn
  };
})();

if (typeof module !== 'undefined') module.exports = WT.diplomacy;
