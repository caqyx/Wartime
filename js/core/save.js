var WT = (typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (global.WT = global.WT || {}));

/* WT.save — zapisy w localStorage (w node / bez dostępu: magazyn w pamięci). */
WT.save = (function () {
  var PREFIX = 'wartime2026_slot_', AUTO = 'wartime2026_autosave';
  var memory = {};
  var memStore = {
    getItem: function (k) { return memory.hasOwnProperty(k) ? memory[k] : null; },
    setItem: function (k, v) { memory[k] = String(v); },
    removeItem: function (k) { delete memory[k]; },
    keys: function () { return Object.keys(memory); }
  };

  function store() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        var t = '__wt_test__';
        localStorage.setItem(t, '1'); localStorage.removeItem(t);
        return {
          getItem: function (k) { return localStorage.getItem(k); },
          setItem: function (k, v) { localStorage.setItem(k, v); },
          removeItem: function (k) { localStorage.removeItem(k); },
          keys: function () { var out = []; for (var i = 0; i < localStorage.length; i++) out.push(localStorage.key(i)); return out; }
        };
      }
    } catch (e) { /* brak dostępu (file://, tryb prywatny) — pamięć */ }
    return memStore;
  }

  function keyFor(slot) { return (slot === 'auto' || slot === 'autosave') ? AUTO : PREFIX + slot; }
  function slotFromKey(k) { return k === AUTO ? 'auto' : (k.indexOf(PREFIX) === 0 ? k.slice(PREFIX.length) : null); }

  function save(slot) {
    if (!WT.G) return false;
    var G = WT.G;
    var wrapper = { savedAt: Date.now(), player: G.player, date: G.date, turn: G.turn, version: G.version, G: G };
    try { store().setItem(keyFor(slot), JSON.stringify(wrapper)); return true; }
    catch (e) { return false; }
  }

  function applyState(g) {
    if (!g || !g.countries || !g.provinces || !Array.isArray(g.provinces)) return false;
    var map = WT.util.mapData();
    if (map && map.provinces.length !== g.provinces.length) return false;
    WT.G = g;
    migrateBuilds(g);
    WT.state.rebuildIndex();
    if (WT.tech) WT.tech.ensureAll();     // zapisy sprzed nauki: budżet, punkty, drzewko
    if (WT.military && WT.military.mergeAll) WT.military.mergeAll();   // stare zapisy: scal stojące armie
    return true;
  }

  // Zapisy sprzed budów równoległych: pojedynczy slot `build` → mapa `builds`.
  function migrateBuilds(g) {
    if (!g.squadrons) g.squadrons = {};   // zapisy sprzed lotnictwa
    if (!g.trades) g.trades = [];         // zapisy sprzed umów handlowych
    g.provinces.forEach(function (p) {
      if (p.buildings.aa == null) p.buildings.aa = 0;
      if (p.buildings.radar == null) p.buildings.radar = 0;
      if (p.buildings.university == null) p.buildings.university = 0;
      if (!p.builds) p.builds = {};
      if (p.build) { p.builds[p.build.type] = p.build.turnsLeft; delete p.build; }
    });
  }

  function load(slot) {
    try {
      var raw = store().getItem(keyFor(slot));
      if (!raw) return false;
      return applyState(JSON.parse(raw).G);
    } catch (e) { return false; }
  }

  function list() {
    var out = [], s;
    try { s = store(); } catch (e) { return out; }
    s.keys().forEach(function (k) {
      var slot = slotFromKey(k);
      if (slot === null) return;
      try {
        var w = JSON.parse(s.getItem(k));
        out.push({ slot: slot, player: w.player, date: w.date, turn: w.turn, savedAt: w.savedAt });
      } catch (e) { /* uszkodzony zapis — pomijamy */ }
    });
    return out.sort(function (a, b) { return b.savedAt - a.savedAt; });
  }

  function remove(slot) {
    try { store().removeItem(keyFor(slot)); return true; } catch (e) { return false; }
  }

  function exportJSON() { return JSON.stringify(WT.G); }

  function importJSON(str) {
    try {
      var data = JSON.parse(str);
      return applyState(data && data.G && !data.provinces ? data.G : data);
    } catch (e) { return false; }
  }

  function autosave() { return save('auto'); }

  return { save: save, load: load, list: list, remove: remove, exportJSON: exportJSON, importJSON: importJSON, autosave: autosave };
})();

if (typeof module !== 'undefined') module.exports = WT.save;
