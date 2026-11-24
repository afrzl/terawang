"""TERAWANG K1 · Pembanding dan komponen deret waktu musiman (ETS, SARIMA) pada uji 3 bulan ke depan bergulir.

Sama dengan nowcast_3bulan.py (batas informasi nyata; BPS final tahun Y-1 baru tersedia 1 Maret), ditambah dua model per kabupaten
yang dilatih pada deret bulanan BPS yang tersedia (2019-04 s.d. akhir tahun final terakhir):
  ets    : Holt-Winters aditif, musiman 12 bulan (tren teredam)
  sarima : SARIMA(0,1,1)x(0,1,1,12) ("airline")
Dipakai (a) sebagai pembanding, (b) sebagai komponen ke-4 dalam gabungan (bobot NNLS, leave-one-year-out; untuk tahun latih th,
fitur ets/sarima = prakiraan tahun th dari data sampai th-1, jadi tidak mengintip).

  python scripts/k1/nowcast_3bulan_ts.py
"""
import datetime as dt
import sys
import warnings

import numpy as np
import pandas as pd
from scipy.optimize import nnls
from statsmodels.tsa.holtwinters import ExponentialSmoothing
from statsmodels.tsa.statespace.sarimax import SARIMAX

warnings.filterwarnings("ignore")
sys.path.insert(0, "scripts/k1")
from nowcast_eval import muat_bps, wape  # noqa: E402

LEAD = {0: 0, 1: 28, 2: 56}
HORIZON = 36


def main():
    y = muat_bps()
    Yw = y.pivot(index=["kabkota", "bulan"], columns="tahun", values="y")
    kabs = sorted(y.kabkota.unique())

    # ----- deret bulanan per kab: 2019-04 ... 2025-12
    ser = {}
    for k in kabs:
        v = []
        for th in range(2019, 2026):
            for m in range(1, 13):
                v.append(Yw.loc[(k, m), th])
        s = pd.Series(v, index=pd.period_range("2019-01", periods=len(v), freq="M")).iloc[3:]  # buang Jan-Mar 2019
        ser[k] = s

    # ----- prakiraan ETS dan SARIMA: fc[(model, kab, L)] = Series (index Period) untuk bulan setelah akhir tahun L
    fc = {}
    for L in range(2020, 2026):
        for k in kabs:
            s = ser[k][: pd.Period(f"{L}-12", freq="M")]
            idx = pd.period_range(s.index[-1] + 1, periods=HORIZON, freq="M")
            if len(s) < 24:
                continue
            try:
                f = ExponentialSmoothing(s.to_numpy(float), trend="add", damped_trend=True, seasonal="add", seasonal_periods=12,
                                         initialization_method="estimated").fit().forecast(HORIZON)
                fc[("ets", k, L)] = pd.Series(np.clip(f, 0, None), index=idx)
            except Exception:
                pass
            try:
                f = SARIMAX(s.to_numpy(float), order=(0, 1, 1), seasonal_order=(0, 1, 1, 12)).fit(disp=False).forecast(HORIZON)
                fc[("sarima", k, L)] = pd.Series(np.clip(f, 0, float(s.max())), index=idx)  # batas wajar: tidak melebihi puncak historis
            except Exception:
                pass
    print(f"prakiraan deret waktu: {len(fc)} model-kab-tahun")

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

    def ts_kolom(model, index, th, L):
        """Prakiraan model untuk tahun th dari data sampai akhir tahun L, selaras dengan index (kab, bulan)."""
        out = []
        for k, m in index:
            f = fc.get((model, k, L))
            p = pd.Period(f"{th}-{m:02d}", freq="M")
            out.append(np.nan if f is None or p not in f.index else f[p])
        return np.array(out)

    def pred(E, par, th, last):
        bg, bk, clim = par
        es = E[th].fillna(0)
        idx = es.index
        d = pd.DataFrame({"sat_kab": es.to_numpy() * bk.reindex(idx.get_level_values(0)).to_numpy(), "klim": clim.to_numpy(),
                          "musiman": Yw[last].fillna(clim).to_numpy()}, index=idx)
        for mdl in ("ets", "sarima"):
            d[mdl] = ts_kolom(mdl, list(idx), th, last)
        return d

    FIT3 = ["sat_kab", "klim", "musiman"]

    def bobot(E, tr, cols):
        rows = []
        for th in tr:
            lain = [x for x in tr if x != th]
            if th == 2019 or not lain:
                continue
            d = pred(E, latih(E, lain), th, th - 1)  # ets/sarima: dari data sampai th-1
            d["y"] = Yw[th].to_numpy()
            rows.append(d[cols + ["y"]].dropna())
        d = pd.concat(rows)
        if len(d) < 200:
            return None
        return nnls(d[cols].to_numpy(), d.y.to_numpy())[0]

    cache = {}

    def prediksi(h, tr, ty):
        key = (h, tuple(tr), ty)
        if key in cache:
            return cache[key]
        kp = ("par", h, tuple(tr))
        if kp not in cache:
            par = latih(ES[h], tr)
            cache[kp] = (par, bobot(ES[h], tr, FIT3), bobot(ES[h], tr, FIT3 + ["ets"]), bobot(ES[h], tr, FIT3 + ["sarima"]))
        par, w3, we, ws = cache[kp]
        p = pred(ES[h], par, ty, max(tr))
        p["gabungan"] = p[FIT3].to_numpy() @ w3 if w3 is not None else np.nan
        p["gab+ets"] = (p[FIT3 + ["ets"]].fillna(0).to_numpy() @ we) if we is not None else np.nan
        p["gab+sarima"] = (p[FIT3 + ["sarima"]].fillna(0).to_numpy() @ ws) if ws is not None else np.nan
        cache[key] = p
        return p

    MODEL = ("musiman", "klim", "ets", "sarima", "gabungan", "gab+ets", "gab+sarima")
    rows = []
    for Yi in range(2021, 2026):
        for M in range(1, 13):
            D = dt.date(Yi, M, 1)
            tr = list(range(2019, Yi)) if D >= dt.date(Yi, 3, 1) else list(range(2019, Yi - 1))
            if len(tr) < 3:  # ets/sarima butuh >= 2 siklus penuh
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
            rows.append(d.reset_index())
    R = pd.concat(rows).dropna()
    n_pen = R[["Yi", "M"]].drop_duplicates().shape[0]
    print(f"\npenerbitan dinilai: {n_pen} (syarat >= 3 tahun BPS tersedia untuk ETS/SARIMA); baris kab x penerbitan: {len(R)}")
    print("\n=== Galat (WAPE) 3 bulan ke depan: per kab | seluruh Jatim ===")
    for m in MODEL:
        g = R.groupby(["Yi", "M"])[["a", m]].sum()
        print(f"  {m:11s} {wape(R.a, R[m]):5.1f}% | {wape(g.a, g[m]):5.1f}%")
    r = R[R.M.isin([10, 11, 12])]
    print("\nPenerbitan Okt-Des (jendela Nov-Jan), per kab:", " | ".join(f"{m} {wape(r.a, r[m]):.1f}%" for m in MODEL))
    jk = R.assign(kota=R.kabkota.str.startswith("Kota") | (R.kabkota == "Batu"))
    for nm, sub in (("kabupaten", jk[~jk.kota]), ("kota", jk[jk.kota])):
        print(f"  {nm}:", " | ".join(f"{m} {wape(sub.a, sub[m]):.1f}%" for m in MODEL))
    R.to_csv("data/satelit/hasil_3bulan_ke_depan_ts.csv", index=False)


if __name__ == "__main__":
    main()
