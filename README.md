# Wartime 2026

Turowa gra strategiczna w stylu Age of History II. Mapa Europy, Azji i Afryki (1639 prowincji, 148 państw) w stanie na 1 stycznia 2026. Afryka dołączyła w późniejszej wersji — stare zapisy wczytują się i automatycznie dostają afrykańskie państwa. Wszystkie państwa grywalne, na starcie bez sojuszy.

**Epoki:** 2026, 1939 (sierpień, tuż przed II wojną światową), 1914 (czerwiec, przed I wojną światową) i 1385 (średniowiecze). **Kontynenty:** na ekranie startowym możesz wyłączyć Europę, Azję lub Afrykę (co najmniej jeden zostaje) — wyłączony ląd jest poza grą (szary, nieprzechodni).

## Uruchomienie

Otwórz `index.html` w przeglądarce (działa z `file://`) albo:

```
python3 -m http.server 8000   # http://localhost:8000
```

## Sterowanie

| Akcja | Sterowanie |
|---|---|
| Przesuwanie mapy | przeciąganie / WASD / strzałki |
| Zoom | kółko myszy / `+` `-` |
| Rozkaz ruchu armii | przeciągnij armię na cel **albo** kliknij prowincję/armię (zaznacza całą armię) i PPM / stuknięcie na cel → Enter wysyła całość (suwak opcjonalnie odłącza część) |
| Desant | jak ruch, cel za morzem — wymaga własnej floty w porcie z armią |
| Koniec tury | Spacja |
| Tryby mapy | 1 polityczna, 2 dyplomacja, 3 ekonomia, 4 teren |
| Budowa w wielu prowincjach | przycisk zaznaczania przy zoomie / `B` / Shift(Ctrl)+klik → klikaj prowincje lub „Wszystkie moje / Nadmorskie / Przygraniczne” → „Buduj (N)” |
| Nauka i technologie | przycisk „Nauka” / Menu / `N` → budżet badań (suwak) i drzewko technologii („Badaj”) |
| Umowa handlowa | Dyplomacja → państwo → „Umowa handlowa” |
| Ustawienia gry | Menu → „Ustawienia gry…”: agresywność AI (0–100) i automatyczne odrzucanie paktów; to samo na ekranie startowym, przełącznik paktów także w Dyplomacji |
| Okręty artyleryjskie | panel prowincji z portem → „Okręty artyleryjskie” → „Kup okręty” → zaznacz flotę i wyślij ją (PPM) do wrogiej prowincji nadmorskiej |
| Ranking państw | przycisk „Ranking” w górnym pasku / Menu → tabela sortowana kliknięciem nagłówka |
| Nalot bombowców | panel własnej prowincji → „Lotnictwo” → zbuduj bombowce → „Cel nalotu” → kliknij prowincję wroga w zasięgu (pomarańczowy okrąg) |
| Scal armie w prowincji | M (zwykle niepotrzebne — scalanie jest automatyczne) |
| Wsparcie państwa | Dyplomacja → państwo → „Wsparcie” (pieniądze / wojsko); panel prowincji → „Przekaż armię…” |
| Odznacz / zamknij | Esc |
| Zoom (przyciski) | `+` / `−` / „wyśrodkuj” w prawym dolnym rogu; pinch na touchpadzie |

### Telefon / tablet

| Akcja | Gest |
|---|---|
| Przesuwanie mapy | przeciągnij jednym palcem (z bezwładnością) |
| Zoom | rozsuń/zsuń dwa palce (z jednoczesnym przesuwaniem), podwójne stuknięcie = ×2 |
| Wybór prowincji / armii | stuknięcie (markery armii mają powiększony obszar trafienia) |
| Informacje o prowincji | przytrzymaj palec ~0,5 s |
| Rozkaz ruchu | przeciągnij własną armię na cel **albo** zaznacz armię i stuknij cel → suwak → „Rozkaż” |
| Panele | arkusz u dołu ekranu: przeciągnij uchwyt w dół = zamknij, w górę = rozwiń, stuknij nagłówek = zwiń |

## Mechaniki

- **Tura = tydzień.** Armia ma 2 punkty ruchu: prowincja własna/sojusznicza kosztuje 1, wroga 2 (kończy ruch), góry/dżungla +1. Trasy wieloprowincyjne (A*) wykonują się przez kolejne tury.
- **Bitwy:** liczebność × technologia × morale, bonus obrońcy za fort i teren, ograniczona szerokość frontu. Wolna prowincja wroga zostaje okupowana (fort = oblężenie).
- **Auto-scalanie armii:** armie jednego państwa stojące w tej samej prowincji łączą się same (po rekrutacji, dotarciu do celu, desancie, odwrocie, wczytaniu gry i na koniec tury). Rekruci dołączają do stojącej armii, która zachowuje punkty ruchu. Armie w marszu i na okrętach scalają się dopiero, gdy staną. Marker pokazuje sumę wojsk państwa w prowincji.
- **Wsparcie innych państw:** przelew pieniędzy ze skarbca (w God Mode za darmo) i przekazanie żołnierzy przyjacielowi/sojusznikowi (relacje ≥ 0, nie wrogowi twojego sojusznika). Wojsko trafia do prowincji źródłowej, jeśli leży na ziemi odbiorcy lub jego sojusznika, inaczej do stolicy odbiorcy. Oba poprawiają relacje. Lista wojen pokazuje, kto przegrywa. Bogate AI czasem finansuje przegrywającego przyjaciela walczącego z jego rywalem.
- **Ekonomia:** PKB 2026, podatki, utrzymanie armii/floty, administracja. Budynki: fabryka, fort, port, koszary — różne typy budują się w prowincji równolegle, ten sam typ tylko raz naraz. Masowa budowa na zaznaczonych prowincjach pomija te, gdzie się nie da (z powodem), i buduje od najtańszych, póki starcza pieniędzy.
- **Dyplomacja:** wojna, pokój (biały / aneksja okupowanych / reparacje), sojusze obronne zawierane w trakcie gry, pakty o nieagresji, relacje.
- **Rozkaz armii bez resztek:** suwak „Wyślij” działa w procentach (100% = dokładnie cała armia, przycisk „Całość”). Jeśli po odłączeniu w prowincji zostałoby mniej niż 1000 żołnierzy, wysyłana jest cała armia.
- **Lotnictwo:** bombowce budowane w dowolnej własnej prowincji (dywizjon w bazie), zasięg 1800 km, 1100 km na turę. Pierwsza tura lotu kończy się 250 km przed celem, zrzut następuje w kolejnej — obrońca ma turę ostrzeżenia. Bombowce, które przelecą, obniżają rozwój prowincji (do −0,3 na nalot), przez 3 tury prowincja daje połowę dochodu, a każdy bombowiec ma 6% szansy zniszczyć poziom budynku. Opcja „Powtarzaj naloty”. Bombardować można tylko państwa, z którymi jesteś w wojnie.
- **Działka przeciwlotnicze** (budynek, maks. 5): każdy poziom zestrzeliwuje bombowiec z szansą 12% (łącznie), działka sąsiednich prowincji pomagają w połowie, radar obrońcy nad celem daje +35%. Skuteczność ograniczona do 75% — część bombowców zawsze może przejść.
- **Radar** (budynek, maks. 3): zasięg 350/550/750 km. Wrogie bombowce w zasięgu twoich radarów (i sojuszników) widać na mapie razem z celem, a pierwsze wykrycie trafia do dziennika i powiadomień. Bez radaru o nalocie dowiadujesz się dopiero po zrzucie.
- **Nauka:** punkty nauki co turę = 10 × √(wydatek na badania w mld $) + 2 za każdy poziom uniwersytetu (budynek, maks. 5). Budżet na badania to 0–30% tygodniowego dochodu (domyślnie 5%), widoczny w wydatkach. Punkty wydajesz w drzewku technologii (28 technologii w 5 gałęziach):
  - **Wojsko:** Nowoczesna piechota (+0,04 technologii), Logistyka (wyniszczenie −50%, +0,02), Broń precyzyjna (+0,06), Pole walki sieciocentryczne (+0,08), Szkolenie rezerw (rekrutacja −20%), Drony bojowe (+0,05) — technologia to mnożnik siły armii i floty.
  - **Obrona:** Umocnienia (forty +40%), Zintegrowana OPL (działka +25%, limit 80%), Radary dalekiego zasięgu (+40% zasięgu), Obrona wybrzeża (ostrzał z morza −40%), Schrony (naloty −40%).
  - **Lotnictwo:** Bombowce strategiczne (+600 km), Bomby kierowane (naloty +50%), Stealth (wroga OPL −40%), Tankowanie w powietrzu (bombowce +50% prędkości), Masowa produkcja samolotów (−30% kosztu).
  - **Marynarka:** Nowoczesne okręty (flota +20%), Okręty desantowe (15 tys. na eskadrę), Artyleria okrętowa (ostrzał +50%), Pociski manewrujące (ostrzał kolejne +40%), Napęd turbinowy (4 węzły na turę).
  - **Gospodarka:** Automatyzacja (fabryki +20%), Cyfrowa administracja (administracja −20%), Gospodarka wiedzy (nauka +25%), Nowoczesna medycyna (rezerwy +30%), Zielona energia (utrzymanie budynków −50%), Rozbudowa infrastruktury (rozwój 2× szybciej), Sieć 5G (dochód +5%).
  AI też prowadzi badania i buduje uniwersytety. W God Mode odkrycia są darmowe.
- **Umowy handlowe:** +3% dochodu podatkowego dla obu stron (liczone do 6 umów), wymagają relacji ≥ 15, wygasają przy wojnie lub relacjach < −20.
- **Dyplomacja AI wobec gracza:** państwa same proponują sojusz (wspólny wróg/zagrożenie, relacje ≥ 50), umowę handlową, pakt o nieagresji (sąsiedzi słabsi od ciebie) i proszą o pieniądze, gdy przegrywają wojnę (przyjęcie = przelew i lepsze relacje, odmowa = −6). Sąsiedzi i państwa zainteresowane współpracą wysyłają prezenty pieniężne dla poprawy relacji. Maks. jedna oferta na 4 tury, żeby nie zasypywać gracza.
- **Ranking państw:** powierzchnia, prowincje, ludność, PKB, dochód, skarbiec, armia, flota, bombowce, siła militarna (wojsko × technologia + flota i lotnictwo), technologia, stabilność.
- **Okręty artyleryjskie:** kupowane w portach (2,5 mld/szt., utrzymanie jak 2 eskadry), dołączają do floty w porcie. Flota stojąca przy prowincji państwa, z którym jesteś w wojnie, co turę ją ostrzeliwuje: zabija do 15% stacjonujących tam wojsk (1500 żołnierzy na okręt × technologia), obniża rozwój, przez 2 tury prowincja daje połowę dochodu, może uszkodzić fort. Forty odpowiadają ogniem (3% szansy zatopienia okrętu na poziom fortu). W bitwie morskiej okręt artyleryjski liczy się jak 1,5 eskadry. AI też je kupuje i ostrzeliwuje wybrzeża.
- **Agresywność AI** (ustawienie 0–100, domyślnie 50): wpływa na szansę wypowiadania wojen, próg relacji i przewagę potrzebną do ataku, limit jednoczesnych wojen oraz gotowość do białego pokoju. 0 = brak nowych wojen AI. W Dyplomacji każde państwo ma pasek „Agresywność wobec ciebie” (relacje, przewaga militarna, niedawne wojny, ustrój, sąsiedztwo), a na liście państw groźne są oznaczone kropką.
- **Automatyczne odrzucanie paktów:** propozycje paktów o nieagresji nie pojawiają się (wpis w dzienniku), AI przestaje je proponować.
- **Flota i strefy morskie:** morze jest podzielone na 1152 strefy (nazwy z Natural Earth, np. „Morze Egejskie 1”). Floty pływają między portami i strefami, mogą stać na morzu, przewożą wojsko (1 eskadra = 10 tys.), toczą bitwy morskie. Rozkaz: zaznacz flotę → PPM (na telefonie stuknięcie) na prowincję nadmorską albo strefę morską. Kliknięcie strefy otwiera jej panel z flotami.
- **Ostrzał z morza (jak naloty, ale dla okrętów):** zaznacz flotę z okrętami artyleryjskimi → „Cel ostrzału” → kliknij prowincję wroga w zasięgu (pomarańczowy okrąg, 320 km od floty; Artyleria okrętowa +120 km, Pociski manewrujące +250 km). Flota ostrzeliwuje cel co turę, dopóki jest w zasięgu i trwa wojna; linia z celownikiem pokazuje cel. „Przerwij ostrzał” kasuje rozkaz. Bez wskazanego celu flota w porcie wroga ostrzeliwuje ten port (jak wcześniej).
- **Epoki historyczne:** granice z historical-basemaps (aourednik, licencja GPL-3.0) przypisane do prowincji wg większości powierzchni + ręczne poprawki; ludność skalowana per kontynent; PKB/armie/floty szacunkowe. 1939: wojna japońsko-chińska, bez sojuszy. 1914: bez lotnictwa, radaru i plot. (okręty artyleryjskie są). 1385: bez lotnictwa, radaru, plot. i okrętów artyleryjskich; wojny Anglia–Francja, Kastylia–Portugalia, Zakon Krzyżacki–Litwa; jednostka pieniądza ×50, koszty budynków przeliczone.
- **God Mode:** nielimitowana kasa i rezerwy, natychmiastowe budowy, przejmowanie prowincji, dodawanie armii, wymuszanie pokoju/sojuszu, ustawianie relacji. Włączany na starcie lub w trakcie gry.
- **Zapis:** 5 slotów + autosave co 5 tur, eksport/import JSON.
- **Konflikty 2026** (opcja): Rosja–Ukraina (okupowany Donbas, Krym), Izrael–Palestyna.

## Struktura

- `data/map.js` — generowane przez `tools/build_map.py` z Natural Earth (`pip install shapely numpy scipy matplotlib`, `python3 tools/build_map.py --preview`).
- `data/countries.js` — dane państw 2026 (PKB, populacja, armia, flota, relacje).
- `data/scenarios.js` — epoki 1939/1914/1385 (właściciele prowincji, państwa, wojny), generowane przez `tools/build_scenarios.py` z [historical-basemaps](https://github.com/aourednik/historical-basemaps) (GPL-3.0).
- `js/core/*` — logika bez DOM, `js/ui/*` — renderer canvas i UI. Kontrakt modułów: `docs/SPEC.md`.
- Testy: `node tests/run_tests.js`, symulacja na prawdziwych danych: `node tests/sim_real.js 100`.
