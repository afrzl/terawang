"""TERAWANG K1 · Riwayat citra 2018-2024 pada titik sawah yang sama (VH, VV Sentinel-1; LSWI, EVI Sentinel-2).

Menyambung ke belakang jendela 12-harian yang sudah ada (mulai 1 Jun 2024), supaya data BPS bulanan 2019-2024 bisa dipakai
mengkalibrasi metode. Titik diambil dari berkas VH yang ada (koordinatnya tetap).

  python scripts/gee/riwayat_titik.py --project ID --bagian 1/3     # ambil (bisa dijalankan paralel: 1/3, 2/3, 3/3)
  python scripts/gee/riwayat_titik.py --project ID --gabung         # gabungkan cache ke 3 berkas csv.gz
Cache: ~/.cache/terawang-gee-riwayat/
"""
import argparse
import csv
import datetime as dt
import gzip
import json
import pathlib
import time

import ee
import pandas as pd

from s2_titik import indeks
from vh_sampel_titik import jendela

CACHE = pathlib.Path.home() / ".cache" / "terawang-gee-riwayat"
TITIK = "data/satelit/vh_titik_12harian_kabkota.csv.gz"
CHUNK = 20


def daftar_jendela(mulai: dt.date, akhir: dt.date):
    """Jendela 12-harian yang berakhir tepat di 1 Jun 2024 (awal deret yang sudah ada), mundur sampai >= mulai."""
    jangkar = dt.date(2024, 6, 1)
    n = (jangkar - mulai).days // 12
    awal = jangkar - dt.timedelta(days=12 * n)
    return list(jendela(awal, akhir))


def coba(f, n=4):
    for k in range(n):
        try:
            return f()
        except ee.EEException as e:
            if k == n - 1:
                raise
            print("   ulang:", str(e)[:80], flush=True)
            time.sleep(20 * (k + 1))


def titik_fc(pts):
    return ee.FeatureCollection([ee.Feature(ee.Geometry.Point([float(r.lon), float(r.lat)]), {"i": int(i)}) for i, r in enumerate(pts.itertuples())])


def ambil_s1(pts, wins):
    fc = titik_fc(pts)
    aoi = fc.geometry().bounds()
    s1 = (ee.ImageCollection("COPERNICUS/S1_GRD").filterBounds(aoi).filter(ee.Filter.eq("instrumentMode", "IW"))
          .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH")).select(["VH", "VV"]))
    n = len(wins)
    vh = [[None] * n for _ in range(len(pts))]
    vv = [[None] * n for _ in range(len(pts))]
    for c0 in range(0, n, CHUNK):
        pita = []
        for k in range(c0, min(c0 + CHUNK, n)):
            t0 = ee.Date(wins[k].isoformat())
            pita.append(s1.filterDate(t0, t0.advance(12, "day")).median().rename([f"h{k:03d}", f"w{k:03d}"]))
        res = coba(lambda: ee.Image.cat(pita).reduceRegions(collection=fc, reducer=ee.Reducer.first(), scale=30, tileScale=8).getInfo()["features"])
        for f in res:
            i, p = f["properties"]["i"], f["properties"]
            for k in range(c0, min(c0 + CHUNK, n)):
                vh[i][k] = None if p.get(f"h{k:03d}") is None else round(p[f"h{k:03d}"], 2)
                vv[i][k] = None if p.get(f"w{k:03d}") is None else round(p[f"w{k:03d}"], 2)
    return vh, vv


def ambil_s2(pts, wins):
    fc = titik_fc(pts)
    aoi = fc.geometry().bounds()
    cs = ee.ImageCollection("GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED")
    s2 = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED").filterBounds(aoi).linkCollection(cs, ["cs_cdf"])
          .map(lambda i: i.select(["B2", "B4", "B8", "B11"]).updateMask(i.select("cs_cdf").gte(0.6))))
    n = len(wins)
    lswi = [[None] * n for _ in range(len(pts))]
    evi = [[None] * n for _ in range(len(pts))]
    for c0 in range(0, n, CHUNK):
        pita = []
        for k in range(c0, min(c0 + CHUNK, n)):
            t0 = ee.Date(wins[k].isoformat())
            kol = s2.filterDate(t0, t0.advance(12, "day"))
            kosong = ee.Image.constant([0, 0]).updateMask(ee.Image.constant(0))  # jendela tanpa citra: semua nilai kosong
            img = ee.Image(ee.Algorithms.If(kol.size().gt(0), indeks(kol.median()), kosong))
            pita.append(img.rename([f"l{k:03d}", f"e{k:03d}"]))
        res = coba(lambda: ee.Image.cat(pita).reduceRegions(collection=fc, reducer=ee.Reducer.first(), scale=10, tileScale=4).getInfo()["features"])
        for f in res:
            i, p = f["properties"]["i"], f["properties"]
            for k in range(c0, min(c0 + CHUNK, n)):
                lswi[i][k] = None if p.get(f"l{k:03d}") is None else round(p[f"l{k:03d}"], 3)
                evi[i][k] = None if p.get(f"e{k:03d}") is None else round(p[f"e{k:03d}"], 3)
    return lswi, evi


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project")
    ap.add_argument("--mulai", default="2018-08-01")
    ap.add_argument("--akhir", default="2024-06-01")
    ap.add_argument("--bagian", default="1/1")
    ap.add_argument("--wilayah", nargs="*")
    ap.add_argument("--gabung", action="store_true")
    a = ap.parse_args()
    d = pd.read_csv(TITIK)
    wins = daftar_jendela(dt.date.fromisoformat(a.mulai), dt.date.fromisoformat(a.akhir))
    nama_kab = list(d.kabkota.drop_duplicates())
    CACHE.mkdir(parents=True, exist_ok=True)

    if a.gabung:
        out = {"vh": [], "vv": [], "lswi": [], "evi": []}
        for nm in nama_kab:
            g = d[d.kabkota == nm].reset_index(drop=True)
            f1 = CACHE / f"{nm.lower().replace(' ', '-')}_s1.json"
            f2 = CACHE / f"{nm.lower().replace(' ', '-')}_s2.json"
            if not (f1.exists() and f2.exists()):
                raise SystemExit(f"cache belum lengkap untuk {nm}")
            s1, s2 = json.loads(f1.read_text()), json.loads(f2.read_text())
            for i in range(len(g)):
                base = [nm, round(float(g.lon[i]), 5), round(float(g.lat[i]), 5)]
                out["vh"].append(base + s1["vh"][i])
                out["vv"].append(base + s1["vv"][i])
                out["lswi"].append(base + s2["lswi"][i])
                out["evi"].append(base + s2["evi"][i])
        for k, nama in [("vh", "vh_titik_riwayat"), ("vv", "vv_titik_riwayat"), ("lswi", "lswi_titik_riwayat"), ("evi", "evi_titik_riwayat")]:
            p = pathlib.Path(f"data/satelit/{nama}_2018_2024.csv.gz")
            with gzip.open(p, "wt", newline="") as fh:
                w = csv.writer(fh)
                w.writerow(["kabkota", "lon", "lat"] + [x.isoformat() for x in wins])
                w.writerows(out[k])
            print("tersimpan", p, len(out[k]), "titik")
        return

    ee.Initialize(project=a.project)
    i_bag, n_bag = (int(x) for x in a.bagian.split("/"))
    tugas = [nm for j, nm in enumerate(nama_kab) if j % n_bag == i_bag - 1 and (not a.wilayah or nm in a.wilayah)]
    print(f"{len(wins)} jendela ({wins[0]} .. {wins[-1]}), {len(tugas)} wilayah: {tugas}", flush=True)
    for nm in tugas:
        g = d[d.kabkota == nm][["lon", "lat"]].reset_index(drop=True)
        base = nm.lower().replace(" ", "-")
        f1, f2 = CACHE / f"{base}_s1.json", CACHE / f"{base}_s2.json"
        t0 = time.time()
        if not f1.exists():
            vh, vv = ambil_s1(g, wins)
            f1.write_text(json.dumps({"vh": vh, "vv": vv}))
        if not f2.exists():
            lswi, evi = ambil_s2(g, wins)
            f2.write_text(json.dumps({"lswi": lswi, "evi": evi}))
        print(f"  {nm}: selesai ({time.time() - t0:.0f} detik)", flush=True)


if __name__ == "__main__":
    main()
