"""TERAWANG · Fase tumbuh padi per kab/kota per bulan dari titik sampel sawah (Sentinel-2 EVI/LSWI, cadangan Sentinel-1 VV).

Masukan: data/satelit/s2_titik_12harian_kabkota.csv.gz dan vv_titik_12harian_kabkota.csv.gz (400 titik sawah per kab/kota,
akuisisi tiap 12 hari; folder bisa diganti lewat TERAWANG_TITIK_DIR atau argumen --folder).

Aturan per titik per akuisisi (EVI, versi titik dari aturan NDVI di scripts/gee/terawang_wilayah.py):
  olah tanah/genangan : LSWI + 0,05 >= EVI dan EVI < 0,20 (Xiao dkk. 2005); bila S2 berawan: VV < -16 dB
  siap panen          : EVI >= 0,20, turun > 0,08 dibanding 2 akuisisi (24 hari) sebelumnya, puncak 72 hari terakhir >= 0,40
  generatif           : EVI >= 0,45
  vegetatif           : 0,20 <= EVI < 0,45
  bera                : selain itu
  tanaman lain        : vegetatif/generatif/siap panen tanpa genangan dalam 10 akuisisi (120 hari) sebelumnya, yaitu tanaman
                        hijau yang bukan padi (tebu, tembakau, palawija, kebun di lahan pertanian WorldCover)
Persen per bulan = porsi semua pasangan (titik, akuisisi) dalam bulan itu, hanya pengamatan yang ada.

Uji (26 Nov 2026), korelasi antar-kab rata-rata per bulan 2024-2025 dengan luas panen BPS (luas = porsi × luas sawah):
  generatif + siap panen bulan m vs panen bulan m+1: tanpa penyaring siklus 0,62 -> dengan penyaring 0,83
  siap panen bulan m vs panen bulan m: 0,58 -> 0,70
Tanpa penyaring, kab dengan tebu/tembakau (Jember, Kediri) tampak paling banyak padi generatif; dengan penyaring urutan Nov 2026
(Ngawi, Madiun teratas) sesuai pola BPS Nov 2024-2025. Belum divalidasi lapangan.

  python scripts/k1/fase_bulanan.py [--folder data/satelit] [--keluar fase_bulanan.json]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import warnings

import numpy as np
import pandas as pd

FASE = ["Bera", "Olah tanah/genangan", "Vegetatif", "Generatif", "Siap panen", "Tanaman lain"]
AMBANG = dict(veg=0.20, gen=0.45, turun=0.08, puncak=0.40, vv_air=-16.0)
SIKLUS = 10  # akuisisi (120 hari): padi hanya bila sawah tergenang dalam rentang ini sebelumnya
MIN_PENGAMATAN = 50  # per kab per bulan


def klasifikasi(E: np.ndarray, L: np.ndarray, V: np.ndarray | None) -> np.ndarray:
    """Kelas fase 0-5 per (titik, akuisisi); -1 bila tidak teramati. 5 = tanaman lain (hijau tanpa genangan sebelumnya)."""
    n, T = E.shape
    K = np.full((n, T), -1)
    G = np.zeros((n, T), bool)
    with np.errstate(invalid="ignore"), warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # nanmax pada kolom semua-NaN
        for j in range(T):
            e, l = E[:, j], L[:, j]
            ada = np.isfinite(e)
            lalu = E[:, j - 2] if j >= 2 else np.full(n, np.nan)
            puncak = np.nanmax(E[:, max(0, j - 6):j + 1], axis=1)
            k = np.where(ada, 0, -1)
            k = np.where(ada & (e >= AMBANG["veg"]) & (e < AMBANG["gen"]), 2, k)
            k = np.where(ada & (e >= AMBANG["gen"]), 3, k)
            k = np.where(ada & (e >= AMBANG["veg"]) & (e - lalu < -AMBANG["turun"]) & (puncak >= AMBANG["puncak"]), 4, k)
            genang = ada & (l + 0.05 >= e) & (e < AMBANG["veg"])
            if V is not None:
                genang |= ~ada & (V[:, j] < AMBANG["vv_air"])
            K[:, j] = np.where(genang, 1, k)
            G[:, j] = genang
    # siklus padi: tanaman hijau dihitung padi hanya bila sawah tergenang dalam SIKLUS akuisisi sebelumnya
    cs = np.cumsum(G, axis=1)
    lalu = np.concatenate([np.zeros((n, SIKLUS + 1), int), cs[:, :-SIKLUS - 1]], axis=1)[:, :T]
    aktif = cs - lalu > 0
    return np.where((K >= 2) & ~aktif, 5, K)


def hitung(folder: str | os.PathLike) -> dict:
    folder = pathlib.Path(folder)
    s2 = pd.read_csv(folder / "s2_titik_12harian_kabkota.csv.gz")
    tanggal = sorted(c[4:] for c in s2.columns if c.startswith("evi_2"))
    E = s2[[f"evi_{t}" for t in tanggal]].to_numpy(float)
    L = s2[[f"lswi_{t}" for t in tanggal]].to_numpy(float)
    rusak = (E < -0.2) | (E > 1.0) | ~np.isfinite(E) | ~np.isfinite(L)  # piksel awan/bayangan yang lolos mask
    E[rusak], L[rusak] = np.nan, np.nan
    V = None
    f_vv = folder / "vv_titik_12harian_kabkota.csv.gz"
    if f_vv.exists():
        vv = pd.read_csv(f_vv)
        if len(vv) == len(s2) and (vv.kabkota.to_numpy() == s2.kabkota.to_numpy()).all():
            V = vv.reindex(columns=tanggal).to_numpy(float)
    K = klasifikasi(E, L, V)
    kab = s2.kabkota.to_numpy()
    bl = pd.PeriodIndex(pd.to_datetime(tanggal), freq="M")
    bulan = {}
    for b in bl.unique():
        js = np.where(bl == b)[0]
        wil = {}
        for kb in np.unique(kab):
            v = K[kab == kb][:, js]
            v = v[v >= 0]
            if len(v) >= MIN_PENGAMATAN:
                wil[str(kb)] = [round(float(x), 1) for x in np.bincount(v, minlength=len(FASE)) / len(v) * 100]
        if wil:
            bulan[str(b)] = {"tanggal": [tanggal[j] for j in js], "wilayah": wil}
    return {"dibuat": dt.datetime.now().isoformat(timespec="seconds"), "fase": FASE, "ambang_evi": AMBANG,
            "tanggal_terakhir": tanggal[-1], "titik_per_wilayah": int(pd.Series(kab).value_counts().median()),
            "sumber": "titik sampel sawah Sentinel-2 EVI/LSWI (cadangan Sentinel-1 VV) tiap 12 hari, aturan ambang, belum divalidasi lapangan",
            "bulan": bulan}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--folder", default=os.environ.get("TERAWANG_TITIK_DIR", "data/satelit"))
    ap.add_argument("--keluar", default="fase_bulanan.json")
    a = ap.parse_args()
    isi = hitung(a.folder)
    pathlib.Path(a.keluar).write_text(json.dumps(isi, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{a.keluar}: {len(isi['bulan'])} bulan, akuisisi terakhir {isi['tanggal_terakhir']}")
