# Wartime 2026 — specyfikacja architektury

Gra strategiczna w stylu Age of History II. Mapa: Europa + Azja, stan na 1 stycznia 2026.
Wszystkie państwa grywalne. **Brak sojuszy na starcie** (sojusze można zawierać w trakcie gry).
God Mode: nielimitowana kasa + narzędzia sandboxowe.

Stack: vanilla HTML/JS + Canvas 2D. **Bez builda, bez ES modules** — wszystko ładowane
klasycznymi `<script>` tak, żeby `index.html` działał z `file://`. Każdy plik JS dokleja
się do globalnej przestrzeni nazw `window.WT`. UI i nazwy w grze: **po polsku**.

## Struktura plików

```
index.html
css/style.css
data/map.js          window.MAP_DATA        (generowane przez tools/build_map.py)
data/countries.js    window.COUNTRY_DATA    (ręcznie/zresearchowane dane 2026)
js/core/util.js      WT.util     — RNG, helpers, kolejka priorytetowa
js/core/state.js     WT.state    — tworzenie nowej gry, indeksy, gettery
js/core/economy.js   WT.economy
js/core/diplomacy.js WT.diplomacy
js/core/military.js  WT.military — armie, pathfinding, ruch, bitwy, okupacja
js/core/naval.js     WT.naval    — floty, graf morski, desanty
js/core/ai.js        WT.ai
js/core/turn.js      WT.turn     — orkiestracja końca tury
js/core/save.js      WT.save     — localStorage, sloty
js/core/god.js       WT.god      — God Mode
js/ui/render.js      WT.render   — canvas, pan/zoom, picking
js/ui/ui.js          WT.ui       — panele, przyciski, modale
js/main.js           bootstrap
tools/build_map.py   pipeline danych mapy
tests/*.js           testy logiki w node (bez DOM)
```

Kolejność `<script>` w index.html: data/map.js, data/countries.js, js/core/util.js, state, economy,
diplomacy, military, naval, ai, god, turn, save, js/ui/render.js, js/ui/ui.js, js/main.js.

Pliki `js/core/*` **nie dotykają DOM** (testowalne w node: każdy plik kończy się
`if (typeof module !== 'undefined') module.exports = WT.<x>;` i zaczyna
`var WT = (typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (global.WT = global.WT || {}));`).

---

## 1. Dane mapy — `window.MAP_DATA`

```js
window.MAP_DATA = {
  width: 4000, height: 2200,          // jednostki mapy (piksele przy zoom=1)
  kmPerUnit: 4.1,                     // przybliżona skala do liczenia odległości
  projection: "miller", lonMin: -25, lonMax: 192, latMin: -12, latMax: 82,
  provinces: [
    {
      id: 0,                          // = indeks w tablicy
      name: "Mazowieckie",
      cc: "POL",                      // właściciel 2026 (adm0_a3 z Natural Earth)
      poly: [[x0,y0,x1,y1,...], ...], // pierścienie (płaskie tablice, zaokr. do 0.1), multipolygon spłaszczony do listy pierścieni zewnętrznych (dziury pomijamy)
      bbox: [minX,minY,maxX,maxY],
      cx: 0, cy: 0,                   // punkt etykiety/armii (wewnątrz poligonu — pole of inaccessibility lub representative_point)
      areaKm2: 35558,
      pop: 5.5,                       // populacja w mln (rozkład populacji kraju)
      coastal: true,
      port: [x,y] | null,             // punkt na wybrzeżu dla floty (dla coastal)
      nb: [12, 13, ...],              // sąsiedzi lądowi (wspólna granica, dowolny kraj)
      terrain: "plains"|"hills"|"mountains"|"desert"|"forest"|"tundra"|"jungle"  // heurystyka
    }, ...
  ],
  seaLinks: [[a, b, distKm], ...],    // połączenia morskie między prowincjami nadmorskimi (a<b)
  straits: [[a, b], ...],             // przejścia lądowe przez wąskie cieśniny (≤ 40 km), traktowane jak nb
  background: [[x0,y0,...], ...]      // ląd poza grą (Afryka, Grenlandia, Ameryka Pn., Australia) – rysowany na szaro
};
```

Zasady generowania (`tools/build_map.py`):
- Źródło: Natural Earth 10m admin-1 (`ne_10m_admin_1_states_provinces`) + 10m admin-0 do teł/kontroli.
- Kraje: wszystkie z kontynentu Europa i Azja wg Natural Earth (`CONTINENT` w admin-0), w tym Rosja (całość),
  Turcja, Bliski Wschód, Kaukaz, Azja Centralna/Pd./Pd.-Wsch., Indonezja (cała), Timor Wsch., Cypr (bez podziału na N. Cyprus — scalić do CYP), Kosowo, Tajwan, Palestyna, Islandia.
  Bez Grenlandii, bez Egiptu, bez PNG. Bez terytoriów zależnych poza kontynentem (np. Gujana Fr. → pomiń).
- Rosja: współrzędne Czukotki z lon<0 przesunąć o +360.
- Scalanie zbyt drobnych jednostek: `target = clamp(round(sqrt(areaKm2_kraju)/35), 1, 90)`.
  Jeśli kraj ma więcej jednostek admin-1 niż `target` → iteracyjnie łącz najmniejszą prowincję z
  najmniejszym sąsiadem z tego samego kraju (preferuj ten sam `region` NE), nazwa = nazwa większej.
  Wysepki (brak sąsiada w kraju) dołącz do najbliższej prowincji tego kraju.
- Uproszczenie geometrii: tolerancja ~0.02° (cel: plik map.js ≤ 6 MB), bez dziur topologicznych między sąsiadami.
- Sąsiedztwo: bufor 0.01° i przecięcie (lub wspólne wierzchołki).
- seaLinks: między prowincjami `coastal`, odległość punktów `port` ≤ 450 km, a odcinek nie przecina lądu
  (próbkowanie co ~10 km; dopuszczalne ≤ 8% próbek na lądzie) — plus zawsze połącz każdą prowincję
  nadmorską z co najmniej 2 najbliższymi nadmorskimi (żeby wyspy były osiągalne). Graf morski musi być spójny w obrębie danego akwenu.
- Populacja: populacja kraju (z admin-0 POP_EST) rozkładana 70% wg sumy `pop_max` miast z
  `ne_10m_populated_places` w prowincji + 30% wg powierzchni.
- Terrain: heurystyka po szerokości geograficznej i krajach (tundra > 64°N, desert dla
  Półwyspu Arabskiego/Iranu-wschód/Azji Centralnej-pd./Gobi, jungle w strefie równikowej) — wystarczy przybliżenie.

## 2. Dane państw — `window.COUNTRY_DATA`

```js
window.COUNTRY_DATA = {
  POL: {
    name: "Polska",            // polska nazwa
    color: "#d6455a",          // unikalny, odróżnialny od sąsiadów
    capital: "Mazowieckie",    // nazwa prowincji admin-1 ze stolicą (dopasowywana fuzzy) LUB
    capitalLonLat: [21.01, 52.23],  // zawsze podaj – to jest źródło prawdy
    gdp: 980,                  // nominalne PKB 2026, mld USD (szacunek IMF)
    pop: 37.4,                 // mln
    army: 210,                 // aktywne wojsko, tys.
    navy: 6,                   // siła floty, liczba "eskadr" 0–60 (USA by miało 100; Chiny ~55, Rosja ~25, Japonia ~22, Polska ~3)
    tech: 0.85,                // 0.4–1.2 jakość/technologia armii (mnożnik siły)
    gov: "republika",          // ustrój opisowo
    ideology: "demokracja"|"autorytaryzm"|"teokracja"|"monarchia"|"komunizm",
    friends: ["LTU","UKR"],    // tylko do początkowych relacji (+40..+70), NIE są to sojusze
    rivals: ["RUS","BLR"]      // początkowe relacje (-40..-80)
  }, ...
};
window.START_WARS = [["RUS","UKR"]];          // trwające wojny 1.01.2026 (opcjonalnie włączane w menu)
window.START_OCCUPATIONS = [{ by:"RUS", cc:"UKR", lonlat:[[34.1,45.0],[39.3,48.6],[37.8,48.0]] }];
// punkty lon/lat → prowincje zawierające te punkty startują jako okupowane przez `by`
```
Klucze = `adm0_a3` z Natural Earth. Kraje bez wpisu dostają domyślne wartości z `WT.state`.

## 3. Stan gry — `WT.G` (jeden obiekt, w pełni serializowalny JSON)

```js
G = {
  version: 1,
  turn: 0, date: "2026-01-05",     // 1 tura = 1 tydzień
  player: "POL",
  god: false,                      // God Mode
  seed: 12345, rngState: 12345,
  countries: {
    POL: {
      cc, name, color, alive: true,
      capital: provId,
      treasury: 50,                // mld USD
      taxRate: 0.15,               // 0.05–0.40, wpływa na dochód i stabilność
      stability: 70,               // 0–100
      manpower: 400,               // tys. rezerwy do rekrutacji
      tech, ideology,
      warExhaustion: 0,
      lastIncome: 0, lastExpense: 0
    }
  },
  provinces: [                     // zmienne dane prowincji (statyczne w MAP_DATA)
    { owner: "POL", ctrl: "POL", buildings: { factory:0, fort:0, port:0, barracks:0 },
      builds: { factory?: turnsLeft, fort?: ..., port?: ..., barracks?: ... }  // budowy równoległe, max 1 na typ, unrest: 0, dev: 1.0 }
  ],
  armies: { "a17": { id, owner, prov, size /*żołnierze*/, path: [provIds], moved: 0, embarked: null|fleetId } },
  fleets: { "f3":  { id, owner, prov /*prow. nadmorska*/, ships, path: [provIds], cargo: [armyIds] } },
  nextId: 100,
  rel: { "POL|RUS": -60, ... },    // klucz = posortowane cc złączone "|", wartość -100..100
  wars: [ { id, attackers:["RUS"], defenders:["UKR"], start: turn, score: {RUS:0, UKR:0} } ],
  alliances: [ ["POL","LTU"] ],    // sojusze obronne, na starcie PUSTE
  pacts: [ { a, b, until: turn } ],  // pakty o nieagresji
  truces: [ { a, b, until: turn } ],
  proposals: [ { id, from, to, type: "peace"|"alliance"|"pact", terms } ],  // oferty AI → gracz
  log: [ { turn, text, cc? } ]     // max 200 wpisów
}
```

## 4. API logiki (kontrakt dla UI) — wszystkie funkcje operują na `WT.G`

### WT.state
- `newGame({ player, god, startWars:boolean, seed }) → G` — buduje stan z MAP_DATA + COUNTRY_DATA, ustawia `WT.G`.
- `provStatic(id)` → obiekt z MAP_DATA. `prov(id)` → stan dynamiczny.
- `country(cc)`, `countriesAlive() → [cc]`, `provincesOf(cc) → [ids]` (owner), `controlledBy(cc)`.
- `armiesIn(provId) → [army]`, `fleetsIn(provId) → [fleet]`, `armiesOf(cc)`, `fleetsOf(cc)`.
- `dateStr() → "5 stycznia 2026"`.
- `dist(a,b)` km między prowincjami.

### WT.economy
- `income(cc) → { tax, factories, total }`, `expenses(cc) → { army, navy, buildings, total }`, `balance(cc)`.
- `BUILDINGS = { factory:{name,cost,turns,max}, fort:{...}, port:{...}, barracks:{...} }`.
- `canBuild(cc, provId, type) → { ok, reason }`, `build(cc, provId, type) → bool` — różne typy równolegle, ten sam typ odrzucany w trakcie budowy.
- `bulkPlan(cc, provIds, type) → { eligible, cost, skipped: {powód: liczba} }`, `buildMany(cc, provIds, type) → { built, cost, noMoney, skipped }` (najtańsze najpierw), `buildsOf(prov) → {typ: tury}`. Stare zapisy (`build`) migrowane w `save`.
- `recruitCost(cc, provId, sizeK)` → mld USD; `canRecruit(...)`, `recruit(cc, provId, sizeK) → army|null` (armia pojawia się od razu, ale ma `moved=99` w tej turze).
- `buildShipsCost(n)`, `buildShips(cc, provId, n) → fleet|null` (wymaga portu).
- `setTax(cc, rate)`.
- `processTurn(cc)` — dochód, wydatki, budowy, manpower, stabilność. Bankructwo → demobilizacja.

### WT.military
- `findPath(army, destProv) → [provIds] | null` — A* po grafie lądowym (nb + straits); dozwolone tylko prowincje
  własne / sojusznicze (dostęp) / wrogie w stanie wojny / neutralne bez wojny NIEdozwolone. Jeśli cel wymaga morza →
  zwraca null (UI wtedy próbuje `WT.naval.planInvasion`).
- `order(armyId, destProv, sizeSoldiers?) → { ok, reason, armyId }` — jeśli `size < army.size`, armia jest dzielona
  (nowa armia dostaje rozkaz). Ustawia `army.path`.
- `cancel(armyId)`, `merge(provId, cc)` — łączy wszystkie bezczynne armie danego kraju w prowincji (zostaje największa armia
  z ruchem; świeżo zrekrutowane `moved=99` dołączają bez odbierania jej punktów ruchu).
- **Auto-scalanie**: bezczynne armie (pusty `path`, nie `embarked`) tego samego państwa w jednej prowincji scalają się same —
  po rekrutacji (`recruit` zwraca armię, do której dołączyli rekruci), po dotarciu do celu, desancie, odwrocie, wyrzuceniu po pokoju,
  `spawnArmy`, wczytaniu gry i na koniec tury. `mergeIfIdle(army)`, `mergeAll()`. Armie w marszu i zaokrętowane się nie scalają.
- `disband(armyId)`.
- Ruch: **punkty ruchu = 2/tura**. Wejście do prowincji własnej/sojuszniczej kosztuje 1, do wrogiej 2 (kończy ruch).
  Teren mountains/jungle: +1 koszt. Ruch wykonywany w `WT.turn.end()` dla wszystkich jednocześnie, w kolejności
  losowej po państwach.
- `battle(attackers:[army], defenders:[army], provId) → { winner, lossesA, lossesD }`:
  siła = size × tech × morale(stabilność) × (obrońca: 1 + 0.25×fort + bonus terenu hills .15/mountains .35/forest .1/jungle .2)
  × losowość 0.85–1.15. Straty: przegrany 20–35% swojej siły (walczącej, patrz dodatki), wygrany proporcjonalnie (ratio). Przegrany się wycofuje
  do najbliższej własnej prowincji (lub ginie gdy brak).
- Okupacja: armia wroga w prowincji bez obrońców na koniec ruchu → `ctrl = okupant` (ufortyfikowane: fort×1 tura oblężenia).
  Wejście do prowincji należącej do sojusznika okupowanej przez wroga → wyzwolenie (ctrl = owner).
- `warScore(war)` – na podstawie okupowanych prowincji (populacja-ważona), stolicy, strat.

### WT.naval
- `seaPath(fromProv, toProv) → [provIds] | null` — Dijkstra po `seaLinks`.
- `orderFleet(fleetId, destProv) → {ok, reason}` — ruch 3 węzły morskie/turę.
- `planInvasion(armyId, destProv, size?) → {ok, reason}` — desant: armia musi być w prowincji nadmorskiej z własną
  flotą o wolnej pojemności (1 eskadra = 10 000 żołnierzy). Flota zabiera armię (`cargo`, `army.embarked`), płynie
  i wysadza na prowincji docelowej (jeśli wroga → bitwa z bonusem obrońcy +25% za desant).
- Bitwy morskie: floty wrogie w tym samym węźle na koniec ruchu. Przegrana flota przewożąca wojsko traci 50% cargo.
- Każde państwo z portem startowym ma floty startowe wg `navy`.

### WT.diplomacy
- `relation(a,b)`, `changeRel(a,b,delta)`, `atWar(a,b)`, `allied(a,b)`, `hasPact(a,b)`, `hasTruce(a,b)`, `enemiesOf(cc)`.
- `declareWar(a, b) → {ok, reason}` — wymaga braku paktu/rozejmu (pakt można zerwać: -50 relacji ze wszystkimi, -20 stabilności).
  Sojusznicy obrońcy są wzywani (AI: dołącza jeśli relacja z obrońcą > 30 i nie jest w wojnie z kimś silniejszym; gracz: propozycja w `G.proposals`).
- `proposePeace(from, to, type:"white"|"annex"|"demand") → {accepted, reason}` — AI ocenia wg warScore, sił, wyczerpania.
  "annex" = okupowane prowincje przechodzą na okupanta; "white" = przywrócenie kontroli.
- `proposeAlliance(a,b)`, `proposePact(a,b)`, `breakAlliance(a,b)`, `improveRelations(a,b)` (koszt 1 mld + 0.1% PKB, +8),
  `insult(a,b)` (-25). Każda zwraca `{accepted|ok, reason}` z polskim opisem.
- `answerProposal(id, accept:boolean)`.
- **Wsparcie**: `giveMoney(from, to, amount) → {ok, reason, relDelta}` — przelew mld USD (God Mode gracza: skarbiec nie maleje),
  relacje +1..+20 proporcjonalnie do kwoty/PKB odbiorcy; odmowa w wojnie z odbiorcą.
  `giveTroops(from, to, soldiers, sourceProv?) → {ok, reason, prov, soldiers, relDelta}` — żołnierze z armii w `sourceProv`
  albo z największych stojących armii (bez zaokrętowanych i stojących z wrogiem); odbiorca dostaje armię (scaloną) w prowincji
  źródłowej, jeśli należy/jest kontrolowana przez niego lub jego sojusznika i nie jest w rękach wroga, inaczej w stolicy
  (okupowana → największa kontrolowana prowincja). Odmowa: wojna z odbiorcą, odbiorca w wojnie z twoim sojusznikiem/współwalczącym,
  relacje < 0. `availableTroops(cc, sourceProv?)`, `aidTroopsReason(from, to) → reason|null`, `aidDestination(to, sourceProv)`.
  AI z nadwyżką skarbca (> ~12 tygodni wydatków) co ~8 tur może (35%, cooldown 16 tur) wesprzeć pieniędzmi przyjaciela/sojusznika
  przegrywającego (wynik ≤ −15) wojnę z rywalem darczyńcy — maks. 3% PKB odbiorcy.
- Eliminacja państwa gdy nie ma żadnych prowincji (owner) → `alive=false`, wojny zamknięte.

### WT.ai
- `runAll()` – dla każdego żywego państwa poza graczem: ekonomia (podatki, budowy), rekrutacja, dyplomacja
  (wojny oportunistyczne wobec słabszych sąsiadów o złych relacjach — rzadko, ~0.3%/tura/kandydat, max 1 nowa wojna na
  turę globalnie na start, rośnie z czasem), pokój, sojusze w obliczu zagrożenia, ruch armii (obrona granic, ataki na
  słabe prowincje wroga, wyzwalanie), floty. Musi działać < 300 ms/turę dla ~1500 prowincji.

### WT.god
- `enabled()`; gdy `G.god`: `treasury` gracza nie spada (wydatki nie są odejmowane, wyświetlane jako ∞), manpower nielimitowany,
  rekrutacja i budowy natychmiastowe.
- Narzędzia: `setOwner(provId, cc)` (przejęcie prowincji), `spawnArmy(provId, cc, size)`, `forcePeace(a,b)`,
  `forceAlliance(a,b)`, `setRelation(a,b,v)`, `annexCountry(cc, byCc)`, `revealAll` (bez znaczenia – brak mgły wojny).

### WT.turn
- `end() → { events: [string] }`: kolejność: AI decyzje → ruch flot → ruch armii (krok po kroku, bitwy) → okupacje →
  ekonomia wszystkich → budowy → dyplomacja (wygasanie paktów/rozejmów, odpowiedzi AI) → wyczerpanie → data += 7 dni →
  autosave co 5 tur.
- Event bus: `WT.events.on(name, fn)`, `WT.events.emit(name, payload)` (w util.js). Zdarzenia: `battle`, `war`, `peace`,
  `alliance`, `occupy`, `annex`, `eliminated`, `proposal`, `log`.

### WT.save
- `save(slot)`, `load(slot) → bool`, `list() → [{slot, player, date, turn, savedAt}]`, `remove(slot)`, `exportJSON()`, `importJSON(str)`.
  Klucz `wartime2026_slot_<n>` + `wartime2026_autosave`. Kompresja niewymagana, ale stan < 2 MB.

### Dodatki do API (ponad kontrakt, zaimplementowane w js/core)
- **WT.util**: `rand/randInt/randRange/chance/pick/shuffle` (mulberry32 na `G.rngState`), `PriorityQueue` (push(item,prio)/pop/size),
  `clamp`, `key(a,b)`, `project(lon,lat)` / `unproject(x,y)` (Miller jak w build_map.py), `provinceAt(x,y)`, `provinceAtLonLat`,
  `pointInProvince`, `hashColor`, `fmtK`, `fmtMoney`. `WT.events.off(name, fn)`, `clear()`; dodatkowe zdarzenia: `turn`, `gameover`.
- **WT.state**: `rebuildIndex()`, `landNeighbors(id)` (nb+straits), `seaNeighbors(id)` → `[{to,d}]`, `countryNeighbors(cc)`,
  `addLog(text, cc)`, `setOwner/setCtrl`, `createArmy/removeArmy/moveArmy`, `createFleet/removeFleet` (utrzymują indeksy — zawsze przez nie).
  Pola dodatkowe w G: prowincja `gdp` (mld/rok, × `dev`), `siege: {by,t}|null`; kraj `startGdp, pop, baseArmy, navy, losses, ai{}`;
  armia `prevProv`; flota `landAt, home`; `G.gameOver`. Propozycja ma też `text` (gotowy opis) i `turn`.
- **WT.economy**: `buildCost(cc,provId,type)` (koszt rośnie z PKB prowincji i poziomem — używać zamiast `BUILDINGS[t].cost`),
  `canBuildShips`, `countryGdp`, `gdpPerCapita`, `costScale`, `provGdp`. `income()` ma też `occupation` i `aid` (pomoc zagraniczna dla napadniętych),
  `expenses()` ma też `admin` (8% PKB/rok — podatek < 8% to deficyt). Dług przy dodatnim bilansie nie demobilizuje.
- **WT.military**: `estimateTurns(cc, path)`, `findPathFor(cc, from, dest)`, `canEnter(cc, provId)`, `power(cc)`, `split(army, size)`,
  `retreat`, `engageAt`. Bitwa: szerokość frontu — walczy maks. max(100k, 2.5× wroga); przegrany traci 20–35% walczących
  (przy przewadze > 6.7:1 — całość), wygrany proporcjonalnie. Armie na ziemi wroga: wyniszczenie 0.5%/turę.
  `battle()` zwraca `{winner:'attackers'|'defenders', winnerCc, loserCc, attacker, defender, prov, sizeA, sizeD, lossesA, lossesD, annihilated}`.
- **WT.naval**: `seaTurns(path)`, `freeCapacity(fleet)`, `isPort(provId)`, `unload(fleetId)` (wysadź ładunek w bieżącej prowincji).
- **WT.diplomacy**: `breakPact(a,b)` (−50 z partnerem, −15 z resztą, −20 stabilności; `declareWar` przy pakcie zwraca błąd),
  `improveRelationsCost(a)`, `checkDeclareWar(a,b) → reason|null`, `warBetween`, `warsOf`, `alliesOf`, `friendly` (sojusz/współwalczący),
  `concludePeace(a,b,kind,winner)`, `setRel`. Typ `"demand"` = reparacje (30% skarbca + 0.5% PKB przegranego). Propozycje mają typ
  dodatkowy `"callToArms"` (`terms:{warId, side, enemy}`); dla `"peace"`: `terms:{kind, winner}`. Wygasają po 3 turach.
- **WT.turn**: `lastTimings()` → ms faz ostatniej tury. **WT.save**: `autosave()`; slot `"auto"` = autozapis.
- **WT.god**: `spawnArmy(provId, cc, size)` — size w żołnierzach (wartości < 1000 traktowane jako tysiące).

## 5. UI (WT.render + WT.ui)

Styl: ciemny, "sztabowy" (granat/grafit), mapa z morzem w ciemnym błękicie, ląd poza grą szary.
Fonty: systemowe sans + monospace dla liczb.

- **Ekran startowy**: tytuł "WARTIME 2026", mapa w tle; wybór państwa kliknięciem na mapie (podświetlenie, karta z PKB,
  populacją, armią), checkbox "God Mode (nielimitowana kasa)", checkbox "Trwające konflikty 2026 (Rosja–Ukraina)", przyciski
  "Rozpocznij", "Wczytaj grę".
- **Mapa**: pan (przeciąganie LPM/PPM, strzałki/WASD), zoom kółkiem (kursor jako punkt stały), min/max zoom.
  Tryby mapy: polityczny, dyplomatyczny (relacje z graczem: zieleń–czerwień, sojusznicy niebiescy, wrogowie czerwoni),
  ekonomiczny (dev/fabryki), teren. Okupowane prowincje: ukośne paski w kolorze okupanta. Granice państw grubsze niż prowincji.
  Etykiety nazw państw na środku ciężkości (przy niskim zoomie), nazwy prowincji przy wysokim zoomie.
- **Armie (jak AoH2)**: w centroidzie prowincji prostokąt z kolorem państwa i liczbą wojsk w tys. ("12.5k"). Kliknięcie
  zaznacza armię; **przeciągnięcie z armii na prowincję docelową** albo klik na armię + PPM na cel = rozkaz ruchu.
  Po wyborze celu pojawia się pasek z suwakiem "ile wysłać" (domyślnie 100%) i przyciskiem potwierdzenia (Enter).
  Trasa rysowana jako przerywana strzałka przez kolejne centroidy z liczbą tur. Cel morski → automatycznie desant
  (jeśli możliwy), trasa morska na niebiesko.
  Floty: ikonka okrętu w punkcie `port` z liczbą eskadr.
- **Górny pasek**: kolor+nazwa gracza, data, skarbiec (∞ w God Mode), bilans/turę, manpower, stabilność, przycisk
  "Koniec tury" (Spacja), menu (zapis/wczytaj/God Mode/wyjście).
- **Panel prowincji** (po kliknięciu): nazwa, właściciel, kontrola, populacja, teren, budynki + przyciski budowy
  z kosztem, rekrutacja (suwak tys.), budowa okrętów (jeśli port). Dla obcej prowincji: przycisk "Dyplomacja z <kraj>".
- **Panel dyplomacji**: lista państw (szukajka), relacja, status (wojna/sojusz/pakt/rozejm), akcje: wypowiedz wojnę,
  zaproponuj pokój (white/annex), sojusz, pakt, popraw relacje, obraź. Lista aktywnych wojen z war score.
- **Panel God Mode** (gdy włączony): przełącznik narzędzia "przejmij prowincję" (klik na mapie zmienia właściciela),
  "dodaj armię", wymuś pokój/sojusz, ustaw relację.
- **Dziennik zdarzeń** (prawy dolny róg, zwijany) + toasty dla bitw/wojen gracza. Modal dla propozycji AI do gracza.
- Wydajność: Path2D cache per prowincja; cały ląd rysowany do offscreen canvas per tryb i odświeżany tylko po zmianie
  właścicieli; armie i trasy na overlay. Picking: siatka przestrzenna bboxów + `isPointInPath`.

### WT.air (js/core/air.js)
- `G.squadrons: { id: { id, owner, base, planes, phase: 'idle'|'out'|'back', target, x, y, repeat, spotted, airborne } }`.
- `planeCost(cc, n)`, `canBuildBombers(cc, prov, n)`, `buildBombers(cc, prov, n) → squadron|null` (dołącza do stojącego dywizjonu w bazie).
- `orderRaid(squadId, targetProv, repeat) → {ok, reason, turns}` — tylko cele w wojnie, ≤ RANGE_KM od bazy; `recall(id)`, `disband(id)`, `flightTurns(from, to)`.
- `processTurn()` (w `turn.end` po flotach): lot, zrzut (`bombProvince`), powrót, radar, licznik `province.bombed`.
- `interceptChance(prov)` — działka (`buildings.aa`) celu + 50% najlepszego sąsiada obrońcy, ×1.35 pod radarem, maks. 0.75.
- `radarRangeKm(level)`, `radarStations(cc)`, `radarCovers(cc, x, y)`, `visibleFor(cc)` (własne + wrogie lecące w zasięgu radaru).
- `planesOf(cc)`, `upkeep(cc)` (w `economy.expenses().air`). Zdarzenia: `bombing`, `radar`.
- Budynki `aa` i `radar` w `economy.BUILDINGS`; `province.bombed > 0` → połowa dochodu prowincji.
- `military.splitForOrder(army, size)` — rozkaz wysyła całość, gdy reszta < `MIN_REMAINDER` (1000).

### WT.tech (js/core/tech.js)
- Kraj: `researchRate` (0–0.30 dochodu), `rp`, `techs {id:true}`, `techMods {klucz: wartość}` (przeliczane przy odkryciu).
- `TREE`, `BRANCHES`, `ensure(c)`, `ensureAll()` (nowa gra i stare zapisy), `mod(cc, key)` (mnożnik, domyślnie 1), `add(cc, key)` (dodatek, domyślnie 0), `has(cc, id)`.
- `setRate(cc, r)`, `spending(cc)` (w `economy.expenses().research`), `pointsPerTurn(cc) → {budget, universities, total}`, `universityLevels(cc)`.
- `canResearch(cc, id)`, `research(cc, id) → {ok, reason}` (God Mode gracza: darmo), `processTurn()` (w `turn.end` po ekonomii), `nextFor(cc, atWar)` dla AI.
- Klucze efektów: fort, attrition, aaKill, aaCap, radarRange, bomberRange, bombDamage, stealth, fleet, shipCapacity, factory, admin, research, manpower; `tech` dodawane do `country.tech`.

### Handel i oferty AI (diplomacy.js, ai.js)
- `G.trades [{a, b, since}]`; `proposeTrade(a, b)`, `makeTrade`, `cancelTrade`, `hasTrade`, `tradesOf(cc)`; `economy.income().trade`.
- Nowe typy propozycji: `trade`, `aidRequest {enemy, amount}`. AI: `courtPlayer` (oferty i prezenty dla gracza, globalny odstęp `G.lastPlayerOffer`), `seekTrade` (umowy AI–AI), `manageResearch`.

### Okręty artyleryjskie, ustawienia, agresywność
- `fleet.gunships`; `naval.gunshipCost(n)`, `canBuyGunships(cc, prov, n)`, `buyGunships(cc, prov, n)`, `shellAll()` (w `turn.end` po ruchu flot), `shellProvince(fleet)`, `fleetMoves(cc)`. Zdarzenie `shelling`.
- `G.settings { autoRejectPacts, aiAggression }` (`state.settings()`, opcje `newGame`); `diplomacy.aggression()` → 0…2; `ai.aggressionOf(cc, target)` → 0–100 (100 = wojna).
- Nowe klucze technologii: recruitCost, coastDef, bombResist, bomberSpeed, planeCost, shellDamage, fleetSpeed, upkeep, devGrowth, income.

### Afryka i zgodność zapisów
- Mapa: Europa, Azja i Afryka (`LAT_MIN = -36`; projekcja Millera zakotwiczona u góry, więc współrzędne Europy/Azji się nie zmieniły). 1639 prowincji, 148 państw.
- `tools/build_map.py → keep_old_ids()`: prowincje z poprzedniej mapy zachowują numery, nowe są dopisywane na końcu (build przerywa się, jeśli którejś starej nie da się dopasować).
- `state.extendWorld(g)`: zapis z krótszą listą prowincji dostaje brakujące prowincje i państwa (stolice, PKB, relacje, forty, armie, floty jak w nowej grze); `save.applyState` wywołuje to automatycznie. Zapis z dłuższą listą niż mapa jest odrzucany.
- Aliasy NE: SAH→MAR, SOL→SOM, BRT→EGY; pominięte: Réunion, Majotta, ATF, SHN, IOT.


### Epoki, kontynenty, strefy morskie
- `window.SCENARIOS[id] = {id, date, title, desc, popScale{EU,AS,AF}, era{air, radar, aa, gunships, costScale, priceScale}, owners[prov] (cc), countries{cc: {name, color, capitalLonLat, gdp, pop, army, navy, tech, ideology, gov, friends, rivals}}, wars[[a,b]], occupations[[occupant, prov]]}`; `'2026'` = dane bazowe (brak wpisu).
- `newGame({scenario, continents:['EU','AS','AF'], ...})`; `G.scenario`, `G.era`, `G.popScale`, `G.continents`. `state.era(feature)` (brak `G.era` = wszystko dostępne), `state.provPop(id)` (ludność prowincji × popScale kontynentu), `state.scenarioData(id)`.
- Prowincja `ct` ∈ {EU, AS, AF} (MAP_DATA). Prowincje wyłączonych kontynentów mają właściciela `state.VOID = 'XXX'` (państwo martwe, nieprzechodnie, rysowane jak tło, niewybieralne).
- `MAP_DATA.seas[k] = {id, name, poly, cx, cy, nb[k], coast[prov]}`; węzeł strefy = `state.SEA_BASE (100000) + k`. `state.isSea, seaZone, nodePoint, nodeName, nodeDist`; `seaNeighbors` i `naval.seaPath/orderFleet` przyjmują strefy. Flota może stać w strefie (`fleet.prov` = id strefy); ładunek nie może tam wysiąść.
- Ostrzał z dystansu: `fleet.shellTarget`; `naval.orderShell(fleetId, prov) → {ok, reason}`, `cancelShell(fleetId)`, `checkShell(f, prov) → błąd|null`, `shellRangeKm(cc)` (320 + tech `shellRange`), `distToProvince(node, prov)` (do portu lub środka prowincji).
- Render: `render.pickSea(mx, my)`, `nodePath(id)`, `view.hoverSea/selSea/shellRange`; handlery `click(prov, e, sea)`, `rightClick(prov, sx, sy, sea)`, `dragDrop(unit, prov, sea)`, `hover(prov, sx, sy, unit, sea)`, `tap(prov, sx, sy, unit, sea)`, `longPress(…, sea)` — `sea` ≥ 0 tylko gdy pod kursorem nie ma lądu.
- UI: ekran startowy buduje grę-podgląd (`newGame` z `player: null` i tym samym ziarnem), więc mapa, lista i karta państwa pokazują wybraną epokę i kontynenty; „Rozpocznij” tworzy grę z identycznymi opcjami.

### Punkty wojenne, traktaty, wasale (js/core/vassal.js → WT.vassal)
- `country.overlord`, `country.vassalSince`, `country.tribute` (0–0.5), `country.tributePaid`; `G.reparations [{from, to, pct, until, paid}]`; `war.dmg['A>B']` — punkty za zniszczenia.
- Punkty: `provValue(id)`, `warPoints(me, target) → {total, occupation, damage, provinces:[{id, value}]}`; źródła zniszczeń: `onBattle` (z `diplomacy.recordLosses`), `onBombing` (air.bombProvince), `onShelling` (naval.shellProvince).
- Traktat: `terms = {provinces, contribution, reparations, disarm, vassal}`; `treatyCost`, `vassalCost(target, taking)`, `acceptLimit`, `checkTreaty → błąd|null`, `proposeTreaty(me, target, terms) → {accepted, reason}` (AI przyjmuje, gdy koszt ≤ limit) → `diplomacy.concludePeace(a, b, 'treaty', winner, terms)` → `applyTreaty`.
- Wasale: `overlordOf, isVassalOf, vassalsOf, related, makeVassal, release, setTribute, takeMoney, vassalTroops, takeTroops, canAnnex, annex, annexCost`; `processTurn()` (w `diplomacy.processTurn`) — trybut i reparacje.
- Dyplomacja: para wasal–suzeren w `idx.allied` (friendly/przejście), `startWar`/`joinWar` dociągają wasali i suzerena obrońcy, wasale wychodzą z wojny razem z suzerenem, wasal nie wypowiada wojen i nie zawiera sojuszy/paktów; pokój z wasalem tylko przez suzerena. AI: `proposeAiTreaty` (prowincje od najcenniejszych, wasalizacja przy upadku, reparacje/kontrybucja z reszty punktów); wobec gracza AI nadal używa propozycji `peace` (white/annex).
- Gracz jako wasal: AI → `vassal.buildTerms(me, target, vassalChance)` → propozycja `treaty` (terms) do gracza; `answerProposal` → `stillValid` (tylko nadal okupowane prowincje) → `concludePeace(..., 'treaty', ...)`. `declareIndependence(v)` — zerwanie zależności i wojna z suzerenem; AI: `considerIndependence`.

### Państwa nieistniejące, powstanie, odtwarzanie
- `state.coresOf(cc)` — ziemie rdzenne (właściciele ze scenariusza, gdy państwo w nim jest, inaczej `MAP.provinces[i].cc`), bez lądu poza grą. `nationCandidates()` — państwa martwe lub nieobecne w epoce z ziemiami na mapie (bez państw z 2026 obecnych w scenariuszu pod innym kodem: ta sama nazwa albo ta sama stolica). `nationData`, `nationName`.
- `state.spawnCountry(cc, provs, {treasury, army, tech})` — nowe/odtworzone państwo (relacje od nowa). `vassal.checkRelease(o, cc, provs)`, `vassal.releaseNation(o, cc, provs)` → wasal `o`, dołącza do jego wojen.
- `newGame({player})` z państwem nieistniejącym → `state.startUprising(g, cc)`: prowincja startowa (`uprisingPreview(cc)` → {cores, start, occupier, occupiers, army}), dezercja 25% wojsk okupanta z ziem rdzennych (maks. 2× armia powstańcza), wojna z okupantem, relacje 55 z jego rywalami. `G.goal = {type:'independence', cc, cores, start, done, doneTurn, shown}`; `state.goalProgress() → {goal, cores:{have,total}, world:{have,total}}`; `state.checkGoal()` w `diplomacy.processTurn` (zdarzenie `goal`).

### Handel prowincjami i przejście wojsk (js/core/land.js → WT.land)
- `G.access [{a, b, until}]` (40 tur, `military.canEnter` uwzględnia), `proposeAccess`, `makeAccess`, `cancelAccess`, `hasAccess`, `findAccess`; `processTurn` usuwa wygasłe i wyrzuca wojska.
- Umowa `{a, b, aProvs, bProvs, aMoney, bMoney, aTroops, bTroops}`: `checkDeal`, `balanceFor(cc, deal) → {got, gave, net}`, `aiAccepts`, `proposeDeal` (gracz → propozycja `land`), `executeDeal`, `describe`, ceny `price(id)` (30% PKB prowincji, stolica ×2), `worthGain/worthLoss`, `troopValue`.
- Oferty AI: `aiTrade(cc)` (co 5 tur na państwo), `G.lastLandOffer` (limit 1 oferta / 5 tur dla gracza), `settings.landOffersPausedUntil` (`pauseOffers(turns)`).
- Trasy: `military.findPathVia(army, via, dest)` (`findPathVia.failedAt`), `military.order(id, dest, size, {via})`, `naval.seaPathVia(from, via, to)`, `naval.orderFleet(id, dest, via)`. UI: `S.via`, `S.viaPick`, `S.routePref` ('land'|'sea'), `plan.routes {land, sea}`, `plan.via` (rysowane jako numerowane punkty).

### Wojna: rodzaje wojsk, organizacja, zaopatrzenie (js/core/warfare.js → WT.warfare)
- `army.mix = {arm, art}` (null = skład domyślny epoki `defaultMix()`), `army.org` (0–1, brak = 1), `army.oos` (tury bez zaopatrzenia).
- `combatFactor(a, terrain, attacking)` w `military.sideStrength`; `fortFactor(attackers)` w `defenseBonus` (opts.fortK); `afterBattle(winners, losers)`; `movePoints(a, base)` (`military.movePointsOf`); oblężenie ×2 przy `artShare ≥ SIEGE_ART`; `blend` przy `merge`, kopia przy `split`.
- `economy.recruitCost/canRecruit/recruit(cc, prov, k, type)` (`COST_MULT`), utrzymanie wg `upkeepSoldiers(cc)`.
- `supplySet(cc)` (BFS od własnych kontrolowanych ziem przez prowincje kontrolowane przez kraj/sojuszników/z przejściem, cache na turę), `isSupplied(a)`, `processTurn()` (w `turn.end` po okupacjach).
- AI: `pickUnitType`, `effStrength` (org), odpoczynek przy org < 0.35, premia celu za kleszcze i okrążone armie wroga.
