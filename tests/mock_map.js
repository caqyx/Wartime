/*
 * Sztuczna mapa testowa (30 prowincji, 4 państwa, morze, wyspa ISL i kolonia CCC na wysepce).
 *
 *   kolumny 0-1: AAA (Alfa)        kolumny 2-4, wiersze 0-1: BBB (Beta)
 *   kolumny 2-4, wiersze 2-4: CCC (Gamma), kolumna 4 = wybrzeże
 *   kolumna 5 = morze; wyspa (6..7 × 1..2) = ISL (bez COUNTRY_DATA → wartości domyślne)
 *   komórka (6,4) = wysepka CCC
 *
 * install(unproject) ustawia globalne MAP_DATA / COUNTRY_DATA / START_WARS / START_OCCUPATIONS.
 */
var CELL = 100, OFF = 50, KM_PER_UNIT = 2;

function cellBox(c, r) { return [OFF + c * CELL, OFF + r * CELL, OFF + (c + 1) * CELL, OFF + (r + 1) * CELL]; }

function makeProvince(id, c, r, cc, name, pop, coastal, terrain) {
  var b = cellBox(c, r), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
  return {
    id: id, name: name, cc: cc, c: c, r: r, ct: CONTINENT[cc],
    poly: [[b[0], b[1], b[2], b[1], b[2], b[3], b[0], b[3]]],
    bbox: b, cx: cx, cy: cy, areaKm2: 40000, pop: pop, coastal: coastal,
    port: coastal ? [cx + 40, cy] : null, nb: [], terrain: terrain || 'plains'
  };
}

function continentOwner(c, r) {
  if (c <= 1) return 'AAA';
  return r <= 1 ? 'BBB' : 'CCC';
}

function buildProvinces() {
  var provs = [], c, r, id = 0;
  var pops = { AAA: 3, BBB: 2, CCC: 2 };
  var terrains = { 7: 'hills', 12: 'mountains', 26: 'forest' };
  for (r = 0; r < 5; r++) for (c = 0; c < 5; c++) {
    var cc = continentOwner(c, r);
    provs.push(makeProvince(id, c, r, cc, cc + '-' + c + r, pops[cc], c === 4, terrains[id]));
    id++;
  }
  [[6, 1], [7, 1], [6, 2], [7, 2]].forEach(function (cr) {
    provs.push(makeProvince(id, cr[0], cr[1], 'ISL', 'Wyspa-' + cr[0] + cr[1], 3, true, terrains[id]));
    id++;
  });
  provs.push(makeProvince(id, 6, 4, 'CCC', 'Wysepka', 1, true));
  return provs;
}

function linkGridNeighbors(provs) {
  provs.forEach(function (a) {
    provs.forEach(function (b) {
      if (a.id !== b.id && Math.abs(a.c - b.c) + Math.abs(a.r - b.r) === 1) a.nb.push(b.id);
    });
  });
}

function seaLinks(provs) {
  var pairs = [[4, 9], [9, 14], [14, 19], [19, 24], [9, 25], [14, 27], [24, 29], [25, 27], [25, 26], [26, 28], [27, 28], [27, 29]];
  return pairs.map(function (p) {
    var a = provs[p[0]], b = provs[p[1]];
    return [p[0], p[1], Math.round(Math.hypot(a.cx - b.cx, a.cy - b.cy) * KM_PER_UNIT)];
  });
}

function buildMap() {
  var provs = buildProvinces();
  linkGridNeighbors(provs);
  return {
    width: 900, height: 600, kmPerUnit: KM_PER_UNIT,
    projection: 'miller', lonMin: 0, lonMax: 20, latMin: 30, latMax: 50,
    provinces: provs, seaLinks: seaLinks(provs), straits: [], background: [], seas: buildSeas()
  };
}

var CONTINENT = { AAA: 'EU', BBB: 'AS', CCC: 'AF', ISL: 'EU' };

/** Dwie strefy morskie w kolumnie 5 (morze): północna przy BBB/CCC/wyspie, południowa przy CCC i wysepce. */
function buildSeas() {
  var box = function (r) { var b = cellBox(5, r); return [b[0], b[1], b[2], b[1], b[2], b[3], b[0], b[3]]; };
  return [
    { id: 0, name: 'Morze Północne', poly: [box(0), box(1)], cx: OFF + 5.5 * CELL, cy: OFF + 1 * CELL, nb: [1], coast: [4, 9, 14, 25, 27] },
    { id: 1, name: 'Morze Południowe', poly: [box(3), box(4)], cx: OFF + 5.5 * CELL, cy: OFF + 4 * CELL, nb: [0], coast: [19, 24, 27, 29] }
  ];
}

/** Scenariusz testowy: AAA i BBB połączone w jedno królestwo KRL, epoka bez lotnictwa i okrętów artyleryjskich. */
function buildScenarios(map) {
  var owners = map.provinces.map(function (p) { return p.cc === 'AAA' || p.cc === 'BBB' ? 'KRL' : p.cc; });
  var c = function (name, color, army) { return { name: name, color: color, capitalLonLat: null, gdp: 200, pop: 5, army: army, navy: 2, tech: 0.5,
    ideology: 'monarchia', gov: 'królestwo', friends: [], rivals: [] }; };
  return { '1385': { id: '1385', date: '1385-01-01', title: 'test', desc: '', popScale: { EU: 0.1, AS: 0.1, AF: 0.1 },
    era: { air: false, radar: false, aa: false, gunships: false, costScale: 12.5, priceScale: 1 }, owners: owners,
    countries: { KRL: c('Królestwo', '#aa2222', 30), CCC: c('Gamma', '#22aa22', 20), ISL: c('Wyspa', '#2222aa', 5) },
    wars: [['KRL', 'CCC']], occupations: [] } };
}

function buildCountries(map, unproject) {
  var ll = function (id) { return unproject(map.provinces[id].cx + 10, map.provinces[id].cy - 10); };
  return {
    AAA: { name: 'Alfa', color: '#cc3333', capitalLonLat: ll(10), gdp: 600, pop: 30, army: 100, navy: 0, tech: 0.9,
      gov: 'republika', ideology: 'demokracja', friends: [], rivals: ['BBB'] },
    BBB: { name: 'Beta', color: '#3333cc', capitalLonLat: ll(3), gdp: 300, pop: 12, army: 60, navy: 6, tech: 0.8,
      gov: 'monarchia', ideology: 'monarchia', friends: ['CCC'], rivals: ['AAA'] },
    CCC: { name: 'Gamma', color: '#33cc33', capitalLonLat: ll(19), gdp: 400, pop: 19, army: 50, navy: 8, tech: 0.85,
      gov: 'republika', ideology: 'demokracja', friends: ['BBB'], rivals: ['ISL'] }
  };
}

function install(root, WT) {
  root.MAP_DATA = buildMap();
  root.COUNTRY_DATA = buildCountries(root.MAP_DATA, WT.util.unproject);
  root.START_WARS = [['AAA', 'BBB']];
  root.SCENARIOS = buildScenarios(root.MAP_DATA);
  root.START_OCCUPATIONS = [{ by: 'AAA', cc: 'BBB', lonlat: [WT.util.unproject(330, 180)] }];
  return root.MAP_DATA;
}

if (typeof module !== 'undefined') module.exports = { buildMap: buildMap, buildCountries: buildCountries, install: install };
