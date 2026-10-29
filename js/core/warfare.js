var WT = (typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (global.WT = global.WT || {}));

/*
 * WT.warfare — głębsza wojna: rodzaje wojsk, organizacja (morale armii) i zaopatrzenie z okrążeniami.
 *  - Skład armii army.mix = { arm, art } (udział wojsk szybkich i wsparcia; reszta = piechota). null = skład domyślny epoki.
 *    Szybkie (pancerne / kawaleria / rycerstwo): silne na równinach, słabe w górach i lasach, +1 punkt ruchu przy ≥35%.
 *    Wsparcie (artyleria / machiny oblężnicze): stała premia, osłabia forty obrońcy i przyspiesza oblężenia.
 *  - Organizacja army.org (0–1, brak = 1): mnożnik siły 0.4 + 0.6·org; spada po bitwach i bez zaopatrzenia, odbudowuje się w spokoju.
 *  - Zaopatrzenie: sieć od własnych (kontrolowanych) ziem przez tereny kontrolowane przez kraj i sojuszników;
 *    armia poza siecią i nie przy jej krawędzi jest okrążona: −4% stanu i −0.12 organizacji na turę.
 */
WT.warfare = (function () {
  var S = WT.state, U = WT.util;
  var D = function () { return WT.diplomacy; };

  var TYPES = ['inf', 'arm', 'art'];
  var ERA_NAMES = {
    '2026': { inf: 'Piechota', arm: 'Pancerne', art: 'Artyleria' },
    '1939': { inf: 'Piechota', arm: 'Pancerne', art: 'Artyleria' },
    '1914': { inf: 'Piechota', arm: 'Kawaleria', art: 'Artyleria' },
    '1385': { inf: 'Piechota', arm: 'Rycerstwo', art: 'Machiny oblężnicze' }
  };
  var DEFAULT_MIX = { '2026': { arm: 0.15, art: 0.15 }, '1939': { arm: 0.1, art: 0.12 }, '1914': { arm: 0.06, art: 0.15 }, '1385': { arm: 0.2, art: 0.03 } };
  var COST_MULT = { inf: 1, arm: 3, art: 2 };            // rekrutacja
  var UPKEEP_MULT = { arm: 1.5, art: 0.8 };              // dodatkowe utrzymanie ponad piechotę
  var ARM_TERRAIN = { plains: 2.0, desert: 1.8, tundra: 1.3, hills: 1.3, forest: 0.85, jungle: 0.7, mountains: 0.7 };
  var ARM_DEFENSE = 1.4, ART_K = 1.6;
  var FAST_SHARE = 0.35;
  var ORG_WIN = 0.08, ORG_LOSE = 0.3, ORG_MIN = 0.05, ORG_REST = 0.12, ORG_FIELD = 0.05, ORG_OOS = 0.12, OOS_ATTRITION = 0.04;
  var NEW_ORG = 0.8;

  function G() { return WT.G; }
  function era() { return G() && G().scenario ? G().scenario : '2026'; }
  function names() { return ERA_NAMES[era()] || ERA_NAMES['2026']; }
  function typeName(t) { return names()[t] || t; }

  // ---------- skład armii ----------
  function defaultMix() { var m = DEFAULT_MIX[era()] || DEFAULT_MIX['2026']; return { arm: m.arm, art: m.art }; }
  function mixOf(a) { return a && a.mix ? a.mix : defaultMix(); }
  /** Udziały {inf, arm, art}. */
  function shares(a) { var m = mixOf(a); return { inf: Math.max(0, 1 - m.arm - m.art), arm: m.arm, art: m.art }; }
  /** Skład po połączeniu armii (średnia ważona liczebnością). */
  function blend(a, b, sizeA, sizeB) {
    var ma = mixOf(a), mb = mixOf(b), t = sizeA + sizeB;
    if (t <= 0) return { arm: ma.arm, art: ma.art };
    return { arm: U.round((ma.arm * sizeA + mb.arm * sizeB) / t, 4), art: U.round((ma.art * sizeA + mb.art * sizeB) / t, 4) };
  }
  /** Dodanie `n` żołnierzy rodzaju `type` do armii o stanie `size` (przed dodaniem). */
  function addTroops(a, size, n, type) {
    var add = { arm: type === 'arm' ? 1 : 0, art: type === 'art' ? 1 : 0 };
    a.mix = blend(a, { mix: add }, size, n);
    a.org = U.round(((a.org != null ? a.org : 1) * size + NEW_ORG * n) / Math.max(1, size + n), 3);
  }
  function mixFor(type) { return { arm: type === 'arm' ? 1 : 0, art: type === 'art' ? 1 : 0 }; }

  // ---------- walka ----------
  function orgOf(a) { return a && a.org != null ? a.org : 1; }
  /** Mnożnik jakości armii w bitwie: skład × teren × organizacja. */
  function combatFactor(a, terrain, attacking) {
    var s = shares(a);
    var armK = attacking ? (ARM_TERRAIN[terrain] || 1) : ARM_DEFENSE;
    return (s.inf + s.arm * armK + s.art * ART_K) * (0.4 + 0.6 * orgOf(a));
  }
  function artShare(armies) {
    var t = 0, art = 0;
    armies.forEach(function (a) { t += a.size; art += a.size * shares(a).art; });
    return t ? art / t : 0;
  }
  /** Mnożnik premii fortu przy artylerii atakującego ponad 10% składu (do −60%). */
  var SIEGE_ART = 0.25;   // od tego udziału wsparcia oblężenie postępuje 2× szybciej
  function fortFactor(attackers) { return 1 - Math.min(0.6, Math.max(0, artShare(attackers || []) - 0.1) * 3); }
  function afterBattle(winners, losers) {
    winners.forEach(function (a) { a.org = Math.max(ORG_MIN, orgOf(a) - ORG_WIN); });
    losers.forEach(function (a) { a.org = Math.max(ORG_MIN, orgOf(a) - ORG_LOSE); });
  }
  function movePoints(a, base) { return base + (shares(a).arm >= FAST_SHARE ? 1 : 0); }
  /** Utrzymanie: „równoważni piechurzy” (szybkie i wsparcie droższe). */
  function upkeepSoldiers(cc) {
    return S.armiesOf(cc).reduce(function (s, a) { var m = mixOf(a); return s + a.size * (1 + m.arm * UPKEEP_MULT.arm + m.art * UPKEEP_MULT.art); }, 0);
  }

  // ---------- zaopatrzenie ----------
  var supplyCache = { g: null, turn: -1, sets: {} };
  function friendlyCtrl(cc, provId) {
    var c = G().provinces[provId].ctrl;
    return c === cc || D().friendly(cc, c) || (WT.land && WT.land.hasAccess(cc, c) && G().provinces[provId].owner === c);
  }
  /** Sieć zaopatrzenia kraju: od własnych kontrolowanych ziem przez prowincje kontrolowane przez niego i sojuszników. */
  function supplySet(cc) {
    if (supplyCache.g !== G() || supplyCache.turn !== G().turn) supplyCache = { g: G(), turn: G().turn, sets: {} };
    if (supplyCache.sets[cc]) return supplyCache.sets[cc];
    var set = {}, queue = [];
    G().provinces.forEach(function (p, id) { if (p.owner === cc && p.ctrl === cc) { set[id] = 1; queue.push(id); } });
    for (var i = 0; i < queue.length; i++) {
      var nbs = S.landNeighbors(queue[i]);
      for (var j = 0; j < nbs.length; j++) {
        var n = nbs[j];
        if (!set[n] && friendlyCtrl(cc, n)) { set[n] = 1; queue.push(n); }
      }
    }
    return (supplyCache.sets[cc] = set);
  }
  function invalidateSupply() { supplyCache.turn = -1; }
  /** Czy armia ma zaopatrzenie: w sieci albo tuż przy niej (linia frontu). */
  function isSupplied(a) {
    if (!a || a.embarked) return true;
    var set = supplySet(a.owner);
    if (set[a.prov]) return true;
    return S.landNeighbors(a.prov).some(function (n) { return set[n]; });
  }

  /** Koniec tury: organizacja i straty bez zaopatrzenia. */
  function processTurn() {
    invalidateSupply();
    var armies = G().armies, me = G().player, warned = false;
    Object.keys(armies).forEach(function (id) {
      var a = armies[id];
      if (!a || a.embarked) return;
      if (isSupplied(a)) {
        var home = G().provinces[a.prov].ctrl === a.owner || D().friendly(a.owner, G().provinces[a.prov].ctrl);
        a.org = Math.min(1, orgOf(a) + (home && !(a.path && a.path.length) ? ORG_REST : ORG_FIELD));
        a.oos = 0;
        return;
      }
      a.oos = (a.oos || 0) + 1;
      a.org = Math.max(ORG_MIN, orgOf(a) - ORG_OOS);
      a.size = Math.floor(a.size * (1 - OOS_ATTRITION));
      if (a.owner === me && a.oos === 1 && !warned) {
        warned = true;
        S.addLog('Okrążenie! Armia w: ' + S.provStatic(a.prov).name + ' nie ma zaopatrzenia (−4% stanu i organizacji na turę). Przebij się do swoich.', me);
      }
      if (a.size < WT.military.MIN_ARMY) S.removeArmy(id);
    });
  }

  return {
    SIEGE_ART: SIEGE_ART, TYPES: TYPES, COST_MULT: COST_MULT, FAST_SHARE: FAST_SHARE,
    typeName: typeName, names: names, defaultMix: defaultMix, mixOf: mixOf, shares: shares, blend: blend, addTroops: addTroops, mixFor: mixFor,
    orgOf: orgOf, combatFactor: combatFactor, artShare: artShare, fortFactor: fortFactor, afterBattle: afterBattle,
    movePoints: movePoints, upkeepSoldiers: upkeepSoldiers,
    supplySet: supplySet, isSupplied: isSupplied, invalidateSupply: invalidateSupply, processTurn: processTurn
  };
})();

if (typeof module !== 'undefined') module.exports = WT.warfare;
