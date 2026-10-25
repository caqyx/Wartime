/* WT.render — mapa na canvasie 2D: kamera, kafelkowy cache lądu, overlay (armie, floty, trasy), picking.
 * Klasyczny skrypt (bez modułów). Czyta stan z WT.G (albo z MAP_DATA/COUNTRY_DATA przed startem gry). */
(function () {
  'use strict';
  var WT = window.WT = window.WT || {};
  var R = WT.render = {};

  // ---------------------------------------------------------------------------
  // Stałe
  // ---------------------------------------------------------------------------
  var TILE = 512;                 // rozmiar kafla w pikselach urządzenia
  var MAX_TILES = 72;             // LRU (~1 MB na kafel); na urządzeniach dotykowych mniej — patrz resize()
  var TILE_BUDGET_MS = 9;         // ile ms na klatkę wolno renderować kafle
  var WORLD_PX = 2048;            // szerokość obrazu całej mapy (fallback)
  var MAX_ZOOM = 24;              // Singapur/Bahrajn/Monako muszą dać się trafić palcem
  var IS_TOUCH = typeof window !== 'undefined' && (('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0);
  var TOUCH_UNIT_TOL = 20;        // tolerancja trafienia markera armii/floty palcem (px CSS)
  var GRID_CELL = 64;             // komórka siatki przestrzennej (jednostki mapy)
  // Paleta mapy zgodna z tokenami css/style.css (akcent = neonowy cyjan, semantyka: wojna/sojusz/sukces/ostrzeżenie)
  var COLORS = {
    sea: '#0b1a2b', seaTop: '#0d2034', seaBottom: '#091523', seaDeep: '#060d17', grid: 'rgba(140,205,235,0.075)',
    coastGlow: [96, 200, 230],       // poświata płytkiej wody przy brzegu (RGB)
    background: '#283039', backgroundEdge: 'rgba(0,0,0,0.30)',
    border: 'rgba(6,9,14,0.9)', provBorder: 'rgba(255,255,255,0.14)',
    hover: 'rgba(255,255,255,0.12)', hoverEdge: 'rgba(225,250,255,0.75)',
    select: '#5fe3f5', selectGlow: 'rgba(95,227,245,0.28)',
    accent: '#5fe3f5', accentRgb: '95,227,245',
    route: '#5fe3f5', routeSea: '#8fa8ff', routeBad: '#ff6b6b',
    war: '#e5484d', ally: '#5b8def', pact: '#3fb8b0', self: '#5fe3f5', ok: '#3ec27f',
    labelInk: 'rgba(250,252,255,0.94)', labelHalo: 'rgba(6,10,16,0.55)'
  };
  var TERRAIN_COLORS = {
    plains: '#8fa865', hills: '#a99a63', mountains: '#867a70', desert: '#cdb882',
    forest: '#4e7a4c', tundra: '#a3b2b8', jungle: '#33735a'
  };

  // ---------------------------------------------------------------------------
  // Stan modułu
  // ---------------------------------------------------------------------------
  var MAP = null, canvas = null, ctx = null, pickCtx = null;
  var dpr = 1, viewW = 0, viewH = 0;
  var cam = { x: 0, y: 0, zoom: 0.4 };
  var mode = 'political';
  var version = 1;                 // wersja danych lądu — kafle ze starszą wersją są nieaktualne
  var tiles = new Map();           // key -> { canvas, ver }
  var world = null;                // { canvas, scale, ver }
  var provPaths = [], bgPath = null, spatial = null;
  var ccIndex = {}, econRank = null;
  var countryLabels = [];
  var patterns = {};
  var scratch = null;              // { id: canvas, border: canvas }
  var keysDown = {};
  var lastFrame = 0, needsDraw = true, pendingTiles = false, dashPhase = 0;
  var hitArmies = [], hitFleets = [];
  var pointer = { down: false, button: 0, sx: 0, sy: 0, lx: 0, ly: 0, moved: false, dragUnit: null, x: 0, y: 0 };

  // Stan interakcji ustawiany przez WT.ui
  var view = {
    hoverProv: -1, selProv: -1, multi: null, airRange: null, radarRing: null,
    sel: null,                     // { type: 'army'|'fleet', id }
    preview: null,                 // plan trasy (podgląd)
    pending: null,                 // plan czekający na potwierdzenie w pasku rozkazu
    highlightCC: null,             // podświetlenie państwa (ekran startowy / dyplomacja)
    startScreen: false
  };
  R.view = view;
  R.handlers = {};                 // ustawiane przez WT.ui: click, hover, unitClick, orderTarget, planOrder, dragStart

  // ---------------------------------------------------------------------------
  // Dostęp do danych (przed i po starcie gry)
  // ---------------------------------------------------------------------------
  function G() { return WT.G || null; }
  function ownerOf(id) { var g = G(); return g && g.provinces[id] ? g.provinces[id].owner : MAP.provinces[id].cc; }
  function ctrlOf(id) { var g = G(); return g && g.provinces[id] ? (g.provinces[id].ctrl || g.provinces[id].owner) : MAP.provinces[id].cc; }
  function hashColor(cc) {
    var h = 0; for (var i = 0; i < cc.length; i++) h = (h * 31 + cc.charCodeAt(i)) >>> 0;
    return 'hsl(' + (h % 360) + ',38%,52%)';
  }
  function rawCountryColor(cc) {
    var g = G();
    if (g && g.countries[cc] && g.countries[cc].color) return g.countries[cc].color;
    var cd = window.COUNTRY_DATA && window.COUNTRY_DATA[cc];
    return (cd && cd.color) || hashColor(cc || '???');
  }
  // Nowoczesna paleta: kolor państwa lekko zdesaturowany, jasność ściśnięta do wąskiego pasma
  // (żadne państwo nie "krzyczy" ani nie ginie w ciemności). Cache per kolor źródłowy.
  var modernCache = {};
  function modernize(c) {
    var hit = modernCache[c]; if (hit) return hit;
    var x = parseColor(c), r = x[0] / 255, gg = x[1] / 255, b = x[2] / 255;
    var max = Math.max(r, gg, b), min = Math.min(r, gg, b), l = (max + min) / 2, h = 0, s = 0, d = max - min;
    if (d > 1e-6) {
      s = d / (1 - Math.abs(2 * l - 1));
      h = max === r ? ((gg - b) / d) % 6 : max === gg ? (b - r) / d + 2 : (r - gg) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    s = Math.min(0.62, s * 0.82);
    l = 0.40 + (Math.max(0.12, Math.min(0.88, l)) - 0.12) / 0.76 * 0.30;
    var C = (1 - Math.abs(2 * l - 1)) * s, X = C * (1 - Math.abs((h / 60) % 2 - 1)), m = l - C / 2, rgb;
    if (h < 60) rgb = [C, X, 0]; else if (h < 120) rgb = [X, C, 0]; else if (h < 180) rgb = [0, C, X];
    else if (h < 240) rgb = [0, X, C]; else if (h < 300) rgb = [X, 0, C]; else rgb = [C, 0, X];
    var hex = '#' + rgb.map(function (v) { var n = Math.round((v + m) * 255); return (n < 16 ? '0' : '') + n.toString(16); }).join('');
    return (modernCache[c] = hex);
  }
  function countryColor(cc) { return modernize(rawCountryColor(cc)); }
  function countryName(cc) {
    var g = G();
    if (g && g.countries[cc] && g.countries[cc].name) return g.countries[cc].name;
    var cd = window.COUNTRY_DATA && window.COUNTRY_DATA[cc];
    return (cd && cd.name) || cc;
  }
  R.countryColor = countryColor;
  R.countryName = countryName;
  R.ownerOf = ownerOf;
  R.ctrlOf = ctrlOf;

  function callApi(path, args, fallback) {
    var parts = path.split('.'), o = WT, owner = null;
    for (var i = 0; i < parts.length; i++) { if (o == null) return fallback; owner = o; o = o[parts[i]]; }
    if (typeof o !== 'function') return fallback;
    try { return o.apply(owner, args || []); } catch (e) { console.warn('[render] ' + path, e); return fallback; }
  }

  // ---------------------------------------------------------------------------
  // Kolory
  // ---------------------------------------------------------------------------
  function parseColor(c) {
    if (c[0] === '#') {
      var n = c.length === 4 ? c.replace(/#(.)(.)(.)/, '#$1$1$2$2$3$3') : c;
      return [parseInt(n.substr(1, 2), 16), parseInt(n.substr(3, 2), 16), parseInt(n.substr(5, 2), 16)];
    }
    var tmp = document.createElement('canvas').getContext('2d');
    tmp.fillStyle = c; var v = tmp.fillStyle;
    if (v[0] === '#') return parseColor(v);
    var m = v.match(/\d+/g); return m ? [+m[0], +m[1], +m[2]] : [128, 128, 128];
  }
  var colorCache = {};
  function rgbOf(c) { return colorCache[c] || (colorCache[c] = parseColor(c)); }
  function mix(a, b, t) {
    var x = rgbOf(a), y = rgbOf(b);
    return 'rgb(' + Math.round(x[0] + (y[0] - x[0]) * t) + ',' + Math.round(x[1] + (y[1] - x[1]) * t) + ',' + Math.round(x[2] + (y[2] - x[2]) * t) + ')';
  }
  function luminance(c) { var x = rgbOf(c); return (0.299 * x[0] + 0.587 * x[1] + 0.114 * x[2]) / 255; }
  function darken(c, t) { return mix(c, '#000000', t); }
  R.luminance = luminance;
  R.darken = darken;

  function diplomacyColor(id) {
    var g = G(), me = g ? g.player : view.highlightCC;
    var cc = ownerOf(id);
    if (!g || !me) return countryColor(cc);
    if (cc === me) return '#d9b86a';
    var D = WT.diplomacy || {};
    if (D.atWar && safeBool(D.atWar, me, cc)) return COLORS.war;
    if (D.allied && safeBool(D.allied, me, cc)) return COLORS.ally;
    if (D.hasPact && safeBool(D.hasPact, me, cc)) return COLORS.pact;
    var rel = D.relation ? callApi('diplomacy.relation', [me, cc], 0) : 0;
    var t = (rel + 100) / 200;
    return t < 0.5 ? mix('#94464a', '#5d6673', t * 2) : mix('#5d6673', '#3f9466', (t - 0.5) * 2);
  }
  function safeBool(fn, a, b) { try { return !!fn.call(WT.diplomacy, a, b); } catch (e) { return false; } }

  function economyValue(id) {
    var g = G(); if (!g) return 0;
    var p = g.provinces[id], b = p.buildings || {};
    return (p.dev || 1) * (1 + 0.35 * (b.factory || 0));
  }
  function economyColor(id) {
    var t = econRank ? econRank[id] : 0;
    return t < 0.5 ? mix('#262a4a', '#2c7d78', t * 2) : mix('#2c7d78', '#d6e06c', (t - 0.5) * 2);
  }
  function provinceFill(id) {
    switch (mode) {
      case 'diplomatic': return diplomacyColor(id);
      case 'economic': return economyColor(id);
      case 'terrain': return TERRAIN_COLORS[MAP.provinces[id].terrain] || '#888';
      default: return countryColor(ownerOf(id));
    }
  }

  // Wzór ukośnych pasków okupacji (w kolorze okupanta)
  function stripePattern(g2, color) {
    var p = patterns[color];
    if (!p) {
      // ukośne pasy okupanta z cienką ciemną krawędzią — czytelne także na podobnym kolorze tła
      var c = document.createElement('canvas'); c.width = c.height = 12;
      var x = c.getContext('2d');
      x.lineCap = 'butt'; x.beginPath();
      for (var k = -12; k <= 24; k += 12) { x.moveTo(k, 12); x.lineTo(k + 12, 0); }
      x.strokeStyle = 'rgba(8,12,18,0.45)'; x.lineWidth = 5.2; x.stroke();
      x.strokeStyle = color; x.lineWidth = 3.4; x.stroke();
      p = patterns[color] = c;
    }
    return g2.createPattern(p, 'repeat');
  }

  // ---------------------------------------------------------------------------
  // Geometria: Path2D, siatka przestrzenna, picking
  // ---------------------------------------------------------------------------
  function ringsToPath(rings) {
    var path = new Path2D();
    for (var r = 0; r < rings.length; r++) {
      var ring = rings[r];
      if (!ring || ring.length < 6) continue;
      path.moveTo(ring[0], ring[1]);
      for (var i = 2; i < ring.length; i += 2) path.lineTo(ring[i], ring[i + 1]);
      path.closePath();
    }
    return path;
  }
  function buildPaths() {
    provPaths = MAP.provinces.map(function (p) { return ringsToPath(p.poly || []); });
    bgPath = MAP.background && MAP.background.length ? ringsToPath(MAP.background) : null;
  }
  function buildSpatialGrid() {
    var cols = Math.ceil(MAP.width / GRID_CELL) + 1, rows = Math.ceil(MAP.height / GRID_CELL) + 1;
    var cells = new Array(cols * rows);
    MAP.provinces.forEach(function (p, id) {
      var b = p.bbox;
      var c0 = clampInt(b[0] / GRID_CELL, cols), c1 = clampInt(b[2] / GRID_CELL, cols);
      var r0 = clampInt(b[1] / GRID_CELL, rows), r1 = clampInt(b[3] / GRID_CELL, rows);
      for (var r = r0; r <= r1; r++) for (var c = c0; c <= c1; c++) {
        var k = r * cols + c; (cells[k] || (cells[k] = [])).push(id);
      }
    });
    spatial = { cols: cols, rows: rows, cells: cells };
  }
  function clampInt(v, n) { return Math.max(0, Math.min(n - 1, Math.floor(v))); }

  // Prowincje, których bbox przecina prostokąt mapy
  function queryRect(x0, y0, x1, y1) {
    var s = spatial, out = [], seen = new Uint8Array(MAP.provinces.length);
    var c0 = clampInt(x0 / GRID_CELL, s.cols), c1 = clampInt(x1 / GRID_CELL, s.cols);
    var r0 = clampInt(y0 / GRID_CELL, s.rows), r1 = clampInt(y1 / GRID_CELL, s.rows);
    for (var r = r0; r <= r1; r++) for (var c = c0; c <= c1; c++) {
      var cell = s.cells[r * s.cols + c]; if (!cell) continue;
      for (var i = 0; i < cell.length; i++) {
        var id = cell[i]; if (seen[id]) continue; seen[id] = 1;
        var b = MAP.provinces[id].bbox;
        if (b[2] >= x0 && b[0] <= x1 && b[3] >= y0 && b[1] <= y1) out.push(id);
      }
    }
    return out;
  }
  R.queryRect = queryRect;

  function pickProvince(mx, my) {
    if (mx < 0 || my < 0 || mx > MAP.width || my > MAP.height) return -1;
    var cell = spatial.cells[clampInt(my / GRID_CELL, spatial.rows) * spatial.cols + clampInt(mx / GRID_CELL, spatial.cols)];
    if (!cell) return -1;
    // Enklawy (np. Brema, Watykan) leżą na poligonie sąsiada bez dziury — wygrywa najmniejsze trafienie.
    var best = -1, bestArea = Infinity;
    for (var i = 0; i < cell.length; i++) {
      var id = cell[i], p = MAP.provinces[id], b = p.bbox;
      if (mx < b[0] || mx > b[2] || my < b[1] || my > b[3]) continue;
      if (p.areaKm2 < bestArea && pickCtx.isPointInPath(provPaths[id], mx, my)) { best = id; bestArea = p.areaKm2; }
    }
    return best;
  }
  R.pickProvince = pickProvince;

  // Floty rysowane są nad armiami, więc mają pierwszeństwo przy wskazywaniu.
  // tol > 0 (dotyk): gdy nic nie trafiono dokładnie, wybierz najbliższy marker w promieniu tol px.
  function pickUnitAt(sx, sy, tol) {
    for (var j = hitFleets.length - 1; j >= 0; j--) {
      var f = hitFleets[j];
      if (sx >= f.x && sx <= f.x + f.w && sy >= f.y && sy <= f.y + f.h) return { type: 'fleet', id: f.id, owner: f.owner, prov: f.prov };
    }
    for (var i = hitArmies.length - 1; i >= 0; i--) {
      var h = hitArmies[i];
      if (sx >= h.x && sx <= h.x + h.w && sy >= h.y && sy <= h.y + h.h) return { type: 'army', id: h.id, owner: h.owner, prov: h.prov };
    }
    if (!tol) return null;
    var best = null, bestD = tol * tol;
    function consider(b, type) {
      var dx = sx < b.x ? b.x - sx : sx > b.x + b.w ? sx - b.x - b.w : 0;
      var dy = sy < b.y ? b.y - sy : sy > b.y + b.h ? sy - b.y - b.h : 0;
      var d = dx * dx + dy * dy;
      if (d <= bestD) { bestD = d; best = { type: type, id: b.id, owner: b.owner, prov: b.prov }; }
    }
    for (var a = 0; a < hitArmies.length; a++) consider(hitArmies[a], 'army');
    for (var k = 0; k < hitFleets.length; k++) consider(hitFleets[k], 'fleet');
    return best;
  }
  R.pickUnitAt = pickUnitAt;

  // ---------------------------------------------------------------------------
  // Kamera
  // ---------------------------------------------------------------------------
  function minZoom() { return Math.min(viewW / MAP.width, viewH / MAP.height) * 0.92; }
  function clampCamera() {
    cam.zoom = Math.max(minZoom(), Math.min(MAX_ZOOM, cam.zoom));
    var vw = viewW / cam.zoom, vh = viewH / cam.zoom;
    var mx = vw * 0.3, my = vh * 0.3;
    cam.x = vw >= MAP.width ? (MAP.width - vw) / 2 : Math.max(-mx, Math.min(MAP.width - vw + mx, cam.x));
    cam.y = vh >= MAP.height ? (MAP.height - vh) / 2 : Math.max(-my, Math.min(MAP.height - vh + my, cam.y));
    needsDraw = true;
  }
  function screenToMap(sx, sy) { return [cam.x + sx / cam.zoom, cam.y + sy / cam.zoom]; }
  function mapToScreen(mx, my) { return [(mx - cam.x) * cam.zoom, (my - cam.y) * cam.zoom]; }
  R.screenToMap = screenToMap;
  R.mapToScreen = mapToScreen;

  function zoomAt(sx, sy, factor) {
    var before = screenToMap(sx, sy);
    cam.zoom = Math.max(minZoom(), Math.min(MAX_ZOOM, cam.zoom * factor));
    cam.x = before[0] - sx / cam.zoom;
    cam.y = before[1] - sy / cam.zoom;
    clampCamera();
  }
  R.zoomBy = function (factor) { zoomAt(viewW / 2, viewH / 2, factor); };
  R.panBy = function (dx, dy) { cam.x += dx / cam.zoom; cam.y += dy / cam.zoom; clampCamera(); };
  R.centerOn = function (mx, my, zoom) {
    stopMotion();
    if (zoom) cam.zoom = zoom;
    cam.zoom = Math.max(minZoom(), Math.min(MAX_ZOOM, cam.zoom));
    cam.x = mx - viewW / 2 / cam.zoom; cam.y = my - viewH / 2 / cam.zoom;
    clampCamera();
  };
  R.centerOnProvince = function (id, zoom) { var p = MAP.provinces[id]; if (p) R.centerOn(p.cx, p.cy, zoom); };
  // offsetX: szerokość (px) panelu zasłaniającego lewą część ekranu — środek przesuwa się w prawo;
  // offsetY: wysokość (px) panelu zasłaniającego dół ekranu (np. bottom sheet na telefonie) — środek idzie w górę.
  R.centerOnCountry = function (cc, minZ, offsetX, offsetY) {
    var ids = [];
    MAP.provinces.forEach(function (p, i) { if (ownerOf(i) === cc) ids.push(i); });
    if (!ids.length) return;
    var b = [1e9, 1e9, -1e9, -1e9];
    ids.forEach(function (i) { var q = MAP.provinces[i].bbox; b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[2]); b[3] = Math.max(b[3], q[3]); });
    var ox = offsetX || 0, oy = offsetY || 0;
    var vw = Math.max(120, viewW - ox), vh = Math.max(120, viewH - oy);
    var padX = Math.min(300, vw * 0.3), padY = Math.min(240, vh * 0.3);
    var z = Math.min(vw / ((b[2] - b[0]) * 2.2 + padX), vh / ((b[3] - b[1]) * 2.2 + padY));
    z = Math.max(minZ || 0.5, Math.min(2.4, z));
    var zc = Math.max(minZoom(), Math.min(MAX_ZOOM, z));
    R.centerOn((b[0] + b[2]) / 2 - ox / 2 / zc, (b[1] + b[3]) / 2 + oy / 2 / zc, z);
  };
  R.camera = function () { return { x: cam.x, y: cam.y, zoom: cam.zoom }; };

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    viewW = canvas.clientWidth || window.innerWidth;
    viewH = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(viewW * dpr); canvas.height = Math.round(viewH * dpr);
    // Telefon/tablet: mniejszy cache kafli (pamięć), ale zawsze większy niż liczba kafli widocznych naraz
    // (inaczej LRU wyrzucałby kafle potrzebne w tej samej klatce).
    if (IS_TOUCH) {
      var visible = (Math.ceil(canvas.width / TILE) + 1) * (Math.ceil(canvas.height / TILE) + 1);
      MAX_TILES = Math.max(32, Math.ceil(visible * 1.5) + 8);
    }
    clampCamera();
  }

  // ---------------------------------------------------------------------------
  // Unieważnianie (flaga dirty)
  // ---------------------------------------------------------------------------
  R.invalidate = function () {
    version++;
    rebuildCountryIndex();
    computeEconomyRange();
    computeCountryLabels();
    needsDraw = true;
  };
  R.requestDraw = function () { needsDraw = true; };
  R.setMode = function (m) { if (m !== mode) { mode = m; R.invalidate(); } };
  R.getMode = function () { return mode; };

  function rebuildCountryIndex() {
    ccIndex = {}; var n = 1;
    for (var i = 0; i < MAP.provinces.length; i++) { var cc = ownerOf(i); if (!ccIndex[cc]) ccIndex[cc] = n++; }
  }
  // Ranking percentylowy — odporny na skrajne wartości (kilka bogatych prowincji nie "przyciemnia" reszty)
  function computeEconomyRange() {
    econRank = null;
    if (!G()) return;
    var n = MAP.provinces.length, vals = new Array(n), order = new Array(n);
    for (var i = 0; i < n; i++) { vals[i] = economyValue(i); order[i] = i; }
    order.sort(function (a, b) { return vals[a] - vals[b]; });
    econRank = new Float32Array(n);
    for (var k = 0; k < n; k++) econRank[order[k]] = n > 1 ? k / (n - 1) : 0.5;
  }
  function idColor(n) {
    return 'rgb(' + (((n & 7) << 5) + 16) + ',' + ((((n >> 3) & 7) << 5) + 16) + ',' + ((((n >> 6) & 7) << 5) + 16) + ')';
  }

  // ---------------------------------------------------------------------------
  // Etykiety państw: największy spójny fragment, rozmiar ~ sqrt(powierzchni)
  // ---------------------------------------------------------------------------
  function computeCountryLabels() {
    var groups = {};
    for (var i = 0; i < MAP.provinces.length; i++) { var cc = ownerOf(i); (groups[cc] || (groups[cc] = [])).push(i); }
    countryLabels = [];
    Object.keys(groups).forEach(function (cc) {
      var comp = largestComponent(groups[cc], cc);
      var lbl = labelForComponent(comp);
      lbl.cc = cc; lbl.text = countryName(cc).toUpperCase();
      lbl.totalArea = groups[cc].reduce(function (s, id) { return s + (MAP.provinces[id].areaKm2 || 0); }, 0);
      countryLabels.push(lbl);
    });
    countryLabels.sort(function (a, b) { return b.area - a.area; });
  }
  function largestComponent(ids, cc) {
    var seen = {}, best = null, bestArea = -1;
    ids.forEach(function (start) {
      if (seen[start]) return;
      var comp = [], stack = [start], area = 0; seen[start] = 1;
      while (stack.length) {
        var id = stack.pop(); comp.push(id); area += MAP.provinces[id].areaKm2 || 1;
        (MAP.provinces[id].nb || []).forEach(function (n) { if (!seen[n] && ownerOf(n) === cc) { seen[n] = 1; stack.push(n); } });
      }
      if (area > bestArea) { bestArea = area; best = comp; }
    });
    return best || ids;
  }
  function labelForComponent(comp) {
    var sx = 0, sy = 0, sa = 0, b = [1e9, 1e9, -1e9, -1e9];
    comp.forEach(function (id) {
      var p = MAP.provinces[id], a = p.areaKm2 || 1;
      sx += p.cx * a; sy += p.cy * a; sa += a;
      b[0] = Math.min(b[0], p.bbox[0]); b[1] = Math.min(b[1], p.bbox[1]); b[2] = Math.max(b[2], p.bbox[2]); b[3] = Math.max(b[3], p.bbox[3]);
    });
    var x = sx / sa, y = sy / sa;
    // jeśli środek ciężkości wypada poza fragment — przyciągnij do najbliższego centroidu prowincji
    var inside = comp.some(function (id) { return pickCtx.isPointInPath(provPaths[id], x, y); });
    if (!inside) {
      var bd = 1e18;
      comp.forEach(function (id) { var p = MAP.provinces[id], d = (p.cx - x) * (p.cx - x) + (p.cy - y) * (p.cy - y); if (d < bd) { bd = d; x = p.cx; y = p.cy; } });
    }
    var kmPerUnit = MAP.kmPerUnit || 4;
    return { x: x, y: y, area: sa, size: 0.2 * Math.sqrt(sa) / kmPerUnit, maxW: (b[2] - b[0]) * 0.92 };
  }

  // ---------------------------------------------------------------------------
  // Renderowanie regionu lądu (kafel lub obraz świata)
  // ---------------------------------------------------------------------------
  function ensureScratch(w, h) {
    if (!scratch) scratch = { id: document.createElement('canvas'), border: document.createElement('canvas') };
    if (scratch.id.width < w + 2 * EDGE_M || scratch.id.height < h + 2 * EDGE_M) { scratch.id.width = w + 2 * EDGE_M; scratch.id.height = h + 2 * EDGE_M; }
    if (scratch.border.width < w || scratch.border.height < h) { scratch.border.width = w; scratch.border.height = h; }
    return scratch;
  }

  // Rysuje ląd do kontekstu g: prostokąt mapy od (x0,y0), skala px/jednostkę, rozmiar w×h px.
  function renderRegion(g, x0, y0, scale, w, h) {
    g.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale);
    var x1 = x0 + w / scale, y1 = y0 + h / scale;
    // morze: pionowy gradient w układzie mapy (ciągły między kaflami)
    var sea = g.createLinearGradient(0, 0, 0, MAP.height);
    sea.addColorStop(0, COLORS.seaTop); sea.addColorStop(0.55, COLORS.sea); sea.addColorStop(1, COLORS.seaBottom);
    g.fillStyle = sea; g.fillRect(x0, y0, x1 - x0, y1 - y0);
    drawGraticule(g, x0, y0, x1, y1, scale);
    drawBackgroundLand(g, scale);
    var ids = queryRect(x0, y0, x1, y1);
    fillProvinces(g, ids, scale);
    drawOccupation(g, ids, scale);
    drawProvinceBorders(g, ids, scale);
    drawCountryBorders(g, ids, x0, y0, scale, w, h);
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  function millerY(latDeg) { var f = latDeg * Math.PI / 180; return 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * f)); }
  function latToY(lat) {
    var top = millerY(MAP.latMax != null ? MAP.latMax : 82), bot = millerY(MAP.latMin != null ? MAP.latMin : -12);
    return (top - millerY(lat)) / (top - bot) * MAP.height;
  }
  function lonToX(lon) {
    var a = MAP.lonMin != null ? MAP.lonMin : -25, b = MAP.lonMax != null ? MAP.lonMax : 192;
    return (lon - a) / (b - a) * MAP.width;
  }
  R.lonLatToMap = function (lon, lat) { return [lonToX(lon), latToY(lat)]; };

  function drawGraticule(g, x0, y0, x1, y1, scale) {
    g.strokeStyle = COLORS.grid; g.lineWidth = 1 / scale;
    g.beginPath();
    var lonA = Math.ceil((MAP.lonMin != null ? MAP.lonMin : -25) / 10) * 10, lonB = MAP.lonMax != null ? MAP.lonMax : 192;
    for (var lon = lonA; lon <= lonB; lon += 10) { var x = lonToX(lon); if (x >= x0 && x <= x1) { g.moveTo(x, Math.max(0, y0)); g.lineTo(x, Math.min(MAP.height, y1)); } }
    var latA = Math.ceil((MAP.latMin != null ? MAP.latMin : -12) / 10) * 10, latB = MAP.latMax != null ? MAP.latMax : 82;
    for (var lat = latA; lat <= latB; lat += 10) { var y = latToY(lat); if (y >= y0 && y <= y1) { g.moveTo(Math.max(0, x0), y); g.lineTo(Math.min(MAP.width, x1), y); } }
    g.stroke();
  }
  function drawBackgroundLand(g, scale) {
    if (!bgPath) return;
    g.fillStyle = COLORS.background; g.fill(bgPath);
    g.strokeStyle = COLORS.backgroundEdge; g.lineWidth = 1 / scale; g.stroke(bgPath);
  }
  function fillProvinces(g, ids, scale) {
    g.lineWidth = 0.9 / scale; g.lineJoin = 'round';
    for (var i = 0; i < ids.length; i++) {
      var c = provinceFill(ids[i]);
      g.fillStyle = c; g.strokeStyle = c;            // obrys w tym samym kolorze zamyka szczeliny antyaliasingu
      g.fill(provPaths[ids[i]]); g.stroke(provPaths[ids[i]]);
    }
  }
  function drawOccupation(g, ids, scale) {
    if (!G() || mode === 'terrain') return;
    var m = new DOMMatrix([1 / scale, 0, 0, 1 / scale, 0, 0]);
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i], ctrl = ctrlOf(id);
      if (ctrl === ownerOf(id)) continue;
      var pat = stripePattern(g, countryColor(ctrl));
      if (pat.setTransform) pat.setTransform(m);
      g.fillStyle = pat; g.fill(provPaths[id]);
    }
  }
  // granice prowincji: cienkie, jasne linie (nowoczesny styl) — pojawiają się płynnie wraz z zoomem
  function drawProvinceBorders(g, ids, scale) {
    var alpha = Math.max(0, Math.min(0.2, (scale - 0.25) * 0.2));
    if (alpha < 0.02) return;
    g.strokeStyle = 'rgba(235,245,255,' + alpha.toFixed(3) + ')';
    g.lineWidth = Math.min(1.1, 0.5 + scale * 0.08) / scale;
    for (var i = 0; i < ids.length; i++) g.stroke(provPaths[ids[i]]);
  }

  // Granice państw: raster ID państw + wykrywanie krawędzi (niezależne od topologii danych).
  // Raster ID państw z marginesem EDGE_M px — cieniowanie przy granicy jest ciągłe między kaflami.
  var EDGE_M = 8;
  function drawCountryBorders(g, ids, x0, y0, scale, w, h) {
    var s = ensureScratch(w, h), M = EDGE_M, W = w + 2 * M, H = h + 2 * M;
    var ic = s.id.getContext('2d', { willReadFrequently: true });
    ids = queryRect(x0 - M / scale, y0 - M / scale, x0 + (w + M) / scale, y0 + (h + M) / scale);
    ic.setTransform(1, 0, 0, 1, 0, 0); ic.clearRect(0, 0, W, H);
    ic.setTransform(scale, 0, 0, scale, -x0 * scale + M, -y0 * scale + M);
    ic.lineWidth = 0.9 / scale;
    if (bgPath) { ic.fillStyle = idColor(511); ic.fill(bgPath); }   // ląd poza grą = osobne "państwo" (brzeg, nie poświata morza)
    for (var i = 0; i < ids.length; i++) {
      var c = idColor(ccIndex[ownerOf(ids[i])] || 0);
      ic.fillStyle = c; ic.strokeStyle = c; ic.fill(provPaths[ids[i]]); ic.stroke(provPaths[ids[i]]);
    }
    var src = new Uint32Array(ic.getImageData(0, 0, W, H).data.buffer);
    var bc = s.border.getContext('2d');
    var out = bc.createImageData(w, h), dst = new Uint32Array(out.data.buffer);
    edgeDetect(src, dst, w, h, scale);
    bc.putImageData(out, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(s.border, 0, 0, w, h, 0, 0, w, h);
  }
  // Krawędzie państw + odległość od krawędzi (chamfer, 2 przebiegi) → wewnętrzne cieniowanie lądu przy granicy
  // i jasna poświata płytkiej wody przy brzegu. Liczone raz na kafel (cache), nie co klatkę.
  var edgeBuf = { n: 0, ids: null, dist: null, lut: null, lutKey: '' };
  function edgeLut(R, scale) {
    var key = R + ':' + Math.round(Math.min(235, 150 + scale * 40));
    if (edgeBuf.lutKey === key) return edgeBuf.lut;
    var lut = { land: new Uint32Array(R + 1), sea: new Uint32Array(R + 1), border: 0 };
    var a = Math.round(Math.min(235, 150 + scale * 40));
    lut.border = ((a << 24) | (14 << 16) | (10 << 8) | 7) >>> 0;     // ABGR (little endian)
    var cg = COLORS.coastGlow;
    for (var d = 1; d <= R; d++) {
      var t = 1 - (d - 0.5) / (R + 0.5), la = Math.round(255 * 0.22 * t * t), sa = Math.round(255 * 0.20 * t * t);
      lut.land[d] = ((la << 24) | (18 << 16) | (10 << 8) | 6) >>> 0;
      lut.sea[d] = ((sa << 24) | (cg[2] << 16) | (cg[1] << 8) | cg[0]) >>> 0;
    }
    edgeBuf.lut = lut; edgeBuf.lutKey = key;
    return lut;
  }
  function edgeDetect(src, dst, w, h, scale) {
    var M = EDGE_M, W = w + 2 * M, H = h + 2 * M, MASK = 0x00e0e0e0, n = W * H;
    var R = Math.max(2, Math.min(M - 1, Math.round(1.5 + scale * 1.5)));
    if (edgeBuf.n < n) { edgeBuf.n = n; edgeBuf.ids = new Uint32Array(n); edgeBuf.dist = new Uint8Array(n); }
    var ids = edgeBuf.ids, dist = edgeBuf.dist, lut = edgeLut(R, scale), INF = 255;
    var x, y, k, v, p, id, e;
    // przebieg 1 (w dół): ID z wyprzedzeniem o wiersz, detekcja krawędzi (4-spójność) i chamfer w przód
    for (k = 0; k < 2 * W; k++) { p = src[k]; ids[k] = (p >>> 24) < 128 ? 0 : (p & MASK); }
    for (k = 0; k < W; k++) dist[k] = INF;
    for (y = 1; y < H - 1; y++) {
      var row = y * W, nxt = row + W, endRow = nxt + W;
      for (k = nxt; k < endRow; k++) { p = src[k]; ids[k] = (p >>> 24) < 128 ? 0 : (p & MASK); }
      dist[row] = INF; dist[nxt - 1] = INF;
      for (k = row + 1; k < nxt - 1; k++) {
        id = ids[k];
        if (id !== ids[k + 1] || id !== ids[k - 1] || id !== ids[k - W] || id !== ids[k + W]) { dist[k] = 0; continue; }
        v = dist[k - 1]; e = dist[k - W]; if (e < v) v = e;
        dist[k] = v < INF ? v + 1 : INF;
      }
    }
    for (k = (H - 1) * W; k < n; k++) dist[k] = INF;
    // przebieg 2 (w górę): chamfer wstecz + zapis wyniku dla wnętrza kafla
    for (y = H - 2; y >= 1; y--) {
      var inner = y >= M && y < M + h, o = (y - M) * w + (W - 2 - M);
      for (x = W - 2, k = y * W + x; x >= 1; x--, k--, o--) {
        v = dist[k];
        if (v) {
          e = dist[k + 1] + 1; if (e < v) v = e;
          e = dist[k + W] + 1; if (e < v) v = e;
          dist[k] = v;
        }
        if (inner && v <= R && x >= M && x < M + w) dst[o] = v === 0 ? lut.border : ids[k] === 0 ? lut.sea[v] : lut.land[v];
      }
    }
  }



  // ---------------------------------------------------------------------------
  // Kafle
  // ---------------------------------------------------------------------------
  function tileScaleFor(s) { return Math.pow(2, Math.round(Math.log2(s) * 2) / 2); }
  function getTile(level, tx, ty, allowRender) {
    var key = level + ':' + tx + ':' + ty, t = tiles.get(key);
    if (t && t.ver === version) { tiles.delete(key); tiles.set(key, t); return t; }
    if (!allowRender) { if (t) pendingTiles = true; return t || null; }
    var c = t ? t.canvas : document.createElement('canvas');
    c.width = TILE; c.height = TILE;
    renderRegion(c.getContext('2d'), tx * TILE / level, ty * TILE / level, level, TILE, TILE);
    t = { canvas: c, ver: version };
    tiles.delete(key); tiles.set(key, t);
    while (tiles.size > MAX_TILES) tiles.delete(tiles.keys().next().value);
    return t;
  }
  function renderWorld() {
    var scale = WORLD_PX / MAP.width, h = Math.ceil(MAP.height * scale);
    var c = world ? world.canvas : document.createElement('canvas');
    c.width = WORLD_PX; c.height = h;
    renderRegion(c.getContext('2d'), 0, 0, scale, WORLD_PX, h);
    world = { canvas: c, scale: scale, ver: version };
  }

  function drawLand(now) {
    var s = cam.zoom * dpr, level = tileScaleFor(s);
    // Podczas pinch-zoomu trzymaj poziom kafli (skalowanie gotowych kafli zamiast renderowania nowych w trakcie gestu).
    if (gestureLevel && s / gestureLevel > 0.85 && s / gestureLevel < 2) level = gestureLevel;
    else if (gestureActive) gestureLevel = level;
    var mx0 = cam.x, my0 = cam.y, mx1 = cam.x + viewW / cam.zoom, my1 = cam.y + viewH / cam.zoom;
    var tx0 = Math.floor(Math.max(-1, mx0) * level / TILE), tx1 = Math.floor(Math.min(MAP.width + 1, mx1) * level / TILE);
    var ty0 = Math.floor(Math.max(-1, my0) * level / TILE), ty1 = Math.floor(Math.min(MAP.height + 1, my1) * level / TILE);
    var cxT = (tx0 + tx1) / 2, cyT = (ty0 + ty1) / 2, list = [];
    for (var ty = ty0; ty <= ty1; ty++) for (var tx = tx0; tx <= tx1; tx++) list.push([tx, ty, Math.abs(tx - cxT) + Math.abs(ty - cyT)]);
    list.sort(function (a, b) { return a[2] - b[2]; });
    pendingTiles = false;
    var t0 = performance.now(), rendered = 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    for (var i = 0; i < list.length; i++) {
      var tx = list[i][0], ty = list[i][1];
      var allow = rendered === 0 && !world || performance.now() - t0 < TILE_BUDGET_MS;
      var t = getTile(level, tx, ty, allow);
      if (allow && t && t.ver === version) rendered++;
      var ax = Math.round((tx * TILE / level - cam.x) * s), bx = Math.round(((tx + 1) * TILE / level - cam.x) * s);
      var ay = Math.round((ty * TILE / level - cam.y) * s), by = Math.round(((ty + 1) * TILE / level - cam.y) * s);
      if (t) ctx.drawImage(t.canvas, ax, ay, bx - ax, by - ay);
      else { pendingTiles = true; drawWorldPart(tx * TILE / level, ty * TILE / level, TILE / level, ax, ay, bx - ax, by - ay); }
    }
    if (!pendingTiles && (!world || world.ver !== version) && now - lastWorldTry > 400) { lastWorldTry = now; renderWorld(); }
  }
  var lastWorldTry = 0;
  function drawWorldPart(mx, my, msize, dx, dy, dw, dh) {
    if (!world) return;
    var k = world.scale;
    ctx.drawImage(world.canvas, mx * k, my * k, msize * k, msize * k, dx, dy, dw, dh);
  }

  // ---------------------------------------------------------------------------
  // Overlay: podświetlenia
  // ---------------------------------------------------------------------------
  function applyMapTransform() { ctx.setTransform(cam.zoom * dpr, 0, 0, cam.zoom * dpr, -cam.x * cam.zoom * dpr, -cam.y * cam.zoom * dpr); }
  function applyScreenTransform() { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }

  function drawHighlights() {
    applyMapTransform();
    var lw = 1 / cam.zoom;
    if (view.highlightCC) drawCountryHighlight(view.highlightCC, lw);
    if (view.hoverProv >= 0 && view.hoverProv !== view.selProv) {
      ctx.fillStyle = COLORS.hover; ctx.fill(provPaths[view.hoverProv]);
      ctx.strokeStyle = COLORS.hoverEdge; ctx.lineWidth = 1.1 * lw; ctx.stroke(provPaths[view.hoverProv]);
    }
    if (view.multi && view.multi.length) drawMultiSelection(lw);
    if (view.selProv >= 0) {
      // zaznaczenie: statyczna poświata akcentu (szeroki półprzezroczysty obrys + ostra linia), bez animacji
      var sp = provPaths[view.selProv];
      ctx.lineJoin = 'round';
      ctx.fillStyle = 'rgba(' + COLORS.accentRgb + ',0.10)'; ctx.fill(sp);
      ctx.strokeStyle = 'rgba(' + COLORS.accentRgb + ',0.16)'; ctx.lineWidth = 9 * lw; ctx.stroke(sp);
      ctx.strokeStyle = COLORS.selectGlow; ctx.lineWidth = 4.5 * lw; ctx.stroke(sp);
      ctx.strokeStyle = COLORS.select; ctx.lineWidth = 1.8 * lw; ctx.stroke(sp);
    }
    var target = view.pending ? view.pending.target : (view.preview ? view.preview.target : -1);
    if (target >= 0) {
      var ok = view.pending ? view.pending.ok !== false : (view.preview && view.preview.ok);
      var rgb = ok ? (((view.pending || view.preview).kind === 'land') ? COLORS.accentRgb : '143,168,255') : '255,107,107';
      ctx.fillStyle = 'rgba(' + rgb + ',0.20)'; ctx.fill(provPaths[target]);
      ctx.strokeStyle = 'rgba(' + rgb + ',0.85)'; ctx.lineWidth = 1.4 * lw; ctx.stroke(provPaths[target]);
    }
  }
  // Zaznaczenie wielu prowincji (masowa budowa): wypełnienie akcentem + obrys
  function drawMultiSelection(lw) {
    ctx.lineJoin = 'round';
    ctx.fillStyle = 'rgba(' + COLORS.accentRgb + ',0.24)';
    ctx.strokeStyle = COLORS.select; ctx.lineWidth = 1.4 * lw;
    for (var i = 0; i < view.multi.length; i++) {
      var path = provPaths[view.multi[i]];
      if (!path) continue;
      ctx.fill(path); ctx.stroke(path);
    }
  }
  function drawCountryHighlight(cc, lw) {
    var vis = visibleProvinces();
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    for (var i = 0; i < vis.length; i++) if (ownerOf(vis[i]) === cc) ctx.fill(provPaths[vis[i]]);
  }
  var visCache = { key: '', ids: [] };
  function visibleProvinces() {
    var key = cam.x.toFixed(1) + ',' + cam.y.toFixed(1) + ',' + cam.zoom.toFixed(4);
    if (visCache.key !== key) { visCache.key = key; visCache.ids = queryRect(cam.x, cam.y, cam.x + viewW / cam.zoom, cam.y + viewH / cam.zoom); }
    return visCache.ids;
  }

  // ---------------------------------------------------------------------------
  // Overlay: etykiety (Inter / systemowy sans, szeroki tracking, miękka obwódka zamiast shadowBlur)
  // ---------------------------------------------------------------------------
  var FONT_SANS = '"Inter", "InterVariable", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  var FONT_MONO = FONT_SANS;

  function drawCountryLabels() {
    if (cam.zoom > 3.4) return;
    var fade = cam.zoom > 1.6 ? Math.max(0, 1 - (cam.zoom - 1.6) / 1.8) : 1;
    applyScreenTransform();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    var placed = [];
    for (var i = 0; i < countryLabels.length; i++) {
      var L = countryLabels[i];
      var px = L.size * cam.zoom * 0.9;
      var maxW = L.maxW * cam.zoom;
      if (px < 8.5) continue;
      px = Math.min(px, 60);
      var track = px * 0.2;
      ctx.font = '700 ' + px.toFixed(1) + 'px ' + FONT_SANS;
      setLetterSpacing(track);
      var tw = ctx.measureText(L.text).width;
      if (tw > maxW && maxW > 0) { px *= maxW / tw; if (px < 8.5) continue; track = px * 0.2; ctx.font = '700 ' + px.toFixed(1) + 'px ' + FONT_SANS; setLetterSpacing(track); tw = ctx.measureText(L.text).width; }
      var p = mapToScreen(L.x, L.y);
      if (p[0] < -tw || p[0] > viewW + tw || p[1] < -px || p[1] > viewH + px) continue;
      var box = [p[0] - tw / 2, p[1] - px / 2, p[0] + tw / 2, p[1] + px / 2];
      if (overlapsAny(box, placed)) continue;
      placed.push(box);
      var x = p[0] + track / 2;            // letterSpacing dodaje odstęp także po ostatniej literze
      ctx.globalAlpha = fade * 0.22;
      ctx.lineWidth = Math.max(3, px * 0.28); ctx.strokeStyle = COLORS.labelHalo; ctx.strokeText(L.text, x, p[1]);
      ctx.globalAlpha = fade;
      ctx.lineWidth = Math.max(1.6, px * 0.12); ctx.strokeText(L.text, x, p[1]);
      ctx.fillStyle = COLORS.labelInk;
      ctx.fillText(L.text, x, p[1]);
      ctx.globalAlpha = 1;
    }
    setLetterSpacing(0);
  }
  function setLetterSpacing(px) { if ('letterSpacing' in ctx) ctx.letterSpacing = px.toFixed(1) + 'px'; }
  function overlapsAny(b, list) {
    for (var i = 0; i < list.length; i++) { var o = list[i]; if (b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]) return true; }
    return false;
  }

  function drawProvinceLabels() {
    if (cam.zoom < 1.6) return;
    applyScreenTransform();
    var vis = visibleProvinces();
    var px = Math.min(12.5, 9 + cam.zoom * 0.5);
    ctx.font = '500 ' + px.toFixed(1) + 'px ' + FONT_SANS;
    setLetterSpacing(0.2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    var a = Math.min(1, (cam.zoom - 1.6) / 0.8);
    for (var i = 0; i < vis.length; i++) {
      var p = MAP.provinces[vis[i]];
      var wpx = (p.bbox[2] - p.bbox[0]) * cam.zoom;
      if (wpx < 70) continue;
      var s = mapToScreen(p.cx, p.cy);
      var y = s[1] + 19;
      ctx.globalAlpha = a;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(6,10,16,0.5)'; ctx.strokeText(p.name, s[0], y);
      ctx.fillStyle = 'rgba(255,255,255,0.86)'; ctx.fillText(p.name, s[0], y);
    }
    ctx.globalAlpha = 1;
    setLetterSpacing(0);
  }

  // ---------------------------------------------------------------------------
  // Overlay: trasy — wygładzona linia przerywana, animowany przesuw kresek (tylko overlay), grot, etykieta-pigułka
  // ---------------------------------------------------------------------------
  function drawRoutes() {
    var g = G(); if (!g) return;
    applyScreenTransform();
    var me = g.player;
    Object.keys(g.armies).forEach(function (id) {
      var a = g.armies[id];
      if (a.owner !== me || a.embarked || !a.path || !a.path.length) return;
      var sel = view.sel && view.sel.type === 'army' && view.sel.id === id;
      drawPolyline(landPoints(a.prov, a.path), sel ? COLORS.route : 'rgba(' + COLORS.accentRgb + ',0.55)', sel ? 2.4 : 1.6, null, sel);
    });
    Object.keys(g.fleets).forEach(function (id) {
      var f = g.fleets[id];
      if (f.owner !== me || !f.path || !f.path.length) return;
      var sel = view.sel && view.sel.type === 'fleet' && view.sel.id === id;
      drawPolyline(seaPoints(f.prov, f.path), sel ? COLORS.routeSea : 'rgba(143,168,255,0.6)', sel ? 2.4 : 1.6, null, sel);
    });
    var plan = view.pending || view.preview;
    if (plan && plan.points && plan.points.length > 1) {
      var color = !plan.ok ? COLORS.routeBad : (plan.kind === 'land' ? COLORS.route : COLORS.routeSea);
      drawPolyline(plan.points, color, 2.8, plan.label || null, true);
    }
  }
  function provPoint(id) { var p = MAP.provinces[id]; return [p.cx, p.cy]; }
  function portPoint(id) { var p = MAP.provinces[id]; return p.port || [p.cx, p.cy]; }
  function landPoints(from, path) { var pts = [provPoint(from)]; path.forEach(function (id) { pts.push(provPoint(id)); }); return pts; }
  function seaPoints(from, path) { var pts = [portPoint(from)]; path.forEach(function (id) { pts.push(portPoint(id)); }); return pts; }
  R.landPoints = landPoints;
  R.seaPoints = seaPoints;
  R.provPoint = provPoint;
  R.portPoint = portPoint;

  // ścieżka przez punkty pośrednie wygładzona krzywymi kwadratowymi (punkty kontrolne = wierzchołki)
  function smoothPath(sp, endTrim) {
    var n = sp.length, last = sp[n - 1], prev = n > 2 ? mid(sp[n - 2], last) : sp[0];
    var dx = last[0] - prev[0], dy = last[1] - prev[1], d = Math.hypot(dx, dy) || 1;
    var end = [last[0] - dx / d * Math.min(endTrim, d * 0.6), last[1] - dy / d * Math.min(endTrim, d * 0.6)];
    ctx.beginPath(); ctx.moveTo(sp[0][0], sp[0][1]);
    if (n === 2) ctx.lineTo(end[0], end[1]);
    else {
      for (var i = 1; i < n - 1; i++) { var m = i < n - 2 ? mid(sp[i], sp[i + 1]) : prev; ctx.quadraticCurveTo(sp[i][0], sp[i][1], m[0], m[1]); }
      ctx.lineTo(end[0], end[1]);
    }
    return prev;
  }
  function mid(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
  function drawPolyline(pts, color, width, label, animated) {
    if (pts.length < 2) return;
    var sp = pts.map(function (p) { return mapToScreen(p[0], p[1]); });
    var head = 7 + width * 2;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var from = smoothPath(sp, head * 0.6);
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(4,8,14,0.5)'; ctx.lineWidth = width + 3.5; ctx.stroke();       // ciemne podłoże (czytelność)
    ctx.globalAlpha = 0.22; ctx.strokeStyle = color; ctx.lineWidth = width + 5; ctx.stroke(); // poświata
    ctx.globalAlpha = 1;
    ctx.setLineDash([10, 7]); ctx.lineDashOffset = animated ? -dashPhase : 0;
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
    ctx.setLineDash([]);
    for (var i = 1; i < sp.length - 1; i++) {
      ctx.beginPath(); ctx.arc(sp[i][0], sp[i][1], width * 0.95 + 0.6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(4,8,14,0.65)'; ctx.fill();
      ctx.beginPath(); ctx.arc(sp[i][0], sp[i][1], width * 0.95, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
    }
    drawArrowHead(from, sp[sp.length - 1], color, head);
    if (label) drawRouteLabel(sp[sp.length - 1], label, color);
  }
  function drawArrowHead(a, b, color, L) {
    var ang = Math.atan2(b[1] - a[1], b[0] - a[0]), c = Math.cos(ang), s = Math.sin(ang);
    var bx = b[0] - c * L * 0.72, by = b[1] - s * L * 0.72;            // wcięcie z tyłu grota
    ctx.beginPath();
    ctx.moveTo(b[0], b[1]);
    ctx.lineTo(b[0] - L * Math.cos(ang - 0.42), b[1] - L * Math.sin(ang - 0.42));
    ctx.lineTo(bx, by);
    ctx.lineTo(b[0] - L * Math.cos(ang + 0.42), b[1] - L * Math.sin(ang + 0.42));
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(4,8,14,0.6)'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.fillStyle = color; ctx.fill();
  }
  function drawRouteLabel(p, text, color) {
    ctx.font = '600 12px ' + FONT_SANS;
    var w = ctx.measureText(text).width + 18, h = 22, x = p[0] + 12, y = p[1] - 30;
    roundRect(x, y + 2, w, h, h / 2); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();   // tani cień
    roundRect(x, y, w, h, h / 2);
    ctx.fillStyle = 'rgba(12,18,28,0.94)'; ctx.fill();
    ctx.strokeStyle = color; ctx.globalAlpha = 0.7; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(x + 9, y + h / 2, 2.5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    ctx.fillStyle = '#eef6fb'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 15, y + h / 2 + 0.5);
  }
  function roundRect(x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
  }

  // ---------------------------------------------------------------------------
  // Overlay: armie (pigułki w kolorze państwa) i floty
  // ---------------------------------------------------------------------------
  function fmtK(n) {
    var k = n / 1000;
    if (k >= 100) return Math.round(k) + 'k';
    if (k >= 10) return (Math.round(k * 10) / 10).toFixed(1).replace(/\.0$/, '') + 'k';
    return (Math.round(k * 10) / 10).toFixed(1) + 'k';
  }
  R.fmtK = fmtK;

  function armyVisible(a, me) {
    if (a.owner === me) return true;
    if (cam.zoom >= 0.7) return true;
    return !!(me && WT.diplomacy && WT.diplomacy.atWar && safeBool(WT.diplomacy.atWar, me, a.owner));
  }
  function groupArmies() {
    var g = G(), byProv = {}, me = g.player;
    var vx0 = cam.x - 40 / cam.zoom, vy0 = cam.y - 30 / cam.zoom, vx1 = cam.x + (viewW + 40) / cam.zoom, vy1 = cam.y + (viewH + 30) / cam.zoom;
    for (var id in g.armies) {
      var a = g.armies[id];
      if (a.embarked || a.prov == null || !MAP.provinces[a.prov]) continue;
      var p = MAP.provinces[a.prov];
      if (p.cx < vx0 || p.cx > vx1 || p.cy < vy0 || p.cy > vy1) continue;
      if (!armyVisible(a, me)) continue;
      (byProv[a.prov] || (byProv[a.prov] = [])).push(a);
    }
    for (var pid in byProv) if (byProv[pid].length > 1) byProv[pid] = stackByOwner(byProv[pid]);
    return byProv;
  }
  // Jeden marker na państwo w prowincji: liczba = suma wojsk; marker (zaznaczenie/przeciąganie) wskazuje
  // stojącą armię (gdy jest), inaczej największą maszerującą.
  function stackByOwner(list) {
    var by = {}, out = [];
    list.forEach(function (a) {
      var s = by[a.owner];
      if (!s) { s = by[a.owner] = { id: a.id, owner: a.owner, prov: a.prov, size: 0, path: a.path, lead: a }; out.push(s); }
      s.size += a.size;
      var selId = view.sel && view.sel.type === 'army' ? view.sel.id : null;
      if (s.lead.id === selId) return;                     // zaznaczona armia pozostaje "twarzą" markera
      var standA = !(a.path && a.path.length), standL = !(s.lead.path && s.lead.path.length);
      if (a.id === selId || (standA && !standL) || (standA === standL && a.size > s.lead.size)) { s.lead = a; s.id = a.id; s.path = a.path; }
    });
    return out;
  }
  R.stackByOwner = stackByOwner;
  var CHIP_FONT = '700 11px ' + FONT_SANS;
  function drawArmies() {
    hitArmies = [];
    var g = G(); if (!g) return;
    applyScreenTransform();
    var byProv = groupArmies(), me = g.player;
    ctx.font = CHIP_FONT; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    setLetterSpacing(0.2);
    Object.keys(byProv).forEach(function (pid) {
      var list = byProv[pid].sort(function (a, b) { return a.owner === me ? -1 : b.owner === me ? 1 : a.owner < b.owner ? -1 : 1; });
      var c = mapToScreen(MAP.provinces[pid].cx, MAP.provinces[pid].cy);
      layoutBoxes(list, c[0], c[1]).forEach(function (b) { drawArmyBox(b, me); });
    });
    setLetterSpacing(0);
  }
  function layoutBoxes(list, cx, cy) {
    var H = 18, gap = 3, perRow = 3, boxes = [];
    var widths = list.map(function (a) { return Math.max(36, Math.ceil(ctx.measureText(fmtK(a.size)).width) + 18); });
    var rows = Math.ceil(list.length / perRow);
    for (var r = 0; r < rows; r++) {
      var items = list.slice(r * perRow, r * perRow + perRow), ws = widths.slice(r * perRow, r * perRow + perRow);
      var total = ws.reduce(function (s, w) { return s + w; }, 0) + gap * (items.length - 1);
      var x = cx - total / 2, y = cy - (rows * (H + gap)) / 2 + r * (H + gap);
      items.forEach(function (a, i) { boxes.push({ army: a, x: Math.round(x), y: Math.round(y), w: Math.round(ws[i]), h: H }); x += ws[i] + gap; });
    }
    return boxes;
  }
  // Pigułka: cień (przesunięta ciemna kopia, bez shadowBlur), wypełnienie kolorem państwa, obrys, połysk u góry.
  function drawPill(x, y, w, h, fill, stroke, strokeW) {
    roundRect(x, y + 1.5, w, h, h / 2); ctx.fillStyle = 'rgba(0,0,0,0.38)'; ctx.fill();
    roundRect(x, y, w, h, h / 2); ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = stroke; ctx.lineWidth = strokeW; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + h * 0.5, y + 2.2); ctx.lineTo(x + w - h * 0.5, y + 2.2);    // połysk u góry
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1; ctx.stroke();
  }
  function drawArmyBox(b, me) {
    var a = b.army, color = countryColor(a.owner), mine = a.owner === me;
    var selected = view.sel && view.sel.type === 'army' && view.sel.id === a.id;
    var dragging = pointer.dragUnit && pointer.dragUnit.type === 'army' && pointer.dragUnit.id === a.id && pointer.moved;
    if (selected) {   // poświata akcentu wokół zaznaczonej armii
      roundRect(b.x - 5, b.y - 5, b.w + 10, b.h + 10, (b.h + 10) / 2); ctx.fillStyle = 'rgba(' + COLORS.accentRgb + ',0.18)'; ctx.fill();
      roundRect(b.x - 2.5, b.y - 2.5, b.w + 5, b.h + 5, (b.h + 5) / 2); ctx.fillStyle = COLORS.select; ctx.fill();
    }
    ctx.globalAlpha = dragging ? 0.55 : 1;
    drawPill(b.x, b.y, b.w, b.h, color, mine ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.45)', mine ? 1.3 : 1);
    var light = luminance(color) > 0.6;
    ctx.fillStyle = light ? '#0b1118' : '#ffffff';
    ctx.fillText(fmtK(a.size), b.x + b.w / 2, b.y + b.h / 2 + 0.5);
    ctx.globalAlpha = 1;
    if (mine && a.path && a.path.length) drawMovingMark(b);
    hitArmies.push({ x: b.x, y: b.y, w: b.w, h: b.h, id: a.id, owner: a.owner, prov: a.prov });
  }
  function drawMovingMark(b) {   // mały szewron "w ruchu" w kolorze akcentu
    var x = b.x + b.w + 3, cy = b.y + b.h / 2;
    ctx.beginPath(); ctx.moveTo(x, cy - 4); ctx.lineTo(x + 4.5, cy); ctx.lineTo(x, cy + 4);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(4,8,14,0.7)'; ctx.lineWidth = 3.6; ctx.stroke();
    ctx.strokeStyle = COLORS.route; ctx.lineWidth = 2; ctx.stroke();
  }

  function drawFleets() {
    hitFleets = [];
    var g = G(); if (!g || !g.fleets) return;
    applyScreenTransform();
    var me = g.player, byPort = {};
    for (var id in g.fleets) {
      var f = g.fleets[id];
      if (f.prov == null || !MAP.provinces[f.prov]) continue;
      if (f.owner !== me && cam.zoom < 0.7) continue;
      (byPort[f.prov] || (byPort[f.prov] = [])).push(f);
    }
    ctx.font = CHIP_FONT; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    Object.keys(byPort).forEach(function (pid) {
      var pt = portPoint(+pid), s = mapToScreen(pt[0], pt[1]);
      if (s[0] < -60 || s[0] > viewW + 60 || s[1] < -30 || s[1] > viewH + 30) return;
      byPort[pid].forEach(function (f, i) { drawFleetIcon(f, s[0] - 4, s[1] + 4 + i * 22, me); });
    });
  }
  function drawFleetIcon(f, x, y, me) {
    var color = countryColor(f.owner), mine = f.owner === me;
    var cargo = (f.cargo || []).length, guns = f.gunships || 0;
    var label = String(Math.round(f.ships));
    var tw = ctx.measureText(label).width, cw = cargo ? ctx.measureText(String(cargo)).width + 12 : 0;
    var gw = guns ? ctx.measureText(String(guns)).width + 20 : 0;
    var h = 19, w = Math.ceil(30 + tw + (cargo ? cw + 4 : 0) + (guns ? gw + 4 : 0));
    var selected = view.sel && view.sel.type === 'fleet' && view.sel.id === f.id;
    if (selected) {
      roundRect(x - 5, y - 5, w + 10, h + 10, (h + 10) / 2); ctx.fillStyle = 'rgba(' + COLORS.accentRgb + ',0.18)'; ctx.fill();
      roundRect(x - 2.5, y - 2.5, w + 5, h + 5, (h + 5) / 2); ctx.fillStyle = COLORS.select; ctx.fill();
    }
    drawPill(x, y, w, h, 'rgba(10,20,34,0.94)', mine ? 'rgba(' + COLORS.accentRgb + ',0.9)' : color, 1.3);
    // kropka-plakietka w kolorze państwa z ikoną okrętu
    ctx.beginPath(); ctx.arc(x + h / 2, y + h / 2, h / 2 - 2.5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    drawShipGlyph(x + h / 2, y + h / 2, luminance(color) > 0.6 ? '#0b1118' : '#ffffff');
    ctx.fillStyle = '#eef6fb'; ctx.fillText(label, x + h + 4, y + h / 2 + 0.5);
    if (cargo) {   // ładunek: mała pigułka akcentu z liczbą armii na pokładzie
      var cx = x + h + 4 + tw + 5;
      roundRect(cx, y + 3, cw, h - 6, (h - 6) / 2); ctx.fillStyle = 'rgba(' + COLORS.accentRgb + ',0.22)'; ctx.fill();
      ctx.fillStyle = COLORS.accent; ctx.fillText(String(cargo), cx + 6, y + h / 2 + 0.5);
    }
    if (guns) {   // okręty artyleryjskie: pomarańczowa pigułka z lufą i liczbą
      var gx = x + w - gw - 4;
      roundRect(gx, y + 3, gw, h - 6, (h - 6) / 2); ctx.fillStyle = 'rgba(255,150,60,0.24)'; ctx.fill();
      ctx.strokeStyle = '#ffb066'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(gx + 5, y + h / 2 + 3); ctx.lineTo(gx + 12, y + h / 2 - 3); ctx.stroke();
      ctx.beginPath(); ctx.arc(gx + 6, y + h / 2 + 3, 2, 0, Math.PI * 2); ctx.fillStyle = '#ffb066'; ctx.fill();
      ctx.lineCap = 'butt';
      ctx.fillStyle = '#ffd2a6'; ctx.fillText(String(guns), gx + 15, y + h / 2 + 0.5);
    }
    hitFleets.push({ x: x, y: y, w: w, h: h, id: f.id, owner: f.owner, prov: f.prov });
  }
  function drawShipGlyph(cx, cy, color) {   // stylizowany okręt (kadłub + nadbudówka), wyśrodkowany w (cx, cy)
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx - 5.5, cy + 0.5); ctx.lineTo(cx + 5.5, cy + 0.5); ctx.lineTo(cx + 3.5, cy + 3.5); ctx.lineTo(cx - 3.5, cy + 3.5); ctx.closePath();
    ctx.fill();
    ctx.fillRect(cx - 2.5, cy - 2.5, 4.5, 2.6);
    ctx.fillRect(cx - 0.9, cy - 4.5, 1.4, 2.2);
  }

  // ---------------------------------------------------------------------------
  // Lotnictwo: zasięgi (nalot, radar), dywizjony w bazach i w locie
  // ---------------------------------------------------------------------------
  function drawRangeCircle(c, rgb, dashed) {
    var s = mapToScreen(c.x, c.y), r = c.r * cam.zoom;
    ctx.beginPath(); ctx.arc(s[0], s[1], r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(' + rgb + ',0.10)'; ctx.fill();
    ctx.strokeStyle = 'rgba(4,8,14,0.55)'; ctx.lineWidth = 4; ctx.stroke();   // ciemna obwódka — czytelność na jasnych państwach
    ctx.setLineDash(dashed ? [10, 6] : []);
    ctx.strokeStyle = 'rgba(' + rgb + ',0.95)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.setLineDash([]);
  }
  function drawAir() {
    var g = G(); if (!g || !g.squadrons || !WT.air || view.startScreen) return;
    applyScreenTransform();
    if (view.radarRing) drawRangeCircle(view.radarRing, '120,220,160', true);
    if (view.airRange) drawRangeCircle(view.airRange, '255,170,80', true);
    var me = g.player, list = WT.air.visibleFor(me), atBase = {};
    ctx.font = CHIP_FONT; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    list.forEach(function (sq) {
      if (sq.phase === 'idle') { (atBase[sq.base] || (atBase[sq.base] = [])).push(sq); return; }
      drawFlyingSquad(sq, sq.owner === me);
    });
    Object.keys(atBase).forEach(function (pid) {
      var p = MAP.provinces[pid], s = mapToScreen(p.cx, p.cy);
      if (s[0] < -60 || s[0] > viewW + 60 || s[1] < -40 || s[1] > viewH + 40) return;
      atBase[pid].forEach(function (sq, i) { drawPlaneChip(sq, s[0] - 18, s[1] + 14 + i * 22); });
    });
  }
  function drawPlaneChip(sq, x, y) {
    var color = countryColor(sq.owner), label = String(sq.planes);
    var tw = ctx.measureText(label).width, h = 19, w = Math.ceil(30 + tw);
    drawPill(x, y, w, h, 'rgba(10,20,34,0.94)', 'rgba(255,170,80,0.9)', 1.3);
    ctx.beginPath(); ctx.arc(x + h / 2, y + h / 2, h / 2 - 2.5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    drawPlaneGlyph(x + h / 2, y + h / 2, -Math.PI / 2, luminance(color) > 0.6 ? '#0b1118' : '#ffffff', 0.8);
    ctx.fillStyle = '#eef6fb'; ctx.fillText(label, x + h + 4, y + h / 2 + 0.5);
  }
  function drawFlyingSquad(sq, mine) {
    var s = mapToScreen(sq.x, sq.y);
    var tp = sq.phase === 'out' ? MAP.provinces[sq.target] : MAP.provinces[sq.base];
    var t = mapToScreen(tp.cx, tp.cy), ang = Math.atan2(t[1] - s[1], t[0] - s[0]);
    var rgb = mine ? COLORS.accentRgb : '255,107,107';
    // linia lotu do celu (wróg widoczny tylko w zasięgu radaru)
    ctx.setLineDash([6, 5]); ctx.lineDashOffset = -dashPhase;
    ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(t[0], t[1]);
    ctx.strokeStyle = 'rgba(' + rgb + ',0.8)'; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
    if (sq.phase === 'out') { ctx.beginPath(); ctx.arc(t[0], t[1], 9, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(' + rgb + ',0.9)'; ctx.lineWidth = 2; ctx.stroke(); }
    if (!mine) { ctx.beginPath(); ctx.arc(s[0], s[1], 15, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,107,107,0.18)'; ctx.fill(); }
    ctx.beginPath(); ctx.arc(s[0], s[1], 10, 0, Math.PI * 2);
    ctx.fillStyle = countryColor(sq.owner); ctx.fill();
    ctx.strokeStyle = 'rgba(' + rgb + ',0.95)'; ctx.lineWidth = 1.6; ctx.stroke();
    drawPlaneGlyph(s[0], s[1], ang, luminance(countryColor(sq.owner)) > 0.6 ? '#0b1118' : '#ffffff', 1);
    ctx.fillStyle = '#eef6fb'; ctx.strokeStyle = 'rgba(4,8,14,0.85)'; ctx.lineWidth = 3;
    ctx.strokeText(String(sq.planes), s[0] + 13, s[1] - 8); ctx.fillText(String(sq.planes), s[0] + 13, s[1] - 8);
  }
  function drawPlaneGlyph(cx, cy, ang, color, k) {   // sylwetka samolotu skierowana pod kątem `ang`
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang); ctx.scale(k, k);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(7, 0); ctx.lineTo(1, -1.4); ctx.lineTo(-1, -6.5); ctx.lineTo(-3, -6.5); ctx.lineTo(-2, -1.4);
    ctx.lineTo(-5.5, -1.2); ctx.lineTo(-7, -3.5); ctx.lineTo(-8, -3.5); ctx.lineTo(-7, 0);
    ctx.lineTo(-8, 3.5); ctx.lineTo(-7, 3.5); ctx.lineTo(-5.5, 1.2); ctx.lineTo(-2, 1.4); ctx.lineTo(-3, 6.5);
    ctx.lineTo(-1, 6.5); ctx.lineTo(1, 1.4); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // Duch przeciąganej jednostki przy kursorze
  function drawDragGhost() {
    if (!pointer.dragUnit || !pointer.moved) return;
    applyScreenTransform();
    ctx.beginPath(); ctx.arc(pointer.x, pointer.y, 11, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(' + COLORS.accentRgb + ',0.18)'; ctx.fill();
    ctx.beginPath(); ctx.arc(pointer.x, pointer.y, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.accent; ctx.fill();
    ctx.strokeStyle = 'rgba(4,8,14,0.8)'; ctx.lineWidth = 1.5; ctx.stroke();
  }


  // ---------------------------------------------------------------------------
  // Pętla klatek
  // ---------------------------------------------------------------------------
  // animowany przesuw kresek tylko dla planowanej trasy i trasy zaznaczonej jednostki (zaznaczenie prowincji jest statyczne)
  function hasAnimation() { return !!(view.preview || view.pending || selHasRoute() || airborne()); }
  function airborne() {
    var g = G(); if (!g || !g.squadrons) return false;
    for (var id in g.squadrons) if (g.squadrons[id].owner === g.player && g.squadrons[id].phase !== 'idle') return true;
    return false;
  }
  function selHasRoute() {
    var g = G(), s = view.sel; if (!g || !s) return false;
    var u = s.type === 'army' ? g.armies[s.id] : (g.fleets || {})[s.id];
    return !!(u && u.path && u.path.length);
  }
  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.05, (now - (lastFrame || now)) / 1000); lastFrame = now;
    if (applyKeyPan(dt)) needsDraw = true;
    if (applyMotion(now, dt)) needsDraw = true;
    if (hasAnimation()) { dashPhase = (dashPhase + dt * 22) % 1000; needsDraw = true; }
    if (!needsDraw && !pendingTiles) return;
    needsDraw = false;
    drawFrame(now);
    fpsTick(now);
  }
  // Podczas ruchu kamery szklane panele przechodzą na tańsze, prawie kryjące tło (bez backdrop-filter):
  // rozmycie tła, które zmienia się co klatkę, to najdroższy element kompozycji (zwłaszcza na telefonach).
  var camTrack = { x: NaN, y: NaN, z: NaN, on: false, timer: 0 };
  function trackCameraMotion() {
    if (cam.x === camTrack.x && cam.y === camTrack.y && cam.zoom === camTrack.z) return;
    var first = camTrack.x !== camTrack.x;
    camTrack.x = cam.x; camTrack.y = cam.y; camTrack.z = cam.zoom;
    if (first || !document.body) return;
    if (!camTrack.on) { camTrack.on = true; document.body.classList.add('map-moving'); }
    clearTimeout(camTrack.timer);
    camTrack.timer = setTimeout(function () { camTrack.on = false; document.body.classList.remove('map-moving'); }, 180);
  }
  function drawFrame(now) {
    trackCameraMotion();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COLORS.seaDeep; ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawLand(now);
    drawHighlights();
    drawCountryLabels();
    drawProvinceLabels();
    drawRoutes();
    drawArmies();
    drawFleets();
    drawAir();
    drawDragGhost();
  }
  var fps = { frames: 0, t0: 0, value: 0 };
  function fpsTick(now) { fps.frames++; if (now - fps.t0 > 1000) { fps.value = fps.frames * 1000 / (now - fps.t0); fps.frames = 0; fps.t0 = now; } }
  R.fps = function () { return fps.value; };
  R.forceDraw = function () { drawFrame(performance.now()); };

  // ---------------------------------------------------------------------------
  // Wejście: klawiatura (pan) — reszta skrótów w WT.ui
  // ---------------------------------------------------------------------------
  var PAN_KEYS = { ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0], ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1] };
  R.keyDown = function (code) { if (PAN_KEYS[code]) { keysDown[code] = true; return true; } return false; };
  R.keyUp = function (code) { delete keysDown[code]; };
  R.clearKeys = function () { keysDown = {}; };
  function applyKeyPan(dt) {
    var dx = 0, dy = 0;
    for (var k in keysDown) { var v = PAN_KEYS[k]; if (v) { dx += v[0]; dy += v[1]; } }
    if (!dx && !dy) return false;
    var speed = 720 * dt;
    cam.x += dx * speed / cam.zoom; cam.y += dy * speed / cam.zoom; clampCamera();
    return true;
  }

  // ---------------------------------------------------------------------------
  // Ruch kamery: inercja po przeciągnięciu palcem, animowany zoom (double-tap, przyciski),
  // przewijanie mapy przy krawędzi podczas przeciągania jednostki palcem.
  // ---------------------------------------------------------------------------
  var inertia = null;              // { vx, vy } — px CSS / s
  var zoomAnim = null;             // { sx, sy, mx, my, from, to, t0, dur }
  var gestureActive = false, gestureLevel = 0;   // blokada poziomu kafli w trakcie pinch
  function stopMotion() { inertia = null; zoomAnim = null; }
  function applyMotion(now, dt) {
    var moved = false;
    if (zoomAnim) {
      var t = Math.max(0, Math.min(1, (performance.now() - zoomAnim.t0) / zoomAnim.dur));
      var e = 1 - Math.pow(1 - t, 3);
      cam.zoom = Math.max(minZoom(), Math.min(MAX_ZOOM, zoomAnim.from * Math.pow(zoomAnim.to / zoomAnim.from, e)));
      cam.x = zoomAnim.mx - zoomAnim.sx / cam.zoom; cam.y = zoomAnim.my - zoomAnim.sy / cam.zoom;
      clampCamera();
      if (t >= 1) zoomAnim = null;
      moved = true;
    }
    if (inertia) {
      cam.x -= inertia.vx * dt / cam.zoom; cam.y -= inertia.vy * dt / cam.zoom; clampCamera();
      var k = Math.exp(-dt / 0.32); inertia.vx *= k; inertia.vy *= k;
      if (Math.abs(inertia.vx) + Math.abs(inertia.vy) < 20) inertia = null;
      moved = true;
    }
    if (pointer.dragUnit && pointer.moved && touches.size === 1) {
      var EZ = 40, ex = 0, ey = 0;
      if (pointer.x < EZ) ex = -(EZ - pointer.x) / EZ; else if (pointer.x > viewW - EZ) ex = (pointer.x - viewW + EZ) / EZ;
      if (pointer.y < EZ) ey = -(EZ - pointer.y) / EZ; else if (pointer.y > viewH - EZ) ey = (pointer.y - viewH + EZ) / EZ;
      if (ex || ey) {
        cam.x += ex * 650 * dt / cam.zoom; cam.y += ey * 650 * dt / cam.zoom; clampCamera();
        updateHover(pointer.x, pointer.y);
        moved = true;
      }
    }
    return moved;
  }
  function animateZoomAt(sx, sy, factor) {
    var target = Math.max(minZoom(), Math.min(MAX_ZOOM, (zoomAnim ? zoomAnim.to : cam.zoom) * factor));
    var m = screenToMap(sx, sy);
    inertia = null;
    zoomAnim = { sx: sx, sy: sy, mx: m[0], my: m[1], from: cam.zoom, to: target, t0: performance.now(), dur: 240 };
    needsDraw = true;
  }
  // Płynny zoom (przyciski na ekranie, double-tap); punkt stały domyślnie w środku ekranu.
  R.zoomAnimated = function (factor, sx, sy) { animateZoomAt(sx == null ? viewW / 2 : sx, sy == null ? viewH / 2 : sy, factor); };
  R.isTouch = function () { return IS_TOUCH; };

  // ---------------------------------------------------------------------------
  // Wejście: mysz / pióro (pointerType 'mouse' | 'pen')
  // ---------------------------------------------------------------------------
  function localXY(e) { var r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  function call(name) { var h = R.handlers[name]; if (h) return h.apply(null, Array.prototype.slice.call(arguments, 1)); }
  function blurActive() {
    var ae = document.activeElement;
    if (ae && ae !== document.body && ae.blur) ae.blur();   // skróty klawiszowe działają po kliknięciu w mapę
  }
  function setHover(id) { if (id !== view.hoverProv) { view.hoverProv = id; call('hoverChange', id); } }

  function onPointerDown(e) {
    if (e.pointerType === 'touch') { touchDown(e); return; }
    var p = localXY(e);
    blurActive();
    stopMotion();
    pointer.down = true; pointer.button = e.button; pointer.sx = pointer.lx = p[0]; pointer.sy = pointer.ly = p[1];
    pointer.moved = false; pointer.dragUnit = null;
    if (e.button === 0) {
      var u = pickUnitAt(p[0], p[1]);
      if (u && call('canDragUnit', u)) pointer.dragUnit = u;
    }
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    if (e.pointerType === 'touch') { touchMove(e); return; }
    var p = localXY(e);
    pointer.x = p[0]; pointer.y = p[1];
    if (pointer.down) {
      if (!pointer.moved && Math.hypot(p[0] - pointer.sx, p[1] - pointer.sy) > 4) {
        pointer.moved = true;
        if (pointer.dragUnit) call('dragStart', pointer.dragUnit);
      }
      if (pointer.moved && !pointer.dragUnit) { cam.x -= (p[0] - pointer.lx) / cam.zoom; cam.y -= (p[1] - pointer.ly) / cam.zoom; clampCamera(); }
      pointer.lx = p[0]; pointer.ly = p[1];
    }
    updateHover(p[0], p[1]);
    needsDraw = true;
  }
  function onPointerUp(e) {
    if (e.pointerType === 'touch') { touchUp(e, false); return; }
    if (!pointer.down) return;
    var p = localXY(e), wasDrag = pointer.moved, unit = pointer.dragUnit, button = pointer.button;
    pointer.down = false; pointer.dragUnit = null; pointer.moved = false;
    var m = screenToMap(p[0], p[1]), prov = pickProvince(m[0], m[1]);
    if (unit && wasDrag) { call('dragDrop', unit, prov); needsDraw = true; return; }
    if (wasDrag) return;
    if (button === 2) { call('rightClick', prov, p[0], p[1]); needsDraw = true; return; }
    if (button !== 0) return;
    var u = pickUnitAt(p[0], p[1]);
    if (u) call('unitClick', u, e.shiftKey);
    else call('click', prov, e);
    needsDraw = true;
  }
  function onPointerCancel(e) {
    if (e.pointerType === 'touch') { touchUp(e, true); return; }
    pointer.down = false; pointer.dragUnit = null;
  }
  function updateHover(sx, sy) {
    var m = screenToMap(sx, sy), id = pickProvince(m[0], m[1]);
    var unit = pointer.down ? null : pickUnitAt(sx, sy);
    setHover(id);
    call('hover', id, sx, sy, unit);
  }
  function onWheel(e) {
    e.preventDefault();
    stopMotion();
    var p = localXY(e);
    var delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    // Pinch na touchpadzie (Chrome/Edge/Firefox) przychodzi jako wheel z ctrlKey i drobnymi deltami → czulszy, płynny zoom.
    var factor = e.ctrlKey ? Math.exp(-Math.max(-60, Math.min(60, delta)) * 0.01) : Math.exp(-delta * 0.0015);
    zoomAt(p[0], p[1], factor);
    updateHover(p[0], p[1]);
  }
  function onLeave(e) {
    if (e && e.pointerType === 'touch') return;   // palec "opuszcza" canvas przy każdym puszczeniu — nie chowaj tooltipa z long-press
    setHover(-1); call('hover', -1, 0, 0, null); needsDraw = true;
  }

  // ---------------------------------------------------------------------------
  // Wejście: dotyk (Pointer Events, pointerType 'touch')
  //  1 palec: przeciąganie mapy z inercją; tap = klik; double-tap = zoom ×2; long-press = informacje o prowincji;
  //           przeciągnięcie zaczęte na własnej jednostce = rozkaz ruchu (jak myszą).
  //  2 palce: pinch-zoom wokół środka gestu + jednoczesne przesuwanie.
  // ---------------------------------------------------------------------------
  var TAP_SLOP = 9, LONG_PRESS_MS = 500, DOUBLE_TAP_MS = 320, DOUBLE_TAP_DIST = 32;
  var touches = new Map();         // pointerId -> { x, y }
  var touch = { multi: false, pinch: null, longTimer: 0, longFired: false, infoShown: false, samples: [], lastTap: null };

  function touchDown(e) {
    var p = localXY(e);
    blurActive();
    if (e.isPrimary && touches.size) touches.clear();   // nowa sekwencja dotyku — usuń "zgubione" palce (utracone pointerup)
    touches.set(e.pointerId, { x: p[0], y: p[1] });
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignoruj */ }
    if (touches.size === 1) {
      stopMotion();
      hideTouchInfo();
      pointer.down = true; pointer.button = 0;
      pointer.sx = pointer.lx = pointer.x = p[0]; pointer.sy = pointer.ly = pointer.y = p[1];
      pointer.moved = false; pointer.dragUnit = null;
      touch.multi = false; touch.longFired = false; touch.pinch = null;
      touch.samples = [[performance.now(), p[0], p[1]]];
      var u = pickUnitAt(p[0], p[1], TOUCH_UNIT_TOL);
      if (u && call('canDragUnit', u)) pointer.dragUnit = u;
      clearTimeout(touch.longTimer);
      touch.longTimer = setTimeout(onLongPress, LONG_PRESS_MS);
    } else {
      // Kolejny palec: to już nie tap ani przeciąganie jednostki — zaczyna się pinch.
      clearTimeout(touch.longTimer);
      hideTouchInfo();
      cancelUnitDrag();
      touch.multi = true; pointer.moved = true; inertia = null;
      startPinch();
    }
    needsDraw = true;
  }
  function cancelUnitDrag() {
    var u = pointer.dragUnit;
    pointer.dragUnit = null;
    if (u && pointer.moved) { view.preview = null; setHover(-1); call('dragCancel', u); }
  }
  function pinchPair() { var it = touches.values(); return [it.next().value, it.next().value]; }
  function startPinch() {
    var ab = pinchPair();
    touch.pinch = { cx: (ab[0].x + ab[1].x) / 2, cy: (ab[0].y + ab[1].y) / 2, d: Math.max(1, Math.hypot(ab[0].x - ab[1].x, ab[0].y - ab[1].y)) };
    if (!gestureActive) { gestureActive = true; gestureLevel = tileScaleFor(cam.zoom * dpr); }
  }
  // Przyrostowo: punkt mapy pod poprzednim środkiem gestu trafia pod nowy środek, zoom × (nowy rozstaw / poprzedni).
  // Dzięki temu dołożenie/zdjęcie palca (nowa para punktów) nie powoduje skoku, a limit zoomu nie tworzy "martwej strefy".
  function updatePinch() {
    var pz = touch.pinch; if (!pz) { startPinch(); return; }
    var ab = pinchPair();
    var cx = (ab[0].x + ab[1].x) / 2, cy = (ab[0].y + ab[1].y) / 2, d = Math.max(1, Math.hypot(ab[0].x - ab[1].x, ab[0].y - ab[1].y));
    var anchor = screenToMap(pz.cx, pz.cy);
    cam.zoom = Math.max(minZoom(), Math.min(MAX_ZOOM, cam.zoom * d / pz.d));
    cam.x = anchor[0] - cx / cam.zoom; cam.y = anchor[1] - cy / cam.zoom;
    clampCamera();
    pz.cx = cx; pz.cy = cy; pz.d = d;
    needsDraw = true;
  }
  function endGesture() { if (gestureActive) { gestureActive = false; gestureLevel = 0; needsDraw = true; } }

  function touchMove(e) {
    var t = touches.get(e.pointerId); if (!t) return;
    var p = localXY(e); t.x = p[0]; t.y = p[1];
    if (touches.size >= 2) { updatePinch(); return; }
    if (!pointer.down) return;
    pointer.x = p[0]; pointer.y = p[1];
    if (!pointer.moved && Math.hypot(p[0] - pointer.sx, p[1] - pointer.sy) > TAP_SLOP) {
      pointer.moved = true;
      clearTimeout(touch.longTimer);
      hideTouchInfo();
      if (pointer.dragUnit) call('dragStart', pointer.dragUnit);
    }
    if (pointer.moved) {
      if (pointer.dragUnit) updateHover(p[0], p[1]);           // podgląd trasy pod palcem
      else {
        cam.x -= (p[0] - pointer.lx) / cam.zoom; cam.y -= (p[1] - pointer.ly) / cam.zoom; clampCamera();
        var now = performance.now();
        touch.samples.push([now, p[0], p[1]]);
        while (touch.samples.length > 2 && now - touch.samples[0][0] > 100) touch.samples.shift();
      }
    }
    pointer.lx = p[0]; pointer.ly = p[1];
    needsDraw = true;
  }
  function touchUp(e, cancelled) {
    if (!touches.has(e.pointerId)) return;
    touches.delete(e.pointerId);
    if (touches.size >= 2) { touch.pinch = null; startPinch(); return; }
    if (touches.size === 1) {
      // Z pinch na jeden palec: dalej przesuwaj pozostałym palcem — bez skoku i bez tapu.
      touch.pinch = null; endGesture();
      var rest = touches.values().next().value;
      pointer.lx = pointer.x = rest.x; pointer.ly = pointer.y = rest.y; pointer.moved = true; pointer.dragUnit = null;
      touch.samples = [[performance.now(), rest.x, rest.y]];
      return;
    }
    clearTimeout(touch.longTimer);
    touch.pinch = null; endGesture();
    var p = localXY(e), wasMoved = pointer.moved, unit = pointer.dragUnit;
    pointer.down = false; pointer.dragUnit = null; pointer.moved = false;
    if (cancelled) {
      if (unit && wasMoved) { view.preview = null; setHover(-1); call('dragCancel', unit); }
      needsDraw = true; return;
    }
    if (unit && wasMoved) {
      var m = screenToMap(p[0], p[1]);
      call('dragDrop', unit, pickProvince(m[0], m[1]));
      setHover(-1);
      needsDraw = true; return;
    }
    if (touch.multi || touch.longFired) { needsDraw = true; return; }
    if (wasMoved) { startInertia(); return; }
    handleTap(p[0], p[1]);
  }
  function startInertia() {
    var s = touch.samples, now = performance.now();
    if (s.length < 2) return;
    var last = s[s.length - 1], first = s[0];
    if (now - last[0] > 70) return;                 // palec zatrzymał się przed puszczeniem
    var dt = (last[0] - first[0]) / 1000; if (dt < 0.008) return;
    var vx = (last[1] - first[1]) / dt, vy = (last[2] - first[2]) / dt, sp = Math.hypot(vx, vy);
    if (sp < 150) return;
    if (sp > 3500) { vx *= 3500 / sp; vy *= 3500 / sp; }
    inertia = { vx: vx, vy: vy }; needsDraw = true;
  }
  function handleTap(sx, sy) {
    var now = performance.now(), lt = touch.lastTap;
    if (lt && now - lt.t < DOUBLE_TAP_MS && Math.hypot(sx - lt.x, sy - lt.y) < DOUBLE_TAP_DIST) {
      touch.lastTap = null;
      animateZoomAt(sx, sy, 2);
      return;
    }
    touch.lastTap = { t: now, x: sx, y: sy };
    var m = screenToMap(sx, sy), prov = pickProvince(m[0], m[1]);
    var u = pickUnitAt(sx, sy, TOUCH_UNIT_TOL);
    if (R.handlers.tap) call('tap', prov, sx, sy, u);
    else if (u) call('unitClick', u, false);
    else call('click', prov, { shiftKey: false, pointerType: 'touch' });
    needsDraw = true;
  }
  function onLongPress() {
    if (!pointer.down || pointer.moved || touches.size !== 1) return;
    touch.longFired = true; touch.infoShown = true;
    var sx = pointer.sx, sy = pointer.sy, m = screenToMap(sx, sy), prov = pickProvince(m[0], m[1]);
    var u = pickUnitAt(sx, sy, TOUCH_UNIT_TOL);
    setHover(prov);
    try { if (navigator.vibrate) navigator.vibrate(12); } catch (err) { /* ignoruj */ }
    if (R.handlers.longPress) call('longPress', prov, sx, sy, u); else call('hover', prov, sx, sy, u);
    needsDraw = true;
  }
  function hideTouchInfo() {
    if (!touch.infoShown) return;
    touch.infoShown = false;
    setHover(-1); call('hover', -1, 0, 0, null);
  }

  // Safari (iOS i touchpad w macOS): własne zdarzenia gesture* — blokujemy zoom strony;
  // na macOS (bez aktywnych dotyków) przekładamy je na zoom mapy.
  var gestureScale = 1;
  function onGestureStart(e) { e.preventDefault(); gestureScale = 1; }
  function onGestureChange(e) {
    e.preventDefault();
    if (touches.size || e.target !== canvas || !e.scale) return;
    var f = e.scale / gestureScale; gestureScale = e.scale;
    var p = localXY(e); stopMotion(); zoomAt(p[0], p[1], f);
  }

  function bindInput() {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    // touch-action: none na canvasie, a to — na wszelki wypadek (starsze WebKity) — blokuje przewijanie/zoom strony.
    canvas.addEventListener('touchstart', function (e) { if (e.cancelable) e.preventDefault(); }, { passive: false });
    canvas.addEventListener('touchmove', function (e) { if (e.cancelable) e.preventDefault(); }, { passive: false });
    document.addEventListener('gesturestart', onGestureStart, { passive: false });
    document.addEventListener('gesturechange', onGestureChange, { passive: false });
    document.addEventListener('gestureend', function (e) { e.preventDefault(); }, { passive: false });
    window.addEventListener('resize', resize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
    window.addEventListener('orientationchange', function () { setTimeout(resize, 120); });
    window.addEventListener('blur', function () { keysDown = {}; });
  }
  R.isDraggingUnit = function () { return !!(pointer.dragUnit && pointer.moved); };

  // ---------------------------------------------------------------------------
  // Inicjalizacja
  // ---------------------------------------------------------------------------
  R.init = function (canvasEl) {
    MAP = window.MAP_DATA;
    canvas = canvasEl; ctx = canvas.getContext('2d', { alpha: false });
    pickCtx = document.createElement('canvas').getContext('2d');
    buildPaths();
    buildSpatialGrid();
    resize();
    R.invalidate();
    renderWorld();
    cam.zoom = minZoom(); cam.x = 0; cam.y = 0; clampCamera();
    bindInput();
    requestAnimationFrame(frame);
  };
  R.mapData = function () { return MAP; };
  R.provincePath = function (id) { return provPaths[id]; };
})();
