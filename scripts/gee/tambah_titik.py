"""TERAWANG K1 · Tambah titik sampel sawah per kab/kota (deret penuh VH, VV, LSWI, EVI 12-harian sejak Agu 2018).

Alasan (evaluasi 24 Nov 2026): dengan 400 titik per kab, rata-rata hanya ±15 titik yang "panen" per kab per bulan, sehingga
derau sampling saja ±26% per kab-bulan, hampir seluruh galat bulanan model (29%). Menambah titik menurunkan derau itu
sebanding 1/sqrt(n): 2.000 titik -> ±12%.

Titik baru diambil acak di sawah (ESA WorldCover kelas 40) dengan seed lain dari titik lama. Keluaran berisi HANYA titik baru,
dengan jendela persis sama dengan berkas lama, dalam struktur yang sama:
  <keluar>/{vh,vv,lswi,evi}_titik_riwayat_2018_2024.csv.gz   (jendela riwayat)
  <keluar>/{vh,vv,s2}_titik_12harian_kabkota.csv.gz          (jendela sesudahnya, sampai --sampai)
multitahun.muat() menggabungkannya bila env TERAWANG_TITIK_TAMBAHAN=<keluar>. Perpanjangan rutin: perpanjang_titik.py
dengan --dasar <keluar> --keluar <keluar>.

  python scripts/gee/tambah_titik.py --project ID_PROJECT_GEE --n 1600 --keluar ~/.local/share/terawang/titik_tambahan
  (cache per kab di <keluar>/_cache, jadi aman diulang bila terputus)
"""
import argparse
import concurrent.futures as cf
import datetime as dt
import json
import os
import pathlib
import sys
import time

import ee
import pandas as pd

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from perpanjang_titik import ambil_s1, coba  # noqa: E402
from s2_titik import ambil as ambil_s2  # noqa: E402
from vh_panen_kabkota import batas  # noqa: E402

CHUNK = 25  # jendela per panggilan Sentinel-1
BATCH = 400  # titik per panggilan


def sampel(nama, n, seed):
    aoi = batas(nama)
    sawah = ee.ImageCollection("ESA/WorldCover/v200").first().eq(40).selfMask()
    fc = (sawah.unmask(0).rename("s").stratifiedSample(numPoints=n, classBand="s", region=aoi, scale=30, seed=seed,
                                                        classValues=[1], classPoints=[n], geometries=True, tileScale=8)
          .filter(ee.Filter.eq("s", 1)))
    return pd.DataFrame([f["geometry"]["coordinates"] for f in fc.getInfo()["features"]], columns=["lon", "lat"]).round(5)


def s1_berpotong(pts, wins, pol):
    out = [[] for _ in range(len(pts))]
    for c0 in range(0, len(wins), CHUNK):
        part = coba(lambda: ambil_s1(pts, wins[c0:c0 + CHUNK], pol))
        for i, r in enumerate(part):
            out[i] += r
    return out


def satu(nama, n, seed, wins, cache, lama):
    f = cache / f"{nama.lower().replace(' ', '-')}.json"
    if f.exists():
        return nama, json.loads(f.read_text())
    pts = coba(lambda: sampel(nama, n, seed))
    # buang titik yang (hampir) sama dengan titik lama
    key = set(zip(lama.lon.round(4), lama.lat.round(4)))
    pts = pts[[(a, b) not in key for a, b in zip(pts.lon.round(4), pts.lat.round(4))]].reset_index(drop=True)
    vh, vv, s2 = [], [], []
    for b0 in range(0, len(pts), BATCH):  # 400 titik per panggilan, sama dengan ukuran berkas lama
        p = pts.iloc[b0:b0 + BATCH].reset_index(drop=True)
        vh += s1_berpotong(p, wins, "VH")
        vv += s1_berpotong(p, wins, "VV")
        s2 += coba(lambda: ambil_s2(nama, p, wins))
    d = {"lon": pts.lon.tolist(), "lat": pts.lat.tolist(), "vh": vh, "vv": vv, "s2": [r[2:] for r in s2]}
    f.write_text(json.dumps(d))
    return nama, d


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--dasar", default="data/satelit", help="folder berkas riwayat titik lama (acuan jendela)")
    ap.add_argument("--titik", default=os.environ.get("TERAWANG_TITIK_DIR", "data/satelit"), help="folder deret 12-harian lama")
    ap.add_argument("--keluar", required=True)
    ap.add_argument("--n", type=int, default=1600, help="titik BARU per kab/kota")
    ap.add_argument("--seed", type=int, default=101)
    ap.add_argument("--wilayah", nargs="*")
    ap.add_argument("--paralel", type=int, default=4)
    a = ap.parse_args()
    ee.Initialize(project=a.project)

    dasar, titik = pathlib.Path(a.dasar).expanduser(), pathlib.Path(a.titik).expanduser()
    keluar = pathlib.Path(a.keluar).expanduser()
    cache = keluar / "_cache"
    cache.mkdir(parents=True, exist_ok=True)
    rw = pd.read_csv(dasar / "vh_titik_riwayat_2018_2024.csv.gz", nrows=1)
    lama12 = pd.read_csv(titik / "vh_titik_12harian_kabkota.csv.gz")
    w_rw = list(rw.columns[3:])
    w_12 = list(lama12.columns[3:])
    wins = [dt.date.fromisoformat(c) for c in w_rw + w_12]
    assert all((b - a_).days == 12 for a_, b in zip(wins, wins[1:])), "jendela harus kontinu 12 hari"
    kab_urut = list(dict.fromkeys(lama12.kabkota))
    if a.wilayah:
        kab_urut = [k for k in kab_urut if k in a.wilayah]
    print(f"{len(kab_urut)} wilayah x {a.n} titik baru x {len(wins)} jendela ({wins[0]}..{wins[-1]})", flush=True)

    t0, hasil = time.time(), {}
    with cf.ThreadPoolExecutor(a.paralel) as ex:
        futs = [ex.submit(satu, k, a.n, a.seed, wins, cache, lama12[lama12.kabkota == k]) for k in kab_urut]
        for fu in cf.as_completed(futs):
            nama, d = fu.result()
            hasil[nama] = d
            print(f"  {nama}: {len(d['lon'])} titik ({time.time() - t0:.0f} detik)", flush=True)

    nr, n12, W = len(w_rw), len(w_12), len(wins)
    rows = {k: [] for k in ("vh", "vv", "lswi", "evi")}
    for nama in kab_urut:
        d = hasil[nama]
        for i in range(len(d["lon"])):
            base = [nama, d["lon"][i], d["lat"][i]]
            rows["vh"].append(base + d["vh"][i])
            rows["vv"].append(base + d["vv"][i])
            rows["lswi"].append(base + d["s2"][i][:W])
            rows["evi"].append(base + d["s2"][i][W:])
    kol = ["kabkota", "lon", "lat"]
    for k in ("vh", "vv", "lswi", "evi"):
        df = pd.DataFrame(rows[k], columns=kol + w_rw + w_12)
        df[kol + w_rw].to_csv(keluar / f"{k}_titik_riwayat_2018_2024.csv.gz", index=False, compression="gzip")
        rows[k] = df
    for k in ("vh", "vv"):
        rows[k][kol + w_12].to_csv(keluar / f"{k}_titik_12harian_kabkota.csv.gz", index=False, compression="gzip")
    s2 = pd.concat([rows["lswi"][kol + w_12], rows["evi"][w_12].add_prefix("evi_")], axis=1)
    s2.columns = kol + [f"lswi_{c}" for c in w_12] + list(s2.columns[3 + n12:])
    s2.to_csv(keluar / "s2_titik_12harian_kabkota.csv.gz", index=False, compression="gzip")
    print(f"Tersimpan {len(rows['vh'])} titik baru di {keluar} ({time.time() - t0:.0f} detik)")


if __name__ == "__main__":
    main()
