"""TERAWANG · Jarak antar 38 kab/kota Jawa Timur (garis lurus dan jalan).

Masukan : public/citra/jatim/kab.geojson  (batas 38 kab/kota, FAO GAUL 2015, dibuat scripts/gee/terawang_jatim.py)
Layanan : OSRM demo publik (https://router.project-osrm.org), data OpenStreetMap, profil mobil. Satu permintaan tabel 38 x 38.

Keluaran di <keluar>/ (default data/geografi/jarak_kabkota/):
  titik_pusat_kabkota_jatim.csv        titik pusat tiap wilayah (daratan utama) dan jarak geser ke jalan terdekat
  jarak_garis_lurus_km_kabkota.csv     matriks 38 x 38, haversine antar titik pusat
  jarak_jalan_km_kabkota.csv           matriks 38 x 38, jarak jalan OSRM
  waktu_tempuh_jam_kabkota.csv         matriks 38 x 38, waktu tempuh OSRM (arus bebas, bukan truk)

Titik pusat = titik pusat luas bagian terbesar (daratan utama) tiap wilayah, supaya pulau terpisah (Bawean, Kangean, dst.)
tidak menarik titik pusat ke laut. Jarak adalah antar titik pusat wilayah, bukan antar gudang atau pasar.

Pakai (dari root repo):
  python3 scripts/geo/jarak_kabkota.py
"""
import argparse
import csv
import json
import math
import pathlib
import statistics as st
import urllib.request

OSRM = "https://router.project-osrm.org/table/v1/driving/{coords}?annotations=distance,duration"
LAT0 = -7.5  # lintang acuan proyeksi ekuirektangular lokal (Jawa Timur)


def luas_dan_pusat(ring):
    kx = math.cos(math.radians(LAT0))
    pts = [(x * kx, y) for x, y in ring]
    A = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]):
        c = x0 * y1 - x1 * y0
        A += c
        cx += (x0 + x1) * c
        cy += (y0 + y1) * c
    A /= 2
    return abs(A), (cx / (6 * A) / kx, cy / (6 * A))


def titik_pusat(feature):
    g = feature["geometry"]
    polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
    bagian = [luas_dan_pusat(p[0]) for p in polys]
    total = sum(a for a, _ in bagian)
    a, c = max(bagian, key=lambda x: x[0])
    return c, len(bagian), a / total


def haversine(a, b):
    R = 6371.0088
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dl, dp = math.radians(b[0] - a[0]), p2 - p1
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def tulis_matriks(path, labels, M, fmt):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["dari"] + labels)
        for lab, row in zip(labels, M):
            w.writerow([lab] + [fmt(x) for x in row])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--geojson", default="public/citra/jatim/kab.geojson")
    ap.add_argument("--keluar", default="data/geografi/jarak_kabkota")
    args = ap.parse_args()
    out = pathlib.Path(args.keluar)
    out.mkdir(parents=True, exist_ok=True)

    fitur = json.load(open(args.geojson, encoding="utf-8"))["features"]
    nama_repo = [f["properties"]["n"] for f in fitur]
    assert len(nama_repo) == 38
    wilayah = ["Kota Batu" if n == "Batu" else n for n in nama_repo]  # penamaan BPS, sama dengan data/bps/
    jenis = ["kota" if w.startswith("Kota ") else "kabupaten" for w in wilayah]
    pusat, bagian, persen = zip(*[titik_pusat(f) for f in fitur])

    coords = ";".join(f"{x:.5f},{y:.5f}" for x, y in pusat)
    req = urllib.request.Request(OSRM.format(coords=coords), headers={"User-Agent": "terawang-research/1.0"})
    r = json.load(urllib.request.urlopen(req, timeout=120))
    assert r.get("code") == "Ok", r.get("code")
    D = [[None if x is None else x / 1000 for x in row] for row in r["distances"]]
    T = [[None if x is None else x / 3600 for x in row] for row in r["durations"]]
    assert all(x is not None for row in D for x in row), "ada pasangan tanpa rute"
    L = [[haversine(a, b) for b in pusat] for a in pusat]

    with open(out / "titik_pusat_kabkota_jatim.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["wilayah", "jenis", "nama_repo", "lon", "lat", "bagian_poligon", "daratan_utama_persen_luas", "geser_ke_jalan_m"])
        for i in range(38):
            w.writerow([wilayah[i], jenis[i], nama_repo[i], f"{pusat[i][0]:.5f}", f"{pusat[i][1]:.5f}", bagian[i],
                        f"{100 * persen[i]:.0f}", f"{r['sources'][i]['distance']:.0f}"])
    tulis_matriks(out / "jarak_garis_lurus_km_kabkota.csv", wilayah, L, lambda x: f"{x:.1f}")
    tulis_matriks(out / "jarak_jalan_km_kabkota.csv", wilayah, D, lambda x: f"{x:.1f}")
    tulis_matriks(out / "waktu_tempuh_jam_kabkota.csv", wilayah, T, lambda x: f"{x:.2f}")

    # ---- validasi
    pas = [(i, j) for i in range(38) for j in range(38) if i != j]
    asim = [abs(D[i][j] - D[j][i]) for i, j in pas]
    rasio = [D[i][j] / L[i][j] for i, j in pas if L[i][j] > 1]
    geser = [s["distance"] for s in r["sources"]]
    print(f"diagonal nol: {all(D[i][i] == 0 and L[i][i] == 0 for i in range(38))}")
    print(f"asimetri jarak jalan (km): maks {max(asim):.1f}, median {st.median(asim):.2f}")
    print(f"rasio jalan/garis lurus: min {min(rasio):.2f}, median {st.median(rasio):.2f}, maks {max(rasio):.2f}")
    print(f"pasangan dengan jalan < 0,97 x garis lurus: {sum(1 for x in rasio if x < 0.97)}")
    print(f"titik bergeser ke jalan: median {st.median(geser):.0f} m, maks {max(geser):.0f} m")
    print("selesai:", sorted(p.name for p in out.iterdir()))


if __name__ == "__main__":
    main()
