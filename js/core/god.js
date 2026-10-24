var WT = (typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (global.WT = global.WT || {}));

/* WT.god — God Mode: nielimitowany skarbiec gracza, natychmiastowe budowy, narzędzia sandboxowe. */
WT.god = (function () {
  var S = WT.state, D = function () { return WT.diplomacy; };

  function G() { return WT.G; }
  function enabled() { return !!(G() && G().god); }

  function toggle(on) {
    G().god = on === undefined ? !G().god : !!on;
    S.addLog('God Mode ' + (G().god ? 'włączony' : 'wyłączony') + '.', G().player);
    return G().god;
  }

  /** Ożywia państwo (np. gdy narzędzie oddaje prowincję wyeliminowanemu krajowi). */
  function revive(cc, provId) {
    var c = S.country(cc);
    if (!c || c.alive) return;
    c.alive = true;
    c.capital = provId;
    if (cc === G().player) G().gameOver = false;
  }

  function setOwner(provId, cc) {
    if (!S.country(cc) || !G().provinces[provId]) return false;
    revive(cc, provId);
    S.setOwner(provId, cc);
    D().afterBorderChange();
    return true;
  }

  /** size w żołnierzach; wartości < 1000 traktowane jako tysiące. */
  function spawnArmy(provId, cc, size) {
    if (!S.country(cc) || !G().provinces[provId]) return null;
    if (size < 1000) size *= 1000;
    var army = S.createArmy(cc, provId, size);
    WT.military.engageAt(provId, army);
    return G().armies[army.id] ? WT.military.mergeIfIdle(army) : null;
  }

  function forcePeace(a, b) {
    var guard = 5;
    while (D().atWar(a, b) && guard--) D().concludePeace(a, b, 'white', null);
    return { ok: !D().atWar(a, b), reason: 'Wymuszono pokój.' };
  }

  function forceAlliance(a, b) {
    if (a === b) return { ok: false, reason: 'To to samo państwo.' };
    forcePeace(a, b);
    if (D().hasTruce(a, b)) G().truces = G().truces.filter(function (t) { return !((t.a === a && t.b === b) || (t.a === b && t.b === a)); });
    var ok = D().formAlliance(a, b);
    return { ok: ok || D().allied(a, b), reason: 'Wymuszono sojusz.' };
  }

  function setRelation(a, b, v) { D().setRel(a, b, v); return { ok: true, reason: 'Relacja ustawiona na ' + D().relation(a, b) + '.' }; }

  function annexCountry(cc, byCc) {
    if (!S.country(cc) || !S.country(byCc) || cc === byCc) return false;
    revive(byCc, S.provincesOf(cc)[0]);
    S.provincesOf(cc).forEach(function (id) { S.setOwner(id, byCc); });
    D().afterBorderChange();
    S.addLog(S.country(byCc).name + ' anektuje ' + S.country(cc).name + ' (God Mode).', byCc);
    return true;
  }

  function revealAll() { return true; }   // brak mgły wojny

  return {
    enabled: enabled, toggle: toggle, setOwner: setOwner, spawnArmy: spawnArmy,
    forcePeace: forcePeace, forceAlliance: forceAlliance, setRelation: setRelation,
    annexCountry: annexCountry, revealAll: revealAll
  };
})();

if (typeof module !== 'undefined') module.exports = WT.god;
