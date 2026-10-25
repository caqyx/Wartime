/* Testy logiki gry w node (bez frameworków): `node tests/run_tests.js` */
var path = require('path');
var ROOT = path.join(__dirname, '..');
var CORE = ['util', 'state', 'economy', 'diplomacy', 'military', 'naval', 'air', 'tech', 'ai', 'god', 'turn', 'save'];
CORE.forEach(function (m) { require(path.join(ROOT, 'js/core', m + '.js')); });
var WT = global.WT;
var mock = require('./mock_map.js');

var results = { pass: 0, fail: 0 };

function test(name, fn) {
  try { fn(); results.pass++; console.log('PASS  ' + name); }
  catch (e) { results.fail++; console.log('FAIL  ' + name + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e)); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'asercja nie spełniona'); }
function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'różne wartości') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }

// ---------- helpery ----------

function freshGame(opts) {
  mock.install(global, WT);
  WT.events.clear();
  opts = Object.assign({ player: 'AAA', seed: 42, god: false, startWars: false }, opts || {});
  return WT.state.newGame(opts);
}
function G() { return WT.G; }
function clearArmies() { Object.keys(G().armies).forEach(function (id) { WT.state.removeArmy(id); }); }
function soldiers(cc) { return WT.state.armiesOf(cc).reduce(function (s, a) { return s + a.size; }, 0); }
function setRel(a, b, v) { WT.diplomacy.setRel(a, b, v); }

// =====================================================================

test('newGame: państwa, stolice, armie, brak sojuszy', function () {
  var g = freshGame();
  eq(WT.state.countriesAlive().length, 4, 'liczba państw');
  eq(g.alliances.length, 0, 'sojusze na starcie');
  eq(g.countries.AAA.capital, 10, 'stolica AAA (point-in-polygon z lon/lat)');
  eq(g.countries.BBB.capital, 3, 'stolica BBB');
  eq(g.countries.CCC.capital, 19, 'stolica CCC');
  eq(soldiers('AAA'), 100000, 'armia AAA');
  assert(WT.state.armiesIn(10).length === 1 && WT.state.armiesIn(10)[0].size >= 50000, '50% armii w stolicy');
  eq(g.countries.ISL.name, 'ISL', 'domyślne dane ISL');
  eq(g.countries.ISL.startGdp, 60, 'domyślne PKB = pop×5');
  eq(soldiers('ISL'), 24000, 'domyślna armia = pop×2 tys.');
  assert(/^#[0-9a-f]{6}$/.test(g.countries.ISL.color), 'kolor z hasha');
  assert(WT.state.fleetsOf('CCC').length >= 1, 'flota startowa CCC');
  eq(g.provinces[19].buildings.port, 1, 'port w bazie floty');
  assert(WT.diplomacy.relation('AAA', 'BBB') <= -40, 'rywale mają złe relacje');
  eq(WT.state.dateStr(), '5 stycznia 2026', 'data');
  assert(Math.abs(WT.economy.countryGdp('AAA') - 600 * (1 + 0.2 * 1.5 / (10 + 0.5) * 0)) < 50, 'PKB rozłożone na prowincje');
});

test('util: projekcja odwracalna, RNG deterministyczny, kolejka priorytetowa', function () {
  freshGame();
  var ll = WT.util.unproject(123, 456), xy = WT.util.project(ll[0], ll[1]);
  assert(Math.abs(xy[0] - 123) < 1e-6 && Math.abs(xy[1] - 456) < 1e-6, 'project(unproject) = id');
  G().rngState = 7; var a = WT.util.rand(); G().rngState = 7; eq(WT.util.rand(), a, 'RNG z G.rngState');
  var pq = new WT.util.PriorityQueue();
  [5, 1, 4, 2, 3].forEach(function (v) { pq.push(v, v); });
  var out = []; while (pq.size()) out.push(pq.pop());
  eq(out.join(','), '1,2,3,4,5', 'kolejność kopca');
  eq(WT.util.key('POL', 'DEU'), 'DEU|POL', 'key posortowany');
});

test('ekonomia: dochód, wydatki, bilans, przetworzenie tury', function () {
  freshGame();
  var inc = WT.economy.income('AAA'), exp = WT.economy.expenses('AAA');
  assert(inc.total > 0 && inc.tax > 0, 'dochód dodatni');
  assert(exp.army > 0 && exp.total > exp.army, 'wydatki na armię i administrację');
  var c = G().countries.AAA, before = c.treasury, bal = WT.economy.balance('AAA');
  WT.economy.processTurn('AAA');
  assert(Math.abs(c.treasury - (before + bal)) < 0.01, 'skarbiec += bilans');
  eq(c.lastIncome, WT.util.round(inc.total, 3), 'lastIncome');
  WT.economy.setTax('AAA', 0.9); eq(c.taxRate, 0.4, 'podatek przycięty do 40%');
  WT.economy.setTax('AAA', 0.15);
});

test('ekonomia: okupacja przenosi dochód (0 dla właściciela, 30% dla okupanta)', function () {
  freshGame();
  var before = WT.economy.income('BBB').tax;
  WT.diplomacy.startWar(['AAA'], ['BBB'], true);
  WT.state.setCtrl(2, 'AAA');
  assert(WT.economy.income('BBB').tax < before, 'właściciel traci dochód');
  assert(WT.economy.income('AAA').occupation > 0, 'okupant dostaje udział');
});

test('ekonomia: bankructwo demobilizuje armię', function () {
  freshGame();
  var c = G().countries.AAA;
  c.treasury = -1;
  var s = soldiers('AAA');
  WT.economy.processTurn('AAA');
  eq(soldiers('AAA'), s, 'dług przy dodatnim bilansie — bez demobilizacji');
  c.treasury = -100;
  WT.economy.setTax('AAA', 0.05);
  assert(WT.economy.balance('AAA') < 0, 'ujemny bilans przy niskim podatku');
  WT.economy.processTurn('AAA');
  assert(soldiers('AAA') <= Math.ceil(s * 0.9) + 1, 'armia zmniejszona o 10%');
  assert(G().log.some(function (l) { return /Bankructwo/.test(l.text); }), 'wpis w dzienniku');
});

test('budowy: koszt, czas, limity', function () {
  freshGame();
  var c = G().countries.AAA;
  c.treasury = 1000;
  eq(WT.economy.canBuild('AAA', 10, 'port').ok, false, 'port bez wybrzeża');
  eq(WT.economy.canBuild('AAA', 2, 'factory').ok, false, 'cudza prowincja');
  var cost = WT.economy.buildCost('AAA', 10, 'factory'), t0 = c.treasury;
  assert(WT.economy.build('AAA', 10, 'factory'), 'budowa rozpoczęta');
  assert(Math.abs(c.treasury - (t0 - cost)) < 1e-9, 'koszt pobrany');
  eq(WT.economy.canBuild('AAA', 10, 'factory').ok, false, 'ten sam typ nie dwa razy naraz');
  assert(WT.economy.build('AAA', 10, 'fort'), 'inny typ budowany równolegle');
  assert(WT.economy.build('AAA', 10, 'barracks'), 'trzeci typ równolegle');
  var incBefore = WT.economy.income('AAA').total;
  for (var i = 0; i < WT.economy.BUILDINGS.factory.turns; i++) WT.economy.processTurn('AAA');
  eq(G().provinces[10].buildings.factory, 1, 'fabryka ukończona');
  eq(G().provinces[10].buildings.fort, 2, 'fort ukończony równolegle (start 1 + 1)');
  eq(G().provinces[10].buildings.barracks, 1, 'koszary ukończone równolegle');
  eq(Object.keys(G().provinces[10].builds).length, 0, 'brak budów w toku');
  assert(WT.economy.income('AAA').total > incBefore, 'fabryka zwiększa dochód');
  G().provinces[10].buildings.fort = 5;
  eq(WT.economy.canBuild('AAA', 10, 'fort').ok, false, 'maks. poziom');
});

test('masowa budowa: wiele prowincji, pomijanie, limit pieniędzy, migracja zapisu', function () {
  freshGame();
  var c = G().countries.AAA, mine = WT.state.provincesOf('AAA');
  c.treasury = 1000;
  WT.economy.build('AAA', mine[0], 'factory');
  var plan = WT.economy.bulkPlan('AAA', mine.concat([2]), 'factory');
  eq(plan.eligible.length, mine.length - 1, 'kwalifikują się wszystkie poza budującą i cudzą');
  eq(Object.keys(plan.skipped).length, 2, 'dwa powody pominięcia');
  var res = WT.economy.buildMany('AAA', mine, 'factory');
  eq(res.built.length, mine.length - 1, 'zbudowano w pozostałych');
  assert(mine.every(function (id) { return G().provinces[id].builds.factory; }), 'fabryka w toku wszędzie');
  var ports = WT.economy.buildMany('AAA', mine, 'port');
  assert(ports.skipped['Port wymaga prowincji nadmorskiej.'] > 0, 'port pomija śródlądowe');
  c.treasury = WT.economy.buildCost('AAA', mine[0], 'barracks') * 1.5;
  var poor = WT.economy.buildMany('AAA', mine, 'barracks');
  assert(poor.built.length >= 1 && poor.noMoney > 0, 'staje, gdy brak pieniędzy');
  var g = JSON.parse(JSON.stringify(G()));
  g.provinces[mine[0]].build = { type: 'fort', turnsLeft: 2 }; delete g.provinces[mine[0]].builds;
  WT.save.importJSON(JSON.stringify(g));
  eq(G().provinces[mine[0]].builds.fort, 2, 'stary slot build zmigrowany');
});

test('rekrutacja: koszt, rezerwy, moved=99, ograniczenia', function () {
  freshGame();
  clearArmies();
  var c = G().countries.AAA, mp = c.manpower, t = c.treasury;
  var cost = WT.economy.recruitCost('AAA', 10, 20);
  var a = WT.economy.recruit('AAA', 10, 20);
  assert(a && a.size === 20000, 'armia 20k');
  eq(a.moved, 99, 'nie rusza się w tej turze');
  assert(Math.abs(c.manpower - (mp - 20)) < 1e-9, 'rezerwy pobrane');
  assert(Math.abs(c.treasury - (t - cost)) < 1e-9, 'koszt pobrany');
  eq(WT.economy.canRecruit('AAA', 2, 5).ok, false, 'cudza prowincja');
  c.manpower = 1;
  eq(WT.economy.canRecruit('AAA', 10, 5).ok, false, 'brak rezerw');
});

test('auto-scalanie: rekruci dołączają do stojącej armii bez utraty jej ruchu', function () {
  freshGame();
  clearArmies();
  var base = WT.state.createArmy('AAA', 10, 30000);
  var r = WT.economy.recruit('AAA', 10, 20);
  eq(r, base, 'rekrutacja zwraca stojącą armię');
  eq(WT.state.armiesIn(10).length, 1, 'jeden marker w prowincji');
  eq(base.size, 50000, 'rekruci dołączyli');
  eq(base.moved, 0, 'armia zachowuje punkty ruchu');
  assert(WT.military.order(base.id, 0).ok, 'rozkaz całości');
  WT.military.moveAll();
  eq(base.prov, 0, 'scalona armia rusza w tej samej turze');
  eq(base.size, 50000, 'cała armia w marszu');
  var fresh = WT.economy.recruit('AAA', 20, 5);
  eq(fresh.moved, 99, 'sam rekrut (bez stojącej armii) nie rusza się w tej turze');
  WT.economy.recruit('AAA', 20, 5);
  eq(WT.state.armiesIn(20).length, 1, 'dwie rekrutacje → jedna armia');
  eq(WT.state.armiesIn(20)[0].size, 10000, 'suma rekrutów');
});

test('auto-scalanie: po dotarciu do celu, brak scalania w marszu, po wczytaniu', function () {
  freshGame();
  clearArmies();
  var a = WT.state.createArmy('AAA', 0, 10000), b = WT.state.createArmy('AAA', 10, 20000);
  WT.military.order(a.id, 10);
  WT.military.moveAll();
  var here = WT.state.armiesIn(10);
  eq(here.length, 1, 'po dotarciu jedna armia');
  eq(here[0].size, 30000, 'suma armii');
  eq(here[0].id, b.id, 'zostaje większa armia');
  // w marszu: armia z trasą nie łączy się ze stojącą
  WT.military.resetMoves();
  var m = WT.state.createArmy('AAA', 0, 5000), idle = WT.state.createArmy('AAA', 0, 7000);
  m.path = [5, 10, 15];
  WT.military.mergeAll();
  eq(WT.state.armiesIn(0).length, 2, 'maszerująca armia nie scalona');
  WT.military.moveAll();
  WT.military.mergeAll();
  eq(m.prov, 10, 'przechodzi przez prowincję ze stojącą armią');
  assert(G().armies[m.id] && m.path.length === 1, 'w trakcie marszu nadal osobna');
  eq(WT.state.armiesIn(10).length, 2, 'stojąca + maszerująca w jednej prowincji');
  // zaokrętowana armia się nie scala
  var e = WT.state.createArmy('AAA', 0, 3000);
  WT.state.embarkArmy(e, 'fX');
  WT.military.mergeAll();
  assert(G().armies[e.id] && G().armies[idle.id], 'zaokrętowana armia nietknięta');
  // wczytanie gry: stare zapisy z kilkoma stojącymi armiami w prowincji
  WT.state.removeArmy(e.id);
  WT.state.createArmy('AAA', 21, 1000); WT.state.createArmy('AAA', 21, 2000);
  var json = WT.save.exportJSON();
  assert(WT.save.importJSON(json), 'import');
  eq(WT.state.armiesIn(21).length, 1, 'scalone po wczytaniu');
  eq(WT.state.armiesIn(21)[0].size, 3000, 'suma po wczytaniu');
  // koniec tury
  WT.state.createArmy('AAA', 1, 1000); WT.state.createArmy('AAA', 1, 1500);
  WT.turn.end();
  var l = WT.state.armiesIn(1).filter(function (x) { return x.owner === 'AAA' && !x.path.length; });
  eq(l.length, 1, 'scalone na koniec tury');
});

test('wsparcie: giveMoney — skarbiec, God Mode, relacje, odmowy', function () {
  freshGame();
  var c = G().countries.AAA, t = G().countries.CCC;
  c.treasury = 100; t.treasury = 5;
  setRel('AAA', 'CCC', 0);
  var r = WT.diplomacy.giveMoney('AAA', 'CCC', 20);
  assert(r.ok, r.reason);
  assert(Math.abs(c.treasury - 80) < 1e-9, 'skarbiec darczyńcy −20');
  assert(Math.abs(t.treasury - 25) < 1e-9, 'skarbiec odbiorcy +20');
  var rel1 = WT.diplomacy.relation('AAA', 'CCC');
  assert(rel1 > 0 && rel1 <= 20, 'relacje rosną (z limitem): ' + rel1);
  WT.diplomacy.giveMoney('AAA', 'CCC', 1);
  assert(WT.diplomacy.relation('AAA', 'CCC') - rel1 < rel1, 'mała kwota → mniejszy przyrost');
  assert(G().log.some(function (l) { return /przekazuje/.test(l.text); }), 'wpis w dzienniku');
  eq(WT.diplomacy.giveMoney('AAA', 'CCC', 1000).ok, false, 'brak środków');
  eq(WT.diplomacy.giveMoney('AAA', 'CCC', 0).ok, false, 'kwota 0');
  WT.diplomacy.startWar(['AAA'], ['BBB'], true);
  var w = WT.diplomacy.giveMoney('AAA', 'BBB', 5);
  assert(!w.ok && /wojny/.test(w.reason), 'odmowa dla wroga: ' + w.reason);
  G().god = true;
  var before = c.treasury;
  assert(WT.diplomacy.giveMoney('AAA', 'CCC', 500).ok, 'God Mode bez limitu');
  eq(c.treasury, before, 'God Mode: skarbiec się nie zmniejsza');
});

test('wsparcie: giveTroops — odmowy, miejsce pojawienia się, odjęcie z armii', function () {
  freshGame();
  clearArmies();
  setRel('AAA', 'CCC', 20);
  var src = WT.state.createArmy('AAA', 11, 50000), small = WT.state.createArmy('AAA', 0, 10000);
  // stolica odbiorcy (prowincja źródłowa AAA nie należy do CCC)
  var r = WT.diplomacy.giveTroops('AAA', 'CCC', 20000, 11);
  assert(r.ok, r.reason);
  eq(src.size, 30000, 'odjęto z armii w prowincji źródłowej');
  eq(r.prov, G().countries.CCC.capital, 'wojsko w stolicy odbiorcy');
  var inCap = WT.state.armiesIn(19).filter(function (a) { return a.owner === 'CCC'; });
  eq(inCap.length, 1, 'scalone z armią odbiorcy');
  eq(inCap[0].size, 20000, 'odbiorca dostał 20k');
  assert(WT.diplomacy.relation('AAA', 'CCC') > 20, 'relacje rosną');
  // bez sourceProv: z największej stojącej armii, nie z maszerującej
  src.path = [10];
  var r2 = WT.diplomacy.giveTroops('AAA', 'CCC', 5000);
  assert(r2.ok, r2.reason);
  eq(small.size, 5000, 'z największej stojącej armii');
  eq(src.size, 30000, 'maszerująca nietknięta');
  src.path = [];
  eq(WT.diplomacy.availableTroops('AAA'), 35000, 'dostępne wojsko');
  // cała armia przekazana → armia znika
  WT.diplomacy.giveTroops('AAA', 'CCC', 5000, 0);
  assert(!G().armies[small.id], 'cała armia przekazana');
  // prowincja źródłowa na ziemi sojusznika odbiorcy → tam
  WT.diplomacy.formAlliance('AAA', 'CCC');
  var front = WT.state.createArmy('AAA', 12, 8000);
  var r3 = WT.diplomacy.giveTroops('AAA', 'CCC', 8000, 12);
  assert(r3.ok, r3.reason);
  eq(r3.prov, 12, 'w prowincji źródłowej należącej do odbiorcy');
  assert(!G().armies[front.id], 'źródłowa armia przekazana w całości');
  eq(WT.state.armiesIn(12)[0].owner, 'CCC', 'armia odbiorcy w prowincji źródłowej');
  // stolica okupowana → największa kontrolowana prowincja (źródło na ziemi AAA, już bez sojuszu)
  WT.diplomacy.breakAlliance('AAA', 'CCC'); setRel('AAA', 'CCC', 30);
  WT.diplomacy.startWar(['ISL'], ['CCC'], true);
  WT.state.setCtrl(19, 'ISL');
  var r4 = WT.diplomacy.giveTroops('AAA', 'CCC', 2000, 11);
  assert(r4.ok, r4.reason);
  assert(r4.prov !== 19 && G().provinces[r4.prov].ctrl === 'CCC', 'nie do okupowanej stolicy');
  // odmowy
  var war = WT.diplomacy.startWar(['AAA'], ['BBB'], true);
  var w = WT.diplomacy.giveTroops('AAA', 'BBB', 5000);
  assert(!w.ok && /wojny/.test(w.reason), 'odmowa dla wroga');
  setRel('AAA', 'ISL', -10);
  var neg = WT.diplomacy.giveTroops('AAA', 'ISL', 5000);
  assert(!neg.ok && /relacje/.test(neg.reason), 'odmowa przy relacjach < 0: ' + neg.reason);
  setRel('AAA', 'ISL', 30); setRel('AAA', 'CCC', 90);
  WT.diplomacy.formAlliance('AAA', 'CCC');
  var foe = WT.diplomacy.giveTroops('AAA', 'ISL', 5000);
  assert(!foe.ok && /sojusznikiem/.test(foe.reason), 'odmowa dla wroga sojusznika: ' + foe.reason);
  var before = soldiers('AAA');
  eq(WT.diplomacy.giveTroops('AAA', 'CCC', 1000000).ok, true, 'kwota przycięta do dostępnych');
  eq(soldiers('AAA'), 0, 'oddano wszystko co dostępne');
  assert(before > 0, 'było co oddać');
  eq(WT.diplomacy.giveTroops('AAA', 'CCC', 1000).ok, false, 'brak wojska');
});

test('AI: bogaty przyjaciel finansuje przegrywającego sojusznika', function () {
  freshGame({ player: 'ISL' });
  var war = WT.diplomacy.startWar(['BBB'], ['AAA'], true);
  WT.state.provincesOf('AAA').slice(0, 6).forEach(function (id) { if (id !== 10) WT.state.setCtrl(id, 'BBB'); });
  WT.diplomacy.warScore(war);
  assert(war.score.AAA <= -15, 'AAA przegrywa: ' + war.score.AAA);
  setRel('CCC', 'AAA', 80); setRel('CCC', 'BBB', -60);
  G().pacts.push({ a: 'CCC', b: 'BBB', until: 9999 });   // darczyńca sam nie wchodzi do wojny
  var c = G().countries.CCC; c.treasury = 400; c.lastIncome = 5; c.lastExpense = 1;
  var got = false;
  for (var i = 0; i < 160 && !got; i++) {
    war.start = G().turn;                         // świeża wojna — strony nie zawrą pokoju w trakcie testu
    c.treasury = Math.max(c.treasury, 300); c.lastIncome = 5; c.lastExpense = 1;
    setRel('CCC', 'AAA', 80); setRel('CCC', 'BBB', -60);   // incydenty graniczne zmieniają relacje
    WT.ai.runAll(); G().turn++; got = G().log.some(function (l) { return /Gamma przekazuje/.test(l.text); }); }
  assert(got, 'AI przekazało pieniądze (log)');
  assert(c.ai.lastAid >= 0, 'zapamiętany cooldown wsparcia');
});

test('pathfinding: A*, dostęp tylko w wojnie/sojuszu, brak drogi przez morze', function () {
  freshGame();
  clearArmies();
  var a = WT.state.createArmy('AAA', 0, 10000);
  var p = WT.military.findPath(a, 20);
  assert(p && p[p.length - 1] === 20 && p.length === 4, 'trasa po własnym terytorium: ' + JSON.stringify(p));
  eq(WT.military.findPath(a, 4), null, 'neutralne terytorium zablokowane');
  WT.diplomacy.startWar(['AAA'], ['BBB'], true);
  var p2 = WT.military.findPath(a, 4);
  assert(p2 && p2[p2.length - 1] === 4, 'w wojnie trasa istnieje');
  assert(p2.every(function (id) { return G().provinces[id].owner !== 'CCC'; }), 'omija neutralne CCC');
  eq(WT.military.findPath(a, 25), null, 'wyspa niedostępna lądem');
  var r = WT.military.order(a.id, 25);
  eq(r.ok, false, 'rozkaz na wyspę odrzucony');
});

test('ruch: wiele prowincji, 2 punkty/turę, góry kosztują więcej, podział armii', function () {
  freshGame();
  clearArmies();
  var a = WT.state.createArmy('AAA', 0, 10000);
  var r = WT.military.order(a.id, 20);
  assert(r.ok, r.reason);
  WT.military.moveAll();
  eq(a.prov, 10, 'po 1 turze 2 prowincje');
  WT.military.resetMoves(); WT.military.moveAll();
  eq(a.prov, 20, 'po 2 turach u celu');
  eq(a.path.length, 0, 'trasa wyczerpana');
  // split
  var r2 = WT.military.order(a.id, 15, 4000);
  assert(r2.ok && r2.armyId !== a.id, 'nowa armia przy podziale');
  eq(a.size, 6000, 'reszta zostaje');
  eq(G().armies[r2.armyId].size, 4000, 'oddział');
  // góry (prowincja 12, CCC) — wojna z CCC, wejście do wrogiej prowincji w górach kończy ruch
  WT.diplomacy.startWar(['AAA'], ['CCC'], true);
  var b = WT.state.createArmy('AAA', 11, 5000);
  WT.military.resetMoves();
  WT.military.order(b.id, 13);
  WT.military.moveAll();
  eq(b.prov, 12, 'wejście do wrogiej górskiej prowincji');
  WT.military.moveAll();
  eq(b.prov, 12, 'ruch zakończony w tej turze');
});

test('bitwa i okupacja (z oblężeniem fortu)', function () {
  freshGame();
  clearArmies();
  WT.diplomacy.declareWar('AAA', 'BBB');
  var att = WT.state.createArmy('AAA', 1, 60000);
  var def = WT.state.createArmy('BBB', 2, 10000);
  var battles = [];
  WT.events.on('battle', function (b) { battles.push(b); });
  WT.military.order(att.id, 2);
  WT.military.moveAll();
  eq(battles.length, 1, 'jedna bitwa');
  eq(battles[0].winnerCc, 'AAA', 'silniejszy wygrywa');
  assert(!G().armies[def.id] || G().armies[def.id].prov !== 2, 'obrońca wycofany lub rozbity');
  assert(att.size < 60000, 'zwycięzca ponosi straty');
  WT.military.resolveOccupations();
  eq(G().provinces[2].ctrl, 'AAA', 'prowincja okupowana');
  assert(G().log.some(function (l) { return /Bitwa/.test(l.text); }), 'log bitwy gracza');
  // fort: 1 tura oblężenia
  G().provinces[7].buildings.fort = 1;
  WT.military.resetMoves();
  WT.military.order(att.id, 7);
  WT.military.moveAll();
  WT.military.resolveOccupations();
  eq(G().provinces[7].ctrl, 'BBB', 'fort trzyma w turze przybycia');
  WT.military.resolveOccupations();
  eq(G().provinces[7].ctrl, 'AAA', 'fort zdobyty po oblężeniu');
  var s = WT.diplomacy.warScore(G().wars[0]);
  assert(s.AAA > 0 && s.BBB < 0, 'wynik wojny dla okupanta dodatni');
});

test('pokój: annex przenosi prowincje, white przywraca kontrolę, odrzucenie przy słabym wyniku', function () {
  freshGame({ player: 'ISL' });
  clearArmies();
  WT.diplomacy.declareWar('AAA', 'BBB');
  var r0 = WT.diplomacy.proposePeace('AAA', 'BBB', 'annex');
  eq(r0.accepted, false, 'annex odrzucony bez okupacji');
  [2, 3, 7, 8].forEach(function (id) { WT.state.setCtrl(id, 'AAA'); });
  var r = WT.diplomacy.proposePeace('AAA', 'BBB', 'annex');
  assert(r.accepted, 'annex przyjęty: ' + r.reason);
  eq(G().provinces[3].owner, 'AAA', 'stolica BBB przejęta');
  eq(G().wars.length, 0, 'wojna zakończona');
  assert(WT.diplomacy.hasTruce('AAA', 'BBB'), 'rozejm');
  assert(G().countries.BBB.capital !== 3 && G().provinces[G().countries.BBB.capital].owner === 'BBB', 'nowa stolica BBB');
  eq(WT.diplomacy.declareWar('AAA', 'BBB').ok, false, 'rozejm blokuje wojnę');
  // white
  WT.diplomacy.declareWar('AAA', 'CCC');
  WT.state.setCtrl(12, 'AAA');
  var w = WT.diplomacy.proposePeace('AAA', 'CCC', 'white');
  assert(w.accepted, 'white przyjęty przez przegrywającego obrońcę: ' + w.reason);
  eq(G().provinces[12].ctrl, 'CCC', 'kontrola przywrócona');
});

test('pokój: eliminacja państwa po aneksji wszystkich prowincji', function () {
  freshGame({ player: 'AAA' });
  clearArmies();
  WT.diplomacy.declareWar('CCC', 'ISL');
  [25, 26, 27, 28].forEach(function (id) { WT.state.setCtrl(id, 'CCC'); });
  var r = WT.diplomacy.proposePeace('CCC', 'ISL', 'annex');
  assert(r.accepted, r.reason);
  eq(G().countries.ISL.alive, false, 'ISL wyeliminowane');
});

test('sojusz: AI wezwane do wojny dołącza, gracz dostaje propozycję', function () {
  freshGame({ player: 'ISL' });
  setRel('BBB', 'CCC', 70);
  eq(WT.diplomacy.proposeAlliance('BBB', 'CCC').accepted, false, 'bez wspólnego zagrożenia — odmowa');
  setRel('CCC', 'AAA', -40); setRel('BBB', 'AAA', -60);
  var al = WT.diplomacy.proposeAlliance('BBB', 'CCC');
  assert(al.accepted || WT.diplomacy.allied('BBB', 'CCC'), 'sojusz: ' + al.reason);
  WT.diplomacy.declareWar('AAA', 'BBB');
  assert(WT.diplomacy.atWar('AAA', 'CCC'), 'CCC dołącza do wojny');
  assert(WT.diplomacy.friendly('BBB', 'CCC'), 'prawo przejścia');
  // gracz jako sojusznik
  freshGame({ player: 'CCC' });
  WT.god.forceAlliance('BBB', 'CCC');
  WT.diplomacy.declareWar('AAA', 'BBB');
  var p = G().proposals.filter(function (x) { return x.type === 'callToArms' && x.to === 'CCC'; })[0];
  assert(p, 'propozycja wezwania do broni');
  var ans = WT.diplomacy.answerProposal(p.id, true);
  assert(ans.ok && WT.diplomacy.atWar('CCC', 'AAA'), 'gracz dołącza po akceptacji');
  eq(WT.diplomacy.proposeAlliance('ISL', 'AAA').accepted, false, 'sojusz odrzucony przy słabych relacjach');
});

test('AI proponuje graczowi pokój (kapitulacja przegrywającego AI)', function () {
  freshGame({ player: 'AAA' });
  clearArmies();
  WT.diplomacy.declareWar('AAA', 'BBB');
  G().turn = 12; G().wars[0].start = 0;
  WT.state.provincesOf('BBB').forEach(function (id) { if (id !== 9) WT.state.setCtrl(id, 'AAA'); });
  WT.ai.runAll();
  var p = G().proposals.filter(function (x) { return x.type === 'peace' && x.from === 'BBB' && x.to === 'AAA'; })[0];
  assert(p, 'propozycja pokoju od AI');
  eq(p.terms.winner, 'AAA', 'gracz jako zwycięzca');
  assert(WT.diplomacy.answerProposal(p.id, true).ok, 'akceptacja');
  assert(!WT.diplomacy.atWar('AAA', 'BBB') && G().provinces[3].owner === 'AAA', 'aneksja po akceptacji');
});

test('desant morski: zaokrętowanie, rejs, lądowanie z bitwą, okupacja', function () {
  freshGame({ player: 'AAA' });
  clearArmies();
  WT.diplomacy.declareWar('CCC', 'ISL');
  var path = WT.naval.seaPath(19, 27);
  assert(path && path[path.length - 1] === 27, 'trasa morska');
  var army = WT.state.createArmy('CCC', 19, 30000);
  var defender = WT.state.createArmy('ISL', 27, 3000);
  var fleet = WT.state.fleetsIn(19).filter(function (f) { return f.owner === 'CCC'; })[0];
  assert(fleet && fleet.ships >= 3, 'flota w porcie');
  var r = WT.naval.planInvasion(army.id, 27);
  assert(r.ok, r.reason);
  eq(army.embarked, fleet.id, 'armia na pokładzie');
  eq(WT.state.armiesIn(19).length, 0, 'armia zniknęła z lądu');
  var landed = false;
  WT.events.on('battle', function (b) { if (b.prov === 27 && !b.naval) landed = true; });
  for (var i = 0; i < 3 && army.embarked; i++) WT.naval.moveFleets();
  eq(army.embarked, null, 'wysadzona');
  eq(army.prov, 27, 'w celu');
  assert(landed, 'bitwa desantowa');
  assert(!G().armies[defender.id] || G().armies[defender.id].prov !== 27, 'obrońca pokonany');
  WT.military.resolveOccupations();
  eq(G().provinces[27].ctrl, 'CCC', 'okupacja po desancie');
  var tooBig = WT.state.createArmy('CCC', 19, 900000);
  eq(WT.naval.planInvasion(tooBig.id, 27).ok, false, 'za mała flota');
});

test('bitwa morska: flota wroga atakowana w węźle', function () {
  freshGame({ player: 'AAA' });
  WT.diplomacy.declareWar('CCC', 'BBB');
  var bf = WT.state.fleetsOf('BBB')[0];
  var cf = WT.state.fleetsOf('CCC')[0];
  assert(bf && cf, 'obie floty');
  var res = null;
  WT.events.on('battle', function (b) { if (b.naval) res = b; });
  WT.naval.orderFleet(cf.id, bf.prov);
  for (var i = 0; i < 3 && !res; i++) WT.naval.moveFleets();
  assert(res, 'doszło do bitwy morskiej');
});

test('rozkaz armii: bez drobnych resztek, całość gdy reszta < 1000', function () {
  freshGame();
  clearArmies();
  var from = cellProv(0, 0), to = cellProv(0, 1);
  var a = WT.state.createArmy('AAA', from, 108400);
  var r = WT.military.order(a.id, to, 108000);
  assert(r.ok, 'rozkaz przyjęty');
  eq(r.armyId, a.id, 'wysłana cała armia, nie podzielona');
  eq(WT.state.armiesIn(from).filter(function (x) { return x.owner === 'AAA'; }).length, 1, 'jedna armia');
  var b = WT.state.createArmy('AAA', cellProv(1, 0), 50000);
  var r2 = WT.military.order(b.id, cellProv(1, 1), 20000);
  assert(r2.ok && r2.armyId !== b.id && b.size === 30000, 'zwykły podział dalej działa');
  var c = WT.state.createArmy('AAA', cellProv(1, 2), 10000);
  var r3 = WT.military.order(c.id, cellProv(1, 1), 100);
  eq(r3.ok, false, 'za mały oddział odrzucony');
  assert(/co najmniej/.test(r3.reason), 'czytelny powód');
});

function cellProv(c, r) { return MAP_DATA.provinces.findIndex(function (p) { return p.c === c && p.r === r; }); }

test('lotnictwo: budowa, nalot niszczy gospodarkę, powrót do bazy', function () {
  freshGame();
  var c = G().countries.AAA, base = cellProv(0, 3), target = cellProv(3, 3);
  c.treasury = 1000;
  eq(WT.air.canBuildBombers('AAA', cellProv(3, 3), 5).ok, false, 'nie na cudzej prowincji');
  var sq = WT.air.buildBombers('AAA', base, 10);
  assert(sq && sq.planes === 10, 'dywizjon 10 bombowców');
  WT.air.buildBombers('AAA', base, 5);
  eq(WT.air.squadronsOf('AAA').length, 1, 'dokupione bombowce dołączają do dywizjonu');
  assert(WT.economy.expenses('AAA').air > 0, 'utrzymanie lotnictwa w wydatkach');
  eq(WT.air.orderRaid(sq.id, target).ok, false, 'bez wojny nie można bombardować');
  WT.diplomacy.startWar(['AAA'], ['CCC'], true);
  var p = G().provinces[target], dev0 = p.dev, inc0 = WT.economy.income('CCC').total;
  var r = WT.air.orderRaid(sq.id, target);
  assert(r.ok, 'nalot zlecony: ' + r.reason);
  WT.air.processTurn();
  eq(p.dev, dev0, 'pierwsza tura: dolot, jeszcze bez zrzutu');
  WT.air.processTurn();
  assert(p.dev < dev0, 'rozwój spadł po nalocie');
  assert(p.bombed > 0 && WT.economy.income('CCC').total < inc0, 'dochód prowincji zakłócony');
  eq(sq.phase, 'back', 'wraca do bazy');
  for (var i = 0; i < 3; i++) WT.air.processTurn();
  eq(sq.phase, 'idle', 'w bazie');
  G().squadrons[sq.id].base = base;
  var save = JSON.parse(JSON.stringify(G())); delete save.squadrons;
  save.provinces.forEach(function (q) { delete q.buildings.aa; delete q.buildings.radar; });
  WT.save.importJSON(JSON.stringify(save));
  assert(G().squadrons && G().provinces[0].buildings.aa === 0, 'stary zapis zmigrowany (lotnictwo, działka, radar)');
});

test('lotnictwo: działka zestrzeliwują część, nigdy nie gwarantują 100%, radar wykrywa', function () {
  freshGame();
  var target = cellProv(3, 3);
  WT.diplomacy.startWar(['CCC'], ['AAA'], true);
  G().provinces[target].buildings.aa = 0;
  eq(WT.air.interceptChance(target, 'AAA'), 0, 'bez działek brak zestrzeleń');
  G().provinces[target].buildings.aa = 5;
  G().provinces[cellProv(2, 3)].buildings.aa = 5;
  G().provinces[target].buildings.radar = 3;
  var ch = WT.air.interceptChance(target, 'AAA');
  assert(ch > 0.5 && ch <= WT.air.MAX_INTERCEPT, 'wysoka, ale ograniczona skuteczność: ' + ch.toFixed(2));
  var total = 0, shot = 0;
  for (var k = 0; k < 20; k++) {
    var sq = WT.air.buildBombers('AAA', cellProv(0, 3), 10) || null;
    G().countries.AAA.treasury = 1000;
    if (!sq) { sq = WT.air.buildBombers('AAA', cellProv(0, 3), 10); }
    sq.target = target; sq.phase = 'out';
    var rep = WT.air.bombProvince(sq);
    total += rep.planes; shot += rep.shot;
    WT.air.squadronsOf('AAA').forEach(function (q) { WT.air.disband(q.id); });
  }
  assert(shot > 0 && shot < total, 'część zestrzelona, część przelatuje (' + shot + '/' + total + ')');
  // radar gracza (AAA) wykrywa lecący dywizjon wroga (CCC)
  G().countries.CCC.treasury = 1000;
  G().provinces[cellProv(1, 3)].buildings.radar = 2;
  var enemy = WT.air.buildBombers('CCC', cellProv(4, 3), 8);
  var logs = [];
  WT.events.on('radar', function (e) { logs.push(e); });
  eq(WT.air.visibleFor('AAA').indexOf(enemy), -1, 'wróg w bazie niewidoczny');
  assert(WT.air.orderRaid(enemy.id, cellProv(0, 3)).ok, 'wrogi nalot');
  WT.air.processTurn();
  assert(logs.length === 1, 'radar zgłosił nalot przed zrzutem');
  assert(WT.air.visibleFor('AAA').indexOf(enemy) >= 0, 'lecący wróg widoczny na mapie w zasięgu radaru');
  eq(enemy.phase, 'out', 'jeszcze nie zbombardował');
});

test('nauka: budżet, uniwersytety, drzewko, efekty', function () {
  freshGame();
  var c = G().countries.AAA;
  eq(c.researchRate, WT.tech.DEFAULT_RATE, 'domyślny budżet badań');
  assert(WT.economy.expenses('AAA').research > 0, 'badania w wydatkach');
  var p0 = WT.tech.pointsPerTurn('AAA').total;
  G().provinces[cellProv(0, 0)].buildings.university = 3;
  assert(WT.tech.pointsPerTurn('AAA').total >= p0 + 6 - 1e-9, 'uniwersytety: +2 pkt/poziom');
  WT.tech.setRate('AAA', 0.2);
  assert(WT.tech.pointsPerTurn('AAA').budget > 0 && c.researchRate === 0.2, 'wyższy budżet');
  WT.tech.setRate('AAA', 5); eq(c.researchRate, WT.tech.MAX_RATE, 'limit budżetu');
  c.rp = 0;
  eq(WT.tech.research('AAA', 'mil1').ok, false, 'za mało punktów');
  eq(WT.tech.canResearch('AAA', 'mil2').ok, false, 'wymaga poprzednika');
  WT.tech.processTurn();
  assert(c.rp > 0, 'punkty rosną co turę');
  c.rp = 1000;
  var tech0 = c.tech;
  assert(WT.tech.research('AAA', 'mil1').ok, 'odkrycie');
  assert(Math.abs(c.tech - tech0 - 0.04) < 1e-9, 'technologia +0,04');
  eq(c.rp, 1000 - WT.tech.get('mil1').cost, 'koszt pobrany');
  WT.tech.research('AAA', 'def1');
  eq(WT.tech.mod('AAA', 'fort'), 1.4, 'efekt fortów');
  WT.tech.research('AAA', 'air1');
  eq(WT.air.rangeKm('AAA'), WT.air.RANGE_KM + 600, 'zasięg bombowców');
  var inc0 = WT.economy.income('AAA').factories;
  G().provinces[cellProv(0, 0)].buildings.factory = 2;
  var incF = WT.economy.income('AAA').factories;
  WT.tech.research('AAA', 'eco1');
  assert(WT.economy.income('AAA').factories > incF && incF > inc0, 'automatyzacja zwiększa dochód z fabryk');
  var g = JSON.parse(JSON.stringify(G()));
  Object.keys(g.countries).forEach(function (k) { delete g.countries[k].rp; delete g.countries[k].techs; delete g.countries[k].techMods; delete g.countries[k].researchRate; });
  WT.save.importJSON(JSON.stringify(g));
  assert(G().countries.AAA.techs && G().countries.AAA.rp === 0, 'stary zapis zmigrowany (nauka)');
});

test('God Mode: badania za darmo', function () {
  freshGame({ god: true });
  var c = G().countries.AAA; c.rp = 0;
  assert(WT.tech.research('AAA', 'eco1').ok && c.rp === 0, 'odkrycie bez punktów');
});

test('handel i dyplomacja AI wobec gracza', function () {
  freshGame();
  setRel('AAA', 'BBB', 10);
  eq(WT.diplomacy.proposeTrade('AAA', 'BBB').accepted, false, 'AI odrzuca handel przy słabych relacjach');
  setRel('AAA', 'BBB', 40);
  assert(WT.diplomacy.proposeTrade('AAA', 'BBB').accepted, 'AI przyjmuje handel');
  assert(WT.economy.income('AAA').trade > 0, 'bonus handlowy w dochodzie');
  WT.diplomacy.startWar(['AAA'], ['BBB'], true);
  WT.diplomacy.processTurn();
  eq(WT.diplomacy.hasTrade('AAA', 'BBB'), false, 'wojna zrywa umowę');
  // AI → gracz: propozycja handlu i prośba o pomoc trafiają do gracza
  freshGame();
  WT.diplomacy.proposeTrade('CCC', 'AAA');
  var pr = G().proposals.filter(function (p) { return p.type === 'trade' && p.to === 'AAA'; })[0];
  assert(pr && /umowę handlową/.test(pr.text), 'propozycja handlu dla gracza');
  assert(WT.diplomacy.answerProposal(pr.id, true).ok && WT.diplomacy.hasTrade('AAA', 'CCC'), 'przyjęcie podpisuje umowę');
  G().countries.AAA.treasury = 100;
  var ar = WT.diplomacy.addProposal('CCC', 'AAA', 'aidRequest', { enemy: 'BBB', amount: 5 });
  var rel0 = WT.diplomacy.relation('AAA', 'CCC'), t0 = G().countries.CCC.treasury;
  assert(WT.diplomacy.answerProposal(ar.id, true).ok, 'pomoc przekazana');
  assert(G().countries.CCC.treasury === t0 + 5 && WT.diplomacy.relation('AAA', 'CCC') > rel0, 'pieniądze i relacje');
  // symulacja: AI samo składa graczowi oferty i daje prezenty
  freshGame();
  ['BBB', 'CCC'].forEach(function (cc) { setRel('AAA', cc, 50); G().countries[cc].treasury = 500; });
  var offers = 0, gifts = 0;
  WT.events.on('proposal', function (p) { if (p.to === 'AAA') offers++; });
  WT.events.on('log', function (e) { if (/przekazuje .* wsparcia dla: Alfa/.test(e.text)) gifts++; });
  for (var i = 0; i < 60; i++) { WT.turn.end(); G().proposals = []; }
  assert(offers > 0, 'AI składa oferty graczowi: ' + offers);
  assert(gifts > 0, 'AI wysyła prezenty: ' + gifts);
});

test('okręty artyleryjskie: zakup w porcie, ostrzał armii i miasta, ogień fortów', function () {
  freshGame({ player: 'AAA' });
  var b = G().countries.BBB; b.treasury = 500;
  eq(WT.naval.canBuyGunships('BBB', 9, 2).ok, false, 'bez portu nie można');
  G().provinces[9].buildings.port = 1;
  var f = WT.naval.buyGunships('BBB', 9, 6);
  assert(f && f.gunships === 6, 'kupiono 6 okrętów');
  assert(WT.economy.expenses('BBB').navy > 0, 'utrzymanie okrętów');
  WT.diplomacy.startWar(['BBB'], ['CCC'], true);
  var army = WT.state.createArmy('CCC', 14, 50000), p = G().provinces[14];
  p.buildings.fort = 0;
  var dev0 = p.dev;
  assert(WT.naval.orderFleet(f.id, 14).ok, 'rejs do wrogiej prowincji');
  WT.naval.moveFleets(); WT.naval.shellAll();
  assert(army.size < 50000 && army.size >= 50000 * 0.85 - 1, 'armia osłabiona (maks. 15%): ' + army.size);
  assert(p.dev < dev0 && p.bombed > 0, 'miasto osłabione, dochód zakłócony');
  // forty odpowiadają ogniem: przy wysokim forcie część okrętów idzie na dno
  p.buildings.fort = 5;
  var sunk = 0;
  for (var i = 0; i < 30 && G().fleets[f.id]; i++) { var r = WT.naval.shellProvince(f); sunk += r.sunk; f.gunships = Math.max(f.gunships, 6); p.buildings.fort = 5; }
  assert(sunk > 0, 'forty zatapiają okręty: ' + sunk);
});

test('ustawienia: auto-odrzucanie paktów i agresywność AI', function () {
  freshGame({ player: 'AAA', autoRejectPacts: true, aiAggression: 0 });
  eq(WT.state.settings().autoRejectPacts, true, 'ustawienie zapisane w stanie');
  var res = WT.diplomacy.addProposal('BBB', 'AAA', 'pact', {});
  assert(res && res.autoRejected, 'pakt odrzucony automatycznie');
  eq(G().proposals.filter(function (p) { return p.type === 'pact'; }).length, 0, 'brak okna propozycji');
  assert(WT.diplomacy.addProposal('BBB', 'AAA', 'trade', {}), 'inne propozycje dalej trafiają do gracza');
  // agresywność 0: AI nie wypowiada nowych wojen
  ['AAA', 'BBB', 'CCC'].forEach(function (a) { ['AAA', 'BBB', 'CCC'].forEach(function (b) { if (a !== b) setRel(a, b, -100); }); });
  for (var i = 0; i < 60; i++) WT.turn.end();
  eq(G().wars.length, 0, 'agresywność 0: brak wojen');
  G().settings.aiAggression = 100;
  assert(WT.ai.aggressionOf('BBB', 'AAA') > 0 && WT.ai.aggressionOf('BBB', 'AAA') <= 100, 'wskaźnik agresywności');
  var hi = WT.ai.aggressionOf('BBB', 'AAA');
  G().settings.aiAggression = 10;
  assert(WT.ai.aggressionOf('BBB', 'AAA') < hi, 'wskaźnik zależy od ustawienia');
  var g = JSON.parse(JSON.stringify(G())); delete g.settings;
  WT.save.importJSON(JSON.stringify(g));
  eq(WT.state.settings().aiAggression, 50, 'stary zapis: domyślne ustawienia');
});

test('nowe technologie: efekty', function () {
  freshGame({ god: true });
  var cost0 = WT.economy.recruitCost('AAA', 0, 10);
  WT.tech.research('AAA', 'mil1'); WT.tech.research('AAA', 'mil5');
  assert(WT.economy.recruitCost('AAA', 0, 10) < cost0, 'szkolenie rezerw: tańsza rekrutacja');
  var pc = WT.air.planeCost('AAA', 10);
  WT.tech.research('AAA', 'air1'); WT.tech.research('AAA', 'air5'); WT.tech.research('AAA', 'air4');
  assert(WT.air.planeCost('AAA', 10) < pc && WT.air.speedKm('AAA') > WT.air.SPEED_KM, 'tańsze i szybsze bombowce');
  WT.tech.research('AAA', 'nav1'); WT.tech.research('AAA', 'nav4');
  eq(WT.naval.fleetMoves('AAA'), WT.naval.FLEET_MOVES + 1, 'napęd turbinowy');
  eq(WT.tech.TREE.length, 28, '28 technologii w drzewku');
});

test('stary zapis bez dopisanych prowincji (np. Afryki) rozszerza świat', function () {
  freshGame();
  WT.turn.end();
  var g = JSON.parse(JSON.stringify(G()));
  var cut = MAP_DATA.provinces.findIndex(function (p) { return p.cc === 'ISL'; });   // wyspa ISL = ostatnie prowincje mapy
  g.provinces = g.provinces.slice(0, cut);
  delete g.countries.ISL;
  Object.keys(g.armies).forEach(function (id) { if (g.armies[id].owner === 'ISL') delete g.armies[id]; });
  Object.keys(g.fleets).forEach(function (id) { if (g.fleets[id].owner === 'ISL') delete g.fleets[id]; });
  Object.keys(g.rel).forEach(function (k) { if (k.indexOf('ISL') >= 0) delete g.rel[k]; });
  var aaaTreasury = g.countries.AAA.treasury, turn = g.turn;
  assert(WT.save.importJSON(JSON.stringify(g)), 'zapis wczytany mimo krótszej listy prowincji');
  eq(G().provinces.length, MAP_DATA.provinces.length, 'prowincje dobudowane');
  assert(G().countries.ISL && G().countries.ISL.alive && G().countries.ISL.capital >= cut, 'nowe państwo ze stolicą');
  eq(G().countries.AAA.treasury, aaaTreasury, 'stan istniejących państw bez zmian');
  eq(G().turn, turn, 'tura bez zmian');
  assert(G().provinces[cut].gdp > 0, 'PKB nowych prowincji');
  for (var i = 0; i < 3; i++) WT.turn.end();
  assert(true, 'gra toczy się dalej');
});

test('God Mode: skarbiec nie maleje, budowy natychmiast, narzędzia', function () {
  freshGame({ player: 'AAA', god: true });
  var c = G().countries.AAA, t0 = c.treasury;
  assert(WT.god.enabled(), 'włączony');
  WT.economy.recruit('AAA', 10, 500);
  assert(WT.economy.build('AAA', 10, 'factory'), 'budowa');
  eq(G().provinces[10].buildings.factory, 1, 'natychmiastowa');
  eq(c.treasury, t0, 'skarbiec bez zmian po wydatkach');
  for (var i = 0; i < 3; i++) WT.turn.end();
  assert(c.treasury >= t0, 'skarbiec nie spada w turach');
  WT.god.setOwner(25, 'AAA');
  eq(G().provinces[25].owner, 'AAA', 'setOwner');
  var sp = WT.god.spawnArmy(26, 'AAA', 50);
  assert(sp && sp.size === 50000, 'spawnArmy w tysiącach');
  WT.god.annexCountry('ISL', 'AAA');
  eq(G().countries.ISL.alive, false, 'annexCountry eliminuje');
  WT.diplomacy.declareWar('AAA', 'BBB');
  WT.god.forcePeace('AAA', 'BBB');
  eq(WT.diplomacy.atWar('AAA', 'BBB'), false, 'forcePeace');
  WT.god.forceAlliance('AAA', 'BBB');
  assert(WT.diplomacy.allied('AAA', 'BBB'), 'forceAlliance');
  WT.god.setRelation('AAA', 'CCC', -77);
  eq(WT.diplomacy.relation('AAA', 'CCC'), -77, 'setRelation');
  WT.god.toggle(false);
  eq(WT.god.enabled(), false, 'toggle off');
});

test('zapis/odczyt: round-trip, lista, eksport/import', function () {
  var g = freshGame({ startWars: true });
  for (var i = 0; i < 3; i++) WT.turn.end();
  var snap = JSON.stringify(WT.G);
  assert(WT.save.save(1), 'zapis');
  WT.turn.end();
  assert(WT.save.load(1), 'odczyt');
  eq(JSON.stringify(WT.G), snap, 'stan identyczny');
  assert(WT.state.armiesIn(G().armies[Object.keys(G().armies)[0]].prov).length > 0, 'indeksy odbudowane');
  var list = WT.save.list();
  assert(list.some(function (s) { return s.slot === '1' && s.turn === 3; }), 'lista slotów');
  var json = WT.save.exportJSON();
  WT.turn.end();
  assert(WT.save.importJSON(json), 'import');
  eq(G().turn, 3, 'import przywraca turę');
  assert(WT.save.remove(1) && !WT.save.load(1), 'usunięcie');
  eq(WT.save.importJSON('{zepsuty'), false, 'zły JSON odrzucony');
  WT.turn.end(); WT.turn.end();
  assert(WT.save.list().some(function (s) { return s.slot === 'auto'; }), 'autozapis co 5 tur');
  assert(g !== WT.G || true);
});

test('konflikty startowe: wojna i okupacje z lon/lat', function () {
  freshGame({ startWars: true });
  assert(WT.diplomacy.atWar('AAA', 'BBB'), 'wojna startowa');
  eq(G().provinces[7].ctrl, 'AAA', 'prowincja okupowana na starcie');
});

test('symulacja 100 tur AI bez wyjątków (gracz pasywny)', function () {
  freshGame({ player: 'ISL', startWars: true, seed: 7 });
  var stats = { battles: 0, peace: 0, wars: 0 };
  WT.events.on('battle', function () { stats.battles++; });
  WT.events.on('peace', function () { stats.peace++; });
  WT.events.on('war', function () { stats.wars++; });
  var maxMs = 0;
  for (var i = 0; i < 100; i++) {
    var t = Date.now();
    WT.turn.end();
    maxMs = Math.max(maxMs, Date.now() - t);
    G().proposals.slice().forEach(function (p) { WT.diplomacy.answerProposal(p.id, i % 2 === 0); });
    assertConsistent();
  }
  eq(G().turn, 100, 'tura 100');
  assert(stats.battles > 0, 'były bitwy');
  console.log('      bitwy: ' + stats.battles + ', wojny: ' + stats.wars + ', pokoje: ' + stats.peace + ', max ms/turę: ' + maxMs +
    ', żywe: ' + WT.state.countriesAlive().join(','));
});

function assertConsistent() {
  Object.keys(G().armies).forEach(function (id) {
    var a = G().armies[id];
    assert(a.size > 0, 'armia z dodatnią liczebnością');
    if (!a.embarked) assert(WT.state.armiesIn(a.prov).indexOf(a) >= 0, 'indeks armii spójny');
    if (!a.embarked) assert(WT.military.canEnter(a.owner, a.prov), 'armia ' + id + ' nie stoi na neutralnym terenie');
  });
  G().provinces.forEach(function (p) {
    assert(G().countries[p.owner], 'właściciel istnieje');
    if (p.ctrl !== p.owner) assert(WT.diplomacy.atWar(p.ctrl, p.owner), 'okupacja tylko w wojnie');
  });
  assert(!isNaN(G().countries.AAA.treasury), 'skarbiec liczbowy');
}

console.log('\n' + results.pass + ' PASS, ' + results.fail + ' FAIL');
process.exitCode = results.fail ? 1 : 0;
