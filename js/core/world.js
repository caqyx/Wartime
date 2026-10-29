var WT = (typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (global.WT = global.WT || {}));

/*
 * WT.world — żywy świat:
 *  - wydarzenia z wyborami (losowe i historyczne wg daty); gracz wybiera w oknie, AI wybiera samo,
 *  - niepokoje w prowincjach (obce ziemie, świeży podbój, niska stabilność; garnizon i fort uspokajają)
 *    obniżają dochód; przy wysokich niepokojach wybucha bunt — często odradza się upadłe państwo,
 *  - agresywna ekspansja (country.ae): podboje budzą nieufność świata, psują relacje i tworzą koalicje,
 *  - modyfikatory stabilności z wydarzeń (country.stabMods), wybory w demokracjach, rewolucje.
 */
WT.world = (function () {
  var U = WT.util, S = WT.state;
  var D = function () { return WT.diplomacy; }, E = function () { return WT.economy; }, Mil = function () { return WT.military; };

  var PLAYER_EVENT_CHANCE = 0.12, PLAYER_EVENT_GAP = 6, AI_EVENT_CHANCE = 0.015;
  var UNREST_STEP = 3, REVOLT_AT = 70, REVOLT_CHANCE = 0.1;
  var AE_DECAY_WAR = 0.3, AE_DECAY_PEACE = 0.8, AE_COALITION = 50, AE_WAR = 70;
  var ELECTION_EVERY = 208;

  function G() { return WT.G; }
  function name(cc) { var c = S.country(cc); return c ? c.name : cc; }
  function isPlayer(cc) { return cc === G().player; }
  function alive(cc) { var c = S.country(cc); return !!(c && c.alive); }
  function turn() { return G().turn; }

  // =====================================================================
  // Modyfikatory stabilności
  // =====================================================================

  function addStab(cc, v, turns, why) {
    var c = S.country(cc);
    (c.stabMods = c.stabMods || []).push({ v: v, until: turn() + turns, why: why });
  }
  /** Suma aktywnych modyfikatorów (doliczana do celu stabilności w ekonomii). */
  function stabilityMod(c) {
    if (!c.stabMods || !c.stabMods.length) return 0;
    var t = turn();
    c.stabMods = c.stabMods.filter(function (m) { return m.until > t; });
    return c.stabMods.reduce(function (s, m) { return s + m.v; }, 0);
  }

  // =====================================================================
  // Ziemie rdzenne prowincji (dla niepokojów i buntów)
  // =====================================================================

  var coreCache = { g: null, map: null };
  /** Narody, dla których prowincja jest rdzenna: właściciel z 2026 i właściciel w scenariuszu. */
  function coreNations(id) {
    if (coreCache.g !== G()) {
      var sc = S.scenarioData(G().scenario), map = [];
      U.mapData().provinces.forEach(function (p, i) {
        var l = [p.cc];
        if (sc && sc.owners[i] && sc.owners[i] !== p.cc) l.push(sc.owners[i]);
        map.push(l);
      });
      coreCache = { g: G(), map: map };
    }
    return coreCache.map[id] || [];
  }
  function isCoreOf(cc, id) { return coreNations(id).indexOf(cc) >= 0; }

  // =====================================================================
  // Niepokoje i bunty
  // =====================================================================

  function unrestTarget(id) {
    var p = G().provinces[id], c = S.country(p.owner);
    if (!c || p.owner === S.VOID) return 0;
    var t = 0;
    if (!isCoreOf(p.owner, id)) t += p.acq == null ? 20 : 40;   // ziemie posiadane od startu (np. kolonie) — mniej
    if (p.acq != null && turn() - p.acq < 52 && !isCoreOf(p.owner, id)) t += 20;
    t += Math.max(0, (50 - c.stability) * 0.6);
    if (S.armiesIn(id).some(function (a) { return a.owner === p.owner; })) t -= 20;
    t -= 5 * (p.buildings.fort || 0);
    if (p.ctrl !== p.owner) t = Math.min(t, 30);
    return U.clamp(t, 0, 100);
  }
  /** Mnożnik dochodu prowincji z powodu niepokojów (do −50%). */
  function unrestIncome(p) { return 1 - (p.unrest || 0) / 200; }

  function updateUnrest() {
    G().provinces.forEach(function (p, id) {
      if (p.owner === S.VOID) return;
      var t = unrestTarget(id), u = p.unrest || 0;
      p.unrest = Math.round(U.clamp(u + U.clamp(t - u, -UNREST_STEP, UNREST_STEP), 0, 100));
      if (p.unrest >= REVOLT_AT && !S.armiesIn(id).some(function (a) { return a.owner === p.owner; }) && U.chance(REVOLT_CHANCE)) revolt(id);
    });
  }

  /** Bunt: odradza się naród, dla którego ziemia jest rdzenna (jeśli nie istnieje); inaczej zamieszki. */
  function revolt(id) {
    var p = G().provinces[id], owner = p.owner;
    var nation = coreNations(id).filter(function (n) { return n !== owner && S.nationCandidates().indexOf(n) >= 0; })[0];
    if (nation && S.provincesOf(owner).length > 1) {
      var provs = [id].concat(S.landNeighbors(id).filter(function (n) {
        var q = G().provinces[n];
        return q.owner === owner && q.ctrl === owner && (q.unrest || 0) >= 50 && isCoreOf(nation, n) && S.country(owner).capital !== n;
      })).filter(function (n) { return S.country(owner).capital !== n; });
      if (!provs.length) return;
      var pop = provs.reduce(function (s, n) { return s + S.provPop(n); }, 0);
      var c = S.spawnCountry(nation, provs, { army: Math.round(U.clamp(pop * 5000, 8000, 60000)), tech: S.country(owner).tech * 0.9 });
      provs.forEach(function (n) { G().provinces[n].unrest = 0; });
      D().startWar([nation], [owner], true);
      S.addLog('Bunt! ' + c.name + ' ogłasza niepodległość (' + provs.map(function (n) { return S.provStatic(n).name; }).join(', ') + ') i walczy z: ' + name(owner) + '.', owner);
      WT.events.emit('revolt', { prov: id, nation: nation, owner: owner });
      return;
    }
    p.dev = Math.max(0.3, (p.dev || 1) - 0.05);
    p.unrest = Math.max(0, p.unrest - 25);
    if (isPlayer(owner)) S.addLog('Zamieszki w: ' + S.provStatic(id).name + ' (rozwój −0,05). Postaw tam garnizon albo fort.', owner);
  }

  // =====================================================================
  // Agresywna ekspansja i koalicje
  // =====================================================================

  function aeOf(cc) { var c = S.country(cc); return c && c.ae ? c.ae : 0; }
  function addAE(cc, v) { var c = S.country(cc); if (c && v > 0) c.ae = U.round(Math.min(100, (c.ae || 0) + v), 1); }
  /** Zabór prowincji siłą (traktat, aneksja): ekspansja wg wartości, ziemie rdzenne zdobywcy liczą się 4× słabiej. */
  function onConquest(cc, provs, factor) {
    var v = (provs || []).reduce(function (s, id) {
      var val = WT.vassal ? WT.vassal.provValue(id) : 5;
      return s + val * (isCoreOf(cc, id) ? 0.25 : 1);
    }, 0);
    addAE(cc, v * 0.4 * (factor || 1));
  }
  function aeLabel(v) { return v >= AE_WAR ? 'świat szykuje koalicję' : v >= AE_COALITION ? 'sąsiedzi łączą się przeciw tobie' : v >= 25 ? 'rosnąca nieufność' : 'spokój'; }
  /** Mnożnik szansy, że AI zaatakuje państwo o wysokiej ekspansji. */
  function aeWarFactor(cc) { return 1 + aeOf(cc) / 40; }

  function updateAE() {
    S.countriesAlive().forEach(function (cc) {
      var c = S.country(cc);
      if (!c.ae) return;
      var ae = c.ae;
      if (ae > 20) {
        var nbs = S.countryNeighbors(cc);
        nbs.forEach(function (n) {
          if (D().allied(cc, n) || (WT.vassal && WT.vassal.related(cc, n))) return;
          if (D().relation(cc, n) > -60) D().changeRel(cc, n, -ae / 40);
        });
        if (ae >= AE_COALITION && turn() % 4 === 0) formCoalition(cc, nbs);
        if (ae >= AE_WAR && U.chance(0.05)) coalitionWar(cc);
      }
      c.ae = U.round(Math.max(0, ae - (D().enemiesOf(cc).length ? AE_DECAY_WAR : AE_DECAY_PEACE)), 1);
    });
  }
  function coalitionMembers(cc) {
    return S.countryNeighbors(cc).filter(function (n) {
      return alive(n) && !isPlayer(n) && D().relation(cc, n) < -40 && !D().allied(cc, n) && !(WT.vassal && (WT.vassal.related(cc, n) || WT.vassal.overlordOf(n)));
    });
  }
  /** Zagrożeni sąsiedzi zawierają między sobą sojusze obronne. */
  function formCoalition(cc, nbs) {
    var m = coalitionMembers(cc);
    for (var i = 0; i < m.length; i++) for (var j = i + 1; j < m.length; j++) {
      if (!D().allied(m[i], m[j]) && !D().atWar(m[i], m[j]) && D().alliesOf(m[i]).length < D().MAX_ALLIANCES && D().alliesOf(m[j]).length < D().MAX_ALLIANCES) {
        if (D().formAlliance(m[i], m[j]) && involvesPlayerTarget(cc)) S.addLog('Koalicja przeciw ' + name(cc) + ': sojusz ' + name(m[i]) + ' – ' + name(m[j]) + '.', cc);
        return;
      }
    }
  }
  function involvesPlayerTarget(cc) { return isPlayer(cc) || D().allied(cc, G().player); }
  /** Silna koalicja wypowiada wspólną wojnę ekspansjoniście. */
  function coalitionWar(cc) {
    var m = coalitionMembers(cc).filter(function (n) { return !D().atWar(n, cc) && !D().checkDeclareWar(n, cc); });
    if (m.length < 2) return;
    var pw = m.reduce(function (s, n) { return s + Mil().power(n); }, 0);
    if (pw < 0.9 * Mil().power(cc)) return;
    D().startWar(m, [cc]);
    S.addLog('Koalicja ' + m.map(name).join(', ') + ' wypowiada wojnę agresorowi: ' + name(cc) + '!', cc);
  }

  // =====================================================================
  // Wydarzenia z wyborami
  // =====================================================================

  function capital(cc) { return S.country(cc).capital; }
  function weeklyIncome(cc) { return Math.max(0.05, S.country(cc).lastIncome || E().income(cc).total || 0.05); }
  function pay(cc, amount) { if (!(isPlayer(cc) && G().god)) S.country(cc).treasury -= amount; }
  function randomOwnProvince(cc) { var l = S.provincesOf(cc).filter(function (id) { return G().provinces[id].ctrl === cc; }); return l.length ? U.pick(l) : -1; }
  function allArmies(cc, f) { S.armiesOf(cc).forEach(function (a) { a.size = Math.max(0, Math.round(a.size * f)); if (a.size < Mil().MIN_ARMY) S.removeArmy(a.id); }); }

  /** Definicje: cond(cc) → bool, data(cc) → kontekst, opcje z apply(cc, d) i opisem; ai = indeks opcji dla AI. */
  var EVENTS = [
    { id: 'crisis', title: 'Kryzys finansowy', w: 1, cond: function (cc) { return S.country(cc).treasury > 0; },
      text: function () { return 'Banki chwieją się, kurs waluty leci w dół. Rząd musi zdecydować.'; },
      options: [
        { label: 'Ratujemy banki', desc: function (cc) { return '−' + U.fmtMoney(weeklyIncome(cc) * 6) + ', stabilność +5 na 20 tur'; }, apply: function (cc) { pay(cc, weeklyIncome(cc) * 6); addStab(cc, 5, 20, 'Ratowanie banków'); } },
        { label: 'Zaciskamy pasa', desc: function () { return 'stabilność −12 na 26 tur'; }, apply: function (cc) { addStab(cc, -12, 26, 'Kryzys i cięcia'); } }
      ], ai: 0 },
    { id: 'boom', title: 'Boom gospodarczy', w: 1, cond: function () { return true; },
      text: function () { return 'Gospodarka przyspiesza: rośnie eksport i inwestycje.'; },
      options: [
        { label: 'Inwestujemy w regiony', desc: function () { return 'rozwój wszystkich prowincji +3%'; }, apply: function (cc) { S.provincesOf(cc).forEach(function (id) { G().provinces[id].dev = U.round((G().provinces[id].dev || 1) * 1.03, 4); }); } },
        { label: 'Zasilamy budżet', desc: function (cc) { return '+' + U.fmtMoney(weeklyIncome(cc) * 8); }, apply: function (cc) { S.country(cc).treasury += weeklyIncome(cc) * 8; } }
      ], ai: 0 },
    { id: 'strike', title: 'Strajk generalny', w: 1, cond: function (cc) { return S.country(cc).stability < 75; },
      text: function () { return 'Związki zawodowe paraliżują kraj i żądają podwyżek.'; },
      options: [
        { label: 'Ustępujemy', desc: function (cc) { return '−' + U.fmtMoney(weeklyIncome(cc) * 3) + ', stabilność +6 na 15 tur'; }, apply: function (cc) { pay(cc, weeklyIncome(cc) * 3); addStab(cc, 6, 15, 'Porozumienie ze związkami'); } },
        { label: 'Rozpędzamy strajk', desc: function () { return 'stabilność −10 na 20 tur, niepokoje w stolicy +30'; }, apply: function (cc) { addStab(cc, -10, 20, 'Rozbity strajk'); var c = capital(cc); if (c >= 0) G().provinces[c].unrest = Math.min(100, (G().provinces[c].unrest || 0) + 30); } }
      ], ai: 0 },
    { id: 'disaster', title: 'Klęska żywiołowa', w: 1, cond: function (cc) { return randomOwnProvince(cc) >= 0; },
      data: function (cc) { return { prov: randomOwnProvince(cc) }; },
      text: function (cc, d) { return 'Powódź i zniszczenia w prowincji ' + S.provStatic(d.prov).name + '. Ludzie czekają na pomoc.'; },
      options: [
        { label: 'Wysyłamy pomoc', desc: function (cc) { return '−' + U.fmtMoney(weeklyIncome(cc) * 2) + ', rozwój prowincji −3%'; }, apply: function (cc, d) { pay(cc, weeklyIncome(cc) * 2); var p = G().provinces[d.prov]; p.dev = Math.max(0.3, p.dev * 0.97); } },
        { label: 'Niech radzą sobie sami', desc: function () { return 'rozwój prowincji −10%, niepokoje +35, stabilność −4'; }, apply: function (cc, d) { var p = G().provinces[d.prov]; p.dev = Math.max(0.3, p.dev * 0.9); p.unrest = Math.min(100, (p.unrest || 0) + 35); addStab(cc, -4, 15, 'Porzuceni powodzianie'); } }
      ], ai: 0 },
    { id: 'epidemic', title: 'Epidemia', w: 0.7, cond: function () { return true; },
      text: function () { return 'Groźna choroba rozprzestrzenia się po kraju.'; },
      options: [
        { label: 'Kwarantanna', desc: function (cc) { return '−' + U.fmtMoney(weeklyIncome(cc) * 4) + ', rezerwy −5%'; }, apply: function (cc) { pay(cc, weeklyIncome(cc) * 4); S.country(cc).manpower *= 0.95; } },
        { label: 'Gospodarka musi działać', desc: function () { return 'rezerwy −20%, armia −5%, stabilność −6'; }, apply: function (cc) { S.country(cc).manpower *= 0.8; allArmies(cc, 0.95); addStab(cc, -6, 20, 'Epidemia'); } }
      ], ai: 0 },
    { id: 'deposits', title: 'Odkrycie złóż', w: 0.8, cond: function (cc) { return randomOwnProvince(cc) >= 0; },
      data: function (cc) { return { prov: randomOwnProvince(cc) }; },
      text: function (cc, d) { return 'Geolodzy odkryli bogate złoża w prowincji ' + S.provStatic(d.prov).name + '.'; },
      options: [
        { label: 'Państwowe wydobycie', desc: function () { return 'PKB prowincji +25%'; }, apply: function (cc, d) { G().provinces[d.prov].gdp *= 1.25; } },
        { label: 'Sprzedajemy koncesję', desc: function (cc) { return '+' + U.fmtMoney(weeklyIncome(cc) * 6); }, apply: function (cc) { S.country(cc).treasury += weeklyIncome(cc) * 6; } }
      ], ai: 0 },
    { id: 'science', title: 'Przełom naukowy', w: 0.8, cond: function () { return !!WT.tech; },
      text: function () { return 'Nasi naukowcy dokonali przełomowego odkrycia.'; },
      options: [
        { label: 'Finansujemy dalsze badania', desc: function () { return '+40 punktów nauki'; }, apply: function (cc) { var c = S.country(cc); c.rp = (c.rp || 0) + 40; } },
        { label: 'Wdrażamy w przemyśle', desc: function () { return 'PKB stolicy +10%'; }, apply: function (cc) { var c = capital(cc); if (c >= 0) G().provinces[c].gdp *= 1.1; } }
      ], ai: 0 },
    { id: 'volunteers', title: 'Fala ochotników', w: 1, cond: function (cc) { return D().enemiesOf(cc).length > 0 && capital(cc) >= 0; },
      text: function () { return 'Tysiące ochotników zgłaszają się do wojska.'; },
      options: [
        { label: 'Formujemy nową armię', desc: function (cc) { return 'armia ' + U.fmtK(volunteers(cc)) + ' w stolicy'; }, apply: function (cc) { var a = S.createArmy(cc, capital(cc), volunteers(cc)); a.moved = 99; if (WT.warfare) { a.mix = { arm: 0, art: 0 }; a.org = 0.7; } Mil().merge(capital(cc), cc); } },
        { label: 'Kierujemy do rezerw', desc: function (cc) { return 'rezerwy +' + Math.round(volunteers(cc) / 1000 * 1.5) + ' tys.'; }, apply: function (cc) { S.country(cc).manpower += volunteers(cc) / 1000 * 1.5; } }
      ], ai: 0 },
    { id: 'desertion', title: 'Dezercje na froncie', w: 1, cond: function (cc) { return D().enemiesOf(cc).length > 0 && S.country(cc).warExhaustion > 30; },
      text: function () { return 'Zmęczeni wojną żołnierze masowo opuszczają oddziały.'; },
      options: [
        { label: 'Podwyższamy żołd', desc: function (cc) { return '−' + U.fmtMoney(weeklyIncome(cc) * 3); }, apply: function (cc) { pay(cc, weeklyIncome(cc) * 3); } },
        { label: 'Sądy polowe', desc: function () { return 'armia −4%, stabilność −5'; }, apply: function (cc) { allArmies(cc, 0.96); addStab(cc, -5, 15, 'Sądy polowe'); } }
      ], ai: 0 },
    { id: 'scandal', title: 'Afera korupcyjna', w: 0.9, cond: function () { return true; },
      text: function () { return 'Media ujawniają łapówki w rządzie.'; },
      options: [
        { label: 'Dymisja ministrów', desc: function () { return 'stabilność −4 na 10 tur'; }, apply: function (cc) { addStab(cc, -4, 10, 'Dymisje po aferze'); } },
        { label: 'Zamiatamy pod dywan', desc: function () { return 'stabilność −10 na 26 tur'; }, apply: function (cc) { addStab(cc, -10, 26, 'Afera korupcyjna'); } }
      ], ai: 0 },
    { id: 'revolution', title: 'Rewolucja!', w: 3, cond: function (cc) { return S.country(cc).stability < 15; },
      text: function () { return 'Tłumy na ulicach stolicy żądają zmiany władzy.'; },
      options: [
        { label: 'Oddajemy władzę', desc: function () { return 'nowy ustrój, stabilność 55, zmęczenie wojną −30'; }, apply: function (cc) { var c = S.country(cc); c.ideology = c.ideology === 'demokracja' ? 'autorytaryzm' : 'demokracja'; c.gov = c.ideology === 'demokracja' ? 'rząd tymczasowy' : 'junta'; c.stability = 55; c.warExhaustion = Math.max(0, c.warExhaustion - 30); c.stabMods = []; } },
        { label: 'Tłumimy siłą', desc: function () { return 'stabilność +15, niepokoje +25 we wszystkich prowincjach, armia −5%'; }, apply: function (cc) { S.country(cc).stability += 15; S.provincesOf(cc).forEach(function (id) { var p = G().provinces[id]; p.unrest = Math.min(100, (p.unrest || 0) + 25); }); allArmies(cc, 0.95); } }
      ], ai: 1 }
  ];
  function volunteers(cc) { return Math.round(U.clamp(S.country(cc).pop * 400, 3000, 60000) / 1000) * 1000; }
  var BY_ID = {}; EVENTS.forEach(function (e) { BY_ID[e.id] = e; });

  // Wybory w demokracjach (co 4 lata) — osobne wydarzenie wywoływane terminem
  BY_ID.election = { id: 'election', title: 'Wybory', w: 0,
    text: function () { return 'Za kilka tygodni wybory. Wynik wpłynie na stabilność rządu.'; },
    options: [
      { label: 'Kosztowna kampania', desc: function (cc) { return '−' + U.fmtMoney(weeklyIncome(cc) * 3) + ', stabilność +8 na 52 tury'; }, apply: function (cc) { pay(cc, weeklyIncome(cc) * 3); addStab(cc, 8, 52, 'Wygrane wybory'); } },
      { label: 'Niech zdecydują wyborcy', desc: function () { return 'losowo: stabilność od −8 do +8 na 52 tury'; }, apply: function (cc) { addStab(cc, U.randInt(-8, 8), 52, 'Wynik wyborów'); } }
    ], ai: 1 };

  // Wydarzenia historyczne (data, scenariusz): AI wykonuje opcję `ai`, gracz wybiera
  var HISTORY = [
    { id: 'sarajevo', scen: '1914', date: '1914-06-28', who: 'AUH', title: 'Zamach w Sarajewie',
      cond: function () { return alive('AUH') && alive('SRB') && !D().atWar('AUH', 'SRB'); },
      text: function () { return 'Arcyksiążę Franciszek Ferdynand zginął z ręki serbskiego zamachowca. Wiedeń rozważa ultimatum wobec Serbii.'; },
      options: [
        { label: 'Wojna z Serbią', desc: function () { return 'wypowiedzenie wojny Serbii'; }, apply: function (cc) { G().truces = G().truces.filter(function (t) { return !((t.a === cc && t.b === 'SRB') || (t.b === cc && t.a === 'SRB')); }); D().declareWar(cc, 'SRB'); } },
        { label: 'Żądamy przeprosin', desc: function () { return 'relacje z Serbią −30, stabilność −5'; }, apply: function (cc) { D().changeRel(cc, 'SRB', -30); addStab(cc, -5, 20, 'Upokorzenie po zamachu'); } }
      ], ai: 0 },
    { id: 'fall_weiss', scen: '1939', date: '1939-09-01', who: 'GER', title: 'Fall Weiss',
      cond: function () { return alive('GER') && alive('POL') && !D().atWar('GER', 'POL'); },
      text: function () { return 'Prowokacja gliwicka. Sztab generalny czeka na rozkaz ataku na Polskę.'; },
      options: [
        { label: 'Atakujemy Polskę', desc: function () { return 'wypowiedzenie wojny Polsce'; }, apply: function (cc) { D().declareWar(cc, 'POL'); } },
        { label: 'Odwołujemy atak', desc: function () { return 'stabilność −8 na 26 tur'; }, apply: function (cc) { addStab(cc, -8, 26, 'Odwołany atak'); } }
      ], ai: 0 },
    { id: 'krewo', scen: '1385', date: '1385-08-14', who: 'POL', title: 'Unia w Krewie',
      cond: function () { return alive('POL') && alive('LIT') && !D().atWar('POL', 'LIT') && !D().allied('POL', 'LIT'); },
      text: function () { return 'Jagiełło proponuje małżeństwo z Jadwigą i połączenie Korony z Litwą.'; },
      options: [
        { label: 'Zawieramy unię', desc: function () { return 'sojusz Polski i Litwy, relacje +40'; }, apply: function (cc) { D().changeRel('POL', 'LIT', 40); D().formAlliance('POL', 'LIT'); } },
        { label: 'Odrzucamy', desc: function () { return 'relacje z Litwą −20'; }, apply: function () { D().changeRel('POL', 'LIT', -20); } }
      ], ai: 0 }
  ];
  HISTORY.forEach(function (e) { BY_ID[e.id] = e; });

  function pending() { if (!G().events) G().events = []; return G().events; }
  /** Zdarzenie dla państwa: gracz → kolejka do okna, AI → od razu wybór `ai`. */
  function fire(ev, cc) {
    var d = ev.data ? ev.data(cc) : {};
    if (isPlayer(cc)) {
      pending().push({ id: S.newId('e'), ev: ev.id, cc: cc, d: d, turn: turn() });
      G().lastEventTurn = turn();
      WT.events.emit('worldEvent', { ev: ev.id, cc: cc });
      return;
    }
    ev.options[ev.ai || 0].apply(cc, d);
  }
  /** Odpowiedź gracza: indeks opcji. */
  function answer(id, optIndex) {
    var list = pending(), e = list.filter(function (x) { return x.id === id; })[0];
    if (!e) return { ok: false, reason: 'Wydarzenie wygasło.' };
    G().events = list.filter(function (x) { return x !== e; });
    var ev = BY_ID[e.ev], opt = ev.options[optIndex] || ev.options[0];
    opt.apply(e.cc, e.d || {});
    S.addLog(ev.title + ': ' + opt.label + '.', e.cc);
    return { ok: true, reason: ev.title + ': ' + opt.label + '.' };
  }
  /** Widok wydarzenia dla UI. */
  function view(e) {
    var ev = BY_ID[e.ev];
    return { id: e.id, title: ev.title, text: ev.text(e.cc, e.d || {}),
      options: ev.options.map(function (o) { return { label: o.label, desc: o.desc ? o.desc(e.cc, e.d || {}) : '' }; }) };
  }

  function rollEvents() {
    var player = G().player;
    S.countriesAlive().forEach(function (cc) {
      var c = S.country(cc);
      if (isPlayer(cc)) {
        if (pending().length || turn() - (G().lastEventTurn != null ? G().lastEventTurn : -99) < PLAYER_EVENT_GAP || !U.chance(PLAYER_EVENT_CHANCE)) return;
      } else if (!U.chance(AI_EVENT_CHANCE)) return;
      var ok = EVENTS.filter(function (ev) { return ev.cond(cc); });
      var sum = ok.reduce(function (s, ev) { return s + ev.w; }, 0), r = U.rand() * sum;
      for (var i = 0; i < ok.length; i++) { r -= ok[i].w; if (r <= 0) { fire(ok[i], cc); return; } }
    });
    // wybory w demokracjach (co 4 lata, przesunięte per państwo)
    S.countriesAlive().forEach(function (cc, i) {
      var c = S.country(cc);
      if (c.ideology !== 'demokracja') return;
      if ((turn() + (cc.charCodeAt(0) * 7 + cc.charCodeAt(1) * 13) % ELECTION_EVERY) % ELECTION_EVERY === 0) fire(BY_ID.election, cc);
    });
  }
  function rollHistory() {
    var done = G().historyDone = G().historyDone || {};
    HISTORY.forEach(function (h) {
      if (done[h.id] || G().scenario !== h.scen || G().date < h.date) return;
      done[h.id] = true;
      if (!alive(h.who) || !h.cond()) return;
      fire(h, h.who);
    });
  }

  function processTurn() {
    updateUnrest();
    updateAE();
    rollHistory();
    rollEvents();
    G().events = pending().filter(function (e) { return turn() - e.turn < 6; });   // nieodebrane wygasają
  }

  return {
    addStab: addStab, stabilityMod: stabilityMod, coreNations: coreNations, isCoreOf: isCoreOf,
    unrestTarget: unrestTarget, unrestIncome: unrestIncome, revolt: revolt,
    aeOf: aeOf, addAE: addAE, onConquest: onConquest, aeLabel: aeLabel, aeWarFactor: aeWarFactor, AE_COALITION: AE_COALITION, AE_WAR: AE_WAR,
    EVENTS: EVENTS, HISTORY: HISTORY, fire: fire, answer: answer, view: view, pending: pending,
    processTurn: processTurn
  };
})();

if (typeof module !== 'undefined') module.exports = WT.world;
