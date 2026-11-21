"""TERAWANG K1 · Deret VH Sentinel-1 12-harian pada titik-titik sawah acak per kab/kota.

Bahan untuk deteksi siklus tanam per piksel (scripts/k1/siklus_tanam.py), mengikuti ide tutorial
s1-rice-irrigation-tutorial (MIT): palung genangan lalu naik >= 4 dB ke kanopi = satu siklus.
Dihitung di server Earth Engine; yang turun hanya angka (sekitar 500 titik x 75 jendela per kab/kota).

  python scripts/gee/vh_sampel_titik.py --project ID_PROJECT_GEE [--wilayah Ngawi] [--n 500]
  hasil: data/satelit/vh_titik_12harian_kabkota.csv.gz (+ cache ~/.cache/terawang-gee-titik/)
"""
import argparse
import csv
import datetime as dt
import gzip
import json
import pathlib

import ee

from vh_panen_kabkota import WILAYAH, batas

CACHE = pathlib.Path.home() / ".cache" / "terawang-gee-titik"
SKALA = 30


def jendela(mulai: dt.date, akhir: dt.date, langkah=12):
    d = mulai
    while d < akhir:
        yield d
        d += dt.timedelta(days=langkah)


def ambil(nama, n, wins, seed=7):
    aoi = batas(nama)
    sawah = ee.ImageCollection("ESA/WorldCover/v200").first().eq(40).selfMask()
    s1 = (ee.ImageCollection("COPERNICUS/S1_GRD").filterBounds(aoi).filter(ee.Filter.eq("instrumentMode", "IW"))
          .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH")).select("VH"))
    pita = []
    for i, d in enumerate(wins):
        t0 = ee.Date(d.isoformat())
        pita.append(s1.filterDate(t0, t0.advance(12, "day")).median().rename(f"v{i:02d}"))
    img = ee.Image.cat(pita)
    # 1) titik acak hanya di sawah  2) deret VH di titik itu (jendela tanpa akuisisi tetap kosong, tidak membuang titik)
    titik = (sawah.unmask(0).rename("s").stratifiedSample(numPoints=n, classBand="s", region=aoi, scale=SKALA, seed=seed,
                                                           classValues=[1], classPoints=[n], geometries=True, tileScale=8)
             .filter(ee.Filter.eq("s", 1)))
    fc = img.reduceRegions(collection=titik, reducer=ee.Reducer.first(), scale=SKALA, tileScale=8)
    baris = []
    for f in fc.getInfo()["features"]:
        p = f["properties"]
        lon, lat = f["geometry"]["coordinates"]
        baris.append([nama, round(lon, 5), round(lat, 5)] + [None if p.get(f"v{i:02d}") is None else round(p[f"v{i:02d}"], 2) for i in range(len(wins))])
    return baris


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--mulai", default="2024-06-01")
    ap.add_argument("--akhir", default="2026-11-16")
    ap.add_argument("--n", type=int, default=400, help="titik acak di sawah per kab/kota")
    ap.add_argument("--wilayah", nargs="*")
    ap.add_argument("--out", default="data/satelit/vh_titik_12harian_kabkota.csv.gz")
    a = ap.parse_args()
    ee.Initialize(project=a.project)
    wins = list(jendela(dt.date.fromisoformat(a.mulai), dt.date.fromisoformat(a.akhir)))
    CACHE.mkdir(parents=True, exist_ok=True)

    semua = []
    for nama in (a.wilayah or WILAYAH):
        f = CACHE / f"{nama.lower().replace(' ', '-')}_{a.mulai}_{a.akhir}_{a.n}.json"
        if f.exists():
            baris = json.loads(f.read_text())
        else:
            baris = ambil(nama, a.n, wins)
            f.write_text(json.dumps(baris))
        print(f"  {nama}: {len(baris)} titik", flush=True)
        semua += baris

    out = pathlib.Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(out, "wt", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["kabkota", "lon", "lat"] + [d.isoformat() for d in wins])
        w.writerows(semua)
    print(f"Tersimpan {len(semua)} titik x {len(wins)} jendela di {out}")


if __name__ == "__main__":
    main()
