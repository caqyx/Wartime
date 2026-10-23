var WT = (typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (global.WT = global.WT || {}));

/* WT.util — RNG, kolejka priorytetowa, geometria, drobne helpery. WT.events — szyna zdarzeń. */
WT.util = (function () {
  var ROOT = (typeof window !== 'undefined') ? window : global;
  var fallbackRng = { rngState: 12345 };

  function root() { return ROOT; }
  function mapData() { return ROOT.MAP_DATA; }
  function countryData() { return ROOT.COUNTRY_DATA || {}; }

  // ---------- RNG (mulberry32, stan w G.rngState => deterministyczny i zapisywalny) ----------

  function rngHolder() { return (WT.G && typeof WT.G.rngState === 'number') ? WT.G : fallbackRng; }

  function rand() {
    var h = rngHolder();
    var s = (h.rngState + 0x6D2B79F5) | 0;
    h.rngState = s;
    var t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function randRange(a, b) { return a + rand() * (b - a); }
  function randInt(a, b) { return a + Math.floor(rand() * (b - a + 1)); }
  function chance(p) { return rand() < p; }
  function pick(arr) { return arr.length ? arr[Math.floor(rand() * arr.length)] : undefined; }
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // ---------- Kolejka priorytetowa (kopiec binarny, min) ----------

  function PriorityQueue() { this.items = []; this.prio = []; }
  PriorityQueue.prototype.size = function () { return this.items.length; };
  PriorityQueue.prototype.push = function (item, priority) {
    var items = this.items, prio = this.prio, i = items.length;
    items.push(item); prio.push(priority);
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (prio[p] <= priority) break;
      items[i] = items[p]; prio[i] = prio[p]; i = p;
    }
    items[i] = item; prio[i] = priority;
  };
  PriorityQueue.prototype.pop = function () {
    var items = this.items, prio = this.prio;
    if (!items.length) return undefined;
    var top = items[0], lastItem = items.pop(), lastPrio = prio.pop(), n = items.length;
    if (n) {
      var i = 0;
      while (true) {
        var l = 2 * i + 1, r = l + 1, m = i, mp = lastPrio;
        if (l < n && prio[l] < mp) { m = l; mp = prio[l]; }
        if (r < n && prio[r] < mp) { m = r; mp = prio[r]; }
        if (m === i) break;
        items[i] = items[m]; prio[i] = prio[m]; i = m;
      }
      items[i] = lastItem; prio[i] = lastPrio;
    }
    return top;
  };

  // ---------- Drobne helpery ----------

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function key(a, b) { return a < b ? a + '|' + b : b + '|' + a; }
  function round(v, digits) { var m = Math.pow(10, digits || 0); return Math.round(v * m) / m; }
  function fmtK(soldiers) { return (soldiers / 1000).toFixed(1) + 'k'; }
  function fmtMoney(v) { return v.toFixed(2) + ' mld $'; }
  function removeFromArray(arr, item) {
    var i = arr.indexOf(item);
    if (i >= 0) arr.splice(i, 1);
    return i >= 0;
  }
  function hashString(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    var k = function (n) { return (n + h / 30) % 12; };
    var a = s * Math.min(l, 1 - l);
    var f = function (n) {
      var c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
      return ('0' + Math.round(c * 255).toString(16)).slice(-2);
    };
    return '#' + f(0) + f(8) + f(4);
  }
  function hashColor(str) {
    var h = hashString(str);
    return hslToHex(h % 360, 45 + (h >>> 9) % 30, 40 + (h >>> 17) % 20);
  }

  // ---------- Projekcja Millera (zgodna z tools/build_map.py) ----------

  var DEG = Math.PI / 180;
  function millerY(lat) { return 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * lat * DEG)); }
  function millerLat(y) { return (Math.atan(Math.exp(y / 1.25)) - Math.PI / 4) / (0.4 * DEG); }

  // Jak w tools/build_map.py: skala z szerokości (width / zakres długości), ta sama dla osi y,
  // y liczone od latMax. Jeśli MAP_DATA podaje scale/offsetX/offsetY — mają pierwszeństwo.
  function projParams() {
    var M = mapData();
    if (M._proj) return M._proj;
    var xr = (M.lonMax - M.lonMin) * DEG;
    var yTop = millerY(M.latMax);
    var scale = M.scale || M.width / xr;
    var p = { scale: scale, yTop: yTop, ox: M.offsetX || 0, oy: M.offsetY || 0 };
    Object.defineProperty(M, '_proj', { value: p, enumerable: false, configurable: true });
    return p;
  }
  function project(lon, lat) {
    var M = mapData(), p = projParams();
    if (lon < M.lonMin - 1) lon += 360;
    return [p.ox + (lon - M.lonMin) * DEG * p.scale, p.oy + (p.yTop - millerY(lat)) * p.scale];
  }
  function unproject(x, y) {
    var M = mapData(), p = projParams();
    return [M.lonMin + (x - p.ox) / p.scale / DEG, millerLat(p.yTop - (y - p.oy) / p.scale)];
  }

  // ---------- Geometria ----------

  function pointInRing(x, y, ring) {
    var inside = false, n = ring.length;
    for (var i = 0, j = n - 2; i < n; j = i, i += 2) {
      var xi = ring[i], yi = ring[i + 1], xj = ring[j], yj = ring[j + 1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function pointInProvince(x, y, ps) {
    var b = ps.bbox;
    if (b && (x < b[0] || y < b[1] || x > b[2] || y > b[3])) return false;
    for (var r = 0; r < ps.poly.length; r++) if (pointInRing(x, y, ps.poly[r])) return true;
    return false;
  }
  /** Prowincja zawierająca punkt (jednostki mapy); filter(id) opcjonalny. -1 gdy brak. */
  function provinceAt(x, y, filter) {
    var provs = mapData().provinces;
    for (var i = 0; i < provs.length; i++) {
      if (filter && !filter(i)) continue;
      if (pointInProvince(x, y, provs[i])) return i;
    }
    return -1;
  }
  function nearestProvince(x, y, filter) {
    var provs = mapData().provinces, best = -1, bd = Infinity;
    for (var i = 0; i < provs.length; i++) {
      if (filter && !filter(i)) continue;
      var dx = provs[i].cx - x, dy = provs[i].cy - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  /** Prowincja dla lon/lat: najpierw point-in-polygon, potem najbliższy centroid. */
  function provinceAtLonLat(lon, lat, filter) {
    var xy = project(lon, lat);
    var id = provinceAt(xy[0], xy[1], filter);
    return id >= 0 ? id : nearestProvince(xy[0], xy[1], filter);
  }

  return {
    root: root, mapData: mapData, countryData: countryData,
    rand: rand, randRange: randRange, randInt: randInt, chance: chance, pick: pick, shuffle: shuffle,
    PriorityQueue: PriorityQueue,
    clamp: clamp, key: key, round: round, fmtK: fmtK, fmtMoney: fmtMoney,
    removeFromArray: removeFromArray, hashString: hashString, hashColor: hashColor,
    project: project, unproject: unproject, millerY: millerY,
    pointInRing: pointInRing, pointInProvince: pointInProvince,
    provinceAt: provinceAt, nearestProvince: nearestProvince, provinceAtLonLat: provinceAtLonLat
  };
})();

/* Szyna zdarzeń: battle, war, peace, alliance, occupy, annex, eliminated, proposal, log, gameover. */
WT.events = (function () {
  var handlers = {};
  function on(name, fn) { (handlers[name] = handlers[name] || []).push(fn); return fn; }
  function off(name, fn) { if (handlers[name]) WT.util.removeFromArray(handlers[name], fn); }
  function emit(name, payload) {
    var list = handlers[name];
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      try { list[i](payload); } catch (e) { if (typeof console !== 'undefined') console.error('[WT.events]', name, e); }
    }
  }
  function clear() { handlers = {}; }
  return { on: on, off: off, emit: emit, clear: clear };
})();

if (typeof module !== 'undefined') module.exports = WT.util;
