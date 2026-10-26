#!/usr/bin/env python3
"""
Scenariusze historyczne (1385, 1914, 1939) -> data/scenarios.js (window.SCENARIOS).

Źródło granic: aourednik/historical-basemaps (GPL-3.0) — mapy świata 1400, 1914, 1938.
Każda prowincja gry dostaje państwo, które zajmuje największą część jej powierzchni; potem reguły
korygują znane błędy/uproszczenia danych i dostosowują rok (np. 1400 -> 1385, 1938 -> sierpień 1939).
Metadane (nazwy PL, stolice, armie, technologia) dla głównych państw są w tabelach poniżej,
pozostałe dostają wartości wyliczone z populacji.

Uruchomienie: python3 tools/build_scenarios.py   (wymaga data/map.js z polem "ct")
"""
import json
import math
import os
import urllib.request
from collections import Counter, defaultdict

import numpy as np
import shapely
from shapely.geometry import shape, Polygon, MultiPolygon
from shapely.strtree import STRtree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "tools", "cache")
MAP = os.path.join(ROOT, "data", "map.js")
OUT = os.path.join(ROOT, "data", "scenarios.js")
HB = "https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson/"

# ---------------------------------------------------------------- mapa gry

def load_map():
    txt = open(MAP, encoding="utf-8").read()
    return json.loads(txt[txt.index("{"):txt.rindex("}") + 1])


def make_unproject(m):
    s = m["width"] / (m["lonMax"] - m["lonMin"])
    # jak tools/build_map.py: współrzędna Millera w stopniach, skala s jednostek mapy na stopień
    miller = lambda lat: math.degrees(1.25 * math.log(math.tan(math.pi / 4 + 0.4 * math.radians(lat))))
    ytop = miller(m["latMax"])

    def unproj(x, y):
        lon = x / s + m["lonMin"]
        Y = math.radians(ytop - y / s)
        lat = math.degrees(2.5 * math.atan(math.exp(0.8 * Y)) - 0.625 * math.pi)
        return (lon - 360 if lon > 180 else lon), lat
    return unproj


def province_shapes(m):
    unproj = make_unproject(m)
    out = []
    for p in m["provinces"]:
        polys = []
        for r in p["poly"]:
            pts = [unproj(r[i], r[i + 1]) for i in range(0, len(r), 2)]
            if len(pts) >= 3:
                polys.append(shapely.make_valid(Polygon(pts)))
        g = shapely.make_valid(shapely.union_all(polys)) if polys else None
        lon, lat = unproj(p["cx"], p["cy"])
        out.append({"g": g, "lon": lon, "lat": lat})
    return out


def fetch_hist(year):
    path = os.path.join(CACHE, f"world_{year}.geojson")
    if not os.path.exists(path):
        urllib.request.urlretrieve(HB + f"world_{year}.geojson", path)
    d = json.load(open(path, encoding="utf-8"))
    geoms, props = [], []
    for f in d["features"]:
        g = shapely.make_valid(shape(f["geometry"]))
        geoms.append(g)
        props.append(f["properties"])
    return geoms, props


# ---------------------------------------------------------------- przypisanie prowincji

def assign(m, shapes, year, key_fn):
    geoms, props = fetch_hist(year)
    tree = STRtree(geoms)
    raw = []
    for i, s in enumerate(shapes):
        best, area = None, 0.0
        if s["g"] is not None:
            for j in tree.query(s["g"]):
                j = int(j)
                k = key_fn(props[j])
                if not k:
                    continue
                try:
                    a = s["g"].intersection(geoms[j]).area
                except shapely.errors.GEOSException:
                    a = s["g"].buffer(0).intersection(geoms[j].buffer(0)).area
                if a > area:
                    area, best = a, k
        raw.append(best)
    # luki (wybrzeża, morze w danych) -> najczęstszy właściciel sąsiadów
    for _ in range(12):
        changed = False
        for i, p in enumerate(m["provinces"]):
            if raw[i] is None:
                c = Counter(raw[n] for n in p["nb"] if raw[n])
                if c:
                    raw[i] = c.most_common(1)[0][0]; changed = True
        if not changed:
            break
    return raw


# ---------------------------------------------------------------- pomocnicze reguły

def P(m, i):
    return m["provinces"][i]


def in_names(m, i, *names):
    p = P(m, i)
    return any(n.lower() in (p["name"] + " " + p.get("name_en", "")).lower() for n in names)


# ================================================================ 1939
N1938 = {
    "Germany": "GER", "Poland": "POL", "USSR": "SOV", "France": "FRA", "United Kingdom": "GBR",
    "United Kingdom of Great Britain and Ireland": "GBR", "Italy": "ITA", "Empire of Japan": "JAP",
    "Chinese warlords": "CHN", "Turkey": "TUR", "Romania": "ROM", "Hungary": "HUN", "Yugoslavia": "YUG",
    "Bulgaria": "BUL", "Greece": "GRE", "Albania": "ITA", "Czechoslovakia": "CZE", "Lithuania": "LIT",
    "Latvia": "LAT", "Estonia": "EST", "Finland": "FIN", "Sweden": "SWE", "Norway": "NOR", "Denmark": "DEN",
    "Netherlands": "HOL", "Belgium": "BEL", "Luxembourg": "LUX", "Switzerland": "SWI", "Spain": "SPA",
    "Portugal": "POR", "Ireland": "IRE", "Iran": "PER", "Afghanistan": "AFG", "Saudi Arabia": "SAU",
    "Hejaz": "SAU", "Hail": "SAU", "Emirate of Bin Shal'an": "SAU", "Yemen": "YEM", "Egypt": "EGY",
    "Mongolia": "MON", "Tibet": "TIB", "Xinjiang": "XIN", "Siam": "SIA", "Nepal": "NEP", "Bhutan": "BHU",
    "Ethiopia": "ITA", "Liberia": "LIB", "Union of South Africa": "SAF", "Netherlands Indies": "HOL",
    "Belgium Congo": "BEL", "United States": "USA", "Iraq": "IRQ", "Tunisia": "FRA", "Libya": "ITA",
    "Sudan": "GBR", "Malawi": "GBR", "Togo": "FRA", "Burundi": "BEL", "Guinea-Bissau": "POR", "Israel": "GBR",
    "French Somaliland": "FRA", "Laos": "FRA", "Trucial Oman": "GBR", "Qatar": "GBR", "Gambia, The": "GBR",
    "Ceylon": "GBR", "Brunei": "GBR", "Iceland": "ICE", "Kuwait": "GBR", "Muscat and Oman": "OMA", "Andorra": "AND",
}


def key1938(pr):
    sub, name = pr.get("SUBJECTO"), pr.get("NAME")
    if name == "Muscat and Oman":
        return "OMA"
    if name in ("Mesopotamia (GB)",):
        return "IRQ"
    return N1938.get(sub) or N1938.get(name) or (sub or name)


def rules1939(m, owner):
    for i, p in enumerate(m["provinces"]):
        cc = p["cc"]
        if cc == "CZE": owner[i] = "GER"                 # Protektorat Czech i Moraw (III 1939)
        elif cc == "SVK": owner[i] = "SLO"               # Państwo słowackie
        elif cc == "AUT": owner[i] = "GER"
        elif cc == "ALB": owner[i] = "ITA"               # IV 1939
        elif cc == "LTU" and in_names(m, i, "Kłajpeda", "Klaip"): owner[i] = "GER"   # Kłajpeda (III 1939)
        elif cc == "UKR" and in_names(m, i, "zakarpack", "Zakarpat"): owner[i] = "HUN"
        elif cc in ("KHM", "VNM", "LAO"): owner[i] = "FRA"
        elif cc == "JOR" or cc == "ISR" or cc == "PSX": owner[i] = "GBR"           # mandaty
        elif cc == "IRQ": owner[i] = "IRQ"
        elif cc in ("SYR", "LBN"): owner[i] = "FRA"
        elif cc in ("MAR",) and owner[i] not in ("SPA",): owner[i] = "FRA"
        elif cc == "LBY": owner[i] = "ITA"
        elif cc in ("ETH", "ERI"): owner[i] = "ITA"
        elif cc == "SDN" or cc == "SDS": owner[i] = "GBR"
        elif cc == "MWI": owner[i] = "GBR"
        elif cc in ("RWA", "BDI"): owner[i] = "BEL"
        elif cc == "GNB": owner[i] = "POR"
        elif cc == "TGO": owner[i] = "FRA"
        elif cc == "SAU": owner[i] = "SAU"
        elif cc == "KOR" or cc == "PRK" or cc == "TWN": owner[i] = "JAP"
        elif cc == "PHL": owner[i] = "USA"
        elif cc == "MDA": owner[i] = "ROM"               # Besarabia
        elif cc == "CYP" or cc == "MLT": owner[i] = "GBR"
        elif cc == "DNK": owner[i] = "DEN"
        elif cc == "ISL": owner[i] = "ICE"
    return owner


# Japońska okupacja Chin (VIII 1939): prowincje Chin przybrzeżnych i doliny Jangcy — kontrolowane przez Japonię.
JAP_OCC_1939 = ["Pekin", "Tiencin", "Hebei", "Szantung", "Shanxi", "Jiangsu", "Szanghaj", "Anhui", "Hubei", "Guangdong",
                "Mongolia Wewnętrzna", "Zhejiang", "Henan", "Jiangxi", "Hajnan"]

META1939 = {
    "GER": ("III Rzesza", "#5b5f66", (13.40, 52.52), 2700, 50, 1.00, "autorytaryzm", "dyktatura nazistowska", "high", ["ITA", "JAP", "SLO"], ["POL", "FRA", "GBR", "SOV"]),
    "POL": ("Polska", "#d6455a", (21.01, 52.23), 1100, 4, 0.75, "autorytaryzm", "republika (rządy sanacji)", "mid", ["FRA", "GBR", "ROM"], ["GER", "SOV", "LIT"]),
    "SOV": ("ZSRR", "#a0302c", (37.62, 55.75), 2000, 22, 0.80, "komunizm", "państwo komunistyczne", "mid", ["MON"], ["GER", "POL", "JAP", "FIN"]),
    "FRA": ("Francja", "#3e6fd8", (2.35, 48.86), 900, 30, 0.90, "demokracja", "III Republika", "high", ["GBR", "POL", "CZE", "BEL"], ["GER", "ITA"]),
    "GBR": ("Wielka Brytania", "#c8364a", (-0.13, 51.51), 600, 60, 0.95, "demokracja", "monarchia parlamentarna", "high", ["FRA", "POL", "EGY", "IRQ"], ["GER", "ITA", "JAP"]),
    "ITA": ("Włochy", "#4caf50", (12.50, 41.90), 1200, 30, 0.75, "autorytaryzm", "monarchia faszystowska", "mid", ["GER", "ALB", "HUN"], ["FRA", "GBR", "YUG", "GRE"]),
    "JAP": ("Japonia", "#e6c84f", (139.69, 35.69), 1500, 55, 0.90, "autorytaryzm", "cesarstwo militarystyczne", "mid", ["GER"], ["CHN", "SOV", "GBR", "USA"]),
    "CHN": ("Chiny", "#e0603a", (106.55, 29.56), 1700, 2, 0.50, "autorytaryzm", "Republika Chińska (Kuomintang)", "low", ["SOV"], ["JAP"]),
    "TUR": ("Turcja", "#b8432f", (32.85, 39.93), 200, 6, 0.65, "autorytaryzm", "republika jednopartyjna", "low", ["GBR", "FRA"], ["ITA"]),
    "ROM": ("Rumunia", "#e8c547", (26.10, 44.43), 400, 3, 0.60, "autorytaryzm", "monarchia (dyktatura królewska)", "low", ["POL", "FRA"], ["HUN", "SOV", "BUL"]),
    "HUN": ("Węgry", "#7aa865", (19.04, 47.50), 120, 0, 0.65, "autorytaryzm", "regencja (Horthy)", "low", ["ITA", "GER", "POL"], ["ROM", "CZE", "YUG"]),
    "YUG": ("Jugosławia", "#6f7fc8", (20.46, 44.80), 160, 3, 0.55, "autorytaryzm", "monarchia", "low", ["FRA"], ["ITA", "HUN", "BUL"]),
    "BUL": ("Bułgaria", "#3f8f5f", (23.32, 42.70), 60, 1, 0.55, "autorytaryzm", "carstwo", "low", ["GER"], ["ROM", "YUG", "GRE"]),
    "GRE": ("Grecja", "#5aa0e0", (23.73, 37.98), 70, 4, 0.55, "autorytaryzm", "monarchia (reżim Metaksasa)", "low", ["GBR"], ["ITA", "BUL", "TUR"]),
    "SLO": ("Słowacja", "#9b6fd0", (17.11, 48.15), 40, 0, 0.55, "autorytaryzm", "republika (protektorat Rzeszy)", "low", ["GER"], ["HUN", "POL"]),
    "LIT": ("Litwa", "#e8c03a", (23.90, 54.90), 25, 0, 0.55, "autorytaryzm", "republika (Smetona)", "low", [], ["POL", "GER"]),
    "LAT": ("Łotwa", "#8a2f3c", (24.11, 56.95), 25, 1, 0.55, "autorytaryzm", "republika (Ulmanis)", "low", ["EST"], ["SOV"]),
    "EST": ("Estonia", "#3e7fd0", (24.75, 59.44), 16, 1, 0.55, "autorytaryzm", "republika", "low", ["LAT", "FIN"], ["SOV"]),
    "FIN": ("Finlandia", "#f0f0f0", (24.94, 60.17), 35, 2, 0.70, "demokracja", "republika", "mid", ["SWE", "EST"], ["SOV"]),
    "SWE": ("Szwecja", "#4a90d0", (18.07, 59.33), 90, 8, 0.75, "demokracja", "monarchia konstytucyjna", "high", ["FIN", "NOR", "DEN"], []),
    "NOR": ("Norwegia", "#b0505a", (10.75, 59.91), 20, 4, 0.65, "demokracja", "monarchia konstytucyjna", "high", ["SWE", "GBR"], []),
    "DEN": ("Dania", "#c0303f", (12.57, 55.68), 15, 3, 0.65, "demokracja", "monarchia konstytucyjna", "high", ["SWE", "NOR"], []),
    "HOL": ("Holandia", "#f08a24", (4.90, 52.37), 250, 12, 0.70, "demokracja", "monarchia konstytucyjna", "high", ["BEL", "GBR"], ["JAP"]),
    "BEL": ("Belgia", "#e3c64a", (4.35, 50.85), 100, 0, 0.70, "demokracja", "monarchia konstytucyjna", "high", ["FRA", "HOL"], ["GER"]),
    "SWI": ("Szwajcaria", "#d63b3b", (7.45, 46.95), 40, 0, 0.75, "demokracja", "konfederacja", "high", [], []),
    "SPA": ("Hiszpania", "#f2b632", (-3.70, 40.42), 400, 8, 0.65, "autorytaryzm", "dyktatura (Franco)", "mid", ["ITA", "GER", "POR"], ["FRA"]),
    "POR": ("Portugalia", "#2f8f5a", (-9.14, 38.72), 50, 4, 0.55, "autorytaryzm", "Estado Novo (Salazar)", "mid", ["GBR", "SPA"], []),
    "IRE": ("Irlandia", "#4cc26b", (-6.26, 53.35), 8, 0, 0.55, "demokracja", "republika (Éire)", "mid", [], ["GBR"]),
    "PER": ("Iran", "#3fa86a", (51.39, 35.69), 120, 1, 0.50, "autorytaryzm", "monarchia (Reza Szah)", "low", ["GER", "TUR"], ["GBR", "SOV"]),
    "AFG": ("Afganistan", "#8f7a55", (69.21, 34.56), 70, 0, 0.40, "monarchia", "królestwo", "low", [], []),
    "SAU": ("Arabia Saudyjska", "#2e8b57", (46.72, 24.69), 50, 0, 0.40, "monarchia", "monarchia absolutna", "low", ["GBR"], []),
    "IRQ": ("Irak", "#c8a24a", (44.36, 33.31), 25, 0, 0.45, "monarchia", "królestwo", "low", ["GBR"], []),
    "EGY": ("Egipt", "#d9b25f", (31.24, 30.04), 40, 1, 0.45, "monarchia", "królestwo", "low", ["GBR"], ["ITA"]),
    "YEM": ("Jemen", "#a0623c", (44.21, 15.35), 20, 0, 0.35, "monarchia", "imamat", "low", [], ["GBR"]),
    "OMA": ("Maskat i Oman", "#b04a3a", (58.59, 23.61), 5, 0, 0.35, "monarchia", "sułtanat", "low", ["GBR"], []),
    "MON": ("Mongolia", "#4f7fc8", (106.91, 47.92), 80, 0, 0.45, "komunizm", "republika ludowa", "low", ["SOV"], ["JAP"]),
    "TIB": ("Tybet", "#c9a96e", (91.11, 29.65), 10, 0, 0.30, "teokracja", "państwo dalajlamy", "low", [], []),
    "XIN": ("Sinciang", "#7a9f5a", (87.62, 43.83), 30, 0, 0.40, "autorytaryzm", "władza Sheng Shicaia", "low", ["SOV"], []),
    "SIA": ("Syjam", "#5fa8d9", (100.50, 13.75), 30, 1, 0.50, "autorytaryzm", "monarchia (rządy wojskowych)", "low", ["JAP"], ["FRA"]),
    "NEP": ("Nepal", "#c94f6a", (85.32, 27.71), 25, 0, 0.35, "monarchia", "królestwo (Ranowie)", "low", ["GBR"], []),
    "BHU": ("Bhutan", "#e08a3a", (89.64, 27.47), 3, 0, 0.30, "monarchia", "królestwo", "low", [], []),
    "LIB": ("Liberia", "#a85a9a", (-10.80, 6.30), 5, 0, 0.30, "demokracja", "republika", "low", [], []),
    "SAF": ("Związek Południowej Afryki", "#3f8f6a", (28.19, -25.75), 20, 1, 0.60, "demokracja", "dominium brytyjskie", "mid", ["GBR"], []),
    "USA": ("Stany Zjednoczone", "#3c6cb4", (120.98, 14.60), 20, 10, 0.85, "demokracja", "Filipiny (terytorium USA)", "high", ["GBR"], ["JAP"]),
    "LUX": ("Luksemburg", "#7fb3e0", (6.13, 49.61), 1, 0, 0.50, "demokracja", "wielkie księstwo", "high", [], []),
    "ICE": ("Islandia", "#8fb4ee", (-21.94, 64.15), 0, 0, 0.50, "demokracja", "królestwo w unii z Danią", "mid", ["DEN"], []),
    "AND": ("Andora", "#5f6fd0", (1.52, 42.51), 0, 0, 0.40, "demokracja", "współksięstwo", "mid", [], []),
    "CZE": ("Czechosłowacja", "#3d6fb0", (14.42, 50.08), 10, 0, 0.70, "demokracja", "republika", "mid", ["FRA"], ["GER"]),
}

# ================================================================ 1914
N1914 = {
    "Russia": "RUS", "German Empire": "GER", "Austro-Hungarian Empire": "AUH", "Ottoman Empire": "OTT",
    "United Kingdom of Great Britain and Ireland": "GBR", "United Kingdom": "GBR", "France": "FRA", "Italy": "ITA",
    "Spain": "SPA", "Portugal": "POR", "Netherlands": "HOL", "Netherlands Indies": "HOL", "Belgium": "BEL",
    "Denmark": "DEN", "Sweden": "SWE", "Norway": "NOR", "Switzerland": "SWI", "Greece": "GRE", "Serbia": "SER",
    "Montenegro": "MNT", "Bulgaria": "BUL", "Romania": "ROM", "Albania": "ALB", "Persia": "PER",
    "Afghanistan": "AFG", "Manchu Empire": "CHN", "Xinjiang": "CHN", "Empire of Japan": "JAP",
    "Rattanakosin Kingdom": "SIA", "Nepal": "NEP", "Bhutan": "BHU", "Abyssinia": "ETH", "Liberia": "LIB",
    "Morocco": "FRA", "Tunisia": "FRA", "Kamerun": "GER", "Togoland": "GER", "German South-West Africa": "GER",
    "Philippines": "USA", "Mongolia": "MON", "Tibet": "TIB", "Arabia (Nejd)": "NEJ", "Finland": "RUS",
    "Georgia": "RUS", "Armenia": "RUS", "Azerbaijan": "RUS", "Rio De Oro": "SPA", "Spanish Morocco": "SPA",
    "Portuguese Guinea": "POR", "Equatorial Guinea": "SPA", "Sierra Leone": "GBR", "Gambia, The": "GBR",
    "Malaya": "GBR", "Ceylon": "GBR", "Brunei": "GBR", "Uganda": "GBR", "Lesotho": "GBR", "Swaziland": "GBR",
    "Iceland": "DEN", "Malta": "GBR", "Kuwait": "GBR", "Qatar": "GBR", "Luxembourg": "LUX",
}


def key1914(pr):
    sub, name = pr.get("SUBJECTO"), pr.get("NAME")
    return N1914.get(name) or N1914.get(sub) or (sub or name)


def rules1914(m, owner):
    for i, p in enumerate(m["provinces"]):
        cc = p["cc"]
        if cc in ("KOR", "PRK", "TWN"): owner[i] = "JAP"
        elif cc in ("FIN", "GEO", "ARM", "AZE", "POL") and owner[i] not in ("GER", "AUH"): owner[i] = "RUS"
        elif cc in ("CYP", "EGY", "SDN", "SDS"): owner[i] = "GBR"
        elif cc == "LBY": owner[i] = "ITA"
        elif cc in ("BIH",): owner[i] = "AUH"
        elif cc in ("IRQ", "SYR", "LBN", "JOR", "ISR", "PSX"): owner[i] = "OTT"
    return owner


META1914 = {
    "RUS": ("Imperium Rosyjskie", "#3f6b3a", (30.32, 59.94), 1400, 30, 0.70, "monarchia", "samodzierżawie carskie", "mid", ["FRA", "SER"], ["GER", "AUH", "OTT"]),
    "GER": ("Cesarstwo Niemieckie", "#5b5f66", (13.40, 52.52), 800, 50, 0.95, "monarchia", "cesarstwo", "high", ["AUH", "OTT"], ["FRA", "RUS", "GBR"]),
    "AUH": ("Austro-Węgry", "#d8c070", (16.37, 48.21), 450, 15, 0.80, "monarchia", "monarchia dualistyczna", "mid", ["GER"], ["SER", "RUS", "ITA"]),
    "OTT": ("Imperium Osmańskie", "#b8432f", (28.98, 41.01), 250, 6, 0.55, "monarchia", "sułtanat (młodoturcy)", "low", ["GER"], ["RUS", "GRE", "BUL", "ITA"]),
    "GBR": ("Wielka Brytania", "#c8364a", (-0.13, 51.51), 250, 100, 0.95, "monarchia", "monarchia parlamentarna (imperium)", "high", ["FRA", "JAP"], ["GER"]),
    "FRA": ("Francja", "#3e6fd8", (2.35, 48.86), 900, 40, 0.90, "demokracja", "III Republika", "high", ["RUS", "GBR"], ["GER"]),
    "ITA": ("Włochy", "#4caf50", (12.50, 41.90), 300, 25, 0.75, "monarchia", "monarchia konstytucyjna", "mid", [], ["AUH", "OTT"]),
    "SPA": ("Hiszpania", "#f2b632", (-3.70, 40.42), 140, 6, 0.60, "monarchia", "monarchia konstytucyjna", "mid", [], []),
    "POR": ("Portugalia", "#2f8f5a", (-9.14, 38.72), 30, 3, 0.55, "demokracja", "republika", "mid", ["GBR"], []),
    "HOL": ("Holandia", "#f08a24", (4.90, 52.37), 80, 10, 0.70, "monarchia", "monarchia konstytucyjna", "high", [], []),
    "BEL": ("Belgia", "#e3c64a", (4.35, 50.85), 120, 0, 0.75, "monarchia", "monarchia konstytucyjna", "high", ["FRA"], ["GER"]),
    "DEN": ("Dania", "#c0303f", (12.57, 55.68), 15, 4, 0.65, "monarchia", "monarchia konstytucyjna", "high", [], []),
    "SWE": ("Szwecja", "#4a90d0", (18.07, 59.33), 60, 8, 0.75, "monarchia", "monarchia konstytucyjna", "high", [], ["RUS"]),
    "NOR": ("Norwegia", "#b0505a", (10.75, 59.91), 12, 3, 0.65, "monarchia", "monarchia konstytucyjna", "high", ["GBR"], []),
    "SWI": ("Szwajcaria", "#d63b3b", (7.45, 46.95), 30, 0, 0.75, "demokracja", "konfederacja", "high", [], []),
    "GRE": ("Grecja", "#5aa0e0", (23.73, 37.98), 60, 5, 0.60, "monarchia", "królestwo", "low", ["SER"], ["OTT", "BUL"]),
    "SER": ("Serbia", "#8a3a4a", (20.46, 44.80), 200, 0, 0.65, "monarchia", "królestwo", "low", ["RUS", "MNT", "GRE"], ["AUH", "BUL"]),
    "MNT": ("Czarnogóra", "#6f7fc8", (19.26, 42.44), 40, 0, 0.55, "monarchia", "królestwo", "low", ["SER", "RUS"], ["AUH"]),
    "BUL": ("Bułgaria", "#3f8f5f", (23.32, 42.70), 60, 1, 0.60, "monarchia", "carstwo", "low", ["GER"], ["SER", "GRE", "ROM"]),
    "ROM": ("Rumunia", "#e8c547", (26.10, 44.43), 100, 2, 0.60, "monarchia", "królestwo", "low", [], ["BUL", "AUH"]),
    "ALB": ("Albania", "#c0503a", (19.82, 41.33), 10, 0, 0.40, "monarchia", "księstwo", "low", [], ["SER", "GRE"]),
    "PER": ("Persja", "#3fa86a", (51.39, 35.69), 40, 0, 0.40, "monarchia", "monarchia (Kadżarowie)", "low", [], ["RUS"]),
    "AFG": ("Afganistan", "#8f7a55", (69.21, 34.56), 50, 0, 0.40, "monarchia", "emirat", "low", [], ["GBR"]),
    "CHN": ("Chiny", "#e0603a", (116.40, 39.90), 500, 4, 0.45, "autorytaryzm", "republika (Yuan Shikai)", "low", [], ["JAP"]),
    "JAP": ("Japonia", "#e6c84f", (139.69, 35.69), 300, 40, 0.85, "monarchia", "cesarstwo", "mid", ["GBR"], ["RUS", "CHN", "GER"]),
    "SIA": ("Syjam", "#5fa8d9", (100.50, 13.75), 20, 1, 0.45, "monarchia", "królestwo", "low", [], []),
    "NEP": ("Nepal", "#c94f6a", (85.32, 27.71), 30, 0, 0.35, "monarchia", "królestwo", "low", ["GBR"], []),
    "BHU": ("Bhutan", "#e08a3a", (89.64, 27.47), 3, 0, 0.30, "monarchia", "królestwo", "low", [], []),
    "ETH": ("Abisynia", "#6aa84f", (38.74, 9.03), 150, 0, 0.35, "monarchia", "cesarstwo", "low", [], ["ITA"]),
    "LIB": ("Liberia", "#a85a9a", (-10.80, 6.30), 3, 0, 0.30, "demokracja", "republika", "low", [], []),
    "USA": ("Stany Zjednoczone", "#3c6cb4", (120.98, 14.60), 15, 10, 0.85, "demokracja", "Filipiny (terytorium USA)", "high", [], ["JAP"]),
    "MON": ("Mongolia", "#4f7fc8", (106.91, 47.92), 10, 0, 0.35, "teokracja", "chanat (Bogd Chan)", "low", ["RUS"], ["CHN"]),
    "TIB": ("Tybet", "#c9a96e", (91.11, 29.65), 10, 0, 0.30, "teokracja", "państwo dalajlamy", "low", [], ["CHN"]),
    "NEJ": ("Nadżd", "#2e8b57", (46.72, 24.69), 20, 0, 0.35, "monarchia", "emirat Saudów", "low", ["GBR"], ["OTT"]),
    "LUX": ("Luksemburg", "#7fb3e0", (6.13, 49.61), 0, 0, 0.50, "monarchia", "wielkie księstwo", "high", [], []),
}

# ================================================================ 1385 (dane: 1400)
N1400 = {
    "Great Khanate": "YUA", "White Horde": "HOR", "Blue Horde": "HOR", "Chagatai Khanate": "MOG", "Tibet": "TIB",
    "Novgorod": "NOV", "Timurid Empire": "TIM", "Kalmar Union": "DEN", "Sultanate of Delhi": "DEL",
    "Poland-Lithuania": "LIT", "Mamluke Sultanate": "MAM", "Holy Roman Empire": "HRE", "Hafsid Caliphate": "HAF",
    "Kingdom of Hungary": "HUN", "France": "FRA", "English territory": "ENG", "Castile": "CAS", "Ethiopia": "ETH",
    "Shogun Japan (Kamakura)": "JAP", "Ottoman Empire": "OTT", "Bulgar Khanate": "BUL", "Seljuk Caliphate": "KAR",
    "Morocco": "MOR", "Khmer Empire": "KHM", "Ayutthaya": "AYU", "Sukhothai": "SUK", "Đại Việt": "DAI",
    "Teutonic Knights": "TEU", "Great Zimbabwe": "ZIM", "Kediri": "MAJ", "Srivijaya Empire": "MAL", "Yemen": "YEM",
    "Aragón": "ARA", "Byzantine Empire": "BYZ", "Makkura": "MAK", "Alwa": "ALW", "Merina Kingdom": "MER",
    "Madagascar": "MER", "Orissa": "ORI", "Muscat": "OMA", "Portugal": "POR", "Bosnia": "BOS", "Scotland": "SCO",
    "Benin": "BNN", "Champa": "CHA", "Chola Empire": "VIJ", "Principality of Wallachia": "WAL", "Sicily": "SIC",
    "Beylik of Aydin": "AYD", "Aceh": "ACE", "Pandya state": "VIJ", "Moldova": "MOL", "Sinhalese kingdom": "SIN",
    "Shoa": "ETH", "Papal States": "PAP", "Georgia": "GEO", "Granada": "GRA", "Britany": "BRE",
    "Trebizond": "TRE", "Sardinia": "ARA", "Navarre": "NAV", "Cyprus": "CYP", "Corsica": "GEN", "Venice": "VEN",
    "Hainan": "MNG", "Kashmir and Ladakh": "KAS", "Hadramaut": "HAD", "Pagan": "AVA", "Mali": "MLI",
    "Kanem-Bornu": "KAN", "Islamic city-states": "SWA", "minor Hindu and Buddhist kingdoms": "RAJ",
    "Siberians": "SIB", "Bantu peoples": "BAN", "West African cereal farmers": "WAF", "Khoisan": "KHO",
    "Sámi": "SAM", "Ainus": "AIN", "Guanches": "GUA", "Hokuzan": "RYU",
}


def key1400(pr):
    name = pr.get("NAME")
    return N1400.get(name) or name


DEU_1385 = {  # Niemcy (części Rzeszy) wg dzisiejszych krajów związkowych
    "Bawaria": "BAV", "Badenia-Wirtembergia": "WUR", "Saksonia": "SAX", "Turyngia": "SAX", "Saksonia-Anhalt": "SAX",
    "Brandenburgia": "BRA", "Berlin": "BRA", "Meklemburgia-Pomorze Przednie": "HAN", "Szlezwik-Holsztyn": "HAN",
    "Hamburg": "HAN", "Brema": "HAN", "Dolna Saksonia": "HAN", "Nadrenia Północna-Westfalia": "RHI",
    "Hesja": "RHI", "Nadrenia-Palatynat": "PAL", "Saara": "PAL",
}


def rules1385(m, owner):
    for i, p in enumerate(m["provinces"]):
        cc, lon, lat = p["cc"], p["lon"], p["lat"]
        o = owner[i]
        if cc == "CHN" and o in ("YUA", "MNG", None) and not in_names(m, i, "Mongolia Wewnętrzna", "Heilongjiang", "Jilin", "Liaoning"):
            owner[i] = "MNG"                                   # Ming (od 1368) — dane 1400 mają całe Chiny jako chanat
        elif cc in ("KOR", "PRK"): owner[i] = "GOR"            # Goryeo (Joseon dopiero 1392)
        elif cc == "POL" and o in ("LIT", "HRE", "TEU", "HUN") and not in_names(m, i, "Pomorskie", "Zachodniopomorskie", "Warmińsko", "Dolnośląskie", "Opolskie", "Lubuskie"):
            owner[i] = "POL"                                   # Królestwo Polskie (unia w Krewie: VIII 1385)
        elif cc == "POL" and in_names(m, i, "Pomorskie", "Warmińsko"): owner[i] = "TEU"
        elif cc == "POL" and in_names(m, i, "Dolnośląskie", "Opolskie"): owner[i] = "BOH"    # Śląsk w Koronie Czeskiej
        elif cc == "CZE": owner[i] = "BOH"
        elif cc == "AUT": owner[i] = "AUS"
        elif cc == "CHE": owner[i] = "SWI"
        elif cc in ("NLD", "BEL", "LUX") and o in ("HRE", "FRA", None): owner[i] = "BUR"
        elif cc == "DEU" and o in ("HRE", None, "TEU") and not (o == "TEU"):
            owner[i] = next((v for k, v in DEU_1385.items() if in_names(m, i, k)), "HRE")
        elif cc == "ITA" and o == "HRE": owner[i] = "FLO" if lat < 44.0 else "MIL"
        elif cc == "ITA" and lat < 41.8 and lon > 13.5 and o in ("SIC", "PAP", None) and not in_names(m, i, "Sycylia"):
            owner[i] = "NAP"
        elif cc in ("SWE", "FIN") and o in ("DEN", None): owner[i] = "DEN" if (cc == "SWE" and lat < 56.4) else "SWE"
        elif cc in ("NOR", "ISL"): owner[i] = "NOR"
        elif cc == "RUS" and o in ("HOR", "NOV") and 33 <= lon <= 44.5 and 54 <= lat <= 58.5: owner[i] = "MOS"
        elif cc in ("SRB", "MNE", "KOS") and o in ("BOS", "BYZ", "OTT", None): owner[i] = "SRB"
        elif cc == "BGR": owner[i] = "BUL"
        elif cc == "ALB": owner[i] = "ALB"
        elif cc == "MKD": owner[i] = "SRB"
        elif cc == "TUR" and in_names(m, i, "Stambuł", "Istanbul"): owner[i] = "BYZ"
        elif cc in ("IRQ", "AZE", "ARM") and o == "TIM": owner[i] = "JAL"     # Dżalairydzi (Timur zdobędzie te ziemie po 1386)
        elif cc == "IRN" and o == "TIM": owner[i] = "JAL" if lon < 50 else ("MUZ" if lon < 56 or lat < 30 else "TIM")
        elif cc == "GEO": owner[i] = "GEO"
        elif cc == "IND" and lat < 16.5 and o in ("VIJ", "RAJ", "DEL", None): owner[i] = "VIJ"
        elif cc == "IND" and 16.5 <= lat < 22 and lon < 81 and o in ("DEL", "RAJ", None): owner[i] = "BAH"
        elif (cc == "BGD" or in_names(m, i, "Bengal Zachodni")) and o in ("DEL", "RAJ", None): owner[i] = "BEN"
        elif cc == "DZA" and lon < 2.0 and lat > 32: owner[i] = "TLE"
        elif cc == "LBY" and o in (None, "MAM") and lon < 17: owner[i] = "HAF"
        elif cc == "PHL": owner[i] = "PHI"
        elif cc == "TWN": owner[i] = "FOR"
        elif cc == "ESP" and in_names(m, i, "Kanary", "Canar"): owner[i] = "GUA"
    return owner


META1385 = {
    "POL": ("Królestwo Polskie", "#d6455a", (19.94, 50.06), 20, 0, 0.50, "monarchia", "królestwo (Jadwiga)", "mid", ["LIT", "HUN"], ["TEU", "BRA"]),
    "LIT": ("Wielkie Księstwo Litewskie", "#e8c03a", (25.28, 54.69), 25, 0, 0.45, "monarchia", "wielkie księstwo (Jagiełło)", "low", ["POL"], ["TEU", "HOR", "MOS"]),
    "TEU": ("Zakon Krzyżacki", "#f0f0f0", (19.03, 54.04), 15, 2, 0.60, "teokracja", "państwo zakonne", "mid", ["HRE"], ["POL", "LIT"]),
    "HOR": ("Złota Orda", "#8a6a3a", (46.0, 48.0), 80, 0, 0.45, "autorytaryzm", "chanat (Tochtamysz)", "low", [], ["MOS", "LIT", "TIM"]),
    "MOS": ("Wielkie Księstwo Moskiewskie", "#3f6b3a", (37.62, 55.75), 15, 0, 0.45, "monarchia", "wielkie księstwo (Dymitr Doński)", "low", ["NOV"], ["HOR", "LIT"]),
    "NOV": ("Republika Nowogrodzka", "#5f8f8a", (31.27, 58.52), 8, 1, 0.45, "demokracja", "republika kupiecka", "mid", ["MOS"], ["TEU", "SWE"]),
    "FRA": ("Królestwo Francji", "#3e6fd8", (2.35, 48.86), 40, 8, 0.55, "monarchia", "królestwo (Karol VI)", "mid", ["SCO", "CAS"], ["ENG"]),
    "ENG": ("Królestwo Anglii", "#c8364a", (-0.13, 51.51), 25, 10, 0.60, "monarchia", "królestwo (Ryszard II)", "mid", ["POR"], ["FRA", "SCO", "CAS"]),
    "SCO": ("Królestwo Szkocji", "#3a62b8", (-3.19, 55.95), 8, 1, 0.50, "monarchia", "królestwo", "low", ["FRA"], ["ENG"]),
    "CAS": ("Korona Kastylii", "#f2b632", (-4.73, 41.65), 30, 8, 0.55, "monarchia", "królestwo (Jan I)", "mid", ["FRA"], ["POR", "ENG", "GRA"]),
    "POR": ("Królestwo Portugalii", "#2f8f5a", (-9.14, 38.72), 8, 4, 0.55, "monarchia", "królestwo (Jan Avis)", "mid", ["ENG"], ["CAS"]),
    "ARA": ("Korona Aragonii", "#e0a040", (-0.88, 41.65), 15, 8, 0.55, "monarchia", "królestwo", "mid", [], ["CAS", "GEN"]),
    "NAV": ("Królestwo Nawarry", "#c06a8a", (-1.64, 42.81), 3, 0, 0.50, "monarchia", "królestwo", "mid", [], []),
    "GRA": ("Emirat Grenady", "#2e8b57", (-3.60, 37.18), 10, 2, 0.50, "monarchia", "emirat (Nasrydzi)", "mid", ["MOR"], ["CAS"]),
    "HRE": ("Święte Cesarstwo (ziemie Rzeszy)", "#d8c070", (8.68, 50.11), 15, 0, 0.55, "monarchia", "księstwa Rzeszy", "mid", [], []),
    "BOH": ("Korona Czeska", "#3d6fb0", (14.42, 50.08), 20, 0, 0.55, "monarchia", "królestwo (Wacław IV, cesarz)", "mid", ["HRE"], ["HUN"]),
    "AUS": ("Księstwo Austrii", "#c43a3a", (16.37, 48.21), 10, 0, 0.55, "monarchia", "księstwo (Habsburgowie)", "mid", [], ["SWI"]),
    "BAV": ("Bawaria", "#5aa0e0", (11.58, 48.14), 8, 0, 0.55, "monarchia", "księstwo (Wittelsbachowie)", "mid", [], []),
    "WUR": ("Wirtembergia", "#9b6fd0", (9.18, 48.78), 5, 0, 0.55, "monarchia", "hrabstwo", "mid", [], []),
    "SAX": ("Saksonia", "#3f8f5f", (13.74, 51.05), 7, 0, 0.55, "monarchia", "księstwo (Wettynowie)", "mid", [], []),
    "BRA": ("Brandenburgia", "#5b5f66", (13.40, 52.52), 6, 0, 0.50, "monarchia", "marchia", "mid", ["BOH"], ["POL"]),
    "HAN": ("Hanza i Brunszwik", "#b0505a", (10.0, 53.55), 6, 6, 0.55, "demokracja", "miasta hanzeatyckie i księstwa", "high", [], ["DEN"]),
    "RHI": ("Arcybiskupstwa nadreńskie", "#7a9f5a", (6.96, 50.94), 6, 0, 0.55, "teokracja", "elektoraty duchowne", "mid", [], []),
    "PAL": ("Palatynat Reński", "#a86a4f", (8.69, 49.40), 5, 0, 0.55, "monarchia", "elektorat", "mid", [], []),
    "BUR": ("Burgundia (Niderlandy)", "#f08a24", (4.35, 50.85), 12, 3, 0.60, "monarchia", "księstwo (Filip Śmiały)", "high", ["FRA"], ["ENG"]),
    "SWI": ("Konfederacja Szwajcarska", "#d63b3b", (7.45, 46.95), 6, 0, 0.55, "demokracja", "związek kantonów", "mid", [], ["AUS"]),
    "MIL": ("Księstwo Mediolanu", "#4caf50", (9.19, 45.46), 10, 0, 0.55, "monarchia", "signoria (Visconti)", "high", [], ["VEN", "FLO"]),
    "FLO": ("Republika Florencji", "#c06a3a", (11.26, 43.77), 5, 0, 0.55, "demokracja", "republika kupiecka", "high", ["PAP"], ["MIL"]),
    "VEN": ("Republika Wenecka", "#2f9fa0", (12.33, 45.44), 6, 10, 0.60, "demokracja", "republika kupiecka", "high", [], ["GEN", "OTT", "MIL"]),
    "GEN": ("Republika Genui", "#d0d0e0", (8.93, 44.41), 4, 8, 0.60, "demokracja", "republika kupiecka", "high", [], ["VEN", "ARA"]),
    "PAP": ("Państwo Kościelne", "#e8d870", (12.45, 41.90), 6, 1, 0.50, "teokracja", "państwo papieskie", "mid", ["FRA"], []),
    "NAP": ("Królestwo Neapolu", "#7a5ac8", (14.25, 40.85), 10, 3, 0.50, "monarchia", "królestwo", "mid", [], ["ARA"]),
    "SIC": ("Królestwo Sycylii", "#c9a35a", (13.36, 38.12), 5, 3, 0.50, "monarchia", "królestwo (Aragończycy)", "mid", ["ARA"], ["NAP"]),
    "HUN": ("Królestwo Węgier", "#7aa865", (19.04, 47.50), 25, 1, 0.55, "monarchia", "królestwo (Maria Andegaweńska)", "mid", ["POL"], ["OTT", "VEN", "BOH"]),
    "WAL": ("Wołoszczyzna", "#e8c547", (26.10, 44.43), 8, 0, 0.45, "monarchia", "hospodarstwo", "low", [], ["OTT", "HUN"]),
    "MOL": ("Mołdawia", "#d97a4a", (27.59, 47.16), 5, 0, 0.45, "monarchia", "hospodarstwo", "low", ["POL"], ["HUN"]),
    "SRB": ("Serbia (Łazarz)", "#8a3a4a", (21.33, 43.58), 12, 0, 0.50, "monarchia", "księstwo", "low", ["BOS"], ["OTT"]),
    "BOS": ("Królestwo Bośni", "#6f7fc8", (18.41, 43.86), 8, 0, 0.45, "monarchia", "królestwo (Tvrtko I)", "low", ["SRB"], ["OTT", "HUN"]),
    "BUL": ("Carstwo Bułgarskie", "#3f8f5f", (25.62, 43.08), 8, 0, 0.45, "monarchia", "carstwo (wasal Osmanów)", "low", [], ["OTT"]),
    "ALB": ("Księstwa albańskie", "#c0503a", (19.82, 41.33), 4, 0, 0.40, "monarchia", "księstwa (Balszowie)", "low", [], ["OTT", "VEN"]),
    "BYZ": ("Cesarstwo Bizantyjskie", "#9b4fa0", (28.98, 41.01), 5, 4, 0.50, "monarchia", "cesarstwo (wasal Osmanów)", "mid", ["VEN"], ["OTT"]),
    "OTT": ("Państwo Osmańskie", "#b8432f", (26.56, 41.68), 30, 3, 0.55, "monarchia", "sułtanat (Murad I)", "low", [], ["BYZ", "SRB", "BUL", "KAR"]),
    "KAR": ("Karamanidzi", "#a0623c", (33.22, 37.18), 10, 0, 0.45, "monarchia", "bejlik", "low", ["MAM"], ["OTT"]),
    "AYD": ("Bejlik Ajdyn", "#d0a060", (27.84, 37.85), 3, 2, 0.45, "monarchia", "bejlik", "low", [], ["OTT"]),
    "TRE": ("Cesarstwo Trapezuntu", "#7a3f8f", (39.72, 41.0), 2, 1, 0.45, "monarchia", "cesarstwo", "mid", [], []),
    "GEO": ("Królestwo Gruzji", "#e0606a", (44.79, 41.72), 8, 0, 0.45, "monarchia", "królestwo", "low", [], ["TIM", "HOR"]),
    "MAM": ("Sułtanat Mameluków", "#d9b25f", (31.24, 30.04), 40, 4, 0.55, "autorytaryzm", "sułtanat (Barkuk)", "mid", ["KAR"], ["CYP"]),
    "CYP": ("Królestwo Cypru", "#e8b0a0", (33.38, 35.17), 2, 1, 0.50, "monarchia", "królestwo (Lusignanowie)", "mid", ["GEN"], ["MAM"]),
    "JAL": ("Dżalairydzi", "#4f9a62", (44.36, 33.31), 15, 0, 0.45, "monarchia", "sułtanat", "low", [], ["TIM", "HOR"]),
    "MUZ": ("Muzaffarydzi", "#8f7a55", (52.53, 29.6), 10, 0, 0.45, "monarchia", "dynastia (Fars)", "low", [], ["TIM"]),
    "TIM": ("Państwo Timurydów", "#5f6fd0", (66.97, 39.65), 60, 0, 0.55, "autorytaryzm", "emirat (Timur)", "low", [], ["HOR", "JAL", "MUZ", "DEL"]),
    "MOG": ("Mogolistan", "#7a9f5a", (76.95, 43.25), 20, 0, 0.45, "autorytaryzm", "chanat Czagatajski", "low", [], ["TIM"]),
    "DEL": ("Sułtanat Delhijski", "#e08a3a", (77.21, 28.61), 50, 0, 0.45, "monarchia", "sułtanat (Tughlakowie)", "low", [], ["TIM", "BAH", "BEN"]),
    "BAH": ("Sułtanat Bahmanidów", "#3f9c7a", (76.83, 17.33), 25, 0, 0.45, "monarchia", "sułtanat", "low", [], ["VIJ", "DEL"]),
    "VIJ": ("Imperium Widźajanagaru", "#c94f6a", (76.46, 15.33), 40, 2, 0.45, "monarchia", "imperium", "low", [], ["BAH"]),
    "BEN": ("Sułtanat Bengalski", "#5aa86e", (88.36, 22.57), 25, 1, 0.45, "monarchia", "sułtanat", "mid", [], ["DEL"]),
    "MNG": ("Cesarstwo Ming", "#e0603a", (118.80, 32.06), 200, 30, 0.55, "monarchia", "cesarstwo (Hongwu)", "mid", ["GOR"], ["YUA"]),
    "YUA": ("Północne Yuan", "#4f7fc8", (106.91, 47.92), 60, 0, 0.45, "autorytaryzm", "chanat mongolski", "low", [], ["MNG"]),
    "GOR": ("Goryeo", "#3e8f8f", (126.98, 37.57), 20, 3, 0.50, "monarchia", "królestwo", "mid", ["MNG"], ["JAP"]),
    "JAP": ("Japonia", "#e6c84f", (135.76, 35.01), 30, 6, 0.55, "monarchia", "szogunat Ashikaga", "mid", [], ["GOR"]),
    "TIB": ("Tybet", "#c9a96e", (91.11, 29.65), 10, 0, 0.40, "teokracja", "państwo (Phagmodrupa)", "low", [], []),
    "DAI": ("Đại Việt", "#c4473f", (105.85, 21.03), 20, 2, 0.45, "monarchia", "królestwo (Trần)", "low", [], ["CHA", "MNG"]),
    "CHA": ("Czampa", "#8a4fa8", (108.2, 13.8), 10, 2, 0.45, "monarchia", "królestwo", "low", [], ["DAI"]),
    "KHM": ("Imperium Khmerskie", "#5fa8d9", (103.86, 13.41), 15, 0, 0.45, "monarchia", "królestwo (Angkor)", "low", [], ["AYU"]),
    "AYU": ("Ajutthaja", "#d9a85a", (100.56, 14.35), 15, 1, 0.45, "monarchia", "królestwo", "low", [], ["KHM", "SUK"]),
    "SUK": ("Sukhothai", "#b9a24a", (99.82, 17.0), 6, 0, 0.40, "monarchia", "królestwo (wasal Ajutthai)", "low", [], []),
    "AVA": ("Królestwo Awy", "#3f8f6a", (95.98, 21.9), 12, 0, 0.40, "monarchia", "królestwo", "low", [], []),
    "MAJ": ("Imperium Madżapahitu", "#c4473f", (112.4, -7.5), 25, 10, 0.50, "monarchia", "imperium (Hayam Wuruk)", "mid", [], ["MAL"]),
    "MAL": ("Malajowie (Sumatra)", "#4f8f3e", (101.4, 0.5), 6, 3, 0.40, "monarchia", "księstwa", "low", [], ["MAJ"]),
    "HAF": ("Hafsydzi", "#c9584c", (10.18, 36.81), 15, 4, 0.50, "monarchia", "sułtanat", "mid", [], ["TLE", "MOR"]),
    "TLE": ("Sułtanat Tlemcen", "#4f9a62", (-1.32, 34.88), 8, 1, 0.45, "monarchia", "sułtanat (Zajjanidzi)", "low", [], ["MOR", "HAF"]),
    "MOR": ("Sułtanat Marynidów", "#b7473f", (-5.0, 34.03), 15, 2, 0.50, "monarchia", "sułtanat", "low", ["GRA"], ["CAS", "TLE"]),
    "MLI": ("Imperium Mali", "#e08a3a", (-8.0, 12.64), 40, 0, 0.40, "monarchia", "imperium (mansa)", "mid", [], []),
    "KAN": ("Kanem-Bornu", "#c99a5a", (13.16, 11.85), 20, 0, 0.40, "monarchia", "sułtanat", "low", [], []),
    "ETH": ("Cesarstwo Etiopii", "#6aa84f", (39.47, 13.5), 30, 0, 0.40, "monarchia", "cesarstwo (Salomonidzi)", "low", [], ["MAM"]),
    "MAK": ("Makuria", "#a8643c", (30.5, 18.2), 8, 0, 0.35, "monarchia", "królestwo chrześcijańskie", "low", ["ETH"], ["MAM"]),
    "ALW": ("Alodia", "#6f8f4a", (32.53, 15.59), 6, 0, 0.35, "monarchia", "królestwo chrześcijańskie", "low", [], []),
    "ZIM": ("Wielkie Zimbabwe", "#8a4fa8", (30.93, -20.27), 10, 0, 0.35, "monarchia", "królestwo", "low", [], []),
    "SWA": ("Miasta Suahili", "#4fb0b0", (39.2, -6.2), 5, 3, 0.40, "demokracja", "miasta-państwa", "mid", [], []),
    "DEN": ("Królestwo Danii", "#c0303f", (12.57, 55.68), 10, 6, 0.55, "monarchia", "królestwo (Małgorzata I)", "mid", ["NOR"], ["HAN", "SWE"]),
    "NOR": ("Królestwo Norwegii", "#b0505a", (10.40, 63.43), 5, 3, 0.50, "monarchia", "królestwo (unia z Danią)", "low", ["DEN"], []),
    "SWE": ("Królestwo Szwecji", "#4a90d0", (18.07, 59.33), 8, 3, 0.50, "monarchia", "królestwo (Albrecht Meklemburski)", "low", [], ["DEN", "NOV"]),
}
TRIBAL = {"SIB": "Ludy Syberii", "BAN": "Ludy Bantu", "WAF": "Rolnicy Afryki Zachodniej", "KHO": "Khoisanie", "SAM": "Lapończycy",
          "AIN": "Ajnowie", "GUA": "Guanczowie", "PHI": "Księstwa filipińskie", "FOR": "Plemiona Tajwanu", "RAJ": "Drobne królestwa indyjskie",
          "HAD": "Hadramaut", "OMA": "Oman", "YEM": "Jemen (Rasulidzi)", "KAS": "Kaszmir", "ORI": "Orisa (Gangowie)", "SIN": "Królestwo syngaleskie",
          "BNN": "Królestwo Beninu", "MER": "Madagaskar (królestwa)", "ACE": "Aceh", "RYU": "Riukiu", "BRE": "Księstwo Bretanii"}


# ================================================================ wspólne

SCENARIOS = {
    "1939": dict(year=1938, key=key1938, rules=rules1939, meta=META1939, date="1939-08-01",
                 title="1939 — w przededniu II wojny światowej",
                 desc="Sierpień 1939: III Rzesza po aneksji Austrii i Czech, ZSRR, imperia kolonialne Wielkiej Brytanii i Francji, Japonia w wojnie z Chinami.",
                 pop={"EU": 0.66, "AS": 0.33, "AF": 0.12}, wealth={"high": 12000, "mid": 5000, "low": 1500}, armyRate=0.010, tech=0.6,
                 era={"air": True, "radar": True, "aa": True, "gunships": True}, money=1.0, prices=0.5,
                 wars=[["JAP", "CHN"]]),
    "1914": dict(year=1914, key=key1914, rules=rules1914, meta=META1914, date="1914-06-01",
                 title="1914 — przed I wojną światową",
                 desc="Czerwiec 1914: wielkie imperia — Rosja, Niemcy, Austro-Węgry, Imperium Osmańskie — i podział kolonialny Afryki i Azji.",
                 pop={"EU": 0.58, "AS": 0.26, "AF": 0.10}, wealth={"high": 10000, "mid": 4000, "low": 1200}, armyRate=0.010, tech=0.55,
                 era={"air": False, "radar": False, "aa": False, "gunships": True}, money=1.0, prices=0.5,
                 wars=[]),
    "1385": dict(year=1400, key=key1400, rules=rules1385, meta=META1385, date="1385-01-01",
                 title="1385 — średniowiecze",
                 desc="Rok unii w Krewie: Polska i Litwa, Zakon Krzyżacki, Złota Orda, wojna stuletnia, rosnące państwo Osmanów i Timur na wschodzie.",
                 pop={"EU": 0.15, "AS": 0.08, "AF": 0.05}, wealth={"high": 3000, "mid": 1800, "low": 800}, armyRate=0.003, tech=0.45,
                 era={"air": False, "radar": False, "aa": False, "gunships": False}, money=50.0, prices=1.0,
                 wars=[["ENG", "FRA"], ["CAS", "POR"], ["TEU", "LIT"]]),
}


TRIBAL_SPLIT = {"BAN", "WAF", "KHO", "SIB"}


def pl_country_names():
    import re
    txt = open(os.path.join(ROOT, "data", "countries.js"), encoding="utf-8").read()
    return dict(re.findall(r'\n  ([A-Z]{3}): \{ name: "([^"]+)"', txt))


def hash_color(code):
    h = 0
    for ch in code:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    import colorsys
    r, g, b = colorsys.hls_to_rgb((h % 360) / 360, 0.55, 0.45)
    return "#%02x%02x%02x" % (int(r * 255), int(g * 255), int(b * 255))


def build(m, shapes, sid, cfg):
    owner = assign(m, shapes, cfg["year"], cfg["key"])
    provs = m["provinces"]
    for i, p in enumerate(provs):
        p["lon"], p["lat"] = shapes[i]["lon"], shapes[i]["lat"]
    owner = cfg["rules"](m, owner)
    # resztki bez właściciela -> sąsiedzi
    for _ in range(10):
        for i, p in enumerate(provs):
            if owner[i] is None:
                c = Counter(owner[n] for n in p["nb"] if owner[n])
                if c: owner[i] = c.most_common(1)[0][0]
    # wysepki bez sąsiadów lądowych -> najbliższe państwo
    for i, p in enumerate(provs):
        if owner[i] is None:
            near = min((j for j in range(len(provs)) if owner[j]), key=lambda j: (provs[j]["lon"] - p["lon"]) ** 2 + (provs[j]["lat"] - p["lat"]) ** 2)
            owner[i] = owner[near]
    # wielkie obszary plemienne dzielone wg dzisiejszych państw (więcej mniejszych, słabych ludów)
    pl = pl_country_names()
    for i, p in enumerate(provs):
        if owner[i] in TRIBAL_SPLIT:
            owner[i] = owner[i] + "_" + p["cc"]

    codes = sorted(set(owner))
    countries = {}
    for code in codes:
        ids = [i for i, o in enumerate(owner) if o == code]
        pop = sum((provs[i].get("pop") or 0) * cfg["pop"].get(provs[i].get("ct", "AS"), 0.2) for i in ids)
        meta = cfg["meta"].get(code)
        base = code.split("_")[0]
        if meta:
            name, color, cap, army, navy, tech, ideo, gov, wealth, friends, rivals = meta
        else:
            name = TRIBAL.get(code) or code
            if base in TRIBAL_SPLIT:
                name = TRIBAL[base] + " (" + pl.get(code.split("_")[1], code.split("_")[1]) + ")"
            color = hash_color(code)
            big = max(ids, key=lambda i: provs[i].get("pop") or 0)
            cap = (round(provs[big]["lon"], 2), round(provs[big]["lat"], 2))
            tribal = base in ("SIB", "BAN", "WAF", "KHO", "SAM", "AIN", "GUA", "PHI", "FOR")
            army = max(1, round(pop * 1000 * cfg["armyRate"] * (0.4 if tribal else 1)))
            navy, tech = 0, round(cfg["tech"] * (0.6 if tribal else 0.85), 2)
            ideo, gov = ("plemiona" if tribal else "monarchia"), ("ludy plemienne" if tribal else "państwo")
            wealth, friends, rivals = "low", [], []
        per_cap = cfg["wealth"][wealth]
        # PKB co najmniej taki, by utrzymać historyczną armię i flotę (skala kosztów epoki 0.25):
        # tygodniowa nadwyżka ≈ PKB·0.07/52 ma pokryć wojsko 0.0003 mld/1000 żołn. i flotę 0.005 mld/eskadrę
        gdp = max(0.2, pop * per_cap / 1000, army * 0.3 + navy * 4.5) * cfg["money"]
        countries[code] = {
            "name": name, "color": color, "capitalLonLat": list(cap), "gdp": round(gdp, 2),
            "pop": round(pop, 3), "army": army, "navy": navy, "tech": tech, "ideology": ideo if ideo != "plemiona" else "autorytaryzm",
            "gov": gov, "friends": [f for f in friends if f in codes], "rivals": [r for r in rivals if r in codes],
        }
    occupations = []
    if sid == "1939":
        ids = [i for i, p in enumerate(provs) if owner[i] == "CHN" and any(n.lower() in p["name"].lower() for n in JAP_OCC_1939)]
        occupations.append({"by": "JAP", "cc": "CHN", "provinces": ids})
    wars = [w for w in cfg["wars"] if w[0] in codes and w[1] in codes]
    print(f"{sid}: {len(codes)} państw; największe:",
          ", ".join(f"{c}({sum(1 for o in owner if o == c)})" for c, _ in Counter(owner).most_common(12)))
    return {
        "id": sid, "date": cfg["date"], "title": cfg["title"], "desc": cfg["desc"],
        # jednostka pieniądza epoki: PKB i koszty wojska skalowane razem (money), ceny budynków/jednostek (prices)
        "popScale": cfg["pop"], "era": dict(cfg["era"], costScale=0.25 * cfg["money"], priceScale=cfg["prices"]),
        "owners": owner, "countries": countries,
        "wars": wars, "occupations": occupations,
    }


def main():
    m = load_map()
    if "ct" not in m["provinces"][0]:
        raise SystemExit("data/map.js nie ma pola 'ct' — przebuduj mapę (tools/build_map.py)")
    shapes = province_shapes(m)
    out = {sid: build(m, shapes, sid, cfg) for sid, cfg in SCENARIOS.items()}
    js = json.dumps(out, separators=(",", ":"), ensure_ascii=False)
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("// Generated by tools/build_scenarios.py (granice: aourednik/historical-basemaps, GPL-3.0). Do not edit.\n")
        fh.write("window.SCENARIOS = " + js + ";\n")
    print("zapisano", OUT, os.path.getsize(OUT) // 1024, "KB")


if __name__ == "__main__":
    main()
