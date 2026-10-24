# Wartime 2026

Turowa gra strategiczna w stylu Age of History II. Mapa Europy i Azji (1026 prowincji, 94 państwa) w stanie na 1 stycznia 2026. Wszystkie państwa grywalne, na starcie bez sojuszy.

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
- **Ranking państw:** powierzchnia, prowincje, ludność, PKB, dochód, skarbiec, armia, flota, bombowce, siła militarna (wojsko × technologia + flota i lotnictwo), technologia, stabilność.
- **Flota:** eskadry poruszają się po grafie morskim, przewożą wojsko (1 eskadra = 10 tys.), bitwy morskie.
- **God Mode:** nielimitowana kasa i rezerwy, natychmiastowe budowy, przejmowanie prowincji, dodawanie armii, wymuszanie pokoju/sojuszu, ustawianie relacji. Włączany na starcie lub w trakcie gry.
- **Zapis:** 5 slotów + autosave co 5 tur, eksport/import JSON.
- **Konflikty 2026** (opcja): Rosja–Ukraina (okupowany Donbas, Krym), Izrael–Palestyna.

## Struktura

- `data/map.js` — generowane przez `tools/build_map.py` z Natural Earth (`pip install shapely numpy scipy matplotlib`, `python3 tools/build_map.py --preview`).
- `data/countries.js` — dane państw 2026 (PKB, populacja, armia, flota, relacje).
- `js/core/*` — logika bez DOM, `js/ui/*` — renderer canvas i UI. Kontrakt modułów: `docs/SPEC.md`.
- Testy: `node tests/run_tests.js`, symulacja na prawdziwych danych: `node tests/sim_real.js 100`.
