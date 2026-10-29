/* Symulacja na prawdziwych danych (data/map.js + data/countries.js): `node tests/sim_real.js [tury] [seed] [gracz]` */
var fs = require('fs'), path = require('path');
var ROOT = path.join(__dirname, '..');

function loadDataFile(rel) {
  var code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  new Function('window', code)(global);
}
loadDataFile('data/map.js');
loadDataFile('data/countries.js');
['util', 'state', 'economy', 'diplomacy', 'vassal', 'land', 'military', 'warfare', 'naval', 'air', 'tech', 'ai', 'god', 'turn', 'save'].forEach(function (m) {
  require(path.join(ROOT, 'js/core', m + '.js'));
});
var WT = global.WT, S = WT.state;

var TURNS = +process.argv[2] || 100, SEED = +process.argv[3] || 2026, PLAYER = process.argv[4] || 'POL';

function checkCapitals() {
  var misses = [];
  Object.keys(WT.G.countries).forEach(function (cc) {
    var c = WT.G.countries[cc];
    if (!c.capitalLonLat || c.capital < 0) return;
    var xy = WT.util.project(c.capitalLonLat[0], c.capitalLonLat[1]);
    if (!WT.util.pointInProvince(xy[0], xy[1], S.provStatic(c.capital))) misses.push(cc);
  });
  return misses;
}

function summarizeWorld() {
  var alive = S.countriesAlive();
  var eliminated = Object.keys(WT.G.countries).filter(function (cc) { return !WT.G.countries[cc].alive; });
  return { alive: alive.length, eliminated: eliminated, wars: WT.G.wars.length, alliances: WT.G.alliances.length,
    armies: Object.keys(WT.G.armies).length, fleets: Object.keys(WT.G.fleets).length };
}

var t0 = Date.now();
WT.state.newGame({ player: PLAYER, startWars: true, seed: SEED });
console.log('newGame: ' + (Date.now() - t0) + ' ms, prowincji: ' + WT.G.provinces.length + ', państw: ' + S.countriesAlive().length);
console.log('Stolica POL: ' + S.provStatic(WT.G.countries.POL.capital).name + ' (' + S.provStatic(WT.G.countries.POL.capital).cc + ')');
console.log('Stolice poza poligonem (fallback najbliższy centroid): ' + (checkCapitals().join(', ') || 'brak'));
console.log('Okupowane na starcie: ' + WT.G.provinces.map(function (p, i) { return p.ctrl !== p.owner ? S.provStatic(i).name + '→' + p.ctrl : null; }).filter(Boolean).join(', '));

var stats = { wars: [], peace: 0, battles: 0, annex: 0, alliances: 0, eliminated: [] };
WT.events.on('war', function (e) { if (e.attacker) stats.wars.push(WT.G.turn + ':' + e.attacker + '→' + e.defender); });
WT.events.on('peace', function () { stats.peace++; });
WT.events.on('battle', function () { stats.battles++; });
WT.events.on('annex', function () { stats.annex++; });
WT.events.on('alliance', function () { stats.alliances++; });
WT.events.on('eliminated', function (e) { stats.eliminated.push(WT.G.turn + ':' + e.cc); });

var invasions = 0, origPlan = WT.naval.planInvasion;
WT.naval.planInvasion = function () { var r = origPlan.apply(null, arguments); if (r.ok) invasions++; return r; };
var trace = (process.env.TRACE || '').split(',').filter(Boolean);
WT.events.on('peace', function (e) { if (trace.indexOf(e.a) >= 0 || trace.indexOf(e.b) >= 0) console.log('  [' + WT.G.turn + '] pokój ' + e.a + '-' + e.b + ' ' + e.kind + ' zw. ' + e.winner); });

var aiTimes = [], totalTimes = [];
for (var i = 0; i < TURNS; i++) {
  var t = Date.now();
  WT.turn.end();
  totalTimes.push(Date.now() - t);
  aiTimes.push(WT.turn.lastTimings().ai);
  WT.G.proposals.slice().forEach(function (p) { WT.diplomacy.answerProposal(p.id, false); });
  trace.forEach(function (cc) { var c = WT.G.countries[cc]; if ((i + 1) % 5 === 0) console.log('  [' + WT.G.turn + '] ' + cc + ' armia ' + (WT.economy.armySoldiers(cc) / 1000).toFixed(0) + 'k, skarb ' + c.treasury.toFixed(1) + ', prow ' + S.provincesOf(cc).length + '/kontr ' + S.controlledBy(cc).length + ', wyczerp ' + c.warExhaustion.toFixed(0) + ', wynik ' + WT.diplomacy.warsOf(cc).map(function (w) { return w.score[cc]; }).join('/')); });
  if ((i + 1) % 25 === 0) console.log('tura ' + (i + 1) + ': ' + JSON.stringify(summarizeWorld()));
}

function stat(arr) {
  var s = arr.slice().sort(function (a, b) { return a - b; });
  return 'śr ' + (s.reduce(function (a, b) { return a + b; }, 0) / s.length).toFixed(1) + ' ms, mediana ' + s[s.length >> 1].toFixed(1) + ', max ' + s[s.length - 1].toFixed(1);
}
console.log('\nCzas AI/turę: ' + stat(aiTimes));
console.log('Czas całej tury: ' + stat(totalTimes));
console.log('Nowe wojny (' + stats.wars.length + '): ' + stats.wars.join(', '));
console.log('Udane desanty AI: ' + invasions);
console.log('Pokoje: ' + stats.peace + ', aneksje: ' + stats.annex + ', bitwy: ' + stats.battles + ', nowe sojusze: ' + stats.alliances);
console.log('Wyeliminowane: ' + (stats.eliminated.join(', ') || 'brak'));
console.log('Trwające wojny: ' + WT.G.wars.map(function (w) { return w.attackers.join('+') + ' vs ' + w.defenders.join('+') + ' (' + w.score[w.attackers[0]] + ')'; }).join('; '));
console.log('Sojusze: ' + WT.G.alliances.map(function (a) { return a.join('-'); }).join(', '));
console.log('Rozmiar zapisu: ' + (JSON.stringify(WT.G).length / 1e6).toFixed(2) + ' MB');
['POL', 'RUS', 'UKR', 'CHN', 'IND', 'DEU', 'PRK', 'JPN'].forEach(function (cc) {
  var c = WT.G.countries[cc];
  if (!c) return;
  console.log(cc + ': skarb ' + c.treasury.toFixed(1) + ', bilans ' + (c.lastIncome - c.lastExpense).toFixed(2) + ', armia ' +
    (WT.economy.armySoldiers(cc) / 1000).toFixed(0) + 'k (start ' + c.baseArmy / 1000 + 'k), prow. ' + S.provincesOf(cc).length + ', stab ' + c.stability.toFixed(0) + ', podatek ' + c.taxRate);
});
