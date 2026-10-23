/* Testy logiki gry w node (bez frameworków): `node tests/run_tests.js` */
var path = require('path');
var ROOT = path.join(__dirname, '..');
var CORE = ['util', 'state', 'economy', 'diplomacy', 'military', 'naval', 'ai', 'god', 'turn', 'save'];
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
  eq(WT.economy.canBuild('AAA', 10, 'fort').ok, false, 'jedna budowa naraz');
  var incBefore = WT.economy.income('AAA').total;
  for (var i = 0; i < WT.economy.BUILDINGS.factory.turns; i++) WT.economy.processTurn('AAA');
  eq(G().provinces[10].buildings.factory, 1, 'fabryka ukończona');
  assert(WT.economy.income('AAA').total > incBefore, 'fabryka zwiększa dochód');
  G().provinces[10].buildings.fort = 5;
  eq(WT.economy.canBuild('AAA', 10, 'fort').ok, false, 'maks. poziom');
});

test('rekrutacja: koszt, rezerwy, moved=99, ograniczenia', function () {
  freshGame();
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
