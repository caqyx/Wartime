#!/usr/bin/env python3
"""
Wartime 2026 — map data pipeline.

Downloads Natural Earth (10m admin-1, 10m admin-0, 10m populated places) into
tools/cache/ and generates data/map.js (window.MAP_DATA) following docs/SPEC.md §1.

Usage:
    python3 tools/build_map.py              # build data/map.js + print report
    python3 tools/build_map.py --preview    # also render tools/preview.png (needs matplotlib)

Requirements: shapely >= 2.1, numpy, scipy (matplotlib optional for --preview).
"""
import json
import math
import os
import sys
import urllib.request
from collections import defaultdict, Counter

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra, connected_components
import shapely
from shapely.geometry import shape, Polygon, MultiPolygon, Point, box, LineString
from shapely.ops import unary_union, nearest_points, polylabel
from shapely.strtree import STRtree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "tools", "cache")
OUT = os.path.join(ROOT, "data", "map.js")
PREVIEW = os.path.join(ROOT, "tools", "preview.png")
NE_BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"

# ---------------------------------------------------------------- parameters
WIDTH = 4000
LON_MIN, LON_MAX = -32.0, 192.0      # -32 so the Azores fit; 192 covers Chukotka (+360)
LAT_MIN, LAT_MAX = -12.0, 82.0
SIMPLIFY_TOL = 0.45                  # map units (~0.025 deg) for coverage simplification
MIN_PART_AREA = 0.6                  # map units^2: drop islets smaller than this (keep >=1 part)
BG_SIMPLIFY_DEG = 0.08
SEA_MAX_KM = 450
SEA_LAND_FRAC = 0.08
STRAIT_KM = 40
STRAIT_MIN_PART = 8.0             # map units^2 (~150-300 km2): smaller islets give no strait
MAX_PROV = 90

# Extra (non Europe/Asia "CONTINENT") countries that are included as playable.
EXTRA_PLAYABLE = {"MDV"}
# admin-0 units that are folded into another playable country (code -> owner).
MERGE_INTO = {
    "CYN": "CYP", "ESB": "CYP", "WSB": "CYP", "CNM": "CYP",   # Cyprus as one country
    "KAB": "KAZ",                                             # Baikonur lease
    "KAS": "IND",                                             # Siachen Glacier (de facto IND)
    "HKG": "CHN", "MAC": "CHN",
    "JEY": "GBR", "GGY": "GBR", "IMN": "GBR",
    "ALD": "FIN", "FRO": "DNK",
    "GIB": "GBR",
}
FOLDED_NAMES = {"CYN": "Northern Cyprus", "KAS": "Siachen", "WSB": "Akrotiri", "ESB": "Dhekelia"}
# admin-0 units dropped entirely (outside scope / not land of a playable state)
DROP = {"IOA", "PGA", "SCR", "ATC", "USG", "SPI", "BJN", "GRL", "EGY", "PNG"}
# admin names to skip (overseas parts that share an adm0 code)
DROP_ADMIN = {"Caribbean Netherlands"}

S = WIDTH / (LON_MAX - LON_MIN)      # map units per degree of longitude


def miller_y(lat_deg):
    lat = np.radians(lat_deg)
    return np.degrees(1.25 * np.log(np.tan(np.pi / 4 + 0.4 * lat)))


Y_TOP = float(miller_y(LAT_MAX))
Y_BOT = float(miller_y(LAT_MIN))
HEIGHT = int(math.ceil((Y_TOP - Y_BOT) * S))


def proj_xy(lon, lat):
    lon = np.asarray(lon, dtype=float)
    lat = np.asarray(lat, dtype=float)
    return (lon - LON_MIN) * S, (Y_TOP - miller_y(lat)) * S


def unproj_xy(x, y):
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    lon = x / S + LON_MIN
    Y = np.radians(Y_TOP - y / S)
    lat = np.degrees(2.5 * np.arctan(np.exp(0.8 * Y)) - 0.625 * np.pi)
    return lon, lat


def project_geom(g):
    def f(coords):
        x, y = proj_xy(coords[:, 0], coords[:, 1])
        return np.column_stack([x, y])
    return shapely.transform(g, f)


def haversine(lon1, lat1, lon2, lat2):
    lon1, lat1, lon2, lat2 = map(np.radians, (lon1, lat1, lon2, lat2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 6371.0 * 2 * np.arcsin(np.sqrt(np.minimum(1, a)))


def km_between_xy(p, q):
    lo, la = unproj_xy([p[0], q[0]], [p[1], q[1]])
    return float(haversine(lo[0], la[0], lo[1], la[1]))


def area_km2(g):
    """Approximate area (sinusoidal equal-area) of a lon/lat geometry."""
    def f(c):
        return np.column_stack([c[:, 0] * np.cos(np.radians(c[:, 1])) * 111.32, c[:, 1] * 111.32])
    return shapely.transform(g, f).area


# ---------------------------------------------------------------- download
def fetch(name):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name + ".geojson")
    if not os.path.exists(path) or os.path.getsize(path) < 1000:
        print("downloading", name, "...", flush=True)
        urllib.request.urlretrieve(NE_BASE + name + ".geojson", path)
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def polys_of(g):
    if g is None or g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    if isinstance(g, MultiPolygon):
        return list(g.geoms)
    return [p for p in getattr(g, "geoms", []) if isinstance(p, (Polygon, MultiPolygon)) for p in polys_of(p)]


def as_multi(g):
    ps = [p for p in polys_of(g) if p.area > 0]
    return MultiPolygon(ps) if len(ps) != 1 else ps[0]


def shift_antimeridian(g):
    """Shift polygons lying west of -100 deg by +360 (Chukotka, Alaska)."""
    out = []
    for p in polys_of(g):
        if p.bounds[2] < -100:
            p = shapely.transform(p, lambda c: c + np.array([360.0, 0.0]))
        out.append(p)
    return unary_union(out) if out else g


PL_PREFIXES = ("województwo ", "prowincja ", "prefektura ", "gubernatorstwo ", "muhafaza ",
               "departament ", "hrabstwo ", "dystrykt ", "region ", "okręg ", "obwód ", "stan ")


def clean_pl(s):
    """'województwo mazowieckie' -> 'Mazowieckie', 'Prowincja Chiang Mai' -> 'Chiang Mai'."""
    if not s:
        return None
    t = s.strip()
    for pre in PL_PREFIXES:
        if t.lower().startswith(pre) and len(t) > len(pre) + 2:
            t = t[len(pre):]
            break
    return t[:1].upper() + t[1:]


def fill_holes(g):
    return unary_union([Polygon(p.exterior) for p in polys_of(g)])


# ---------------------------------------------------------------- terrain heuristic
MOUNTAIN_BOXES = [  # (lon0, lat0, lon1, lat1)
    (5.8, 45.6, 13.8, 47.4),     # Alps
    (6.8, 44.0, 7.8, 45.6),      # western Alps
    (-1.8, 42.3, 2.5, 43.0),     # Pyrenees
    (72.0, 27.5, 97.5, 37.5),    # Himalaya / Karakoram / Tibet south
    (78.0, 31.0, 103.0, 39.0),   # Tibetan plateau / Qinghai
    (67.0, 36.5, 80.0, 43.5),    # Pamir / Tian Shan
    (40.0, 42.0, 48.0, 44.0),    # Greater Caucasus
    (43.2, 38.8, 46.6, 41.4),    # Armenian highlands
    (67.0, 33.5, 72.5, 37.0),    # Hindu Kush
]
MOUNTAIN_CC = {"CHE", "NPL", "BTN", "TJK", "KGZ", "AND", "LIE", "ARM"}
HILLS_CC = {"MNE", "ALB", "BIH", "MKD", "KOS", "GRC", "TUR", "LAO", "JPN", "KOR", "PRK", "GEO",
            "LBN", "SVN", "AUT", "AFG", "IRN", "NOR", "YEM", "TWN", "SRB", "BGR"}
FOREST_CC = {"FIN", "SWE", "EST", "LVA", "BLR"}
JUNGLE_CC = {"IDN", "MYS", "BRN", "SGP", "TLS", "PHL"}
DESERT_CC = {"SAU", "ARE", "QAT", "KWT", "OMN", "BHR", "TKM"}


def in_box(lon, lat, b):
    return b[0] <= lon <= b[2] and b[1] <= lat <= b[3]


def terrain_for(cc, lon, lat):
    if cc in MOUNTAIN_CC or any(in_box(lon, lat, b) for b in MOUNTAIN_BOXES):
        return "mountains"
    if lat > 64:
        return "tundra"
    if cc == "RUS" and lon > 100 and lat > 60:
        return "tundra"
    if cc in DESERT_CC:
        return "desert"
    if cc == "YEM" and lat > 15.5:
        return "desert"
    if cc in ("IRQ", "SYR", "JOR") and lon > 38.5 and not (cc == "IRQ" and lon > 44 and lat > 34.5):
        return "desert"
    if cc == "ISR" and lat < 31.2:
        return "desert"
    if cc == "IRN" and lon > 54.5 and lat < 36:
        return "desert"
    if cc == "UZB" and lon < 66:
        return "desert"
    if cc == "KAZ" and lat < 46.5:
        return "desert"
    if cc == "MNG" and lat < 45.5:
        return "desert"
    if cc == "CHN" and ((lon < 106 and lat > 37) or (106 <= lon < 112 and lat > 40)):
        return "desert"
    if cc == "PAK" and (lon < 69 or lat < 27):
        return "desert"
    if cc == "IND" and 69 <= lon <= 74.5 and 24 <= lat <= 30.5:
        return "desert"
    if cc in JUNGLE_CC or (lat < 13 and cc in ("THA", "MMR", "KHM", "VNM", "LKA", "IND")):
        return "jungle"
    if cc in FOREST_CC or (cc == "RUS" and 55 <= lat <= 64) or (cc == "NOR" and lat > 61):
        return "forest"
    if cc in HILLS_CC:
        return "hills"
    if cc == "CHN" and lon < 112 and lat < 33:
        return "hills"
    if cc in ("MMR", "THA", "VNM") and lat >= 13:
        return "hills" if cc != "THA" or lat > 17 else "plains"
    return "plains"


# ---------------------------------------------------------------- build
def main():
    want_preview = "--preview" in sys.argv
    a0 = fetch("ne_10m_admin_0_countries")
    a1 = fetch("ne_10m_admin_1_states_provinces")
    places = fetch("ne_10m_populated_places_simple")

    # ---- countries
    a0props = {}
    a0geom = {}
    playable = set()
    for f in a0["features"]:
        p = f["properties"]
        code = p["ADM0_A3"]
        a0props[code] = p
        a0geom[code] = f["geometry"]
        if code in DROP or code in MERGE_INTO:
            continue
        if p["CONTINENT"] in ("Europe", "Asia") or code in EXTRA_PLAYABLE:
            playable.add(code)
    owner_of = {c: c for c in playable}
    owner_of.update({k: v for k, v in MERGE_INTO.items()})

    # ---- admin-1 units
    bbox_ll = box(LON_MIN, LAT_MIN, LON_MAX, LAT_MAX)
    units = []
    for f in a1["features"]:
        p = f["properties"]
        code = p["adm0_a3"]
        if code not in owner_of or p.get("admin") in DROP_ADMIN:
            continue
        g = shape(f["geometry"])
        if not g.is_valid:
            g = shapely.make_valid(g)
        if code == "RUS" or code == "USA":
            g = shift_antimeridian(g)
        g = g.intersection(bbox_ll)
        g = as_multi(g)
        if g.is_empty or g.area < 1e-7:
            continue
        name = p.get("name") or p.get("name_en") or p.get("gn_name")  # None => forced merge
        name_pl = clean_pl(p.get("name_pl")) or name
        if code in MERGE_INTO:
            name = FOLDED_NAMES.get(code) or a0props[code]["NAME_EN"]
            name_pl = a0props[code].get("NAME_PL") or name
        units.append({
            "name": name, "name_pl": name_pl, "cc": owner_of[code], "src": code,
            "region": p.get("region") or "", "geom": g, "area": area_km2(g),
        })
    print(f"admin-1 units in scope: {len(units)}")

    # ---- fill admin-0 gaps (e.g. UN buffer zone in Cyprus) not covered by admin-1
    by_cc = defaultdict(list)
    for i, u in enumerate(units):
        by_cc[u["cc"]].append(i)
    for code in ["CNM"]:
        if code in a0geom:
            g = as_multi(shapely.make_valid(shape(a0geom[code])))
            cover = unary_union([units[i]["geom"] for i in by_cc[owner_of[code]]])
            g = as_multi(g.difference(cover))
            if g.area > 1e-6:
                units.append({"name": a0props[code]["NAME_EN"], "name_pl": a0props[code].get("NAME_PL") or "",
                          "cc": owner_of[code], "src": code,
                              "region": "", "geom": g, "area": area_km2(g)})

    # ---- city population per admin-1 unit (used to name merged provinces)
    utree = STRtree([u["geom"] for u in units])
    for f in places["features"]:
        pp = f["properties"]
        if owner_of.get(pp.get("adm0_a3")) is None:
            continue
        lon = pp["longitude"] + (360 if pp["longitude"] < -100 else 0)
        for j in utree.query(Point(lon, pp["latitude"]), predicate="intersects"):
            units[int(j)]["cpop"] = units[int(j)].get("cpop", 0) + (pp.get("pop_max") or 0)
            break

    # ---- dissolve folded-in admin-0 units (HKG, MAC, CYN, ALD, ...) into one unit each
    folded = defaultdict(list)
    rest = []
    for u in units:
        (folded[u["src"]] if u["src"] in MERGE_INTO else rest).append(u)
    for code, us in folded.items():
        g = as_multi(unary_union([u["geom"] for u in us]))
        rest.append({"name": us[0]["name"], "name_pl": us[0]["name_pl"], "cc": us[0]["cc"], "src": code, "region": "",
                     "geom": g, "area": area_km2(g), "cpop": sum(u.get("cpop", 0) for u in us)})
    units = rest

    # ---- merging per country
    by_cc = defaultdict(list)
    for u in units:
        by_cc[u["cc"]].append(u)
    provinces = []
    merge_log = {}
    for cc in sorted(by_cc):
        us = by_cc[cc]
        total_area = sum(u["area"] for u in us)
        target = max(1, min(MAX_PROV, round(math.sqrt(total_area) / 35)))
        n0 = len(us)
        us = merge_country(us, target)
        merge_log[cc] = (n0, len(us), target)
        provinces.extend(us)
    print(f"provinces after merge: {len(provinces)}")

    # ---- project & simplify (coverage-preserving -> no gaps between neighbours)
    geoms_p = [project_geom(p["geom"]) for p in provinces]
    parts = []
    owner_idx = []
    for i, g in enumerate(geoms_p):
        for q in polys_of(g):
            parts.append(q)
            owner_idx.append(i)
    parts_arr = np.array(parts, dtype=object)
    simp = shapely.coverage_simplify(parts_arr, SIMPLIFY_TOL, simplify_boundary=True)
    # round to 0.1 and regroup
    grouped = defaultdict(list)
    for q, i in zip(simp, owner_idx):
        q = shapely.set_precision(q, 0.1)
        for pp in polys_of(q):
            if pp.area > 0:
                grouped[i].append(pp)
    final_geoms = []
    for i in range(len(provinces)):
        ps = grouped.get(i, [])
        if not ps:  # simplified away; fall back to the raw (rounded) geometry
            ps = polys_of(shapely.set_precision(geoms_p[i], 0.1))
        if not ps:  # micro-state (Vatican...): tiny square around its centre, drawn on top
            c = geoms_p[i].representative_point()
            ps = [shapely.set_precision(box(c.x - 0.6, c.y - 0.6, c.x + 0.6, c.y + 0.6), 0.1)]
        big = [p for p in ps if p.area >= MIN_PART_AREA]
        if not big:
            big = [max(ps, key=lambda p: p.area)]
        final_geoms.append(MultiPolygon(big) if len(big) > 1 else big[0])

    # ---- enclave handling: same-country enclaves merged earlier; order others last
    n = len(provinces)
    tree = STRtree(final_geoms)
    filled = [fill_holes(g) for g in final_geoms]
    depth = [0] * n
    for i, g in enumerate(final_geoms):
        rp = g.representative_point()
        for j in tree.query(g, predicate="intersects"):
            if j != i and filled[j].contains(rp) and not final_geoms[j].contains(rp):
                depth[i] += 1
    order = sorted(range(n), key=lambda i: (depth[i], provinces[i]["cc"], -provinces[i]["area"]))
    provinces = [provinces[i] for i in order]
    final_geoms = [final_geoms[i] for i in order]
    enclaves = [(provinces[k]["name"], provinces[k]["cc"]) for k, i in enumerate(order) if depth[i] > 0]

    # ---- neighbours
    tree = STRtree(final_geoms)
    nb = [set() for _ in range(n)]
    for i, g in enumerate(final_geoms):
        gb = g.buffer(0.2)
        for j in tree.query(gb, predicate="intersects"):
            if j <= i:
                continue
            inter = gb.intersection(final_geoms[j].boundary)
            if inter.length > 0.3:
                nb[i].add(int(j))
                nb[j].add(i)

    # enclaves / micro-states without a shared border: neighbour = provinces they overlap/touch
    for i, g in enumerate(final_geoms):
        if nb[i]:
            continue
        for j in tree.query(g.buffer(0.3), predicate="intersects"):
            j = int(j)
            if j != i:
                nb[i].add(j)
                nb[j].add(i)

    # ---- background land
    background_geoms = build_background(a0, a0geom, set(owner_of), bbox_ll)

    # ---- land union, coastline
    land_all = unary_union(final_geoms + background_geoms).buffer(0)
    # keep only big inland water bodies (Caspian etc.), fill small lakes/slivers
    land_filled = []
    for p in polys_of(land_all):
        holes = [h for h in p.interiors if Polygon(h).area > 400]
        land_filled.append(Polygon(p.exterior, holes))
    land_filled = unary_union(land_filled)
    coastline = land_filled.boundary
    coast_buf = coastline.buffer(0.05)
    coast_lines = []
    coastal = []
    for g in final_geoms:
        c = g.boundary.intersection(coast_buf)
        c = shapely.line_merge(c) if not c.is_empty and c.geom_type == "MultiLineString" else c
        coast_lines.append(c)
        coastal.append((not c.is_empty) and c.length > 0.8)

    # ---- label points
    labels = []
    for g in final_geoms:
        big = max(polys_of(g), key=lambda p: p.area)
        try:
            lp = polylabel(big, tolerance=0.3)
            if not big.contains(lp):
                lp = big.representative_point()
        except Exception:
            lp = big.representative_point()
        labels.append((round(lp.x, 1), round(lp.y, 1)))

    # ---- population (also gives the biggest cities per province, used for ports)
    pops, cities = distribute_population(provinces, final_geoms, places, a0props, owner_of)

    # ---- ports: on open coast (not deep in an estuary/lagoon), next to the biggest coastal city,
    #      else nearest the label point; islet-only coasts are avoided when possible
    shapely.prepare(land_filled)
    ang = np.linspace(0, 2 * np.pi, 12, endpoint=False)
    ring = np.concatenate([np.column_stack([r * np.cos(ang), r * np.sin(ang)]) for r in (1.5, 3.0, 4.5)])
    ports = []
    for i, g in enumerate(final_geoms):
        if not coastal[i]:
            ports.append(None)
            continue
        c = coast_lines[i]
        segs = [q for q in getattr(c, "geoms", [c]) if q.length > 0]
        longest = max(q.length for q in segs)
        pts = []
        for q in segs:
            if q.length < 0.1 * longest and q.length < 3:
                continue  # tiny islet coast
            k = max(2, int(q.length / 0.7))
            for t in np.linspace(0, 1, k):
                pp = q.interpolate(t, normalized=True)
                pts.append((pp.x, pp.y))
        if not pts:
            pp = segs[0].interpolate(0.5, normalized=True)
            pts = [(pp.x, pp.y)]
        pts = np.array(pts)
        sx = (pts[:, None, 0] + ring[None, :, 0]).ravel()
        sy = (pts[:, None, 1] + ring[None, :, 1]).ravel()
        openness = (~shapely.contains_xy(land_filled, sx, sy)).reshape(len(pts), -1).mean(axis=1)
        good = pts[openness >= max(0.3, 0.6 * openness.max())]
        if len(good) == 0:
            good = pts[openness >= openness.max()]
        target = None
        for _, cpt in sorted(cities[i], key=lambda t: -t[0]):
            if np.min(np.hypot(good[:, 0] - cpt.x, good[:, 1] - cpt.y)) <= 8.0:
                target = (cpt.x, cpt.y)
                break
        if target is None:
            target = labels[i]
        k = int(np.argmin(np.hypot(good[:, 0] - target[0], good[:, 1] - target[1])))
        ports.append((round(float(good[k, 0]), 1), round(float(good[k, 1]), 1)))

    # ---- straits
    land_eroded = land_filled.buffer(-1.0)
    shapely.prepare(land_eroded)
    straits = set()
    # only substantial land counts for straits (no land bridge via islets such as Kinmen)
    major = []
    for g in final_geoms:
        ps = [q for q in polys_of(g) if q.area >= STRAIT_MIN_PART]
        major.append(unary_union(ps) if ps else max(polys_of(g), key=lambda q: q.area))
    mtree = STRtree(major)
    for i, g in enumerate(major):
        for j in mtree.query(g, predicate="dwithin", distance=25.0):
            j = int(j)
            if j <= i or j in nb[i]:
                continue
            a, b = nearest_points(g, major[j])
            d = km_between_xy((a.x, a.y), (b.x, b.y))
            if d <= STRAIT_KM and seg_land_frac(land_filled, a, b) <= 0.5:
                straits.add((i, j))

    # ---- sea links
    coast_ids = [i for i in range(n) if coastal[i]]
    def nearest_port(lon, lat, exclude=()):
        x, y = proj_xy(lon, lat)
        return min((i for i in coast_ids if i not in exclude),
                   key=lambda i: (ports[i][0] - x) ** 2 + (ports[i][1] - y) ** 2)
    c_med = nearest_port(32.3, 31.3)
    c_red = nearest_port(32.55, 29.95, exclude=(c_med,))
    print("Suez link:", provinces[c_med]["cc"], provinces[c_med]["name"], "<->",
          provinces[c_red]["cc"], provinces[c_red]["name"])
    sea = build_sea_links(coast_ids, ports, land_filled, land_eroded, provinces, canal=(c_med, c_red))

    # ---- population

    # ---- assemble
    out_prov = []
    for i, g in enumerate(final_geoms):
        rings = []
        for p in polys_of(g):
            cs = np.asarray(p.exterior.coords)[:-1]
            rings.append([round(float(v), 1) for v in cs.reshape(-1)])
        bx = g.bounds
        lon, lat = unproj_xy(labels[i][0], labels[i][1])
        out_prov.append({
            "id": i,
            "name": provinces[i]["name_pl"] or provinces[i]["name"],
            "name_en": provinces[i]["name"],
            "cc": provinces[i]["cc"],
            "poly": rings,
            "bbox": [round(bx[0], 1), round(bx[1], 1), round(bx[2], 1), round(bx[3], 1)],
            "cx": labels[i][0], "cy": labels[i][1],
            "areaKm2": int(round(provinces[i]["area"])),
            "pop": round(pops[i], 3),
            "coastal": bool(coastal[i]),
            "port": list(ports[i]) if ports[i] else None,
            "nb": sorted(nb[i]),
            "terrain": terrain_for(provinces[i]["cc"], float(lon), float(lat)),
        })

    bg_rings = []
    for g in background_geoms:
        for p in polys_of(g):
            if p.area < 2.0:
                continue
            for q in polys_of(shapely.set_precision(p, 0.1)):
                cs = np.asarray(q.exterior.coords)[:-1]
                if len(cs) >= 3:
                    bg_rings.append([round(float(v), 1) for v in cs.reshape(-1)])

    countries = {}
    for cc in sorted({p["cc"] for p in provinces}):
        pr = a0props[cc]
        countries[cc] = {"name_en": pr["NAME_EN"], "lonlat": [round(pr["LABEL_X"], 2), round(pr["LABEL_Y"], 2)]}

    km_per_unit = 111.32 * math.cos(math.radians(45)) / S
    data = {
        "width": WIDTH, "height": HEIGHT,
        "kmPerUnit": round(km_per_unit, 2),
        "projection": "miller", "lonMin": LON_MIN, "lonMax": LON_MAX, "latMin": LAT_MIN, "latMax": LAT_MAX,
        "provinces": out_prov,
        "seaLinks": sea,
        "straits": sorted([list(s) for s in straits]),
        "background": bg_rings,
        "countries": countries,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    js = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("// Generated by tools/build_map.py from Natural Earth (public domain). Do not edit.\n")
        fh.write("window.MAP_DATA = " + js + ";\n")

    report(data, merge_log, enclaves)
    if want_preview:
        render_preview(data)


def merge_country(us, target):
    """Same-country enclaves are always merged; then smallest-with-smallest-neighbour until <= target."""
    us = [dict(u) for u in us]
    for u in us:
        u["geom"] = shapely.make_valid(u["geom"])
    alive = set(range(len(us)))

    def weight(k):
        """Name priority: city population + 20 people/km2 baseline (Istanbul beats Kirklareli)."""
        u = us[k]
        if u.get("noname") or not u["name"]:
            return -1
        return u.get("cpop", 0) + 20.0 * u["area"]
    tree = STRtree([u["geom"] for u in us])
    adj = defaultdict(set)
    for i, u in enumerate(us):
        for j in tree.query(u["geom"].buffer(0.005), predicate="intersects"):
            j = int(j)
            if j != i:
                adj[i].add(j)
                adj[j].add(i)

    def do_merge(a, b):  # merge two units; the name of the "heavier" one survives
        big, small = (a, b) if us[a]["area"] >= us[b]["area"] else (b, a)
        if weight(small) > weight(big):
            us[big]["name"] = us[small]["name"]
            us[big]["name_pl"] = us[small]["name_pl"]
        g = unary_union([us[big]["geom"], us[small]["geom"]])
        us[big]["geom"] = as_multi(g)
        us[big]["area"] += us[small]["area"]
        us[big]["cpop"] = us[big].get("cpop", 0) + us[small].get("cpop", 0)
        alive.discard(small)
        for k in adj[small]:
            adj[k].discard(small)
            if k != big:
                adj[k].add(big)
                adj[big].add(k)
        adj[big].discard(big)
        adj[big].discard(small)
        del adj[small]
        return big

    # nameless units (slivers in NE data) are merged into their largest neighbour
    for i in list(alive):
        if not us[i]["name"]:
            nbs = [j for j in adj[i] if j in alive]
            gi = us[i]["geom"]
            j = max(nbs, key=lambda k: us[k]["area"]) if nbs else \
                min((k for k in alive if k != i and us[k]["name"]), key=lambda k: gi.distance(us[k]["geom"]))
            us[i]["noname"] = True  # make sure the named unit wins
            do_merge(i, j)

    # enclaves: unit lying inside the hole of a same-country unit
    changed = True
    while changed:
        changed = False
        for i in list(alive):
            if i not in alive:
                continue
            nbs = [j for j in adj[i] if j in alive]
            if len(nbs) == 1:
                j = nbs[0]
                if fill_holes(us[j]["geom"]).contains(us[i]["geom"].representative_point()) and \
                        fill_holes(us[j]["geom"]).buffer(0.01).contains(us[i]["geom"]):
                    do_merge(i, j)
                    changed = True

    while len(alive) > target:
        i = min(alive, key=lambda k: us[k]["area"])
        nbs = [j for j in adj[i] if j in alive]
        if nbs:
            same = [j for j in nbs if us[j]["region"] and us[j]["region"] == us[i]["region"]]
            pool = same or nbs
            j = min(pool, key=lambda k: us[k]["area"])
        else:
            gi = us[i]["geom"]
            j = min((k for k in alive if k != i), key=lambda k: gi.distance(us[k]["geom"]))
        do_merge(i, j)
    return [us[i] for i in sorted(alive, key=lambda k: -us[k]["area"])]


def build_background(a0, a0geom, game_codes, bbox_ll):
    out = []
    clip = box(LON_MIN - 0.5, LAT_MIN - 0.5, LON_MAX + 0.5, LAT_MAX + 0.5)
    for f in a0["features"]:
        code = f["properties"]["ADM0_A3"]
        if code in game_codes and code not in DROP:
            continue
        g = shape(f["geometry"])
        if not g.is_valid:
            g = shapely.make_valid(g)
        if code in ("USA", "FJI", "KIR", "NZL"):
            g = shift_antimeridian(g)
        if not g.intersects(clip):
            continue
        g = g.intersection(clip).simplify(BG_SIMPLIFY_DEG, preserve_topology=True)
        g = as_multi(g)
        if not g.is_empty:
            out.append(g)
    u = unary_union(out)
    return [project_geom(p) for p in polys_of(u)]


def seg_land_frac(land, a, b, k=12):
    t = np.linspace(0, 1, k + 2)[1:-1]
    xs = a.x + (b.x - a.x) * t
    ys = a.y + (b.y - a.y) * t
    return float(np.mean(shapely.contains_xy(land, xs, ys)))


SEA_GRID = 2.0          # map units per cell of the water routing grid
SEA_ROUTE_LIMIT = 3000  # km, Dijkstra search radius per port


def build_sea_links(coast_ids, ports, land_filled, land_eroded, provinces, canal=None):
    """Sea links between coastal provinces.

    Water routing grid: cells outside land eroded by one cell (so straits a few km wide stay
    open: Bosporus, Danish straits, Kerch, Messina...). Sea distance = shortest water path.
      * base rule (SPEC): straight port distance <= 450 km, straight segment land share <= 8%,
        and a water path exists that is <= 1.5 x straight + 50 km (same sea, no isthmus hopping);
        plus short coast-hugging hops (<= 250 km, water path <= 1.25 x straight + 25 km)
      * every coastal province gets >= 2 links (nearest by water path)
      * components that share water get joined by their shortest water path
      * Suez canal link (Egypt is outside the game)
    distKm = water path length (km), straight distance when no water path is known.
    """
    G = SEA_GRID
    nx, ny = int(math.ceil(WIDTH / G)), int(math.ceil(HEIGHT / G))
    xs = (np.arange(nx) + 0.5) * G
    ys = (np.arange(ny) + 0.5) * G
    X, Y = np.meshgrid(xs, ys)
    land_grid = land_filled.buffer(-G)
    shapely.prepare(land_grid)
    water = ~shapely.contains_xy(land_grid, X.ravel(), Y.ravel()).reshape(ny, nx)
    node = -np.ones((ny, nx), dtype=np.int64)
    node[water] = np.arange(int(water.sum()))
    N = int(water.sum())
    _, lat_rows = unproj_xy(np.zeros(ny), ys)
    _, lat_edges = unproj_xy(np.zeros(ny + 1), np.arange(ny + 1) * G)
    kx = G / S * 111.32 * np.cos(np.radians(lat_rows))          # km per cell horizontally
    ky = 111.32 * np.abs(lat_edges[:-1] - lat_edges[1:])          # km per cell vertically
    rows, cols, wts = [], [], []
    for dy, dx in ((0, 1), (1, 0), (1, 1), (1, -1)):
        if dx >= 0:
            a = node[: ny - dy, : nx - dx]
            b = node[dy:, dx:]
        else:
            a = node[: ny - dy, 1:]
            b = node[dy:, : nx - 1]
        m = (a >= 0) & (b >= 0)
        r = np.nonzero(m)[0]
        hx = kx[r] * abs(dx)
        vy = ky[r] * dy
        rows.append(a[m])
        cols.append(b[m])
        wts.append(np.sqrt(hx ** 2 + vy ** 2))
    graph = coo_matrix((np.concatenate(wts), (np.concatenate(rows), np.concatenate(cols))), shape=(N, N)).tocsr()
    # only cells of sizeable water bodies are valid port anchors (skip lagoons / estuary pockets)
    ncomp, lab = connected_components(graph, directed=False)
    big_comp = np.bincount(lab) >= 400

    m = len(coast_ids)
    P = np.array([ports[i] for i in coast_ids], dtype=float)
    lon, lat = unproj_xy(P[:, 0], P[:, 1])
    D = haversine(lon[:, None], lat[:, None], lon[None, :], lat[None, :])

    # port -> nearest water cell
    pnode = np.full(m, -1, dtype=np.int64)
    for a in range(m):
        cx, cy = int(P[a, 0] // G), int(P[a, 1] // G)
        best = None
        for r in range(0, 12):
            for yy in range(max(0, cy - r), min(ny, cy + r + 1)):
                for xx in range(max(0, cx - r), min(nx, cx + r + 1)):
                    if node[yy, xx] >= 0 and big_comp[lab[node[yy, xx]]]:
                        d2 = ((xx + 0.5) * G - P[a, 0]) ** 2 + ((yy + 0.5) * G - P[a, 1]) ** 2
                        if best is None or d2 < best[0]:
                            best = (d2, node[yy, xx])
            if best is not None:
                break
        if best is not None:
            pnode[a] = best[1]

    SD = np.full((m, m), np.inf)
    valid_src = [a for a in range(m) if pnode[a] >= 0]
    for a in valid_src:
        dist = dijkstra(graph, directed=False, indices=int(pnode[a]), limit=SEA_ROUTE_LIMIT)
        for b in valid_src:
            # + distance from port to its cell (small)
            SD[a, b] = dist[pnode[b]]
    SD = np.minimum(SD, SD.T)
    np.fill_diagonal(SD, np.inf)

    def land_frac(a, b):
        """Land share of the straight port-port segment, ignoring 20 km at each end (estuaries)."""
        k = max(6, int(D[a, b] / 10))
        t = np.linspace(0, 1, k + 2)[1:-1]
        if D[a, b] > 60:
            e = 20.0 / D[a, b]
            t = t[(t > e) & (t < 1 - e)]
        return float(np.mean(shapely.contains_xy(land_eroded, P[a, 0] + (P[b, 0] - P[a, 0]) * t,
                                                 P[a, 1] + (P[b, 1] - P[a, 1]) * t)))

    ok = {}
    for a in range(m):
        for b in range(a + 1, m):
            if D[a, b] > SEA_MAX_KM or not np.isfinite(SD[a, b]):
                continue
            if SD[a, b] <= 1.5 * D[a, b] + 50 and land_frac(a, b) <= SEA_LAND_FRAC:
                ok[(a, b)] = SD[a, b]
            elif D[a, b] <= 250 and SD[a, b] <= 1.25 * D[a, b] + 25:  # short coast-hugging hop
                ok[(a, b)] = SD[a, b]
    deg = Counter()
    for a, b in ok:
        deg[a] += 1
        deg[b] += 1
    for a in range(m):  # >= 2 links each: nearest by water, penalising segments over land
        cand = [int(b) for b in np.argsort(SD[a])[:8] if np.isfinite(SD[a, b])]
        cand.sort(key=lambda b: SD[a, b] * (1 + 2 * land_frac(min(a, b), max(a, b))))
        for b in cand:
            if deg[a] >= 2:
                break
            key = (min(a, b), max(a, b))
            if key not in ok:
                ok[key] = SD[a, b]
                deg[a] += 1
                deg[int(b)] += 1
    for a in range(m):  # ports without water routing (should not happen): straight fallback
        if deg[a] == 0:
            for b in np.argsort(D[a])[1:3]:
                ok[(min(a, int(b)), max(a, int(b)))] = D[a, b]
            print("  WARNING: port without water route:", provinces[coast_ids[a]]["name"])
    if canal:
        ia, ib = coast_ids.index(canal[0]), coast_ids.index(canal[1])
        ok[(min(ia, ib), max(ia, ib))] = max(D[ia, ib], 190.0)

    # join components that are connected by water
    while True:
        par = list(range(m))

        def find(x):
            while par[x] != x:
                par[x] = par[par[x]]
                x = par[x]
            return x
        for a, b in ok:
            par[find(a)] = find(b)
        comp = np.array([find(a) for a in range(m)])
        best = None
        for c in set(comp.tolist()):
            ins = np.nonzero(comp == c)[0]
            outs = np.nonzero(comp != c)[0]
            if len(outs) == 0:
                continue
            sub = SD[np.ix_(ins, outs)]
            k = np.argmin(sub)
            v = sub.flat[k]
            if np.isfinite(v) and (best is None or v < best[0]):
                best = (v, int(ins[k // len(outs)]), int(outs[k % len(outs)]))
        if best is None:
            break
        _, a, b = best
        ok[(min(a, b), max(a, b))] = SD[a, b]
        print(f"  join link: {provinces[coast_ids[a]]['cc']}:{provinces[coast_ids[a]]['name']} <-> "
              f"{provinces[coast_ids[b]]['cc']}:{provinces[coast_ids[b]]['name']} {SD[a, b]:.0f} km by sea")
    links = []
    for (a, b), d in ok.items():
        i, j = sorted((coast_ids[a], coast_ids[b]))
        links.append([i, j, int(round(d))])
    return sorted(links)


def distribute_population(provinces, geoms, places, a0props, owner_of):
    n = len(provinces)
    tree = STRtree(geoms)
    city = np.zeros(n)
    cities = defaultdict(list)
    by_cc_idx = defaultdict(list)
    for i, p in enumerate(provinces):
        by_cc_idx[p["cc"]].append(i)
    for f in places["features"]:
        p = f["properties"]
        code = owner_of.get(p.get("adm0_a3"))
        if code is None:
            continue
        lon, lat = p["longitude"], p["latitude"]
        if lon < -100:
            lon += 360
        x, y = proj_xy(lon, lat)
        pt = Point(float(x), float(y))
        hits = [int(j) for j in tree.query(pt, predicate="intersects") if provinces[int(j)]["cc"] == code]
        if not hits:
            cands = by_cc_idx.get(code, [])
            if not cands:
                continue
            j = min(cands, key=lambda k: geoms[k].distance(pt))
            if geoms[j].distance(pt) > 30:
                continue
            hits = [j]
        city[hits[0]] += max(0, p.get("pop_max") or 0)
        cities[hits[0]].append((p.get("pop_max") or 0, pt))
    pops = np.zeros(n)
    for cc, idx in by_cc_idx.items():
        total = (a0props[cc]["POP_EST"] or 0)
        for k, v in MERGE_INTO.items():
            if v == cc and k in a0props and k not in ("KAS", "KAB"):
                total += a0props[k]["POP_EST"] or 0
        total /= 1e6
        areas = np.array([provinces[i]["area"] for i in idx])
        cpop = city[idx]
        wa = areas / areas.sum()
        if cpop.sum() > 0:
            w = 0.7 * cpop / cpop.sum() + 0.3 * wa
        else:
            w = wa
        pops[idx] = w * total
    return pops, cities


def report(data, merge_log, enclaves):
    provs = data["provinces"]
    print("=" * 70)
    print(f"size map.js: {os.path.getsize(OUT) / 1e6:.2f} MB   width={data['width']} height={data['height']}")
    print(f"provinces: {len(provs)}   countries: {len(data['countries'])}")
    print(f"seaLinks: {len(data['seaLinks'])}   straits: {len(data['straits'])}   background rings: {len(data['background'])}")
    cnt = Counter(p["cc"] for p in provs)
    pop = defaultdict(float)
    for p in provs:
        pop[p["cc"]] += p["pop"]
    for cc in sorted(cnt):
        n0, n1, t = merge_log[cc]
        print(f"  {cc} {data['countries'][cc]['name_en'][:28]:28s} prov={cnt[cc]:3d} (admin1={n0}, target={t})  pop={pop[cc]:.1f}M")
    sea_deg = Counter()
    for a, b, _ in data["seaLinks"]:
        sea_deg[a] += 1
        sea_deg[b] += 1
    st = Counter()
    for a, b in data["straits"]:
        st[a] += 1
        st[b] += 1
    iso = [p for p in provs if not p["nb"] and not sea_deg[p["id"]] and not st[p["id"]]]
    print(f"isolated provinces (no nb, no seaLinks, no straits): {len(iso)}")
    for p in iso:
        print("   ", p["id"], p["cc"], p["name"])
    noport_coastal = [p for p in provs if p["coastal"] and not sea_deg[p["id"]]]
    print(f"coastal without seaLinks: {len(noport_coastal)}", [(p['cc'], p['name']) for p in noport_coastal][:20])
    # sea graph components
    par = list(range(len(provs)))

    def find(x):
        while par[x] != x:
            par[x] = par[par[x]]
            x = par[x]
        return x
    for a, b, _ in data["seaLinks"]:
        par[find(a)] = find(b)
    comps = defaultdict(list)
    for p in provs:
        if p["coastal"]:
            comps[find(p["id"])].append(p["id"])
    print(f"sea graph components: {len(comps)}")
    for c in sorted(comps.values(), key=len, reverse=True)[:12]:
        print(f"   size {len(c)}: " + ", ".join(f"{provs[i]['cc']}:{provs[i]['name']}" for i in c[:6]))
    # land+strait components
    par = list(range(len(provs)))
    for p in provs:
        for q in p["nb"]:
            par[find(p["id"])] = find(q)
    for a, b in data["straits"]:
        par[find(a)] = find(b)
    lc = Counter(find(p["id"]) for p in provs)
    print(f"land(+straits) components: {len(lc)}")
    print(f"enclaves (provinces inside another one's outer ring; ordered last): {enclaves}")
    bad = [p for p in provs if not any(point_in_ring(p['cx'], p['cy'], r) for r in p['poly'])]
    print(f"label points outside polygon: {len(bad)}")
    print("terrain:", Counter(p["terrain"] for p in provs))
    cpath = os.path.join(ROOT, "data", "countries.js")
    if os.path.exists(cpath):
        import subprocess
        try:
            keys = json.loads(subprocess.check_output(
                ["node", "-e", "global.window={};require(process.argv[1]);"
                 "console.log(JSON.stringify(Object.keys(window.COUNTRY_DATA||{})))", cpath]))
            mine = set(data["countries"])
            print(f"COUNTRY_DATA keys: {len(keys)}; map countries: {len(mine)}")
            print("  in map, missing in COUNTRY_DATA:", sorted(mine - set(keys)))
            print("  in COUNTRY_DATA, missing in map:", sorted(set(keys) - mine))
        except Exception as e:  # node missing etc.
            print("COUNTRY_DATA check skipped:", e)


def point_in_ring(x, y, r):
    xs, ys = r[0::2], r[1::2]
    inside = False
    j = len(xs) - 1
    for i in range(len(xs)):
        if (ys[i] > y) != (ys[j] > y) and x < (xs[j] - xs[i]) * (y - ys[i]) / (ys[j] - ys[i] + 1e-12) + xs[i]:
            inside = not inside
        j = i
    return inside


def render_preview(data, path=PREVIEW, scale=1.0, crop=None):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.collections import PolyCollection, LineCollection
    W, H = data["width"], data["height"]
    x0, y0, x1, y1 = crop or (0, 0, W, H)
    fig = plt.figure(figsize=((x1 - x0) / 200 * scale, (y1 - y0) / 200 * scale), dpi=100)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_facecolor("#9cc3e0")
    fig.patch.set_facecolor("#9cc3e0")
    bg = [np.array(r).reshape(-1, 2) for r in data["background"]]
    ax.add_collection(PolyCollection(bg, facecolors="#bbbbbb", edgecolors="#999999", linewidths=0.2))
    ccs = sorted(data["countries"])
    rng = np.random.RandomState(7)
    cmap = {cc: rng.rand(3) * 0.6 + 0.35 for cc in ccs}
    polys, cols = [], []
    for p in data["provinces"]:
        for r in p["poly"]:
            polys.append(np.array(r).reshape(-1, 2))
            cols.append(cmap[p["cc"]])
    ax.add_collection(PolyCollection(polys, facecolors=cols, edgecolors="#333333", linewidths=0.15))
    pv = data["provinces"]
    segs = []
    for a, b, _ in data["seaLinks"]:
        pa, pb = pv[a]["port"], pv[b]["port"]
        segs.append([pa, pb])
    ax.add_collection(LineCollection(segs, colors="#1a4fa0", linewidths=0.15, alpha=0.6))
    ss = [[(pv[a]["cx"], pv[a]["cy"]), (pv[b]["cx"], pv[b]["cy"])] for a, b in data["straits"]]
    ax.add_collection(LineCollection(ss, colors="#d00000", linewidths=0.5))
    ax.scatter([p["cx"] for p in pv], [p["cy"] for p in pv], s=0.6, c="k", linewidths=0)
    ax.set_xlim(x0, x1)
    ax.set_ylim(y1, y0)
    ax.set_xticks([])
    ax.set_yticks([])
    fig.savefig(path, dpi=100)
    plt.close(fig)
    print("preview written:", path)


if __name__ == "__main__":
    main()
