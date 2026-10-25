/*
 * Wartime 2026 — dane państw (stan na 1 stycznia 2026).
 * Kontrakt: docs/SPEC.md, sekcja 2. Klucze = ADM0_A3 z Natural Earth 10m admin-0
 * (wszystkie kraje z CONTINENT = Europe | Asia | Africa, plus Malediwy, Seszele i Mauritius z "Seven seas").
 *
 * Źródła / szacunki (zaokrąglone, przybliżone — to gra, nie rocznik statystyczny):
 *  - gdp:  nominalne PKB 2026 w mld USD, prognozy IMF World Economic Outlook (X 2025);
 *          dla krajów bez prognozy IMF (Syria, Afganistan, Korea Pn., Jemen, Palestyna,
 *          Watykan, Monako, Liechtenstein, San Marino) — szacunki własne/Bank Światowy/CIA.
 *  - pop:  populacja w mln (UN WPP 2024, prognoza na 2026; Ukraina — ludność na terenach
 *          kontrolowanych przez rząd w Kijowie).
 *  - army: aktywne siły zbrojne w tys. (IISS Military Balance 2025, zaokrąglone; Ukraina i
 *          Rosja wg stanu wojennego). Bez rezerw i formacji paramilitarnych.
 *  - navy: abstrakcyjna siła floty 0–60 ("eskadry"; USA ≈ 100). Kraje śródlądowe = 0.
 *  - tech: 0.4–1.2 mnożnik jakości / wyposażenia armii (ocena własna).
 *  - friends / rivals: realne relacje dwustronne początku 2026 — NIE są to sojusze
 *    (sojusze na starcie gry są puste).
 */
window.COUNTRY_DATA = {
  // ---------------- Europa Zachodnia ----------------
  GBR: { name: "Wielka Brytania", color: "#c8364a", capital: "Greater London", capitalLonLat: [-0.13, 51.51], gdp: 4000, pop: 69.6, army: 141, navy: 14, tech: 1.10,
         gov: "monarchia parlamentarna", ideology: "demokracja", friends: ["UKR","POL","FRA","NOR","NLD","EST","JPN","IRL","DNK"], rivals: ["RUS","IRN","BLR","PRK"] },
  IRL: { name: "Irlandia", color: "#4cc26b", capital: "Dublin", capitalLonLat: [-6.26, 53.35], gdp: 760, pop: 5.4, army: 7.5, navy: 1, tech: 0.85,
         gov: "republika parlamentarna", ideology: "demokracja", friends: ["GBR","FRA","DEU","NLD"], rivals: ["RUS"] },
  ISL: { name: "Islandia", color: "#8fb4ee", capital: "Capital Region", capitalLonLat: [-21.94, 64.15], gdp: 37, pop: 0.39, army: 0, navy: 1, tech: 0.60,
         gov: "republika parlamentarna", ideology: "demokracja", friends: ["NOR","DNK","GBR","FIN","SWE"], rivals: ["RUS"] },
  FRA: { name: "Francja", color: "#3e6fd8", capital: "Paris", capitalLonLat: [2.35, 48.86], gdp: 3360, pop: 68.6, army: 200, navy: 14, tech: 1.08,
         gov: "republika semiprezydencka", ideology: "demokracja", friends: ["DEU","UKR","GBR","BEL","ITA","ESP","POL","GRC","ARE","IND"], rivals: ["RUS","IRN","BLR"] },
  BEL: { name: "Belgia", color: "#e3c64a", capital: "Bruxelles", capitalLonLat: [4.35, 50.85], gdp: 720, pop: 11.9, army: 23, navy: 1, tech: 0.95,
         gov: "monarchia parlamentarna", ideology: "demokracja", friends: ["NLD","LUX","FRA","DEU"], rivals: ["RUS"] },
  NLD: { name: "Holandia", color: "#f08a24", capital: "Noord-Holland", capitalLonLat: [4.90, 52.37], gdp: 1350, pop: 18.1, army: 33, navy: 4, tech: 1.02,
         gov: "monarchia parlamentarna", ideology: "demokracja", friends: ["BEL","LUX","DEU","GBR","UKR","DNK"], rivals: ["RUS"] },
  LUX: { name: "Luksemburg", color: "#6cc3e0", capital: "Luxembourg", capitalLonLat: [6.13, 49.61], gdp: 100, pop: 0.68, army: 1, navy: 0, tech: 0.90,
         gov: "monarchia konstytucyjna (wielkie księstwo)", ideology: "demokracja", friends: ["BEL","NLD","FRA","DEU"], rivals: [] },
  DEU: { name: "Niemcy", color: "#8e949e", capital: "Berlin", capitalLonLat: [13.40, 52.52], gdp: 5000, pop: 83.5, army: 181, navy: 8, tech: 1.06,
         gov: "republika federalna", ideology: "demokracja", friends: ["FRA","POL","NLD","AUT","UKR","CZE","DNK","ISR","LTU"], rivals: ["RUS","BLR","IRN"] },
  CHE: { name: "Szwajcaria", color: "#e8504a", capital: "Bern", capitalLonLat: [7.45, 46.95], gdp: 1000, pop: 9.0, army: 20, navy: 0, tech: 1.00,
         gov: "republika federalna (konfederacja)", ideology: "demokracja", friends: ["LIE","AUT","DEU"], rivals: [] },
  LIE: { name: "Liechtenstein", color: "#5b6ee1", capital: "Vaduz", capitalLonLat: [9.52, 47.14], gdp: 8, pop: 0.04, army: 0, navy: 0, tech: 0.50,
         gov: "monarchia konstytucyjna (księstwo)", ideology: "monarchia", friends: ["CHE","AUT"], rivals: [] },
  AUT: { name: "Austria", color: "#e6ddca", capital: "Wien", capitalLonLat: [16.37, 48.21], gdp: 560, pop: 9.2, army: 23, navy: 0, tech: 0.95,
         gov: "republika federalna", ideology: "demokracja", friends: ["DEU","CHE","SVN","CZE"], rivals: [] },
  MCO: { name: "Monako", color: "#f06c9b", capital: "Monaco", capitalLonLat: [7.42, 43.74], gdp: 10, pop: 0.04, army: 0, navy: 0, tech: 0.50,
         gov: "monarchia konstytucyjna (księstwo)", ideology: "monarchia", friends: ["FRA"], rivals: [] },
  AND: { name: "Andora", color: "#b98ad8", capital: "Andorra la Vella", capitalLonLat: [1.52, 42.51], gdp: 4.5, pop: 0.08, army: 0, navy: 0, tech: 0.50,
         gov: "współksięstwo parlamentarne", ideology: "demokracja", friends: ["ESP","FRA"], rivals: [] },
  ESP: { name: "Hiszpania", color: "#e6b631", capital: "Comunidad de Madrid", capitalLonLat: [-3.70, 40.42], gdp: 1890, pop: 48.8, army: 122, navy: 7, tech: 0.95,
         gov: "monarchia parlamentarna", ideology: "demokracja", friends: ["PRT","FRA","ITA","AND"], rivals: ["RUS"] },
  PRT: { name: "Portugalia", color: "#2f8f5b", capital: "Lisboa", capitalLonLat: [-9.14, 38.72], gdp: 330, pop: 10.6, army: 24, navy: 2, tech: 0.85,
         gov: "republika semiprezydencka", ideology: "demokracja", friends: ["ESP","GBR","FRA"], rivals: [] },
  ITA: { name: "Włochy", color: "#3fa34d", capital: "Lazio", capitalLonLat: [12.50, 41.90], gdp: 2550, pop: 58.9, army: 161, navy: 9, tech: 1.00,
         gov: "republika parlamentarna", ideology: "demokracja", friends: ["FRA","DEU","ESP","GRC","ALB","UKR","SMR","VAT","MLT"], rivals: ["RUS"] },
  SMR: { name: "San Marino", color: "#8ed1f5", capital: "San Marino", capitalLonLat: [12.45, 43.94], gdp: 2.2, pop: 0.03, army: 0, navy: 0, tech: 0.50,
         gov: "republika parlamentarna", ideology: "demokracja", friends: ["ITA"], rivals: [] },
  VAT: { name: "Watykan", color: "#f6e27a", capital: "Vatican City", capitalLonLat: [12.45, 41.90], gdp: 0.5, pop: 0.001, army: 0, navy: 0, tech: 0.50,
         gov: "monarchia absolutna (teokratyczna)", ideology: "teokracja", friends: ["ITA","POL"], rivals: [] },
  MLT: { name: "Malta", color: "#d9d9d9", capital: "Valletta", capitalLonLat: [14.51, 35.90], gdp: 28, pop: 0.57, army: 2, navy: 1, tech: 0.75,
         gov: "republika parlamentarna", ideology: "demokracja", friends: ["ITA","GBR"], rivals: [] },

  // ---------------- Skandynawia i Bałtyk ----------------
  DNK: { name: "Dania", color: "#c9384a", capital: "Hovedstaden", capitalLonLat: [12.57, 55.68], gdp: 450, pop: 6.0, army: 15, navy: 3, tech: 1.00,
         gov: "monarchia parlamentarna", ideology: "demokracja", friends: ["NOR","SWE","FIN","DEU","UKR","ISL"], rivals: ["RUS"] },
  NOR: { name: "Norwegia", color: "#a64a6a", capital: "Oslo", capitalLonLat: [10.75, 59.91], gdp: 520, pop: 5.6, army: 24, navy: 4, tech: 1.05,
         gov: "monarchia parlamentarna", ideology: "demokracja", friends: ["SWE","DNK","FIN","GBR","ISL","UKR"], rivals: ["RUS"] },
  SWE: { name: "Szwecja", color: "#4a90d9", capital: "Stockholm", capitalLonLat: [18.07, 59.33], gdp: 660, pop: 10.6, army: 24, navy: 3, tech: 1.05,
         gov: "monarchia parlamentarna", ideology: "demokracja", friends: ["FIN","NOR","DNK","EST","LVA","LTU","POL","UKR"], rivals: ["RUS","BLR"] },
  FIN: { name: "Finlandia", color: "#dde6f3", capital: "Uusimaa", capitalLonLat: [24.94, 60.17], gdp: 330, pop: 5.6, army: 24, navy: 2, tech: 1.02,
         gov: "republika parlamentarna", ideology: "demokracja", friends: ["SWE","EST","NOR","DNK","UKR","POL"], rivals: ["RUS","BLR"] },
  EST: { name: "Estonia", color: "#3a7bd5", capital: "Harju", capitalLonLat: [24.75, 59.44], gdp: 46, pop: 1.37, army: 7.7, navy: 0, tech: 0.90,
         gov: "republika parlamentarna", ideology: "demokracja", friends: ["LVA","LTU","FIN","POL","UKR","GBR"], rivals: ["RUS","BLR"] },
  LVA: { name: "Łotwa", color: "#9e2b3a", capital: "Riga", capitalLonLat: [24.11, 56.95], gdp: 47, pop: 1.86, army: 8, navy: 0, tech: 0.85,
         gov: "republika parlamentarna", ideology: "demokracja", friends: ["EST","LTU","POL","UKR","SWE"], rivals: ["RUS","BLR"] },
  LTU: { name: "Litwa", color: "#f2c12e", capital: "Vilniaus", capitalLonLat: [25.28, 54.69], gdp: 90, pop: 2.89, army: 23, navy: 0, tech: 0.90,
         gov: "republika semiprezydencka", ideology: "demokracja", friends: ["POL","LVA","EST","UKR","DEU","TWN"], rivals: ["RUS","BLR","CHN"] },

  // ---------------- Europa Środkowa ----------------
  POL: { name: "Polska", color: "#d6455a", capital: "Mazowieckie", capitalLonLat: [21.01, 52.23], gdp: 1040, pop: 37.4, army: 216, navy: 3, tech: 0.90,
         gov: "republika parlamentarna", ideology: "demokracja", friends: ["LTU","UKR","LVA","EST","FIN","SWE","CZE","DEU","GBR"], rivals: ["RUS","BLR"] },
  CZE: { name: "Czechy", color: "#3b6fb6", capital: "Prague", capitalLonLat: [14.42, 50.09], gdp: 380, pop: 10.9, army: 28, navy: 0, tech: 0.95,
         gov: "republika parlamentarna", ideology: "demokracja", friends: ["SVK","POL","DEU","AUT","UKR"], rivals: ["RUS"] },
  SVK: { name: "Słowacja", color: "#8a6dd6", capital: "Bratislavský", capitalLonLat: [17.11, 48.15], gdp: 160, pop: 5.4, army: 13, navy: 0, tech: 0.85,
         gov: "republika parlamentarna", ideology: "demokracja", friends: ["CZE","HUN","POL","AUT"], rivals: [] },
  HUN: { name: "Węgry", color: "#5aa65a", capital: "Budapest", capitalLonLat: [19.04, 47.50], gdp: 250, pop: 9.5, army: 32, navy: 0, tech: 0.85,
         gov: "republika parlamentarna", ideology: "demokracja", friends: ["SVK","SRB","TUR","CHN","AUT"], rivals: ["UKR","ROU"] },
  SVN: { name: "Słowenia", color: "#4fb3a9", capital: "Osrednjeslovenska", capitalLonLat: [14.51, 46.06], gdp: 80, pop: 2.1, army: 6.5, navy: 0, tech: 0.85,
         gov: "republika parlamentarna", ideology: "demokracja", friends: ["HRV","AUT","ITA"], rivals: [] },

  // ---------------- Bałkany ----------------
  HRV: { name: "Chorwacja", color: "#d9604a", capital: "Grad Zagreb", capitalLonLat: [15.98, 45.81], gdp: 105, pop: 3.8, army: 15, navy: 1, tech: 0.85,
         gov: "republika parlamentarna", ideology: "demokracja", friends: ["SVN","ITA","ALB","KOS","BIH"], rivals: ["SRB"] },
  BIH: { name: "Bośnia i Hercegowina", color: "#3f5fbf", capital: "Sarajevo", capitalLonLat: [18.41, 43.86], gdp: 32, pop: 3.2, army: 10.5, navy: 0, tech: 0.60,
         gov: "republika federalna", ideology: "demokracja", friends: ["TUR","HRV"], rivals: [] },
  SRB: { name: "Serbia", color: "#9d3c5c", capital: "Grad Beograd", capitalLonLat: [20.46, 44.81], gdp: 100, pop: 6.6, army: 28, navy: 0, tech: 0.75,
         gov: "republika parlamentarna", ideology: "demokracja", friends: ["RUS","CHN","HUN","MNE","BIH"], rivals: ["KOS","HRV","ALB"] },
  MNE: { name: "Czarnogóra", color: "#c78f3a", capital: "Podgorica", capitalLonLat: [19.26, 42.44], gdp: 9, pop: 0.62, army: 2.3, navy: 0, tech: 0.60,
         gov: "republika parlamentarna", ideology: "demokracja", friends: ["SRB","HRV","ALB"], rivals: [] },
  KOS: { name: "Kosowo", color: "#5b8de0", capital: "Pristina", capitalLonLat: [21.17, 42.66], gdp: 12, pop: 1.6, army: 2.5, navy: 0, tech: 0.55,
         gov: "republika parlamentarna", ideology: "demokracja", friends: ["ALB","TUR","GBR","DEU","HRV"], rivals: ["SRB"] },
  ALB: { name: "Albania", color: "#b8302c", capital: "Tiranë", capitalLonLat: [19.82, 41.33], gdp: 30, pop: 2.4, army: 6.6, navy: 0, tech: 0.60,
         gov: "republika parlamentarna", ideology: "demokracja", friends: ["KOS","ITA","TUR","GBR"], rivals: ["SRB"] },
  MKD: { name: "Macedonia Północna", color: "#f2a03a", capital: "Grad Skopje", capitalLonLat: [21.43, 42.00], gdp: 18, pop: 1.8, army: 8, navy: 0, tech: 0.60,
         gov: "republika parlamentarna", ideology: "demokracja", friends: ["ALB","SRB","TUR"], rivals: ["BGR"] },
  GRC: { name: "Grecja", color: "#6fb4f0", capital: "Attica", capitalLonLat: [23.73, 37.98], gdp: 280, pop: 10.3, army: 132, navy: 8, tech: 0.95,
         gov: "republika parlamentarna", ideology: "demokracja", friends: ["CYP","FRA","ISR","ITA","BGR"], rivals: ["TUR"] },
  BGR: { name: "Bułgaria", color: "#5f9e6e", capital: "Grad Sofiya", capitalLonLat: [23.32, 42.70], gdp: 125, pop: 6.4, army: 37, navy: 1, tech: 0.75,
         gov: "republika parlamentarna", ideology: "demokracja", friends: ["ROU","GRC"], rivals: ["MKD"] },
  ROU: { name: "Rumunia", color: "#2c5fa8", capital: "Bucharest", capitalLonLat: [26.10, 44.43], gdp: 430, pop: 19.0, army: 70, navy: 2, tech: 0.80,
         gov: "republika semiprezydencka", ideology: "demokracja", friends: ["MDA","POL","BGR","UKR","FRA"], rivals: ["RUS"] },
  MDA: { name: "Mołdawia", color: "#e27fb0", capital: "Chişinău", capitalLonLat: [28.86, 47.01], gdp: 20, pop: 2.4, army: 5, navy: 0, tech: 0.55,
         gov: "republika parlamentarna", ideology: "demokracja", friends: ["ROU","UKR","FRA"], rivals: ["RUS"] },
  CYP: { name: "Cypr", color: "#d98c3f", capital: "Nicosia", capitalLonLat: [33.36, 35.17], gdp: 40, pop: 1.3, army: 12, navy: 1, tech: 0.75,
         gov: "republika prezydencka", ideology: "demokracja", friends: ["GRC","ISR","FRA"], rivals: ["TUR"] },

  // ---------------- Europa Wschodnia ----------------
  UKR: { name: "Ukraina", color: "#f2d24c", capital: "Kiev City", capitalLonLat: [30.52, 50.45], gdp: 205, pop: 33.0, army: 880, navy: 1, tech: 0.85,
         gov: "republika semiprezydencka (stan wojenny)", ideology: "demokracja", friends: ["POL","GBR","LTU","LVA","EST","FIN","SWE","DNK","NOR","DEU","FRA","CZE","NLD","MDA","ROU"], rivals: ["RUS","BLR","IRN","PRK"] },
  BLR: { name: "Białoruś", color: "#b07a3c", capital: "Minsk", capitalLonLat: [27.56, 53.90], gdp: 80, pop: 9.1, army: 48, navy: 0, tech: 0.70,
         gov: "republika prezydencka (dyktatura)", ideology: "autorytaryzm", friends: ["RUS","CHN","PRK","IRN","KAZ"], rivals: ["POL","LTU","LVA","UKR"] },
  RUS: { name: "Rosja", color: "#4f7a3a", capital: "Moscow City", capitalLonLat: [37.62, 55.75], gdp: 2550, pop: 143.5, army: 1150, navy: 25, tech: 0.90,
         gov: "federacja prezydencka", ideology: "autorytaryzm", friends: ["BLR","CHN","PRK","IRN","KAZ","ARM","TJK","KGZ","SRB","MMR"], rivals: ["UKR","POL","LTU","LVA","EST","FIN","GBR","DEU","FRA","SWE","GEO","JPN","AZE","MDA"] },

  // ---------------- Kaukaz ----------------
  GEO: { name: "Gruzja", color: "#d65a8a", capital: "Tbilisi", capitalLonLat: [44.79, 41.72], gdp: 38, pop: 3.7, army: 20, navy: 0, tech: 0.70,
         gov: "republika parlamentarna", ideology: "demokracja", friends: ["AZE","TUR","ARM"], rivals: ["RUS"] },
  ARM: { name: "Armenia", color: "#e07b2e", capital: "Erevan", capitalLonLat: [44.51, 40.18], gdp: 28, pop: 3.0, army: 42, navy: 0, tech: 0.70,
         gov: "republika parlamentarna", ideology: "demokracja", friends: ["FRA","IND","IRN","GEO","GRC"], rivals: ["AZE","TUR"] },
  AZE: { name: "Azerbejdżan", color: "#38a3e0", capital: "Baku", capitalLonLat: [49.87, 40.41], gdp: 80, pop: 10.2, army: 64, navy: 1, tech: 0.75,
         gov: "republika prezydencka", ideology: "autorytaryzm", friends: ["TUR","PAK","ISR","GEO","UZB","KAZ"], rivals: ["ARM","RUS","IRN"] },

  // ---------------- Bliski Wschód ----------------
  TUR: { name: "Turcja", color: "#b8432f", capital: "Ankara", capitalLonLat: [32.85, 39.93], gdp: 1580, pop: 86.5, army: 355, navy: 10, tech: 0.95,
         gov: "republika prezydencka", ideology: "autorytaryzm", friends: ["AZE","PAK","QAT","HUN","SYR","BIH","ALB","KOS","UZB","KAZ"], rivals: ["ISR","GRC","CYP","ARM"] },
  ISR: { name: "Izrael", color: "#7aa6f5", capital: "Jerusalem", capitalLonLat: [35.21, 31.77], gdp: 610, pop: 10.1, army: 170, navy: 3, tech: 1.15,
         gov: "republika parlamentarna", ideology: "demokracja", friends: ["DEU","ARE","IND","AZE","GRC","CYP","BHR"], rivals: ["IRN","PSX","LBN","TUR","YEM","QAT"] },
  PSX: { name: "Palestyna", color: "#3a9a4e", capital: "West Bank", capitalLonLat: [35.20, 31.90], gdp: 15, pop: 5.5, army: 20, navy: 0, tech: 0.45,
         gov: "autonomia (Autonomia Palestyńska / Hamas w Strefie Gazy)", ideology: "autorytaryzm", friends: ["JOR","QAT","TUR","SAU","IRN"], rivals: ["ISR"] },
  LBN: { name: "Liban", color: "#e8d9a8", capital: "Beirut", capitalLonLat: [35.50, 33.89], gdp: 25, pop: 5.8, army: 60, navy: 0, tech: 0.55,
         gov: "republika parlamentarna (wyznaniowa)", ideology: "demokracja", friends: ["FRA","SAU","QAT"], rivals: ["ISR"] },
  SYR: { name: "Syria", color: "#7f8f4a", capital: "Damascus", capitalLonLat: [36.29, 33.51], gdp: 25, pop: 24.5, army: 60, navy: 0, tech: 0.50,
         gov: "rząd tymczasowy (republika prezydencka)", ideology: "autorytaryzm", friends: ["TUR","SAU","QAT","JOR"], rivals: ["ISR","IRN"] },
  JOR: { name: "Jordania", color: "#c45a5a", capital: "Amman", capitalLonLat: [35.93, 31.95], gdp: 56, pop: 11.6, army: 100, navy: 0, tech: 0.75,
         gov: "monarchia konstytucyjna", ideology: "monarchia", friends: ["SAU","ARE","PSX","GBR"], rivals: ["IRN"] },
  IRQ: { name: "Irak", color: "#a77d3e", capital: "Baghdad", capitalLonLat: [44.37, 33.31], gdp: 270, pop: 47.0, army: 190, navy: 0, tech: 0.60,
         gov: "republika parlamentarna (federalna)", ideology: "demokracja", friends: ["IRN","JOR","SAU"], rivals: ["ISR"] },
  IRN: { name: "Iran", color: "#4fae86", capital: "Tehran", capitalLonLat: [51.39, 35.69], gdp: 360, pop: 92.0, army: 610, navy: 6, tech: 0.70,
         gov: "republika islamska", ideology: "teokracja", friends: ["RUS","CHN","PRK","IRQ","YEM","BLR","ARM","TJK"], rivals: ["ISR","SAU","AZE","GBR","ARE","BHR"] },
  SAU: { name: "Arabia Saudyjska", color: "#1f7a42", capital: "Ar Riyad", capitalLonLat: [46.72, 24.69], gdp: 1300, pop: 35.0, army: 257, navy: 4, tech: 0.85,
         gov: "monarchia absolutna", ideology: "monarchia", friends: ["ARE","BHR","KWT","PAK","JOR","QAT","OMN","SYR"], rivals: ["IRN","YEM"] },
  KWT: { name: "Kuwejt", color: "#e0e0e0", capital: "Al Kuwayt", capitalLonLat: [47.98, 29.38], gdp: 165, pop: 5.0, army: 17.5, navy: 1, tech: 0.75,
         gov: "monarchia (emirat)", ideology: "monarchia", friends: ["SAU","ARE","BHR","QAT","OMN","GBR"], rivals: ["IRQ"] },
  BHR: { name: "Bahrajn", color: "#f0a0a8", capital: "Capital", capitalLonLat: [50.59, 26.23], gdp: 49, pop: 1.6, army: 8, navy: 1, tech: 0.75,
         gov: "monarchia konstytucyjna", ideology: "monarchia", friends: ["SAU","ARE","KWT","ISR","GBR"], rivals: ["IRN"] },
  QAT: { name: "Katar", color: "#a8285a", capital: "Ad Dawhah", capitalLonLat: [51.53, 25.29], gdp: 220, pop: 3.1, army: 17, navy: 1, tech: 0.80,
         gov: "monarchia absolutna (emirat)", ideology: "monarchia", friends: ["TUR","SAU","KWT","OMN","PSX","FRA"], rivals: ["ISR"] },
  ARE: { name: "ZEA", color: "#c9a14a", capital: "Abu Dhabi", capitalLonLat: [54.37, 24.45], gdp: 570, pop: 11.3, army: 63, navy: 2, tech: 0.90,
         gov: "federacja monarchii (emiratów)", ideology: "monarchia", friends: ["SAU","BHR","ISR","IND","FRA","KWT"], rivals: ["IRN"] },
  OMN: { name: "Oman", color: "#c43c3c", capital: "Muscat", capitalLonLat: [58.41, 23.59], gdp: 110, pop: 5.3, army: 43, navy: 2, tech: 0.75,
         gov: "monarchia absolutna (sułtanat)", ideology: "monarchia", friends: ["SAU","QAT","KWT","GBR","IND","IRN"], rivals: [] },
  YEM: { name: "Jemen", color: "#7a6a5a", capital: "Amanat Al Asimah", capitalLonLat: [44.21, 15.35], gdp: 18, pop: 41.0, army: 40, navy: 0, tech: 0.45,
         gov: "państwo podzielone (wojna domowa)", ideology: "autorytaryzm", friends: ["IRN"], rivals: ["SAU","ISR","ARE"] },

  // ---------------- Azja Centralna ----------------
  KAZ: { name: "Kazachstan", color: "#48b0d6", capital: "Astana", capitalLonLat: [71.43, 51.13], gdp: 300, pop: 20.6, army: 39, navy: 1, tech: 0.70,
         gov: "republika prezydencka", ideology: "autorytaryzm", friends: ["RUS","CHN","UZB","KGZ","TUR","AZE"], rivals: [] },
  UZB: { name: "Uzbekistan", color: "#59c2a8", capital: "Tashkent", capitalLonLat: [69.24, 41.31], gdp: 130, pop: 37.5, army: 48, navy: 0, tech: 0.65,
         gov: "republika prezydencka", ideology: "autorytaryzm", friends: ["KAZ","TUR","RUS","CHN","KGZ","TJK","AZE"], rivals: [] },
  TKM: { name: "Turkmenistan", color: "#3c8a3c", capital: "Ashgabat", capitalLonLat: [58.38, 37.95], gdp: 85, pop: 7.3, army: 36, navy: 0, tech: 0.55,
         gov: "republika prezydencka (dyktatura)", ideology: "autorytaryzm", friends: ["TUR","CHN"], rivals: [] },
  KGZ: { name: "Kirgistan", color: "#d97bc8", capital: "Bishkek", capitalLonLat: [74.59, 42.87], gdp: 20, pop: 7.3, army: 11, navy: 0, tech: 0.55,
         gov: "republika prezydencka", ideology: "autorytaryzm", friends: ["RUS","KAZ","UZB","CHN","TJK"], rivals: [] },
  TJK: { name: "Tadżykistan", color: "#e0b04a", capital: "Dushanbe", capitalLonLat: [68.79, 38.56], gdp: 16, pop: 10.6, army: 9, navy: 0, tech: 0.50,
         gov: "republika prezydencka", ideology: "autorytaryzm", friends: ["RUS","CHN","IRN","KGZ","UZB"], rivals: ["AFG"] },
  AFG: { name: "Afganistan", color: "#d8d2c0", capital: "Kabul", capitalLonLat: [69.17, 34.53], gdp: 17, pop: 43.0, army: 150, navy: 0, tech: 0.45,
         gov: "emirat islamski (talibowie)", ideology: "teokracja", friends: ["CHN","RUS","UZB","QAT"], rivals: ["PAK","TJK"] },
  MNG: { name: "Mongolia", color: "#4a6fc9", capital: "Ulaanbaatar", capitalLonLat: [106.91, 47.92], gdp: 25, pop: 3.5, army: 9, navy: 0, tech: 0.60,
         gov: "republika parlamentarna", ideology: "demokracja", friends: ["RUS","CHN","JPN","KOR"], rivals: [] },

  // ---------------- Azja Południowa ----------------
  PAK: { name: "Pakistan", color: "#1e6e3a", capital: "F.C.T.", capitalLonLat: [73.05, 33.69], gdp: 410, pop: 253.0, army: 660, navy: 5, tech: 0.75,
         gov: "republika parlamentarna (federalna)", ideology: "demokracja", friends: ["CHN","SAU","TUR","AZE","QAT","ARE"], rivals: ["IND","AFG"] },
  IND: { name: "Indie", color: "#f39c38", capital: "Delhi", capitalLonLat: [77.21, 28.61], gdp: 4500, pop: 1470.0, army: 1475, navy: 20, tech: 0.85,
         gov: "republika parlamentarna (federalna)", ideology: "demokracja", friends: ["RUS","FRA","JPN","ARE","ISR","BTN","ARM","VNM","SAU","NPL"], rivals: ["PAK","CHN"] },
  NPL: { name: "Nepal", color: "#c94a5a", capital: "Bagmati", capitalLonLat: [85.32, 27.71], gdp: 47, pop: 30.0, army: 96, navy: 0, tech: 0.50,
         gov: "republika parlamentarna (federalna)", ideology: "demokracja", friends: ["IND","CHN"], rivals: [] },
  BTN: { name: "Bhutan", color: "#e8d14a", capital: "Thimphu", capitalLonLat: [89.64, 27.47], gdp: 3.6, pop: 0.79, army: 8, navy: 0, tech: 0.50,
         gov: "monarchia konstytucyjna", ideology: "monarchia", friends: ["IND"], rivals: [] },
  BGD: { name: "Bangladesz", color: "#2e9e5a", capital: "Dhaka", capitalLonLat: [90.41, 23.81], gdp: 500, pop: 175.0, army: 163, navy: 3, tech: 0.60,
         gov: "republika parlamentarna (rząd tymczasowy)", ideology: "demokracja", friends: ["CHN","PAK","JPN","TUR"], rivals: ["MMR"] },
  LKA: { name: "Sri Lanka", color: "#9b2d3c", capital: "Colombo", capitalLonLat: [79.86, 6.93], gdp: 100, pop: 22.0, army: 190, navy: 1, tech: 0.60,
         gov: "republika prezydencka", ideology: "demokracja", friends: ["IND","CHN","JPN"], rivals: [] },
  MDV: { name: "Malediwy", color: "#c94040", capital: "Male", capitalLonLat: [73.51, 4.18], gdp: 7.5, pop: 0.53, army: 4, navy: 0, tech: 0.50,
         gov: "republika prezydencka", ideology: "demokracja", friends: ["CHN","TUR","IND"], rivals: [] },

  // ---------------- Azja Południowo-Wschodnia ----------------
  MMR: { name: "Mjanma", color: "#e3dc5a", capital: "Mandalay", capitalLonLat: [96.13, 19.75], gdp: 65, pop: 55.0, army: 150, navy: 1, tech: 0.50,
         gov: "junta wojskowa", ideology: "autorytaryzm", friends: ["CHN","RUS"], rivals: ["BGD"] },
  THA: { name: "Tajlandia", color: "#5a6ad0", capital: "Bangkok Metropolis", capitalLonLat: [100.50, 13.76], gdp: 560, pop: 71.6, army: 360, navy: 5, tech: 0.80,
         gov: "monarchia konstytucyjna", ideology: "monarchia", friends: ["JPN","CHN","LAO","MYS","SGP"], rivals: ["KHM"] },
  LAO: { name: "Laos", color: "#6ec08c", capital: "Vientiane", capitalLonLat: [102.63, 17.98], gdp: 16, pop: 7.8, army: 29, navy: 0, tech: 0.50,
         gov: "republika ludowa (jednopartyjna)", ideology: "komunizm", friends: ["VNM","CHN","THA"], rivals: [] },
  KHM: { name: "Kambodża", color: "#a64fa0", capital: "Phnom Penh", capitalLonLat: [104.92, 11.56], gdp: 50, pop: 17.8, army: 124, navy: 0, tech: 0.50,
         gov: "monarchia konstytucyjna (dominacja jednej partii)", ideology: "autorytaryzm", friends: ["CHN","VNM","LAO"], rivals: ["THA"] },
  VNM: { name: "Wietnam", color: "#e8a93a", capital: "Ha Noi", capitalLonLat: [105.85, 21.03], gdp: 510, pop: 101.5, army: 450, navy: 4, tech: 0.75,
         gov: "republika socjalistyczna (jednopartyjna)", ideology: "komunizm", friends: ["LAO","KHM","RUS","IND","JPN","KOR"], rivals: ["CHN"] },
  MYS: { name: "Malezja", color: "#3aa0c8", capital: "Kuala Lumpur", capitalLonLat: [101.69, 3.14], gdp: 470, pop: 34.5, army: 113, navy: 3, tech: 0.75,
         gov: "monarchia konstytucyjna (federalna)", ideology: "demokracja", friends: ["SGP","IDN","BRN","THA","TUR"], rivals: [] },
  SGP: { name: "Singapur", color: "#e04878", capital: "Central Singapore", capitalLonLat: [103.82, 1.35], gdp: 580, pop: 6.1, army: 51, navy: 3, tech: 1.05,
         gov: "republika parlamentarna", ideology: "demokracja", friends: ["MYS","IDN","JPN","THA","BRN"], rivals: [] },
  BRN: { name: "Brunei", color: "#f2e05a", capital: "Brunei and Muara", capitalLonLat: [114.94, 4.89], gdp: 16, pop: 0.46, army: 7, navy: 0, tech: 0.65,
         gov: "monarchia absolutna (sułtanat)", ideology: "monarchia", friends: ["MYS","SGP","GBR"], rivals: [] },
  IDN: { name: "Indonezja", color: "#b03030", capital: "Jakarta Raya", capitalLonLat: [106.85, -6.21], gdp: 1500, pop: 285.0, army: 404, navy: 8, tech: 0.70,
         gov: "republika prezydencka", ideology: "demokracja", friends: ["MYS","SGP","TLS","JPN","TUR"], rivals: [] },
  TLS: { name: "Timor Wschodni", color: "#d97a2a", capital: "Dili", capitalLonLat: [125.57, -8.56], gdp: 2.2, pop: 1.4, army: 2.3, navy: 0, tech: 0.45,
         gov: "republika semiprezydencka", ideology: "demokracja", friends: ["IDN","PRT"], rivals: [] },
  PHL: { name: "Filipiny", color: "#4a7ae0", capital: "Metropolitan Manila", capitalLonLat: [120.98, 14.60], gdp: 500, pop: 116.0, army: 150, navy: 3, tech: 0.65,
         gov: "republika prezydencka", ideology: "demokracja", friends: ["JPN","KOR","VNM","TWN"], rivals: ["CHN"] },

  // ---------------- Azja Wschodnia ----------------
  CHN: { name: "Chiny", color: "#d0342c", capital: "Beijing", capitalLonLat: [116.40, 39.90], gdp: 20600, pop: 1408.0, army: 2035, navy: 55, tech: 1.00,
         gov: "republika ludowa (jednopartyjna)", ideology: "komunizm", friends: ["RUS","PAK","PRK","IRN","KHM","LAO","BLR","MMR","KAZ","SRB"], rivals: ["TWN","JPN","IND","PHL"] },
  TWN: { name: "Tajwan", color: "#3fc0c0", capital: "Taipei City", capitalLonLat: [121.56, 25.04], gdp: 880, pop: 23.3, army: 169, navy: 6, tech: 1.05,
         gov: "republika semiprezydencka", ideology: "demokracja", friends: ["JPN","PHL","LTU","KOR"], rivals: ["CHN"] },
  JPN: { name: "Japonia", color: "#f2c9d0", capital: "Tokyo", capitalLonLat: [139.69, 35.69], gdp: 4300, pop: 123.0, army: 247, navy: 22, tech: 1.12,
         gov: "monarchia parlamentarna", ideology: "demokracja", friends: ["TWN","PHL","KOR","GBR","IND","VNM","UKR"], rivals: ["CHN","PRK","RUS"] },
  KOR: { name: "Korea Południowa", color: "#4f7ff0", capital: "Seoul", capitalLonLat: [126.98, 37.57], gdp: 1900, pop: 51.6, army: 450, navy: 15, tech: 1.10,
         gov: "republika prezydencka", ideology: "demokracja", friends: ["JPN","POL","TWN","PHL","VNM"], rivals: ["PRK"] },
  PRK: { name: "Korea Północna", color: "#8a2a52", capital: "P'yŏngyang", capitalLonLat: [125.76, 39.04], gdp: 30, pop: 26.5, army: 1280, navy: 4, tech: 0.55,
         gov: "republika ludowa (dyktatura dynastyczna)", ideology: "komunizm", friends: ["RUS","CHN","IRN","BLR"], rivals: ["KOR","JPN","UKR"] },
  // ---------------- Afryka Północna ----------------
  EGY: { name: "Egipt", color: "#bc42bc", capital: "Al Qahirah", capitalLonLat: [31.24, 30.04], gdp: 400, pop: 116, army: 440, navy: 9, tech: 0.75,
         gov: "republika prezydencka", ideology: "autorytaryzm", friends: ["SAU","ARE","GRC","CYP","FRA","ERI","SOM"], rivals: ["ETH"] },
  LBY: { name: "Libia", color: "#4273bc", capital: "Tripoli", capitalLonLat: [13.19, 32.89], gdp: 50, pop: 7.4, army: 30, navy: 1, tech: 0.50,
         gov: "rząd tymczasowy (kraj podzielony)", ideology: "autorytaryzm", friends: ["TUR","EGY"], rivals: [] },
  TUN: { name: "Tunezja", color: "#bc42b0", capital: "Tunis", capitalLonLat: [10.18, 36.81], gdp: 55, pop: 12.3, army: 36, navy: 1, tech: 0.60,
         gov: "republika prezydencka", ideology: "autorytaryzm", friends: ["DZA","FRA","ITA"], rivals: [] },
  DZA: { name: "Algieria", color: "#c98787", capital: "Alger", capitalLonLat: [3.06, 36.75], gdp: 280, pop: 47.4, army: 140, navy: 5, tech: 0.75,
         gov: "republika prezydencka", ideology: "autorytaryzm", friends: ["RUS","CHN","TUN"], rivals: ["MAR","MLI"] },
  MAR: { name: "Maroko", color: "#439d79", capital: "Rabat - Salé - Zemmour - Zaer", capitalLonLat: [-6.84, 34.02], gdp: 175, pop: 38.4, army: 196, navy: 3, tech: 0.75,
         gov: "monarchia konstytucyjna", ideology: "monarchia", friends: ["FRA","ESP","ARE","SAU","ISR","SEN","CIV"], rivals: ["DZA"] },
  MRT: { name: "Mauretania", color: "#55439d", capital: "Nouakchott", capitalLonLat: [-15.98, 18.08], gdp: 12, pop: 5.3, army: 16, navy: 1, tech: 0.50,
         gov: "republika prezydencka", ideology: "autorytaryzm", friends: ["SEN","MAR"], rivals: [] },
  SDN: { name: "Sudan", color: "#bc7f42", capital: "Khartoum", capitalLonLat: [32.53, 15.59], gdp: 35, pop: 51, army: 100, navy: 1, tech: 0.50,
         gov: "junta wojskowa (wojna domowa)", ideology: "autorytaryzm", friends: ["EGY","SAU","ERI","TUR"], rivals: ["ARE","TCD"] },
  SDS: { name: "Sudan Południowy", color: "#67bc42", capital: "Central Equatoria", capitalLonLat: [31.58, 4.85], gdp: 6, pop: 12, army: 185, navy: 0, tech: 0.40,
         gov: "republika prezydencka", ideology: "autorytaryzm", friends: ["UGA","KEN"], rivals: [] },
  // ---------------- Afryka Zachodnia ----------------
  SEN: { name: "Senegal", color: "#87c9bc", capital: "Dakar", capitalLonLat: [-17.45, 14.69], gdp: 35, pop: 18.9, army: 14, navy: 1, tech: 0.60,
         gov: "republika prezydencka", ideology: "demokracja", friends: ["FRA","GMB","MAR","MRT"], rivals: [] },
  GMB: { name: "Gambia", color: "#8166c0", capital: "Banjul", capitalLonLat: [-16.58, 13.45], gdp: 2.6, pop: 2.9, army: 1, navy: 0, tech: 0.45,
         gov: "republika prezydencka", ideology: "demokracja", friends: ["SEN"], rivals: [] },
  GNB: { name: "Gwinea Bissau", color: "#bc5a42", capital: "Bissau", capitalLonLat: [-15.6, 11.86], gdp: 2.3, pop: 2.2, army: 4.5, navy: 0, tech: 0.40,
         gov: "republika semiprezydencka", ideology: "autorytaryzm", friends: ["SEN"], rivals: [] },
  GIN: { name: "Gwinea", color: "#b587c9", capital: "Conakry", capitalLonLat: [-13.71, 9.51], gdp: 30, pop: 15, army: 10, navy: 0, tech: 0.45,
         gov: "junta wojskowa", ideology: "autorytaryzm", friends: ["MLI","BFA"], rivals: [] },
  SLE: { name: "Sierra Leone", color: "#9d6743", capital: "Western", capitalLonLat: [-13.23, 8.48], gdp: 5, pop: 8.9, army: 8.5, navy: 0, tech: 0.45,
         gov: "republika prezydencka", ideology: "demokracja", friends: ["LBR","GBR"], rivals: [] },
  LBR: { name: "Liberia", color: "#97bc42", capital: "Montserrado", capitalLonLat: [-10.80, 6.30], gdp: 5, pop: 5.6, army: 2, navy: 0, tech: 0.40,
         gov: "republika prezydencka", ideology: "demokracja", friends: ["SLE"], rivals: [] },
  CIV: { name: "Wybrzeże Kości Słoniowej", color: "#439d9d", capital: "Lacs", capitalLonLat: [-5.28, 6.82], gdp: 95, pop: 32, army: 27, navy: 1, tech: 0.55,
         gov: "republika prezydencka", ideology: "demokracja", friends: ["FRA","SEN","GHA","MAR"], rivals: ["BFA"] },
  MLI: { name: "Mali", color: "#bcbc42", capital: "Bamako", capitalLonLat: [-8.0, 12.64], gdp: 23, pop: 24.5, army: 40, navy: 0, tech: 0.45,
         gov: "junta wojskowa", ideology: "autorytaryzm", friends: ["RUS","BFA","NER","GIN"], rivals: ["FRA","DZA","CIV"] },
  BFA: { name: "Burkina Faso", color: "#bc427f", capital: "Centre", capitalLonLat: [-1.52, 12.37], gdp: 24, pop: 24, army: 12, navy: 0, tech: 0.45,
         gov: "junta wojskowa", ideology: "autorytaryzm", friends: ["RUS","MLI","NER","GIN"], rivals: ["FRA","CIV"] },
  NER: { name: "Niger", color: "#42bca4", capital: "Niamey", capitalLonLat: [2.11, 13.51], gdp: 21, pop: 28, army: 33, navy: 0, tech: 0.45,
         gov: "junta wojskowa", ideology: "autorytaryzm", friends: ["RUS","MLI","BFA","TUR"], rivals: ["FRA","BEN"] },
  GHA: { name: "Ghana", color: "#bc9742", capital: "Greater Accra", capitalLonLat: [-0.19, 5.60], gdp: 88, pop: 35, army: 16, navy: 1, tech: 0.55,
         gov: "republika prezydencka", ideology: "demokracja", friends: ["NGA","CIV","TGO","GBR"], rivals: [] },
  TGO: { name: "Togo", color: "#42bcbc", capital: "Maritime", capitalLonLat: [1.23, 6.13], gdp: 11, pop: 9.5, army: 9, navy: 0, tech: 0.45,
         gov: "republika parlamentarna", ideology: "autorytaryzm", friends: ["GHA","BEN"], rivals: [] },
  BEN: { name: "Benin", color: "#42bc42", capital: "Ouémé", capitalLonLat: [2.63, 6.50], gdp: 23, pop: 14.5, army: 12, navy: 0, tech: 0.45,
         gov: "republika prezydencka", ideology: "demokracja", friends: ["NGA","TGO","FRA"], rivals: ["NER"] },
  NGA: { name: "Nigeria", color: "#425abc", capital: "Federal Capital Territory", capitalLonLat: [7.49, 9.06], gdp: 310, pop: 236, army: 143, navy: 5, tech: 0.65,
         gov: "republika federalna (prezydencka)", ideology: "demokracja", friends: ["GHA","BEN","CMR","GBR"], rivals: [] },
  CPV: { name: "Republika Zielonego Przylądka", color: "#c9a187", capital: "Santiago", capitalLonLat: [-23.51, 14.93], gdp: 3, pop: 0.53, army: 1, navy: 0, tech: 0.50,
         gov: "republika parlamentarna", ideology: "demokracja", friends: ["PRT","SEN"], rivals: [] },
  // ---------------- Afryka Środkowa ----------------
  CMR: { name: "Kamerun", color: "#87bcc9", capital: "Centre", capitalLonLat: [11.52, 3.87], gdp: 55, pop: 30, army: 25, navy: 1, tech: 0.50,
         gov: "republika prezydencka", ideology: "autorytaryzm", friends: ["FRA","NGA","TCD","GAB"], rivals: [] },
  TCD: { name: "Czad", color: "#bc4273", capital: "Ville de N'Djamena", capitalLonLat: [15.04, 12.13], gdp: 19, pop: 20.3, army: 33, navy: 0, tech: 0.50,
         gov: "republika prezydencka (władza wojskowa)", ideology: "autorytaryzm", friends: ["ARE","CMR","NER"], rivals: ["SDN"] },
  CAF: { name: "Republika Środkowoafrykańska", color: "#5a42bc", capital: "Bangui", capitalLonLat: [18.56, 4.36], gdp: 3, pop: 5.6, army: 9, navy: 0, tech: 0.40,
         gov: "republika prezydencka", ideology: "autorytaryzm", friends: ["RUS","RWA"], rivals: [] },
  GNQ: { name: "Gwinea Równikowa", color: "#42bc5a", capital: "Bioko Norte", capitalLonLat: [8.78, 3.75], gdp: 13, pop: 1.9, army: 1.5, navy: 0, tech: 0.45,
         gov: "republika prezydencka", ideology: "autorytaryzm", friends: ["CMR"], rivals: ["GAB"] },
  GAB: { name: "Gabon", color: "#9d5543", capital: "Estuaire", capitalLonLat: [9.45, 0.39], gdp: 22, pop: 2.5, army: 5, navy: 0, tech: 0.50,
         gov: "republika prezydencka", ideology: "autorytaryzm", friends: ["FRA","CMR"], rivals: ["GNQ"] },
  COG: { name: "Kongo", color: "#439d43", capital: "Brazzaville", capitalLonLat: [15.27, -4.27], gdp: 16, pop: 6.5, army: 10, navy: 0, tech: 0.45,
         gov: "republika prezydencka", ideology: "autorytaryzm", friends: ["COD","AGO","RUS"], rivals: [] },
  COD: { name: "DR Konga", color: "#bc4242", capital: "Kinshasa City", capitalLonLat: [15.31, -4.32], gdp: 80, pop: 112, army: 135, navy: 1, tech: 0.45,
         gov: "republika semiprezydencka", ideology: "autorytaryzm", friends: ["AGO","BDI","ZAF","COG"], rivals: ["RWA","UGA"] },
  STP: { name: "Wyspy Świętego Tomasza i Książęca", color: "#799d43", capital: "Água Grande", capitalLonLat: [6.73, 0.34], gdp: 0.8, pop: 0.24, army: 0.5, navy: 0, tech: 0.40,
         gov: "republika semiprezydencka", ideology: "demokracja", friends: ["PRT","AGO"], rivals: [] },
  AGO: { name: "Angola", color: "#8b42bc", capital: "Luanda", capitalLonLat: [13.23, -8.84], gdp: 90, pop: 39, army: 107, navy: 2, tech: 0.55,
         gov: "republika prezydencka", ideology: "autorytaryzm", friends: ["COD","CHN","ZAF","NAM"], rivals: [] },
  // ---------------- Afryka Wschodnia i Róg Afryki ----------------
  ETH: { name: "Etiopia", color: "#82439d", capital: "Addis Ababa", capitalLonLat: [38.74, 9.03], gdp: 140, pop: 135, army: 162, navy: 0, tech: 0.55,
         gov: "republika federalna (parlamentarna)", ideology: "autorytaryzm", friends: ["DJI","KEN","ARE","CHN"], rivals: ["ERI","EGY","SOM"] },
  ERI: { name: "Erytrea", color: "#42bc73", capital: "Maekel", capitalLonLat: [38.93, 15.32], gdp: 2.5, pop: 3.8, army: 200, navy: 1, tech: 0.40,
         gov: "republika jednopartyjna", ideology: "autorytaryzm", friends: ["EGY","SDN","SOM"], rivals: ["ETH"] },
  DJI: { name: "Dżibuti", color: "#bcb042", capital: "Djibouti", capitalLonLat: [43.15, 11.59], gdp: 4.5, pop: 1.2, army: 8, navy: 0, tech: 0.50,
         gov: "republika prezydencka", ideology: "autorytaryzm", friends: ["ETH","FRA","CHN"], rivals: [] },
  SOM: { name: "Somalia", color: "#42bc8b", capital: "Banaadir", capitalLonLat: [45.32, 2.05], gdp: 13, pop: 19.7, army: 15, navy: 0, tech: 0.40,
         gov: "republika federalna", ideology: "autorytaryzm", friends: ["TUR","EGY","QAT","ERI"], rivals: ["ETH"] },
  KEN: { name: "Kenia", color: "#4297bc", capital: "Nairobi", capitalLonLat: [36.82, -1.29], gdp: 135, pop: 57.5, army: 24, navy: 1, tech: 0.60,
         gov: "republika prezydencka", ideology: "demokracja", friends: ["UGA","TZA","ETH","GBR"], rivals: [] },
  UGA: { name: "Uganda", color: "#c066c0", capital: "Kampala", capitalLonLat: [32.58, 0.35], gdp: 60, pop: 51, army: 45, navy: 0, tech: 0.50,
         gov: "republika prezydencka", ideology: "autorytaryzm", friends: ["SDS","KEN","RWA"], rivals: ["COD"] },
  RWA: { name: "Rwanda", color: "#43799d", capital: "Kigali City", capitalLonLat: [30.06, -1.95], gdp: 15, pop: 14.6, army: 33, navy: 0, tech: 0.60,
         gov: "republika prezydencka", ideology: "autorytaryzm", friends: ["UGA","MOZ","CAF"], rivals: ["COD","BDI"] },
  BDI: { name: "Burundi", color: "#a442bc", capital: "Gitega", capitalLonLat: [29.93, -3.43], gdp: 3, pop: 14.4, army: 30, navy: 0, tech: 0.40,
         gov: "republika prezydencka", ideology: "autorytaryzm", friends: ["COD","TZA"], rivals: ["RWA"] },
  TZA: { name: "Tanzania", color: "#c9bc87", capital: "Dodoma", capitalLonLat: [35.74, -6.17], gdp: 90, pop: 70, army: 27, navy: 1, tech: 0.50,
         gov: "republika prezydencka", ideology: "autorytaryzm", friends: ["KEN","MOZ","BDI","CHN"], rivals: [] },
  SYC: { name: "Seszele", color: "#c987a8", capital: "English River", capitalLonLat: [55.45, -4.62], gdp: 2.3, pop: 0.13, army: 0.4, navy: 0, tech: 0.50,
         gov: "republika prezydencka", ideology: "demokracja", friends: ["IND","FRA","MUS"], rivals: [] },
  MUS: { name: "Mauritius", color: "#aec066", capital: "Port Louis", capitalLonLat: [57.50, -20.16], gdp: 16, pop: 1.26, army: 1, navy: 0, tech: 0.50,
         gov: "republika parlamentarna", ideology: "demokracja", friends: ["IND","FRA","SYC"], rivals: [] },
  COM: { name: "Komory", color: "#9d438b", capital: "Grande Comore", capitalLonLat: [43.26, -11.70], gdp: 1.6, pop: 0.9, army: 0.5, navy: 0, tech: 0.40,
         gov: "republika federalna (prezydencka)", ideology: "autorytaryzm", friends: ["FRA"], rivals: [] },
  MDG: { name: "Madagaskar", color: "#87a1c9", capital: "Antananarivo", capitalLonLat: [47.52, -18.91], gdp: 18, pop: 32.7, army: 13.5, navy: 0, tech: 0.40,
         gov: "junta wojskowa", ideology: "autorytaryzm", friends: ["FRA","MUS"], rivals: [] },
  // ---------------- Afryka Południowa ----------------
  ZMB: { name: "Zambia", color: "#428bbc", capital: "Lusaka", capitalLonLat: [28.28, -15.42], gdp: 28, pop: 21.9, army: 15, navy: 0, tech: 0.45,
         gov: "republika prezydencka", ideology: "demokracja", friends: ["ZWE","MWI","TZA"], rivals: [] },
  MWI: { name: "Malawi", color: "#6742bc", capital: "Lilongwe", capitalLonLat: [33.79, -13.96], gdp: 13, pop: 22, army: 10.7, navy: 0, tech: 0.40,
         gov: "republika prezydencka", ideology: "demokracja", friends: ["ZMB","TZA","MOZ"], rivals: [] },
  MOZ: { name: "Mozambik", color: "#9d435e", capital: "Maputo", capitalLonLat: [32.59, -25.97], gdp: 24, pop: 35.6, army: 11, navy: 0, tech: 0.40,
         gov: "republika prezydencka", ideology: "autorytaryzm", friends: ["RWA","ZAF","TZA"], rivals: [] },
  ZWE: { name: "Zimbabwe", color: "#7342bc", capital: "Harare", capitalLonLat: [31.05, -17.83], gdp: 35, pop: 17, army: 29, navy: 0, tech: 0.45,
         gov: "republika prezydencka", ideology: "autorytaryzm", friends: ["CHN","RUS","ZAF","ZMB"], rivals: [] },
  BWA: { name: "Botswana", color: "#c0669c", capital: "South-East", capitalLonLat: [25.91, -24.65], gdp: 20, pop: 2.6, army: 9, navy: 0, tech: 0.55,
         gov: "republika parlamentarna", ideology: "demokracja", friends: ["ZAF","NAM","ZMB"], rivals: [] },
  NAM: { name: "Namibia", color: "#bc6742", capital: "Khomas", capitalLonLat: [17.08, -22.56], gdp: 14, pop: 3.1, army: 9.9, navy: 0, tech: 0.50,
         gov: "republika prezydencka", ideology: "demokracja", friends: ["ZAF","AGO","BWA"], rivals: [] },
  ZAF: { name: "RPA", color: "#8dc987", capital: "Gauteng", capitalLonLat: [28.19, -25.75], gdp: 430, pop: 64, army: 74, navy: 3, tech: 0.80,
         gov: "republika parlamentarna", ideology: "demokracja", friends: ["NAM","BWA","MOZ","AGO","CHN","IND"], rivals: ["ISR"] },
  LSO: { name: "Lesotho", color: "#878dc9", capital: "Maseru", capitalLonLat: [27.48, -29.31], gdp: 2.3, pop: 2.4, army: 2, navy: 0, tech: 0.40,
         gov: "monarchia konstytucyjna", ideology: "demokracja", friends: ["ZAF"], rivals: [] },
  SWZ: { name: "Eswatini", color: "#424ebc", capital: "Hhohho", capitalLonLat: [31.14, -26.31], gdp: 5, pop: 1.25, army: 3, navy: 0, tech: 0.40,
         gov: "monarchia absolutna", ideology: "monarchia", friends: ["ZAF","TWN"], rivals: [] }
};

/*
 * Jednostki NE admin-0 z Europy/Azji, które nie są osobnymi państwami w grze — scalane do
 * wskazanego państwa (dla tools/build_map.py i WT.state). Niewymienione drobne obszary
 * sporne (Spratly, Scarborough, Terytoria Oceanu Indyjskiego) pomijamy.
 */
window.COUNTRY_ALIASES = {
  CYN: "CYP", CNM: "CYP", ESB: "CYP", WSB: "CYP",      // Cypr Pn., strefa buforowa ONZ, bazy brytyjskie
  HKG: "CHN", MAC: "CHN",                              // Hongkong, Makau
  KAB: "KAZ",                                          // Bajkonur
  KAS: "IND",                                          // Lodowiec Siachen
  GIB: "GBR", JEY: "GBR", GGY: "GBR", IMN: "GBR",      // Gibraltar, Jersey, Guernsey, Wyspa Man
  ALD: "FIN",                                          // Wyspy Alandzkie
  FRO: "DNK",                                          // Wyspy Owcze
  SAH: "MAR",                                          // Sahara Zachodnia (de facto Maroko)
  SOL: "SOM",                                          // Somaliland
  BRT: "EGY"                                           // Bir Tawil
};

// Trwające wojny 1.01.2026 (włączane opcją "Trwające konflikty 2026" w menu).
window.START_WARS = [["RUS", "UKR"], ["ISR", "PSX"]];

// Punkty lon/lat → prowincje zawierające te punkty startują jako okupowane przez `by`.
// Krym + Sewastopol, obwód ługański i doniecki. Obwody zaporoski i chersoński pozostają ukraińskie.
window.START_OCCUPATIONS = [
  { by: "RUS", cc: "UKR", lonlat: [
    [34.10, 44.95],   // Symferopol (Republika Autonomiczna Krymu)
    [33.52, 44.60],   // Sewastopol
    [39.31, 48.57],   // Ługańsk (obwód ługański)
    [37.80, 48.02]    // Donieck (obwód doniecki)
  ] }
];
