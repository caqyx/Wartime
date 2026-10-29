var WT = (typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (global.WT = global.WT || {}));

/*
 * WT.goals — powód do ponownej gry:
 *  - statystyki partii (G.stats): bitwy, wojny, traktaty, zdobyte prowincje, szczyt terytorium,
 *  - misje dla państwa gracza (G.missions) z nagrodami (pieniądze, stabilność),
 *  - osiągnięcia zapisywane w przeglądarce (między partiami),
 *  - poziomy trudności (mnożniki dochodu gracza i AI) i wynik końcowy partii.
 */
WT.goals = (function () {
  var U = WT.util, S = WT.state;
  var D = function () { return WT.diplomacy; }, E = function () { return WT.economy; };
  var ACH_KEY = 'wartime_achievements';

  function G() { return WT.G; }
  function me() { return G().player; }
  function c() { return S.country(me()); }

  // =====================================================================
  // Poziomy trudności
  // =====================================================================
  var DIFFICULTY = {
    easy: { label: 'Łatwy', player: 1.25, ai: 0.9, aggr: -10 },
    normal: { label: 'Normalny', player: 1, ai: 1, aggr: 0 },
    hard: { label: 'Trudny', player: 0.9, ai: 1.15, aggr: 10 },
    brutal: { label: 'Bardzo trudny', player: 0.8, ai: 1.3, aggr: 20 }
  };
  function difficulty() { var s = G() && G().settings; return DIFFICULTY[(s && s.difficulty) || 'normal'] || DIFFICULTY.normal; }
  /** Mnożnik dochodu (gracz / AI) wg poziomu trudności. */
  function incomeMult(cc) { if (!G()) return 1; var d = difficulty(); return cc === me() ? d.player : d.ai; }

  // =====================================================================
  // Statystyki partii
  // =====================================================================
  function stats() {
    var g = G();
    if (!g.stats) g.stats = { battlesWon: 0, battlesLost: 0, wars: 0, peaces: 0, treaties: 0, provsGained: 0, provsLost: 0, maxProvs: 0, vassals: 0, released: 0, bought: 0, warTurns: 0, peaceStreak: 0, maxPeaceStreak: 0, startTurn: g.turn };
    return g.stats;
  }
  var hooks = null;
  /** Podpięcie liczników do szyny zdarzeń (po newGame i wczytaniu gry). */
  function attach() {
    if (hooks) Object.keys(hooks).forEach(function (n) { WT.events.off(n, hooks[n]); });
    hooks = {
      battle: function (r) { var p = me(); if (r.attacker !== p && r.defender !== p) return; if (r.winnerCc === p) { stats().battlesWon++; unlock('first_blood'); } else stats().battlesLost++; },
      war: function (r) { var p = me(), w = r.war; if (!w || (r.joined && r.joined !== p)) return; if (w.attackers.concat(w.defenders).indexOf(p) >= 0 && !r.joined) stats().wars++; },
      peace: function (r) {
        var p = me(); if (r.a !== p && r.b !== p) return;
        stats().peaces++;
        if (r.winner === p && r.kind !== 'white') { var st = stats(); (st.beat = st.beat || {})[r.a === p ? r.b : r.a] = true; }
        if (r.kind === 'treaty' && r.winner === p) { stats().treaties++; unlock('peace_through_strength'); }
      },
      occupy: function (r) { var p = me(); if (r.by === p && r.from !== p) stats().provsGained++; if (r.from === p && r.by !== p) stats().provsLost++; },
      vassal: function (r) { if (r.overlord === me()) { stats().vassals++; unlock('overlord'); } },
      released: function (r) { if (r.overlord === me()) { stats().released++; unlock('rebirth'); } },
      goal: function (r) { if (r.cc === me()) unlock('independence'); }
    };
    Object.keys(hooks).forEach(function (n) { WT.events.on(n, hooks[n]); });
  }

  // =====================================================================
  // Osiągnięcia (localStorage, między partiami)
  // =====================================================================
  var ACHIEVEMENTS = [
    { id: 'first_blood', name: 'Pierwsza krew', desc: 'Wygraj bitwę.' },
    { id: 'peace_through_strength', name: 'Pokój przez siłę', desc: 'Narzuć wrogowi traktat pokojowy.' },
    { id: 'overlord', name: 'Suzeren', desc: 'Zdobądź pierwszego wasala.' },
    { id: 'rebirth', name: 'Odrodzenie', desc: 'Odtwórz upadłe państwo jako wasala.' },
    { id: 'independence', name: 'Niepodległość', desc: 'Wygraj powstanie: odzyskaj wszystkie ziemie rdzenne.' },
    { id: 'merchant', name: 'Kupiec ziemski', desc: 'Kup lub wymień prowincję w umowie terytorialnej.' },
    { id: 'empire', name: 'Imperium', desc: 'Posiadaj 100 prowincji.' },
    { id: 'half_world', name: 'Połowa świata', desc: 'Ty i twoi wasale macie połowę prowincji na mapie.' },
    { id: 'world', name: 'Władca świata', desc: 'Ty i twoi wasale macie 90% prowincji na mapie.' },
    { id: 'banker', name: 'Bankier', desc: 'Zgromadź w skarbcu równowartość 100 tygodniowych dochodów (min. 100 mld $).' },
    { id: 'pacifist', name: 'Pacyfista', desc: 'Przetrwaj 200 tur bez żadnej wojny.' },
    { id: 'scientist', name: 'Uczony', desc: 'Odkryj 15 technologii.' },
    { id: 'survivor', name: 'Ocalały', desc: 'Przetrwaj wojnę z koalicją (agresywna ekspansja ≥ 70).' },
    { id: 'warlord', name: 'Wódz', desc: 'Wygraj 50 bitew w jednej partii.' },
    { id: 'hard_win', name: 'Twardziel', desc: 'Wygraj 20 bitew na poziomie Trudny lub wyższym.' }
  ];
  function store() { try { return U.root().localStorage || null; } catch (e) { return null; } }
  function unlocked() { var s = store(); if (!s) return memAch; try { return JSON.parse(s.getItem(ACH_KEY) || '{}'); } catch (e) { return {}; } }
  var memAch = {};
  /** Odblokowanie (raz na zawsze w tej przeglądarce); zdarzenie `achievement` dla UI. */
  function unlock(id) {
    var a = unlocked();
    if (a[id] || !ACHIEVEMENTS.some(function (x) { return x.id === id; })) return false;
    a[id] = { at: Date.now(), cc: G() ? me() : null };
    var s = store();
    if (s) { try { s.setItem(ACH_KEY, JSON.stringify(a)); } catch (e) { /* pełny magazyn */ } } else memAch = a;
    var def = ACHIEVEMENTS.filter(function (x) { return x.id === id; })[0];
    if (G()) { (stats().achievements = stats().achievements || []).push(id); S.addLog('Osiągnięcie: ' + def.name + ' — ' + def.desc, me()); }
    WT.events.emit('achievement', { id: id, name: def.name, desc: def.desc });
    return true;
  }
  function checkAchievements() {
    var p = me(), cc = c(); if (!cc || !cc.alive) return;
    var st = stats(), provs = S.provincesOf(p).length;
    if (provs >= 100) unlock('empire');
    var wp = S.goalProgress ? S.goalProgress().world : null;
    if (wp && wp.have >= wp.total * 0.5) unlock('half_world');
    if (wp && wp.have >= wp.total * 0.9) unlock('world');
    if (!G().god && cc.treasury >= Math.max(100, (cc.lastIncome || 0) * 100)) unlock('banker');
    if (st.maxPeaceStreak >= 200) unlock('pacifist');
    if (cc.techs && Object.keys(cc.techs).length >= 15) unlock('scientist');
    if (st.battlesWon >= 50) unlock('warlord');
    if (st.battlesWon >= 20 && ['hard', 'brutal'].indexOf((G().settings || {}).difficulty) >= 0) unlock('hard_win');
    if (WT.world && WT.world.aeOf(p) >= 70 && D().enemiesOf(p).length && st.warTurns > 26) unlock('survivor');
  }

  // =====================================================================
  // Misje
  // =====================================================================
  function nbsOf(cc) { return S.countryNeighbors(cc).filter(function (n) { var x = S.country(n); return x && x.alive && n !== S.VOID; }); }
  /** Generuje 4 misje dopasowane do sytuacji państwa (raz na partię, uzupełniane po wykonaniu). */
  function makeMissions() {
    var p = me(), cc = c(), out = [], gdp = E().countryGdp(p), provs = S.provincesOf(p).length;
    var rivals = (cc.rivals || []).filter(function (r) { var x = S.country(r); return x && x.alive; });
    var nbs = nbsOf(p).sort(function (a, b) { return WT.military.power(a) - WT.military.power(b); });
    var lostCores = S.coresOf(p).filter(function (id) { return G().provinces[id].owner !== p; });
    if (lostCores.length) out.push({ id: 'cores', text: 'Odzyskaj ziemie rdzenne (' + lostCores.length + ' prowincji)', target: lostCores.length, cores: lostCores });
    out.push({ id: 'gdp', text: 'Zwiększ PKB do ' + Math.round(gdp * 1.3) + ' mld $', target: Math.round(gdp * 1.3) });
    out.push({ id: 'provs', text: 'Posiadaj ' + Math.max(provs + 5, Math.round(provs * 1.5)) + ' prowincji', target: Math.max(provs + 5, Math.round(provs * 1.5)) });
    if (rivals.length) out.push({ id: 'rival', text: 'Pokonaj rywala: ' + S.country(rivals[0]).name + ' (traktat, wasalizacja albo upadek)', who: rivals[0] });
    else if (nbs.length) out.push({ id: 'vassal', text: 'Zwasalizuj sąsiada: ' + S.country(nbs[0]).name, who: nbs[0] });
    out.push({ id: 'uni', text: 'Zbuduj 6 poziomów uniwersytetów', target: 6 });
    out.push({ id: 'tech', text: 'Osiągnij technologię ' + (Math.round((cc.tech + 0.15) * 100) / 100), target: Math.round((cc.tech + 0.15) * 100) / 100 });
    return out.slice(0, 4).map(function (m) { m.done = false; m.reward = 'stability'; return m; });
  }
  function missions() { var g = G(); if (!g.missions) g.missions = makeMissions(); return g.missions; }
  /** Postęp misji: { have, need } (lub done). */
  function progress(m) {
    var p = me(), cc = c();
    switch (m.id) {
      case 'cores': return { have: m.cores.filter(function (id) { return G().provinces[id].owner === p; }).length, need: m.target };
      case 'gdp': return { have: Math.round(E().countryGdp(p)), need: m.target };
      case 'provs': return { have: S.provincesOf(p).length, need: m.target };
      case 'uni': return { have: S.provincesOf(p).reduce(function (s, id) { return s + (G().provinces[id].buildings.university || 0); }, 0), need: m.target };
      case 'tech': return { have: Math.round(cc.tech * 100) / 100, need: m.target };
      case 'vassal': return { have: WT.vassal && WT.vassal.overlordOf(m.who) === p ? 1 : 0, need: 1 };
      case 'rival': {
        var r = S.country(m.who), beaten = !r || !r.alive || (WT.vassal && WT.vassal.overlordOf(m.who) === p) || (G().stats && G().stats.beat && G().stats.beat[m.who]);
        return { have: beaten ? 1 : 0, need: 1 };
      }
    }
    return { have: 0, need: 1 };
  }
  function reward(m) {
    var cc = c(), money = U.round(Math.max(5, (cc.lastIncome || 0) * 15), 1);
    cc.treasury += money;
    if (WT.world) WT.world.addStab(me(), 8, 52, 'Misja: ' + m.text);
    S.addLog('Misja wykonana: ' + m.text + '. Nagroda: ' + U.fmtMoney(money) + ' i stabilność +8 na rok.', me());
    WT.events.emit('mission', { mission: m, money: money });
  }
  function checkMissions() {
    missions().forEach(function (m) {
      if (m.done) return;
      var pr = progress(m);
      if (pr.have >= pr.need) { m.done = true; m.doneTurn = G().turn; reward(m); }
    });
  }

  // =====================================================================
  // Wynik partii
  // =====================================================================
  function score() {
    var p = me(), st = stats(), cc = c(), wp = S.goalProgress ? S.goalProgress().world : { have: 0, total: 1 };
    var base = cc && cc.alive ? 1000 : 0;
    var v = base + wp.have * 20 + st.battlesWon * 15 - st.battlesLost * 5 + st.treaties * 100 + st.vassals * 150 + st.released * 80 +
      missions().filter(function (m) { return m.done; }).length * 250 + (stats().achievements || []).length * 200 +
      Math.round(E().countryGdp(p) / 10);
    return Math.round(v * (G().settings && G().settings.difficulty === 'brutal' ? 1.6 : G().settings && G().settings.difficulty === 'hard' ? 1.3 : G().settings && G().settings.difficulty === 'easy' ? 0.7 : 1));
  }
  function summary() {
    var st = stats(), p = me();
    return { turns: G().turn - (st.startTurn || 0), provs: S.provincesOf(p).length, maxProvs: Math.max(st.maxProvs || 0, S.provincesOf(p).length), battlesWon: st.battlesWon, battlesLost: st.battlesLost,
      wars: st.wars, peaces: st.peaces, treaties: st.treaties, vassals: st.vassals, released: st.released, gained: st.provsGained, lost: st.provsLost,
      missions: missions().filter(function (m) { return m.done; }).length, achievements: (st.achievements || []).slice(), score: score(), difficulty: difficulty().label };
  }

  function processTurn() {
    if (!G() || !c()) return;
    var st = stats(), p = me(), atWar = D().enemiesOf(p).length > 0;
    st.maxProvs = Math.max(st.maxProvs || 0, S.provincesOf(p).length);
    if (atWar) { st.warTurns = (st.warTurns || 0) + 1; st.peaceStreak = 0; }
    else { st.peaceStreak = (st.peaceStreak || 0) + 1; st.maxPeaceStreak = Math.max(st.maxPeaceStreak || 0, st.peaceStreak); }
    if (!c().alive) return;
    checkMissions();
    checkAchievements();
  }

  return {
    DIFFICULTY: DIFFICULTY, difficulty: difficulty, incomeMult: incomeMult,
    stats: stats, attach: attach, ACHIEVEMENTS: ACHIEVEMENTS, unlocked: unlocked, unlock: unlock,
    missions: missions, progress: progress, score: score, summary: summary, processTurn: processTurn
  };
})();

if (typeof module !== 'undefined') module.exports = WT.goals;
