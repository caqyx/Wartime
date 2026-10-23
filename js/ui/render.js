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
  var MAX_TILES = 72;             // LRU (~1 MB na kafel)
  var TILE_BUDGET_MS = 9;         // ile ms na klatkę wolno renderować kafle
  var WORLD_PX = 2048;            // szerokość obrazu całej mapy (fallback)
  var MAX_ZOOM = 14;
  var GRID_CELL = 64;             // komórka siatki przestrzennej (jednostki mapy)
  var COLORS = {
    sea: '#0d2236', seaDeep: '#0a1b2c', grid: 'rgba(120,170,215,0.09)',
    background: '#3d4247', backgroundEdge: 'rgba(0,0,0,0.35)',
    border: 'rgba(6,8,12,0.88)', provBorder: 'rgba(0,0,0,0.30)',
    hover: 'rgba(255,255,255,0.16)', select: '#ffe27a',
    route: '#ffd166', routeSea: '#4fb3ff', routeBad: '#ff6b6b'
  };
  var TERRAIN_COLORS = {
    plains: '#8fae5e', hills: '#b0a060', mountains: '#8c7b6b', desert: '#d8c27e',
    forest: '#4f7f45', tundra: '#a9b8bd', jungle: '#2f7a4f'
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
    hoverProv: -1, selProv: -1,
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
  function countryColor(cc) {
    var g = G();
    if (g && g.countries[cc] && g.countries[cc].color) return g.countries[cc].color;
    var cd = window.COUNTRY_DATA && window.COUNTRY_DATA[cc];
    return (cd && cd.color) || hashColor(cc || '???');
  }
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
    if (cc === me) return '#e0c068';
    var D = WT.diplomacy || {};
    if (D.atWar && safeBool(D.atWar, me, cc)) return '#c0392b';
    if (D.allied && safeBool(D.allied, me, cc)) return '#3b7dd8';
    if (D.hasPact && safeBool(D.hasPact, me, cc)) return '#4aa3a0';
    var rel = D.relation ? callApi('diplomacy.relation', [me, cc], 0) : 0;
    var t = (rel + 100) / 200;
    return t < 0.5 ? mix('#9b3b36', '#6c7076', t * 2) : mix('#6c7076', '#3f9a52', (t - 0.5) * 2);
  }
  function safeBool(fn, a, b) { try { return !!fn.call(WT.diplomacy, a, b); } catch (e) { return false; } }

  function economyValue(id) {
    var g = G(); if (!g) return 0;
    var p = g.provinces[id], b = p.buildings || {};
    return (p.dev || 1) * (1 + 0.35 * (b.factory || 0));
  }
  function economyColor(id) {
    var t = econRank ? econRank[id] : 0;
    return t < 0.5 ? mix('#2b2f45', '#7c6a2c', t * 2) : mix('#7c6a2c', '#f2d45c', (t - 0.5) * 2);
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
      var c = document.createElement('canvas'); c.width = c.height = 10;
      var x = c.getContext('2d');
      x.strokeStyle = color; x.lineWidth = 3.2;
      x.beginPath();
      for (var k = -10; k <= 20; k += 10) { x.moveTo(k, 10); x.lineTo(k + 10, 0); }
      x.stroke();
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
    for (var i = 0; i < cell.length; i++) {
      var id = cell[i], b = MAP.provinces[id].bbox;
      if (mx < b[0] || mx > b[2] || my < b[1] || my > b[3]) continue;
      if (pickCtx.isPointInPath(provPaths[id], mx, my)) return id;
    }
    return -1;
  }
  R.pickProvince = pickProvince;

  // Floty rysowane są nad armiami, więc mają pierwszeństwo przy wskazywaniu.
  function pickUnitAt(sx, sy) {
    for (var j = hitFleets.length - 1; j >= 0; j--) {
      var f = hitFleets[j];
      if (sx >= f.x && sx <= f.x + f.w && sy >= f.y && sy <= f.y + f.h) return { type: 'fleet', id: f.id, owner: f.owner, prov: f.prov };
    }
    for (var i = hitArmies.length - 1; i >= 0; i--) {
      var h = hitArmies[i];
      if (sx >= h.x && sx <= h.x + h.w && sy >= h.y && sy <= h.y + h.h) return { type: 'army', id: h.id, owner: h.owner, prov: h.prov };
    }
    return null;
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
    if (zoom) cam.zoom = zoom;
    cam.zoom = Math.max(minZoom(), Math.min(MAX_ZOOM, cam.zoom));
    cam.x = mx - viewW / 2 / cam.zoom; cam.y = my - viewH / 2 / cam.zoom;
    clampCamera();
  };
  R.centerOnProvince = function (id, zoom) { var p = MAP.provinces[id]; if (p) R.centerOn(p.cx, p.cy, zoom); };
  // offsetX: szerokość (px) panelu zasłaniającego lewą część ekranu — środek przesuwa się w prawo
  R.centerOnCountry = function (cc, minZ, offsetX) {
    var ids = [];
    MAP.provinces.forEach(function (p, i) { if (ownerOf(i) === cc) ids.push(i); });
    if (!ids.length) return;
    var b = [1e9, 1e9, -1e9, -1e9];
    ids.forEach(function (i) { var q = MAP.provinces[i].bbox; b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[2]); b[3] = Math.max(b[3], q[3]); });
    var z = Math.min(viewW / ((b[2] - b[0]) * 2.2 + 300), viewH / ((b[3] - b[1]) * 2.2 + 240));
    z = Math.max(minZ || 0.5, Math.min(2.4, z));
    R.centerOn((b[0] + b[2]) / 2 - (offsetX || 0) / 2 / Math.max(minZoom(), Math.min(MAX_ZOOM, z)), (b[1] + b[3]) / 2, z);
  };
  R.camera = function () { return { x: cam.x, y: cam.y, zoom: cam.zoom }; };

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    viewW = canvas.clientWidth || window.innerWidth;
    viewH = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(viewW * dpr); canvas.height = Math.round(viewH * dpr);
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
    if (scratch.id.width < w + 2 || scratch.id.height < h + 2) { scratch.id.width = w + 2; scratch.id.height = h + 2; }
    if (scratch.border.width < w || scratch.border.height < h) { scratch.border.width = w; scratch.border.height = h; }
    return scratch;
  }

  // Rysuje ląd do kontekstu g: prostokąt mapy od (x0,y0), skala px/jednostkę, rozmiar w×h px.
  function renderRegion(g, x0, y0, scale, w, h) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = COLORS.sea; g.fillRect(0, 0, w, h);
    g.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale);
    var x1 = x0 + w / scale, y1 = y0 + h / scale;
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
  function drawProvinceBorders(g, ids, scale) {
    var alpha = Math.max(0, Math.min(0.42, (scale - 0.25) * 0.4));
    if (alpha < 0.03) return;
    g.strokeStyle = 'rgba(0,0,0,' + alpha.toFixed(3) + ')';
    g.lineWidth = Math.min(1.2, 0.5 + scale * 0.1) / scale;
    for (var i = 0; i < ids.length; i++) g.stroke(provPaths[ids[i]]);
  }

  // Granice państw: raster ID państw + wykrywanie krawędzi (niezależne od topologii danych).
  function drawCountryBorders(g, ids, x0, y0, scale, w, h) {
    var s = ensureScratch(w, h);
    var ic = s.id.getContext('2d', { willReadFrequently: true });
    ic.setTransform(1, 0, 0, 1, 0, 0); ic.clearRect(0, 0, w + 2, h + 2);
    ic.setTransform(scale, 0, 0, scale, -x0 * scale + 1, -y0 * scale + 1);
    ic.lineWidth = 0.9 / scale;
    for (var i = 0; i < ids.length; i++) {
      var c = idColor(ccIndex[ownerOf(ids[i])] || 0);
      ic.fillStyle = c; ic.strokeStyle = c; ic.fill(provPaths[ids[i]]); ic.stroke(provPaths[ids[i]]);
    }
    var src = new Uint32Array(ic.getImageData(0, 0, w + 2, h + 2).data.buffer);
    var bc = s.border.getContext('2d');
    var out = bc.createImageData(w, h), dst = new Uint32Array(out.data.buffer);
    edgeDetect(src, dst, w, h, scale);
    bc.putImageData(out, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(s.border, 0, 0, w, h, 0, 0, w, h);
  }
  function edgeDetect(src, dst, w, h, scale) {
    var sw = w + 2, MASK = 0x00e0e0e0;
    var a = Math.round(Math.min(235, 150 + scale * 40));
    var col = ((a << 24) | (14 << 16) | (10 << 8) | 8) >>> 0;     // ABGR (little endian)
    for (var y = 0; y < h; y++) {
      var row = (y + 1) * sw + 1, o = y * w;
      for (var x = 0; x < w; x++) {
        var k = row + x, p = src[k];
        var id = (p >>> 24) < 128 ? 0 : (p & MASK);
        var r = src[k + 1], l = src[k - 1], u = src[k - sw], d = src[k + sw];
        if (id !== ((r >>> 24) < 128 ? 0 : (r & MASK)) || id !== ((l >>> 24) < 128 ? 0 : (l & MASK)) ||
            id !== ((u >>> 24) < 128 ? 0 : (u & MASK)) || id !== ((d >>> 24) < 128 ? 0 : (d & MASK))) dst[o + x] = col;
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
    if (view.hoverProv >= 0) {
      ctx.fillStyle = COLORS.hover; ctx.fill(provPaths[view.hoverProv]);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.2 * lw; ctx.stroke(provPaths[view.hoverProv]);
    }
    if (view.selProv >= 0) {
      ctx.strokeStyle = COLORS.select; ctx.lineWidth = 2.4 * lw; ctx.setLineDash([6 * lw, 4 * lw]);
      ctx.lineDashOffset = -dashPhase * lw; ctx.stroke(provPaths[view.selProv]); ctx.setLineDash([]);
    }
    var target = view.pending ? view.pending.target : (view.preview ? view.preview.target : -1);
    if (target >= 0) {
      ctx.fillStyle = view.pending || (view.preview && view.preview.ok) ? 'rgba(255,209,102,0.22)' : 'rgba(255,90,90,0.22)';
      ctx.fill(provPaths[target]);
    }
  }
  function drawCountryHighlight(cc, lw) {
    var vis = visibleProvinces();
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.strokeStyle = 'rgba(255,240,190,0.9)'; ctx.lineWidth = 1.4 * lw;
    for (var i = 0; i < vis.length; i++) if (ownerOf(vis[i]) === cc) ctx.fill(provPaths[vis[i]]);
  }
  var visCache = { key: '', ids: [] };
  function visibleProvinces() {
    var key = cam.x.toFixed(1) + ',' + cam.y.toFixed(1) + ',' + cam.zoom.toFixed(4);
    if (visCache.key !== key) { visCache.key = key; visCache.ids = queryRect(cam.x, cam.y, cam.x + viewW / cam.zoom, cam.y + viewH / cam.zoom); }
    return visCache.ids;
  }

  // ---------------------------------------------------------------------------
  // Overlay: etykiety
  // ---------------------------------------------------------------------------
  var FONT_SANS = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
  var FONT_MONO = 'ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace';

  function drawCountryLabels() {
    if (cam.zoom > 3.4) return;
    var fade = cam.zoom > 1.6 ? Math.max(0, 1 - (cam.zoom - 1.6) / 1.8) : 1;
    applyScreenTransform();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    var placed = [];
    for (var i = 0; i < countryLabels.length; i++) {
      var L = countryLabels[i];
      var px = L.size * cam.zoom;
      var maxW = L.maxW * cam.zoom;
      if (px < 8.5) continue;
      px = Math.min(px, 72);
      ctx.font = '700 ' + px.toFixed(1) + 'px ' + FONT_SANS;
      setLetterSpacing(px * 0.12);
      var tw = ctx.measureText(L.text).width;
      if (tw > maxW && maxW > 0) { px *= maxW / tw; if (px < 8.5) continue; ctx.font = '700 ' + px.toFixed(1) + 'px ' + FONT_SANS; setLetterSpacing(px * 0.12); tw = ctx.measureText(L.text).width; }
      var p = mapToScreen(L.x, L.y);
      if (p[0] < -tw || p[0] > viewW + tw || p[1] < -px || p[1] > viewH + px) continue;
      var box = [p[0] - tw / 2, p[1] - px / 2, p[0] + tw / 2, p[1] + px / 2];
      if (overlapsAny(box, placed)) continue;
      placed.push(box);
      ctx.globalAlpha = fade;
      ctx.lineWidth = Math.max(2, px * 0.16); ctx.strokeStyle = 'rgba(8,12,18,0.6)';
      ctx.strokeText(L.text, p[0], p[1]);
      ctx.fillStyle = 'rgba(248,246,236,0.94)';
      ctx.fillText(L.text, p[0], p[1]);
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
    var px = Math.min(13, 9 + cam.zoom * 0.6);
    ctx.font = '600 ' + px.toFixed(1) + 'px ' + FONT_SANS;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.globalAlpha = Math.min(1, (cam.zoom - 1.6) / 0.8);
    for (var i = 0; i < vis.length; i++) {
      var p = MAP.provinces[vis[i]];
      var wpx = (p.bbox[2] - p.bbox[0]) * cam.zoom;
      if (wpx < 70) continue;
      var s = mapToScreen(p.cx, p.cy);
      var y = s[1] + 17;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.strokeText(p.name, s[0], y);
      ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.fillText(p.name, s[0], y);
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // Overlay: trasy
  // ---------------------------------------------------------------------------
  function drawRoutes() {
    var g = G(); if (!g) return;
    applyScreenTransform();
    var me = g.player;
    Object.keys(g.armies).forEach(function (id) {
      var a = g.armies[id];
      if (a.owner !== me || a.embarked || !a.path || !a.path.length) return;
      var sel = view.sel && view.sel.type === 'army' && view.sel.id === id;
      drawPolyline(landPoints(a.prov, a.path), sel ? COLORS.route : 'rgba(255,209,102,0.55)', sel ? 2.4 : 1.6, null);
    });
    Object.keys(g.fleets).forEach(function (id) {
      var f = g.fleets[id];
      if (f.owner !== me || !f.path || !f.path.length) return;
      var sel = view.sel && view.sel.type === 'fleet' && view.sel.id === id;
      drawPolyline(seaPoints(f.prov, f.path), sel ? COLORS.routeSea : 'rgba(79,179,255,0.6)', sel ? 2.4 : 1.6, null);
    });
    var plan = view.pending || view.preview;
    if (plan && plan.points && plan.points.length > 1) {
      var color = !plan.ok ? COLORS.routeBad : (plan.kind === 'land' ? COLORS.route : COLORS.routeSea);
      drawPolyline(plan.points, color, 3, plan.label || null, true);
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

  function drawPolyline(pts, color, width, label, animated) {
    if (pts.length < 2) return;
    var sp = pts.map(function (p) { return mapToScreen(p[0], p[1]); });
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(sp[0][0], sp[0][1]);
    for (var i = 1; i < sp.length; i++) ctx.lineTo(sp[i][0], sp[i][1]);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = width + 2.5; ctx.setLineDash([9, 6]);
    ctx.lineDashOffset = animated ? -dashPhase : 0; ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
    ctx.setLineDash([]);
    sp.slice(1, -1).forEach(function (p) { ctx.beginPath(); ctx.arc(p[0], p[1], width * 0.9, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); });
    drawArrowHead(sp[sp.length - 2], sp[sp.length - 1], color, width);
    if (label) drawRouteLabel(sp[sp.length - 1], label, color);
  }
  function drawArrowHead(a, b, color, width) {
    var ang = Math.atan2(b[1] - a[1], b[0] - a[0]), L = 8 + width * 2.2;
    ctx.beginPath();
    ctx.moveTo(b[0], b[1]);
    ctx.lineTo(b[0] - L * Math.cos(ang - 0.45), b[1] - L * Math.sin(ang - 0.45));
    ctx.lineTo(b[0] - L * Math.cos(ang + 0.45), b[1] - L * Math.sin(ang + 0.45));
    ctx.closePath();
    ctx.fillStyle = color; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.2; ctx.fill(); ctx.stroke();
  }
  function drawRouteLabel(p, text, color) {
    ctx.font = '700 12px ' + FONT_MONO;
    var w = ctx.measureText(text).width + 12, x = p[0] + 10, y = p[1] - 26;
    roundRect(x, y, w, 19, 4);
    ctx.fillStyle = 'rgba(10,16,26,0.92)'; ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 6, y + 10);
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }

  // ---------------------------------------------------------------------------
  // Overlay: armie i floty (styl AoH2)
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
    return byProv;
  }
  function drawArmies() {
    hitArmies = [];
    var g = G(); if (!g) return;
    applyScreenTransform();
    var byProv = groupArmies(), me = g.player;
    ctx.font = '700 11px ' + FONT_MONO; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    Object.keys(byProv).forEach(function (pid) {
      var list = byProv[pid].sort(function (a, b) { return a.owner === me ? -1 : b.owner === me ? 1 : a.owner < b.owner ? -1 : 1; });
      var c = mapToScreen(MAP.provinces[pid].cx, MAP.provinces[pid].cy);
      layoutBoxes(list, c[0], c[1]).forEach(function (b) { drawArmyBox(b, me); });
    });
  }
  function layoutBoxes(list, cx, cy) {
    var H = 17, gap = 2, perRow = 3, boxes = [];
    var widths = list.map(function (a) { return Math.max(34, ctx.measureText(fmtK(a.size)).width + 14); });
    var rows = Math.ceil(list.length / perRow);
    for (var r = 0; r < rows; r++) {
      var items = list.slice(r * perRow, r * perRow + perRow), ws = widths.slice(r * perRow, r * perRow + perRow);
      var total = ws.reduce(function (s, w) { return s + w; }, 0) + gap * (items.length - 1);
      var x = cx - total / 2, y = cy - (rows * (H + gap)) / 2 + r * (H + gap);
      items.forEach(function (a, i) { boxes.push({ army: a, x: Math.round(x), y: Math.round(y), w: Math.round(ws[i]), h: H }); x += ws[i] + gap; });
    }
    return boxes;
  }
  function drawArmyBox(b, me) {
    var a = b.army, color = countryColor(a.owner);
    var selected = view.sel && view.sel.type === 'army' && view.sel.id === a.id;
    var dragging = pointer.dragUnit && pointer.dragUnit.type === 'army' && pointer.dragUnit.id === a.id && pointer.moved;
    if (selected) { roundRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6, 4); ctx.fillStyle = COLORS.select; ctx.fill(); }
    roundRect(b.x, b.y, b.w, b.h, 2);
    ctx.fillStyle = color; ctx.globalAlpha = dragging ? 0.55 : 1; ctx.fill();
    ctx.fillStyle = darken(color, 0.35); ctx.fillRect(b.x, b.y, 4, b.h);
    ctx.lineWidth = 1; ctx.strokeStyle = a.owner === me ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.8)'; ctx.stroke();
    var light = luminance(color) > 0.62;
    ctx.fillStyle = light ? '#111' : '#fff';
    if (!light) { ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 2; }
    ctx.fillText(fmtK(a.size), b.x + 2 + b.w / 2, b.y + b.h / 2 + 0.5);
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    if (a.owner === me && a.path && a.path.length) drawMovingMark(b);
    hitArmies.push({ x: b.x, y: b.y, w: b.w, h: b.h, id: a.id, owner: a.owner, prov: a.prov });
  }
  function drawMovingMark(b) {
    ctx.beginPath();
    ctx.moveTo(b.x + b.w + 1, b.y + 3); ctx.lineTo(b.x + b.w + 6, b.y + b.h / 2); ctx.lineTo(b.x + b.w + 1, b.y + b.h - 3);
    ctx.closePath(); ctx.fillStyle = COLORS.route; ctx.fill();
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
    ctx.font = '700 11px ' + FONT_MONO; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    Object.keys(byPort).forEach(function (pid) {
      var pt = portPoint(+pid), s = mapToScreen(pt[0], pt[1]);
      if (s[0] < -60 || s[0] > viewW + 60 || s[1] < -30 || s[1] > viewH + 30) return;
      byPort[pid].forEach(function (f, i) { drawFleetIcon(f, s[0] - 4, s[1] + 4 + i * 20, me); });
    });
  }
  function drawFleetIcon(f, x, y, me) {
    var color = countryColor(f.owner);
    var cargo = (f.cargo || []).length;
    var label = String(f.ships) + (cargo ? ' ⚓' + cargo : '');
    var w = 26 + ctx.measureText(label).width, h = 18;
    var selected = view.sel && view.sel.type === 'fleet' && view.sel.id === f.id;
    if (selected) { roundRect(x - 3, y - 3, w + 6, h + 6, 5); ctx.fillStyle = COLORS.select; ctx.fill(); }
    roundRect(x, y, w, h, 9);
    ctx.fillStyle = 'rgba(9,24,42,0.92)'; ctx.fill();
    ctx.strokeStyle = f.owner === me ? '#9fd3ff' : darken(color, 0.1); ctx.lineWidth = 1.4; ctx.stroke();
    drawShipGlyph(x + 4, y + 4, color);
    ctx.fillStyle = '#e6f2ff'; ctx.fillText(label, x + 22, y + h / 2 + 0.5);
    hitFleets.push({ x: x, y: y, w: w, h: h, id: f.id, owner: f.owner, prov: f.prov });
  }
  function drawShipGlyph(x, y, color) {
    ctx.beginPath();
    ctx.moveTo(x, y + 6); ctx.lineTo(x + 16, y + 6); ctx.lineTo(x + 13, y + 10); ctx.lineTo(x + 3, y + 10); ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    ctx.fillRect(x + 6, y + 2, 5, 4);
    ctx.fillRect(x + 8, y, 1.5, 2);
  }

  // Duch przeciąganej jednostki przy kursorze
  function drawDragGhost() {
    if (!pointer.dragUnit || !pointer.moved) return;
    applyScreenTransform();
    ctx.beginPath(); ctx.arc(pointer.x, pointer.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,226,122,0.9)'; ctx.fill();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
  }

  // ---------------------------------------------------------------------------
  // Pętla klatek
  // ---------------------------------------------------------------------------
  function hasAnimation() { return !!(view.preview || view.pending || view.selProv >= 0 || view.sel); }
  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.05, (now - (lastFrame || now)) / 1000); lastFrame = now;
    if (applyKeyPan(dt)) needsDraw = true;
    if (hasAnimation()) { dashPhase = (dashPhase + dt * 22) % 1000; needsDraw = true; }
    if (!needsDraw && !pendingTiles) return;
    needsDraw = false;
    drawFrame(now);
    fpsTick(now);
  }
  function drawFrame(now) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COLORS.seaDeep; ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawLand(now);
    drawHighlights();
    drawCountryLabels();
    drawProvinceLabels();
    drawRoutes();
    drawArmies();
    drawFleets();
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
  // Wejście: mysz
  // ---------------------------------------------------------------------------
  function localXY(e) { var r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  function call(name) { var h = R.handlers[name]; if (h) return h.apply(null, Array.prototype.slice.call(arguments, 1)); }

  function onPointerDown(e) {
    var p = localXY(e);
    var ae = document.activeElement;
    if (ae && ae !== document.body && ae.blur) ae.blur();   // skróty klawiszowe działają po kliknięciu w mapę
    pointer.down = true; pointer.button = e.button; pointer.sx = pointer.lx = p[0]; pointer.sy = pointer.ly = p[1];
    pointer.moved = false; pointer.dragUnit = null;
    if (e.button === 0) {
      var u = pickUnitAt(p[0], p[1]);
      if (u && call('canDragUnit', u)) pointer.dragUnit = u;
    }
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
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
  function updateHover(sx, sy) {
    var m = screenToMap(sx, sy), id = pickProvince(m[0], m[1]);
    var unit = pointer.down ? null : pickUnitAt(sx, sy);
    if (id !== view.hoverProv) { view.hoverProv = id; call('hoverChange', id); }
    call('hover', id, sx, sy, unit);
  }
  function onWheel(e) {
    e.preventDefault();
    var p = localXY(e);
    var delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    zoomAt(p[0], p[1], Math.exp(-delta * 0.0015));
    updateHover(p[0], p[1]);
  }
  function onLeave() { if (view.hoverProv !== -1) { view.hoverProv = -1; call('hoverChange', -1); } call('hover', -1, 0, 0, null); needsDraw = true; }

  function bindInput() {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', function () { pointer.down = false; pointer.dragUnit = null; });
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    window.addEventListener('resize', resize);
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
