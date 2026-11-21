"""TERAWANG K1 · Deret VV Sentinel-1 12-harian pada titik sawah yang sama dengan vh_sampel_titik.py.

VV peka terhadap genangan (pantulan spekular air menurunkan VV lebih tegas daripada VH); dipakai sebagai fitur tambahan fusi.

  python scripts/gee/vv_titik.py --project ID_PROJECT_GEE [--wilayah Ngawi]
  hasil: data/satelit/vv_titik_12harian_kabkota.csv.gz (+ cache ~/.cache/terawang-gee-vv/)
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

CACHE = pathlib.Path.home() / ".cache" / "terawang-gee-vv"
TITIK = "data/satelit/vh_titik_12harian_kabkota.csv.gz"


def ambil(pts, wins):
    fc = ee.FeatureCollection([ee.Feature(ee.Geometry.Point([float(r.lon), float(r.lat)]), {"i": int(i)}) for i, r in enumerate(pts.itertuples())])
    aoi = fc.geometry().bounds()
    s1 = (ee.ImageCollection("COPERNICUS/S1_GRD").filterBounds(aoi).filter(ee.Filter.eq("instrumentMode", "IW"))
          .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV")).select("VV"))
    pita = []
    for i, d in enumerate(wins):
        t0 = ee.Date(d.isoformat())
        pita.append(s1.filterDate(t0, t0.advance(12, "day")).median().rename(f"v{i:02d}"))
    res = ee.Image.cat(pita).reduceRegions(collection=fc, reducer=ee.Reducer.first(), scale=30, tileScale=8).getInfo()["features"]
    out = [None] * len(pts)
    for f in res:
        p = f["properties"]
        out[p["i"]] = [None if p.get(f"v{k:02d}") is None else round(p[f"v{k:02d}"], 2) for k in range(len(wins))]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--wilayah", nargs="*")
    ap.add_argument("--out", default="data/satelit/vv_titik_12harian_kabkota.csv.gz")
    a = ap.parse_args()
    ee.Initialize(project=a.project)
    d = pd.read_csv(TITIK)
    wins = list(jendela(dt.date.fromisoformat(d.columns[3]), dt.date.fromisoformat("2026-11-16")))
    assert len(wins) == d.shape[1] - 3
    CACHE.mkdir(parents=True, exist_ok=True)

    semua = []
    for nama, g in d.groupby("kabkota", sort=False):
        if a.wilayah and nama not in a.wilayah:
            continue
        f = CACHE / f"{nama.lower().replace(' ', '-')}.json"
        if f.exists():
            baris = json.loads(f.read_text())
        else:
            baris = ambil(g[["lon", "lat"]].reset_index(drop=True), wins)
            f.write_text(json.dumps(baris))
        kosong = sum(v is None for r in baris for v in r) / (len(baris) * len(wins)) * 100
        print(f"  {nama}: {len(baris)} titik, sel kosong {kosong:.1f}%", flush=True)
        semua += [[nama, round(float(g.iloc[i].lon), 5), round(float(g.iloc[i].lat), 5)] + r for i, r in enumerate(baris)]

    out = pathlib.Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(out, "wt", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["kabkota", "lon", "lat"] + [x.isoformat() for x in wins])
        w.writerows(semua)
    print(f"Tersimpan {len(semua)} titik x {len(wins)} jendela di {out}")


if __name__ == "__main__":
    main()
