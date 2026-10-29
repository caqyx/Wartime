var WT = (typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (global.WT = global.WT || {}));

/*
 * WT.land — handel prowincjami i pakty o przejściu wojsk.
 *  - Umowa (deal): { a, b, aProvs, bProvs, aMoney, bMoney, aTroops, bTroops } — a oddaje b swoje aProvs/aMoney/aTroops,
 *    b oddaje a swoje bProvs/bMoney/bTroops. Pokrywa: darowiznę, sprzedaż za pieniądze lub wojsko, wymianę prowincji.
 *  - AI ocenia umowę wartością (pieniądze): ziemie rdzenne i prowincje przy własnej granicy są cenniejsze, stolicy nie oddaje.
 *  - AI proponuje graczowi kupno/sprzedaż (maks. 1 oferta na 5 tur; gracz może wstrzymać oferty na N tur).
 *  - Pakt o przejściu wojsk (G.access): obie strony mogą wprowadzać armie na tereny drugiej przez 40 tur.
 */
WT.land = (function () {
  var U = WT.util, S = WT.state;
  var D = function () { return WT.diplomacy; }, E = function () { return WT.economy; }, Mil = function () { return WT.military; };

  var ACCESS_TURNS = 40, OFFER_EVERY = 5, PRICE_K = 0.3, AI_MARGIN = 1.1;

  function G() { return WT.G; }
  function name(cc) { var c = S.country(cc); return c ? c.name : cc; }
  function isPlayer(cc) { return cc === G().player; }
  function alive(cc) { var c = S.country(cc); return !!(c && c.alive); }
  function sameDeal(x, y) { return (x.a === y.a && x.b === y.b) || (x.a === y.b && x.b === y.a); }

  // =====================================================================
  // Pakt o przejściu wojsk
  // =====================================================================

  function accessList() { if (!G().access) G().access = []; return G().access; }
  function findAccess(a, b) { return accessList().filter(function (t) { return sameDeal({ a: t.a, b: t.b }, { a: a, b: b }); })[0] || null; }
  function hasAccess(a, b) { return !!(a && b && a !== b && G() && G().access && findAccess(a, b)); }
  function checkAccess(a, b) {
    if (a === b || !alive(a) || !alive(b)) return 'Państwo nie istnieje.';
    if (D().atWar(a, b)) return 'Jesteście w stanie wojny.';
    if (D().allied(a, b)) return 'Sojusznicy i wasale już mają przejście.';
    if (hasAccess(a, b)) return 'Pakt o przejściu już obowiązuje.';
    return null;
  }
  function proposeAccess(a, b) {
    var err = checkAccess(a, b);
    if (err) return { accepted: false, reason: err };
    if (isPlayer(b)) { D().addProposal(a, b, 'access', {}); return { accepted: false, reason: 'Propozycja przekazana graczowi.' }; }
    var rel = D().relation(a, b);
    // AI nie wpuszcza wojsk państwa, które walczy z jego sojusznikiem, ani gdy relacje są słabe
    var conflict = D().alliesOf(b).some(function (x) { return D().atWar(a, x); });
    if (rel >= 30 && !conflict) { makeAccess(a, b); return { accepted: true, reason: name(b) + ' zgadza się na przejście wojsk (' + ACCESS_TURNS + ' tur).' }; }
    return { accepted: false, reason: name(b) + ' odmawia przejścia wojsk' + (conflict ? ' (walczysz z jego sojusznikiem).' : ' (relacje ' + rel + ', wymagane 30).') };
  }
  function makeAccess(a, b) {
    if (hasAccess(a, b)) return;
    accessList().push({ a: a, b: b, until: G().turn + ACCESS_TURNS });
    D().changeRel(a, b, 3);
    S.addLog('Pakt o przejściu wojsk: ' + name(a) + ' – ' + name(b) + ' (do tury ' + (G().turn + ACCESS_TURNS) + ').', a);
  }
  function cancelAccess(a, b) {
    var t = findAccess(a, b);
    if (!t) return { ok: false, reason: 'Brak paktu o przejściu.' };
    G().access = accessList().filter(function (x) { return x !== t; });
    D().changeRel(a, b, -10);
    Mil().expelTrespassers();
    return { ok: true, reason: 'Pakt o przejściu zerwany — wojska wracają do siebie.' };
  }

  // =====================================================================
  // Wartość prowincji i umowy
  // =====================================================================

  function isCapital(id) { var p = G().provinces[id], c = S.country(p.owner); return !!(c && c.capital === id); }
  /** Cena prowincji w mld (część PKB prowincji). */
  function price(id) { return U.round(Math.max(0.1, E().provGdp(id) * PRICE_K) * (isCapital(id) ? 2 : 1), 1); }
  function isCore(cc, id) { return S.coresOf ? S.coresOf(cc).indexOf(id) >= 0 : false; }
  function bordersOwn(cc, id) {
    return (S.provStatic(id).nb || []).some(function (n) { return G().provinces[n] && G().provinces[n].owner === cc; });
  }
  /** Wartość prowincji dla `cc`: przy zakupie (czy rdzenna, czy przy granicy) i przy oddaniu (rdzenna ×2). */
  function worthGain(cc, id) { return price(id) * (isCore(cc, id) ? 1.6 : 1) * (bordersOwn(cc, id) ? 1 : 0.6); }
  function worthLoss(cc, id) { return price(id) * (isCore(cc, id) ? 2 : 1.2); }
  /** Pieniądze warte tysiąca żołnierzy dla `cc` (koszt rekrutacji ×1.5). */
  function troopValue(cc, soldiers) {
    var c = S.country(cc), prov = c && c.capital >= 0 ? c.capital : 0;
    return (E().recruitCost(cc, prov, soldiers / 1000) || 0) * 1.5;
  }

  function norm(deal) {
    return { a: deal.a, b: deal.b, aProvs: (deal.aProvs || []).slice(), bProvs: (deal.bProvs || []).slice(),
      aMoney: Math.max(0, +deal.aMoney || 0), bMoney: Math.max(0, +deal.bMoney || 0),
      aTroops: Math.max(0, Math.round(+deal.aTroops || 0)), bTroops: Math.max(0, Math.round(+deal.bTroops || 0)) };
  }
  function idleTroops(cc) {
    return S.armiesOf(cc).filter(function (a) { return !a.embarked && !(a.path && a.path.length); }).reduce(function (s, a) { return s + a.size; }, 0);
  }
  function checkSide(cc, provs, money, troops) {
    for (var i = 0; i < provs.length; i++) {
      var p = G().provinces[provs[i]];
      if (!p || p.owner !== cc || p.ctrl !== cc) return name(cc) + ': można oddać tylko własne, kontrolowane prowincje.';
      if (isCapital(provs[i])) return name(cc) + ': stolicy nie można oddać.';
    }
    if (provs.length && S.provincesOf(cc).length - provs.length < 1) return name(cc) + ' musi zachować co najmniej jedną prowincję.';
    if (money > 0 && !(isPlayer(cc) && G().god) && S.country(cc).treasury < money) return name(cc) + ': brak środków (' + U.fmtMoney(money) + ').';
    if (troops > 0 && idleTroops(cc) < troops) return name(cc) + ': za mało stojącego wojska (' + U.fmtK(troops) + ').';
    return null;
  }
  function checkDeal(deal) {
    var d = norm(deal);
    if (!alive(d.a) || !alive(d.b) || d.a === d.b) return 'Państwo nie istnieje.';
    if (D().atWar(d.a, d.b)) return 'W czasie wojny ziemie zdobywa się na konferencji pokojowej.';
    if (!d.aProvs.length && !d.bProvs.length) return 'Umowa musi obejmować co najmniej jedną prowincję.';
    if (d.aTroops && d.aTroops < Mil().MIN_ARMY || d.bTroops && d.bTroops < Mil().MIN_ARMY) return 'Wojsko w umowie: min. ' + Mil().MIN_ARMY + ' żołnierzy.';
    return checkSide(d.a, d.aProvs, d.aMoney, d.aTroops) || checkSide(d.b, d.bProvs, d.bMoney, d.bTroops);
  }
  /** Bilans umowy z punktu widzenia `cc` (w mld): co dostaje − co oddaje. */
  function balanceFor(cc, deal) {
    var d = norm(deal), mine = cc === d.a;
    var gotProvs = mine ? d.bProvs : d.aProvs, gaveProvs = mine ? d.aProvs : d.bProvs;
    var got = gotProvs.reduce(function (s, id) { return s + worthGain(cc, id); }, 0) + (mine ? d.bMoney : d.aMoney) + troopValue(cc, mine ? d.bTroops : d.aTroops);
    var gave = gaveProvs.reduce(function (s, id) { return s + worthLoss(cc, id); }, 0) + (mine ? d.aMoney : d.bMoney) + troopValue(cc, mine ? d.aTroops : d.bTroops);
    return { got: U.round(got, 2), gave: U.round(gave, 2), net: U.round(got - gave, 2) };
  }
  /** Czy AI `cc` przyjmie: darowizna zawsze; inaczej zysk ≥ 110% straty (lepsze relacje — mniejsza marża). */
  function aiAccepts(cc, deal) {
    var other = cc === deal.a ? deal.b : deal.a, rel = D().relation(cc, other);
    if (rel < -30) return { ok: false, reason: name(cc) + ' nie handluje ziemią z wrogim państwem (relacje ' + rel + ').' };
    var bal = balanceFor(cc, deal);
    if (bal.gave <= 0) return { ok: true };
    var margin = AI_MARGIN - U.clamp(rel, 0, 100) / 1000;
    if (bal.got >= bal.gave * margin) return { ok: true };
    return { ok: false, reason: name(cc) + ' odrzuca: oferta warta ' + U.fmtMoney(bal.got) + ', a oddaje ' + U.fmtMoney(bal.gave) + ' (chce ok. ' + U.fmtMoney(bal.gave * margin - bal.got) + ' więcej).' };
  }

  /** Złożenie umowy: AI odpowiada od razu, gracz dostaje okno propozycji. */
  function proposeDeal(deal) {
    var d = norm(deal), err = checkDeal(d);
    if (err) return { accepted: false, reason: err };
    if (isPlayer(d.b)) {
      if (offersPaused()) return { accepted: false, reason: 'Gracz wstrzymał oferty ziemi.' };
      var p = D().addProposal(d.a, d.b, 'land', d);
      if (p) G().lastLandOffer = G().turn;
      return { accepted: false, proposed: !!p, reason: 'Propozycja przekazana graczowi.' };
    }
    var v = aiAccepts(d.b, d);
    if (!v.ok) return { accepted: false, reason: v.reason };
    executeDeal(d);
    return { accepted: true, reason: name(d.b) + ' przyjmuje umowę: ' + describe(d) + '.' };
  }
  function moveTroops(from, to, n) {
    if (!n) return;
    var left = n;
    S.armiesOf(from).filter(function (a) { return !a.embarked && !(a.path && a.path.length); }).sort(function (x, y) { return y.size - x.size; }).forEach(function (a) {
      if (left <= 0) return;
      var t = Math.min(left, a.size);
      if (a.size - t < Mil().MIN_ARMY) t = a.size;
      a.size -= t; left -= t;
      if (a.size <= 0) S.removeArmy(a.id);
    });
    var cap = S.country(to).capital;
    if (cap >= 0) { var army = S.createArmy(to, cap, n); army.moved = 99; Mil().merge(cap, to); }
    Mil().invalidatePower();
  }
  function payMoney(from, to, amount) {
    if (!amount) return;
    if (!(isPlayer(from) && G().god)) S.country(from).treasury -= amount;
    S.country(to).treasury += amount;
  }
  function executeDeal(deal) {
    var d = norm(deal);
    d.aProvs.forEach(function (id) { S.setOwner(id, d.b); });
    d.bProvs.forEach(function (id) { S.setOwner(id, d.a); });
    payMoney(d.a, d.b, d.aMoney); payMoney(d.b, d.a, d.bMoney);
    moveTroops(d.a, d.b, d.aTroops); moveTroops(d.b, d.a, d.bTroops);
    var gift = !d.bProvs.length && !d.bMoney && !d.bTroops;
    D().changeRel(d.a, d.b, gift ? Math.min(30, 8 + 4 * d.aProvs.length) : 4);
    D().afterBorderChange();
    S.addLog('Umowa terytorialna: ' + name(d.a) + ' – ' + name(d.b) + ': ' + describe(d) + '.', isPlayer(d.b) ? d.b : d.a);
    WT.events.emit('annex', { loser: d.a, provinces: d.aProvs.concat(d.bProvs) });
    return true;
  }
  function describe(deal) {
    var d = norm(deal);
    var side = function (cc, provs, money, troops) {
      var t = [];
      if (provs.length) t.push(provs.map(function (id) { return S.provStatic(id).name; }).join(', '));
      if (money) t.push(U.fmtMoney(money));
      if (troops) t.push(U.fmtK(troops) + ' żołnierzy');
      return t.length ? name(cc) + ' oddaje ' + t.join(' + ') : '';
    };
    return [side(d.a, d.aProvs, d.aMoney, d.aTroops), side(d.b, d.bProvs, d.bMoney, d.bTroops)].filter(Boolean).join('; ');
  }

  // =====================================================================
  // Oferty AI (dla gracza i między AI)
  // =====================================================================

  function offersPaused() { var u = S.settings().landOffersPausedUntil; return u != null && u > G().turn; }
  /** Wstrzymanie ofert ziemi od AI na `turns` tur (0 = wznów; Infinity = do odwołania). */
  function pauseOffers(turns) {
    var st = S.settings();
    st.landOffersPausedUntil = turns > 0 ? (isFinite(turns) ? G().turn + turns : 1e9) : null;
    G().proposals = G().proposals.filter(function (p) { return !(p.type === 'land' && p.to === G().player); });
    return st.landOffersPausedUntil;
  }
  function canOfferPlayer() {
    return !offersPaused() && G().turn - (G().lastLandOffer != null ? G().lastLandOffer : -99) >= OFFER_EVERY;
  }

  /**
   * AI `cc` szuka umowy z `partner`: odkupienie własnej ziemi rdzennej (przy granicy) albo — gdy jest w długach —
   * sprzedaż prowincji partnerowi, dla którego jest rdzenna. Zwraca umowę albo null.
   */
  function aiDealFor(cc, partner) {
    var c = S.country(cc), rel = D().relation(cc, partner);
    if (rel < 0 || D().atWar(cc, partner)) return null;
    var cores = S.coresOf(cc);
    var want = S.provincesOf(partner).filter(function (id) {
      var p = G().provinces[id];
      return p.ctrl === partner && cores.indexOf(id) >= 0 && !isCapital(id) && bordersOwn(cc, id);
    }).sort(function (x, y) { return price(x) - price(y); })[0];
    if (want != null) {
      var offer = U.round(worthLoss(partner, want) * 1.15, 1);
      if (c.treasury > offer * 1.5) return { a: cc, b: partner, aProvs: [], bProvs: [want], aMoney: offer, bMoney: 0, aTroops: 0, bTroops: 0 };
    }
    if (c.treasury < 0 && S.provincesOf(cc).length > 3) {
      var pc = S.coresOf(partner);
      var sell = S.provincesOf(cc).filter(function (id) {
        return G().provinces[id].ctrl === cc && !isCapital(id) && cores.indexOf(id) < 0 && bordersOwn(partner, id);
      }).sort(function (x, y) { return (pc.indexOf(y) >= 0) - (pc.indexOf(x) >= 0) || price(x) - price(y); })[0];
      if (sell != null) {
        var ask = U.round(price(sell) * 1.1, 1);
        if (S.country(partner).treasury > ask * 2) return { a: cc, b: partner, aProvs: [sell], bProvs: [], aMoney: 0, bMoney: ask, aTroops: 0, bTroops: 0 };
      }
    }
    return null;
  }
  /** Wywoływane z AI co kilka tur dla państwa `cc`: oferta do gracza (limit) albo umowa z sąsiadem AI. */
  function aiTrade(cc) {
    var player = G().player, nbs = S.countryNeighbors(cc);
    if (nbs.indexOf(player) >= 0 && alive(player) && canOfferPlayer()) {
      var dp = aiDealFor(cc, player);
      if (dp && !checkDeal(dp)) { proposeDeal(dp); return; }
    }
    if (!U.chance(0.25)) return;
    for (var i = 0; i < nbs.length; i++) {
      if (nbs[i] === player || !alive(nbs[i])) continue;
      var d = aiDealFor(cc, nbs[i]);
      if (d && !checkDeal(d) && proposeDeal(d).accepted) return;
    }
  }

  function processTurn() {
    if (!G().access) return;
    var before = G().access.length;
    G().access = G().access.filter(function (t) { return t.until > G().turn && alive(t.a) && alive(t.b) && !D().atWar(t.a, t.b); });
    if (G().access.length < before) Mil().expelTrespassers();
  }

  return {
    ACCESS_TURNS: ACCESS_TURNS, OFFER_EVERY: OFFER_EVERY,
    hasAccess: hasAccess, findAccess: findAccess, checkAccess: checkAccess, proposeAccess: proposeAccess, makeAccess: makeAccess, cancelAccess: cancelAccess,
    price: price, worthGain: worthGain, worthLoss: worthLoss, troopValue: troopValue, idleTroops: idleTroops,
    checkDeal: checkDeal, balanceFor: balanceFor, aiAccepts: aiAccepts, proposeDeal: proposeDeal, executeDeal: executeDeal, describe: describe,
    offersPaused: offersPaused, pauseOffers: pauseOffers, canOfferPlayer: canOfferPlayer, aiDealFor: aiDealFor, aiTrade: aiTrade,
    processTurn: processTurn
  };
})();

if (typeof module !== 'undefined') module.exports = WT.land;
