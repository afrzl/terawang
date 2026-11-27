"""TERAWANG K1 · LSWI dan EVI Sentinel-2 12-harian pada titik sawah yang sama dengan vh_sampel_titik.py.

Untuk aturan banjir berbasis optik (Xiao 2006, Dong 2016): tanggal tanam = jendela pertama dengan LSWI + 0,05 >= EVI.
Piksel berawan dibuang (Cloud Score+ >= 0,6). Jendela tanpa pengamatan jernih tetap kosong.

  python scripts/gee/s2_titik.py --project ID_PROJECT_GEE [--wilayah Ngawi]
  hasil: data/satelit/s2_titik_12harian_kabkota.csv.gz (+ cache ~/.cache/terawang-gee-s2/)
"""
import argparse
import csv
import datetime as dt
import gzip
import json
import pathlib

import ee
import pandas as pd

from vh_sampel_titik import jendela

CACHE = pathlib.Path.home() / ".cache" / "terawang-gee-s2"
TITIK = "data/satelit/vh_titik_12harian_kabkota.csv.gz"
CHUNK = 25  # jendela per panggilan, supaya tidak melebihi batas memori server


def indeks(img):
    b2, b4, b8, b11 = [img.select(b).divide(10000) for b in ("B2", "B4", "B8", "B11")]
    evi = b8.subtract(b4).multiply(2.5).divide(b8.add(b4.multiply(6)).subtract(b2.multiply(7.5)).add(1)).rename("evi")
    lswi = b8.subtract(b11).divide(b8.add(b11)).rename("lswi")
    return ee.Image.cat([lswi, evi])


def ambil(nama, pts, wins):
    """pts: DataFrame lon, lat untuk satu kab/kota. Kembalikan baris [lon, lat, lswi_0..lswi_n, evi_0..evi_n]."""
    fc = ee.FeatureCollection([ee.Feature(ee.Geometry.Point([float(r.lon), float(r.lat)]), {"i": int(i)}) for i, r in enumerate(pts.itertuples())])
    aoi = fc.geometry().bounds()
    cs = ee.ImageCollection("GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED")
    s2 = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED").filterBounds(aoi).linkCollection(cs, ["cs_cdf"])
          .map(lambda i: i.select(["B2", "B4", "B8", "B11"]).updateMask(i.select("cs_cdf").gte(0.6))))
    # jendela tanpa citra (mis. jendela terbaru yang belum ada akuisisi): median koleksi kosong = image tanpa band dan
    # select("B8") gagal. Satu image ter-mask penuh membuat koleksi tidak pernah kosong; hasilnya tetap kosong (None).
    kosong = ee.ImageCollection([ee.Image.constant([0, 0, 0, 0]).rename(["B2", "B4", "B8", "B11"]).toUint16().updateMask(0)])
    n = len(wins)
    lswi = [[None] * n for _ in range(len(pts))]
    evi = [[None] * n for _ in range(len(pts))]
    for c0 in range(0, n, CHUNK):
        pita = []
        for k in range(c0, min(c0 + CHUNK, n)):
            t0 = ee.Date(wins[k].isoformat())
            pita.append(indeks(s2.filterDate(t0, t0.advance(12, "day")).merge(kosong).median()).rename([f"l{k:02d}", f"e{k:02d}"]))
        res = ee.Image.cat(pita).reduceRegions(collection=fc, reducer=ee.Reducer.first(), scale=10, tileScale=4).getInfo()["features"]
        for f in res:
            i = f["properties"]["i"]
            for k in range(c0, min(c0 + CHUNK, n)):
                lswi[i][k] = f["properties"].get(f"l{k:02d}")
                evi[i][k] = f["properties"].get(f"e{k:02d}")
    return [[round(float(pts.iloc[i].lon), 5), round(float(pts.iloc[i].lat), 5)] + [None if v is None else round(v, 3) for v in lswi[i]] +
            [None if v is None else round(v, 3) for v in evi[i]] for i in range(len(pts))]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--wilayah", nargs="*")
    ap.add_argument("--out", default="data/satelit/s2_titik_12harian_kabkota.csv.gz")
    a = ap.parse_args()
    ee.Initialize(project=a.project)
    d = pd.read_csv(TITIK)
    wins = list(jendela(dt.date.fromisoformat(d.columns[3]), dt.date.fromisoformat("2026-11-16")))
    assert len(wins) == d.shape[1] - 3, "jendela tidak sama dengan berkas VH"
    CACHE.mkdir(parents=True, exist_ok=True)

    semua = []
    for nama, g in d.groupby("kabkota", sort=False):
        if a.wilayah and nama not in a.wilayah:
            continue
        f = CACHE / f"{nama.lower().replace(' ', '-')}.json"
        if f.exists():
            baris = json.loads(f.read_text())
        else:
            baris = ambil(nama, g[["lon", "lat"]].reset_index(drop=True), wins)
            f.write_text(json.dumps(baris))
        kosong = sum(v is None for r in baris for v in r[2:]) / (len(baris) * (len(baris[0]) - 2)) * 100
        print(f"  {nama}: {len(baris)} titik, sel kosong {kosong:.0f}%", flush=True)
        semua += [[nama] + r for r in baris]

    out = pathlib.Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(out, "wt", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["kabkota", "lon", "lat"] + [f"lswi_{x.isoformat()}" for x in wins] + [f"evi_{x.isoformat()}" for x in wins])
        w.writerows(semua)
    print(f"Tersimpan {len(semua)} titik x {len(wins)} jendela x 2 indeks di {out}")


if __name__ == "__main__":
    main()
