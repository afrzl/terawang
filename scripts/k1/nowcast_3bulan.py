"""TERAWANG K1 · Uji "3 bulan ke depan bergulir" dengan batas informasi nyata (sesuai kartu utama aplikasi).

Prakiraan diterbitkan tiap tanggal 1 bulan M untuk luas panen bulan M, M+1, M+2 per kabupaten/kota lalu dijumlahkan.
  bulan M   : taksiran citra jarak 0 hari  (est_nowcast2_lead0)
  bulan M+1 : taksiran citra jarak 28 hari (est_nowcast2_lead28)
  bulan M+2 : taksiran citra jarak 56 hari (est_nowcast2_lead56)
Data BPS yang tersedia pada tanggal terbit D: tahun final sampai Y-1 bila D >= 1 Maret tahun Y, selain itu sampai Y-2.
Model: musiman, klimatologi, citra per kab, gabungan (bobot NNLS leave-one-year-out). Target: jumlah luas panen BPS 3 bulan itu.

  python scripts/k1/nowcast_3bulan.py
"""
import datetime as dt
import sys

import numpy as np
import pandas as pd
from scipy.optimize import nnls

sys.path.insert(0, "scripts/k1")
from nowcast_eval import muat_bps, wape  # noqa: E402

MODEL = ("musiman", "klim", "sat_kab", "gabungan")
LEAD = {0: 0, 1: 28, 2: 56}


def main():
    y = muat_bps()
    Yw = y.pivot(index=["kabkota", "bulan"], columns="tahun", values="y")

    def est_wide(est):
        e = est.copy()
        e["tahun"], e["bulan"] = (e.t - 1) // 12, (e.t - 1) % 12 + 1
        e.loc[(e.tahun == 2019) & (e.bulan <= 3), "est"] = np.nan
        return e.pivot(index=["kabkota", "bulan"], columns="tahun", values="est").reindex(Yw.index)

    ES = {h: est_wide(pd.read_csv(f"data/satelit/est_nowcast2_lead{L}.csv")[["kabkota", "t", "est"]]) for h, L in LEAD.items()}

    def latih(E, tr):
        sy, se = Yw[tr].sum(axis=1, min_count=1), E[tr].sum(axis=1, min_count=1)
        m = sy.notna() & se.notna() & (se > 0)
        bg = sy[m].sum() / se[m].sum()
        tau = se[m].groupby(level=0).sum().mean() / max(len(tr), 1)
        bk = (sy[m].groupby(level=0).sum() + tau * bg) / (se[m].groupby(level=0).sum() + tau)
        return bg, bk, Yw[tr].mean(axis=1)

    def pred(E, par, th, prev_y):
        bg, bk, clim = par
        es = E[th].fillna(0)
        prev = Yw[prev_y].fillna(clim)
        return pd.DataFrame({"sat_kab": es.to_numpy() * bk.reindex(es.index.get_level_values(0)).to_numpy(), "klim": clim.to_numpy(), "musiman": prev.to_numpy()}, index=es.index)

    def bobot(E, tr):
        rows = []
        for th in tr:
            lain = [x for x in tr if x != th]
            if th == 2019 or not lain:
                continue
            rows.append(pred(E, latih(E, lain), th, th - 1).assign(y=Yw[th].to_numpy()).dropna())
        d = pd.concat(rows)
        return nnls(d[["sat_kab", "klim", "musiman"]].to_numpy(), d.y.to_numpy())[0]

    cache = {}

    def prediksi(h, tr, ty):
        key = (h, tuple(tr), ty)
        if key not in cache:
            kp = (h, tuple(tr))
            if kp not in cache:
                cache[kp] = (latih(ES[h], tr), bobot(ES[h], tr))
            par, w = cache[kp]
            p = pred(ES[h], par, ty, max(tr))
            p["gabungan"] = p[["sat_kab", "klim", "musiman"]].to_numpy() @ w
            cache[key] = p
        return cache[key]

    rows = []
    for Yi in range(2021, 2026):
        for M in range(1, 13):
            D = dt.date(Yi, M, 1)
            tr = list(range(2019, Yi)) if D >= dt.date(Yi, 3, 1) else list(range(2019, Yi - 1))
            if len(tr) < 2:
                continue
            tg = [(Yi + (M - 1 + h) // 12, (M - 1 + h) % 12 + 1) for h in (0, 1, 2)]
            if any(ty > 2025 for ty, _ in tg):
                continue
            acc = {m: None for m in MODEL}
            act = None
            for h, (ty, tm) in enumerate(tg):
                p = prediksi(h, tr, ty)
                sel = p.index.get_level_values(1) == tm
                a = Yw[ty][sel].droplevel(1)
                for m in MODEL:
                    v = p[m][sel].droplevel(1)
                    acc[m] = v if acc[m] is None else acc[m] + v
                act = a if act is None else act + a
            ok = act.notna()
            d = pd.DataFrame({"a": act[ok]})
            for m in MODEL:
                d[m] = acc[m][ok]
            d["Yi"], d["M"] = Yi, M
            d = d.reset_index()
            rows.append(d)
    R = pd.concat(rows)
    R.to_csv("data/satelit/hasil_3bulan_ke_depan.csv", index=False)
    print(f"jumlah penerbitan (tahun-bulan) yang dinilai: {R[['Yi','M']].drop_duplicates().shape[0]}; baris kab x penerbitan: {len(R)}")
    print("\n=== Galat (WAPE) prakiraan jumlah luas panen 3 bulan ke depan ===")
    print(f"{'':12s}{'per kab':>10s}{'Jatim':>9s}")
    for m in MODEL:
        wk = wape(R.a, R[m])
        g = R.groupby(["Yi", "M"])[["a", m]].sum()
        print(f"  {m:10s}{wk:9.1f}%{wape(g.a, g[m]):8.1f}%")
    print("\nPer bulan penerbitan (WAPE per kab, gabungan | musiman | klimatologi):")
    for M in range(1, 13):
        r = R[R.M == M]
        if len(r):
            print(f"  terbit awal bulan {M:2d}: gabungan {wape(r.a, r.gabungan):5.1f}% | musiman {wape(r.a, r.musiman):5.1f}% | klim {wape(r.a, r.klim):5.1f}% (n tahun={r.Yi.nunique()})")
    r = R[R.M.isin([10, 11, 12])]
    print(f"\nPenerbitan Okt-Des (seperti jendela Nov-Jan di aplikasi): gabungan {wape(r.a, r.gabungan):.1f}% | citra saja {wape(r.a, r.sat_kab):.1f}% | klimatologi {wape(r.a, r.klim):.1f}% | musiman {wape(r.a, r.musiman):.1f}%")
    jk = R.assign(jenis=np.where(R.kabkota.str.startswith("Kota") | (R.kabkota == "Batu"), "kota", "kabupaten"))
    for j in ("kabupaten", "kota"):
        r = jk[jk.jenis == j]
        print(f"  {j}: gabungan {wape(r.a, r.gabungan):.1f}% | klimatologi {wape(r.a, r.klim):.1f}%")


if __name__ == "__main__":
    main()
