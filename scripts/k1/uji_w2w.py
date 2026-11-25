"""TERAWANG K1 · Uji taksiran luas panen wall-to-wall (nowcast_w2w.py) terhadap taksiran 400 titik sekarang.

Varian yang dimasukkan ke model gabungan (uji sama dengan uji_k1_ringkas.py: bergulir 2022-2025 dan produksi Jan-Sep 2026):
  titik      : est_nowcast2_lead{L}.csv (+ _2026), operasional sekarang
  w2w        : est_w2w_lead{L}.csv kolom est (dikoreksi rasio awan dari titik)
  w2w optik  : kolom est_optik (tanpa koreksi awan)
  rerata     : (titik + w2w) / 2
Ditambah diagnosa citra saja: WAPE bulanan per kab setelah diskalakan per kab dari 2019-2021, dinilai 2022-2025.

  python scripts/k1/uji_w2w.py <folder berisi est_w2w_lead{0,28,56}.csv>
"""
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, "scripts/k1")
import k1_prakiraan as kp  # noqa: E402
import uji_k1_ringkas as ur  # noqa: E402
from nowcast_eval import muat_bps  # noqa: E402
from uji_jeda_per_kab import pasang  # noqa: E402


def titik(L):
    a = pd.read_csv(f"data/satelit/est_nowcast2_lead{L}.csv")[["kabkota", "t", "est"]]
    p = f"data/satelit/est_nowcast2_lead{L}_2026.csv"
    if os.path.exists(p):
        a = pd.concat([a, pd.read_csv(p)[["kabkota", "t", "est"]]]).drop_duplicates(["kabkota", "t"], keep="last")
    return a


def w2w(folder, L, kolom="est"):
    e = pd.read_csv(os.path.join(folder, f"est_w2w_lead{L}.csv"))
    return e[["kabkota", "t", kolom]].rename(columns={kolom: "est"})


def rerata(folder, L):
    a, b = titik(L), w2w(folder, L)
    d = a.merge(b, on=["kabkota", "t"], how="outer", suffixes=("_a", "_b"))
    d["est"] = d[["est_a", "est_b"]].mean(axis=1)
    return d[["kabkota", "t", "est"]]


def diagnosa(est):
    """WAPE citra saja (skala per kab dari 2019-2021) pada 2022-2025, dan korelasi bulanan."""
    y = muat_bps().rename(columns={"y": "bps"})
    e = est.copy()
    e["tahun"], e["bulan"] = (e.t - 1) // 12, (e.t - 1) % 12 + 1
    d = e.merge(y, on=["kabkota", "tahun", "bulan"]).dropna(subset=["est", "bps"])
    d = d[~((d.tahun == 2019) & (d.bulan <= 3))]
    lat = d[d.tahun.between(2019, 2021)].groupby("kabkota")
    b = (lat.bps.sum() / lat.est.sum().clip(lower=1e-9)).rename("b")
    u = d[d.tahun.between(2022, 2025)].join(b, on="kabkota")
    u["p"] = u.est * u.b
    return ur.wape(u.bps, u.p), np.corrcoef(u.bps, u.p)[0, 1], ur.wape(u.bps.groupby([u.tahun, u.bulan]).sum(), u.p.groupby([u.tahun, u.bulan]).sum())


def main():
    folder = sys.argv[1]
    leads = list(kp.LEAD.values())
    varian = {
        "titik 400 (sekarang)": {L: titik(L) for L in leads},
        "w2w dikoreksi rasio": {L: w2w(folder, L) for L in leads},
        "w2w optik saja": {L: w2w(folder, L, "est_optik") for L in leads},
        "rerata titik + w2w": {L: rerata(folder, L) for L in leads},
    }
    print("diagnosa citra saja, 2022-2025 (skala per kab dari 2019-2021): WAPE kab-bulan | korelasi | WAPE total Jatim per bulan")
    for nama, est in varian.items():
        print(f"  {nama:22s}", " | ".join("L{}: {:5.1f}% r={:.3f} {:5.1f}%".format(L, *diagnosa(est[L])) for L in leads), flush=True)
    asli = kp.muat_citra
    for nama, est in varian.items():
        print(f"\n=== {nama}", flush=True)
        pasang(est)
        ur.main()
    kp.muat_citra = asli


if __name__ == "__main__":
    main()
