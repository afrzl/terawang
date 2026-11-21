"""TERAWANG K1 · Prakiraan luas panen per kab (model gabungan) untuk bulan target tertentu, dipakai oleh K2.

Gabungan = w1 x Citra (koefisien per kab) + w2 x Rata-rata musiman + w3 x Tahun lalu, bobot NNLS leave-one-year-out pada tahun latih.
Taksiran citra per jarak waktu: lead 0 (bulan berjalan), 28 hari (bulan depan), 56 hari (dua bulan lagi).

  from k1_prakiraan import prakiraan
  prakiraan(tr=list(range(2019, 2026)), targets=[(2026, 11, 0), (2026, 12, 1), (2027, 1, 2)])
"""
import os
import sys

import numpy as np
import pandas as pd
from scipy.optimize import nnls

sys.path.insert(0, "scripts/k1")
from nowcast_eval import muat_bps  # noqa: E402

LEAD = {0: 0, 1: 28, 2: 56}
FIT3 = ["sat_kab", "klim", "musiman"]


def prakiraan(tr, targets):
    y = muat_bps()
    Yw = y.pivot(index=["kabkota", "bulan"], columns="tahun", values="y")

    def est_wide(est):
        e = est.copy()
        e["tahun"], e["bulan"] = (e.t - 1) // 12, (e.t - 1) % 12 + 1
        e.loc[(e.tahun == 2019) & (e.bulan <= 3), "est"] = np.nan
        return e.pivot(index=["kabkota", "bulan"], columns="tahun", values="est").reindex(Yw.index)

    ES = {}
    for h, L in LEAD.items():
        a = pd.read_csv(f"data/satelit/est_nowcast2_lead{L}.csv")[["kabkota", "t", "est"]]
        b = pd.read_csv(os.path.join(os.environ.get("TERAWANG_K1_DIR", "data/satelit"), f"est_nowcast2_lead{L}_2026.csv"))[["kabkota", "t", "est"]]
        ES[h] = est_wide(pd.concat([a, b]).drop_duplicates(["kabkota", "t"], keep="last"))

    def latih(E, trn):
        sy, se = Yw[trn].sum(axis=1, min_count=1), E[trn].sum(axis=1, min_count=1)
        m = sy.notna() & se.notna() & (se > 0)
        bg = sy[m].sum() / se[m].sum()
        tau = se[m].groupby(level=0).sum().mean() / max(len(trn), 1)
        bk = (sy[m].groupby(level=0).sum() + tau * bg) / (se[m].groupby(level=0).sum() + tau)
        return bg, bk, Yw[trn].mean(axis=1)

    def pred(E, par, th, prev_y):
        bg, bk, clim = par
        es = E[th].fillna(0) if th in E.columns else pd.Series(0.0, index=Yw.index)
        return pd.DataFrame({"sat_kab": es.to_numpy() * bk.reindex(es.index.get_level_values(0)).to_numpy(), "klim": clim.to_numpy(),
                             "musiman": Yw[prev_y].fillna(clim).to_numpy()}, index=es.index)

    def bobot(E, trn):
        rows = []
        for th in trn:
            lain = [x for x in trn if x != th]
            if th == 2019 or not lain:
                continue
            rows.append(pred(E, latih(E, lain), th, th - 1).assign(y=Yw[th].to_numpy()).dropna())
        d = pd.concat(rows)
        return nnls(d[FIT3].to_numpy(), d.y.to_numpy())[0]

    hasil = {}
    for h in sorted({h for _, _, h in targets}):
        par = latih(ES[h], tr)
        w = bobot(ES[h], tr)
        hasil[h] = (par, w)
    out = {}
    for ty, tm, h in targets:
        par, w = hasil[h]
        p = pred(ES[h], par, ty, max(tr))
        sel = p.index.get_level_values(1) == tm
        v = pd.Series(p[FIT3].to_numpy()[sel] @ w, index=p.index.get_level_values(0)[sel])
        out[(ty, tm)] = v
    return pd.DataFrame(out)
