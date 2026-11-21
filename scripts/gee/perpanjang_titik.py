"""TERAWANG K1 · Perpanjang deret 12-harian VH, VV, LSWI/EVI di titik sawah yang SAMA dengan berkas yang sudah ada.

Dipakai pipeline Dagster supaya taksiran citra K1 (scripts/k1/nowcast_est2.py) ikut citra terbaru tanpa mengambil ulang
seluruh deret. Titik tidak diambil acak ulang: lon/lat dibaca dari berkas VH yang ada. Jendela 12 hari mengikuti
vh_sampel_titik.jendela(); dua jendela terakhir yang sudah ada diambil ulang (mungkin belum lengkap saat diambil),
lalu ditambah jendela baru yang mulainya sebelum --sampai.

  python scripts/gee/perpanjang_titik.py --project ID_PROJECT_GEE --dasar data/satelit --keluar ~/.local/share/terawang/titik
  hasil: <keluar>/{vh,vv,s2}_titik_12harian_kabkota.csv.gz (format sama dengan berkas di data/satelit)
"""
import argparse
import concurrent.futures as cf
import datetime as dt
import pathlib
import sys
import time

import ee
import pandas as pd

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from s2_titik import ambil as ambil_s2  # noqa: E402
from vh_sampel_titik import jendela  # noqa: E402

BERKAS = {"vh": "vh_titik_12harian_kabkota.csv.gz", "vv": "vv_titik_12harian_kabkota.csv.gz", "s2": "s2_titik_12harian_kabkota.csv.gz"}
ULANG = 2  # jendela terakhir yang diambil ulang


def ambil_s1(pts, wins, pol):
    """Median Sentinel-1 (VH atau VV) 12 hari per titik, sama dengan vv_titik.ambil()."""
    fc = ee.FeatureCollection([ee.Feature(ee.Geometry.Point([float(r.lon), float(r.lat)]), {"i": int(i)}) for i, r in enumerate(pts.itertuples())])
    aoi = fc.geometry().bounds()
    s1 = (ee.ImageCollection("COPERNICUS/S1_GRD").filterBounds(aoi).filter(ee.Filter.eq("instrumentMode", "IW"))
          .filter(ee.Filter.listContains("transmitterReceiverPolarisation", pol)).select(pol))
    pita = [s1.filterDate(ee.Date(d.isoformat()), ee.Date(d.isoformat()).advance(12, "day")).median().rename(f"v{i:02d}") for i, d in enumerate(wins)]
    res = ee.Image.cat(pita).reduceRegions(collection=fc, reducer=ee.Reducer.first(), scale=30, tileScale=8).getInfo()["features"]
    out = [[None] * len(wins) for _ in range(len(pts))]
    for f in res:
        p = f["properties"]
        out[p["i"]] = [None if p.get(f"v{k:02d}") is None else round(p[f"v{k:02d}"], 2) for k in range(len(wins))]
    return out


def coba(f, n=4):
    for i in range(n):
        try:
            return f()
        except Exception as e:  # batas laju/memori server EE: tunggu lalu ulang
            if i == n - 1:
                raise
            print(f"    ulang ({e.__class__.__name__}: {str(e)[:120]})", flush=True)
            time.sleep(20 * (i + 1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--dasar", default="data/satelit", help="folder berkas awal (dipakai bila --keluar belum berisi)")
    ap.add_argument("--keluar", required=True)
    ap.add_argument("--sampai", default=dt.date.today().isoformat(), help="jendela baru yang mulainya sebelum tanggal ini")
    ap.add_argument("--paralel", type=int, default=6)
    a = ap.parse_args()
    ee.Initialize(project=a.project)
    keluar = pathlib.Path(a.keluar).expanduser()
    keluar.mkdir(parents=True, exist_ok=True)
    sumber = keluar if all((keluar / b).exists() for b in BERKAS.values()) else pathlib.Path(a.dasar)
    d = {k: pd.read_csv(sumber / b) for k, b in BERKAS.items()}
    tgl_lama = [dt.date.fromisoformat(c) for c in d["vh"].columns[3:]]
    for k in ("vv", "s2"):
        assert (d[k].kabkota.to_numpy() == d["vh"].kabkota.to_numpy()).all(), f"urutan titik {k} beda dengan vh"
    assert [c for c in d["vv"].columns[3:]] == [t.isoformat() for t in tgl_lama], "jendela vv beda dengan vh"

    sampai = dt.date.fromisoformat(a.sampai)
    semua = list(jendela(tgl_lama[0], sampai))
    assert semua[:len(tgl_lama)] == tgl_lama, "jendela lama tidak mengikuti langkah 12 hari"
    mulai = max(0, len(tgl_lama) - ULANG)
    wins = semua[mulai:]
    print(f"sumber {sumber}; jendela lama {len(tgl_lama)} (terakhir {tgl_lama[-1]}), ambil {len(wins)} jendela {wins[0]}..{wins[-1]}", flush=True)
    if len(semua) == len(tgl_lama) and not wins:
        print("tidak ada jendela untuk diambil")
        return

    kol = [w.isoformat() for w in wins]
    hasil = {}

    def satu(nama, g):
        pts = g[["lon", "lat"]].reset_index(drop=True)
        vh = coba(lambda: ambil_s1(pts, wins, "VH"))
        vv = coba(lambda: ambil_s1(pts, wins, "VV"))
        s2 = coba(lambda: ambil_s2(nama, pts, wins))
        return nama, g.index, vh, vv, s2

    t0 = time.time()
    with cf.ThreadPoolExecutor(a.paralel) as ex:
        for nama, idx, vh, vv, s2 in ex.map(lambda x: satu(*x), d["vh"].groupby("kabkota", sort=False)):
            hasil[nama] = (idx, vh, vv, s2)
            print(f"  {nama}: {len(idx)} titik ({time.time() - t0:.0f} detik)", flush=True)

    n = len(wins)
    baru = {"vh": pd.DataFrame(index=d["vh"].index, columns=kol, dtype=float), "vv": pd.DataFrame(index=d["vh"].index, columns=kol, dtype=float),
            "lswi": pd.DataFrame(index=d["vh"].index, columns=kol, dtype=float), "evi": pd.DataFrame(index=d["vh"].index, columns=kol, dtype=float)}
    for idx, vh, vv, s2 in hasil.values():
        baru["vh"].loc[idx] = pd.DataFrame(vh, index=idx, columns=kol).astype(float)
        baru["vv"].loc[idx] = pd.DataFrame(vv, index=idx, columns=kol).astype(float)
        s2d = pd.DataFrame([r[2:] for r in s2], index=idx, dtype=float)
        baru["lswi"].loc[idx] = s2d.iloc[:, :n].set_axis(kol, axis=1)
        baru["evi"].loc[idx] = s2d.iloc[:, n:].set_axis(kol, axis=1)

    simpan = len(tgl_lama) - ULANG if len(tgl_lama) > ULANG else 0
    tetap = [t.isoformat() for t in tgl_lama[:simpan]]
    vh_out = pd.concat([d["vh"][["kabkota", "lon", "lat"] + tetap], baru["vh"]], axis=1)
    vv_out = pd.concat([d["vv"][["kabkota", "lon", "lat"] + tetap], baru["vv"]], axis=1)
    s2_out = pd.concat([d["s2"][["kabkota", "lon", "lat"] + [f"lswi_{t}" for t in tetap]], baru["lswi"].add_prefix("lswi_"),
                        d["s2"][[f"evi_{t}" for t in tetap]], baru["evi"].add_prefix("evi_")], axis=1)
    for k, df in (("vh", vh_out), ("vv", vv_out), ("s2", s2_out)):
        tmp = keluar / (BERKAS[k] + ".tmp")
        df.to_csv(tmp, index=False, compression="gzip")
        tmp.replace(keluar / BERKAS[k])
    kosong = baru["vh"].isna().to_numpy().mean() * 100
    print(f"Tersimpan {len(vh_out)} titik x {len(vh_out.columns) - 3} jendela (terakhir {wins[-1]}; VH kosong pada jendela baru {kosong:.0f}%) di {keluar}")


if __name__ == "__main__":
    main()
