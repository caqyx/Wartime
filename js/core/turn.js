var WT = (typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (global.WT = global.WT || {}));

/* WT.turn — orkiestracja końca tury. */
WT.turn = (function () {
  var S = WT.state;
  var AUTOSAVE_EVERY = 5;
  var timings = {};

  function G() { return WT.G; }

  function now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }
  function timed(label, fn) {
    var t = now();
    fn();
    timings[label] = now() - t;
  }

  /** Koniec tury: AI → floty → armie → okupacje → ekonomia/budowy → dyplomacja → wyczerpanie → data → autozapis. */
  function end() {
    if (G().gameOver) return { events: [] };
    var events = [];
    var collect = WT.events.on('log', function (e) { events.push(e.text); });
    try {
      timings = {};
      timed('ai', function () { WT.ai.runAll(); });
      timed('fleets', function () { WT.naval.moveFleets(); });
      timed('air', function () { WT.air.processTurn(); });
      timed('armies', function () { WT.military.moveAll(); });
      timed('occupation', function () { WT.military.resolveOccupations(); WT.military.applyAttrition(); });
      timed('economy', runEconomy);
      timed('research', function () { WT.tech.processTurn(); });
      timed('diplomacy', function () { WT.diplomacy.processTurn(); });
      updateExhaustion();
      advanceTime();
    } finally {
      WT.events.off('log', collect);
    }
    if (G().turn % AUTOSAVE_EVERY === 0 && WT.save) WT.save.autosave();
    WT.events.emit('turn', { turn: G().turn, events: events });
    return { events: events };
  }

  function runEconomy() {
    S.countriesAlive().forEach(function (cc) { WT.economy.processTurn(cc); });
  }

  function updateExhaustion() {
    S.countriesAlive().forEach(function (cc) {
      var c = S.country(cc);
      if (WT.diplomacy.enemiesOf(cc).length) c.warExhaustion += 0.3 + 2 * WT.diplomacy.occupiedShare(cc);
      else c.warExhaustion -= 1.5;
      c.warExhaustion = Math.max(0, Math.min(100, c.warExhaustion));
    });
  }

  function advanceTime() {
    G().turn++;
    S.advanceDate(7);
    WT.military.mergeAll();
    WT.military.resetMoves();
  }

  function lastTimings() { return timings; }

  return { end: end, lastTimings: lastTimings };
})();

if (typeof module !== 'undefined') module.exports = WT.turn;
