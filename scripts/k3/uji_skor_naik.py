"""TERAWANG K3a · Uji skor "kecenderungan naik >= 2%" dari prakiraan GNN-tanpa-graf / RIDGE (27 Nov 2026). TIDAK dipakai operasional.

Masukan: data/satelit/uji_spasio_temporal_medium.csv.gz (prakiraan di luar sampel dari uji_spasio_temporal.py).
Kategori per asal t, tanpa melihat label: tinggi = skor >= persentil 90 skor 180 hari asal sebelumnya, sedang = persentil 70-90, rendah = sisanya.
Dicetak: porsi kejadian naik >= 2% per kategori, per horizon, per kuartal, dan untuk kab yang masih di bawah HET.

  python scripts/k3/uji_skor_naik.py [--model GNN-tanpa-graf]
"""
import argparse
import sys

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

sys.path.insert(0, "scripts/k3")
import uji_spasio_temporal as ust  # noqa: E402

KAT = ["tinggi", "sedang", "rendah"]


def kategori(d):
    out = []
    for t in np.sort(d.tgl.unique()):
        past = d[(d.tgl < t) & (d.tgl >= t - np.timedelta64(180, "D"))].yhat
        if len(past) < 38 * 60:
            continue
        q90, q70 = np.quantile(past, [0.9, 0.7])
        cur = d[d.tgl == t]
        out.append(cur.assign(kat=np.where(cur.yhat >= q90, "tinggi", np.where(cur.yhat >= q70, "sedang", "rendah"))))
    return pd.concat(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="GNN-tanpa-graf")
    a = ap.parse_args()
    P, _ = ust.muat("medium")
    p0 = P.rename_axis(columns="kab").stack().rename("p0")
    g = pd.read_csv("data/satelit/uji_spasio_temporal_medium.csv.gz", parse_dates=["tgl"])
    for h in ust.HOR:
        o = kategori(g[(g.model == a.model) & (g.h == h)].sort_values("tgl")).join(p0, on=["tgl", "kab"])
        o["naik"] = o.y > 0.02
        o["q"] = o.tgl.dt.to_period("Q").astype(str)
        het = np.where(o.tgl >= pd.Timestamp("2025-08-22"), 13500, 12500)
        print(f"\n{a.model} h{h}: prevalensi naik>=2% {o.naik.mean():.3f}; AUC 2025 {roc_auc_score(o[o.tgl.dt.year == 2025].naik, o[o.tgl.dt.year == 2025].yhat):.3f}, "
              f"2026 {roc_auc_score(o[o.tgl.dt.year == 2026].naik, o[o.tgl.dt.year == 2026].yhat):.3f}")
        t = o.groupby("kat").agg(n=("y", "size"), naik=("naik", "mean"))
        t["tertangkap"] = o.groupby("kat").naik.sum() / o.naik.sum()
        print(t.reindex(KAT).round(3).to_string())
        print(o.pivot_table(index="q", columns="kat", values="naik", aggfunc="mean").reindex(columns=KAT).round(3).to_string())
        b = o[o.p0 < het]
        print("kab < HET:", b.pivot_table(index=b.tgl.dt.year, columns="kat", values="naik", aggfunc="mean").reindex(columns=KAT).round(3).to_dict("index"))


if __name__ == "__main__":
    main()
