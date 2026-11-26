"""TERAWANG K3 · Pencarian model harga GKP terbaik dengan input yang BENAR-BENAR tersedia saat prakiraan.

Semua model dilatih s.d. origin T dengan luas panen aktual BPS; untuk prakiraan T+1..T+3 luas panen bulan target
diisi angka potensi BPS bila edisi BRS-nya sudah terbit, selain itu taksiran musiman (rata-rata bulan yang sama
1-3 tahun sebelumnya). Lihat uji_sarimax_gkp_luas_prakiraan.py untuk perbandingan sumber luas panen.

Varian:
  sarima            log harga, tanpa eksogen
  hpp_luas          log harga ~ log HPP + log luas panen
  rasio             log(harga/HPP), tanpa eksogen (elastisitas HPP dipaksa 1)
  rasio_luas        log(harga/HPP) ~ log luas panen
  *_oni             + ONI jeda 5 bulan
  hpp_luas_aic      hpp_luas dengan orde dipilih AIC di tiap origin
  gab_<m>           rata-rata log prakiraan <m> dan naif
Uji mulai origin 2021-01 (2022 tanpa harga BPS -> NaN, ditangani filter Kalman, tidak ikut dinilai).

  python scripts/k3/cari_sarimax_gkp.py
"""
import itertools
import os
import pathlib
import sys
import warnings

os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from statsmodels.tsa.statespace.sarimax import SARIMAX  # noqa: E402

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import sarimax_gkp as sg  # noqa: E402
import uji_sarimax_gkp_luas_prakiraan as up  # noqa: E402

warnings.filterwarnings("ignore")
D = sg.D
ORDE, MUSIM = (0, 1, 0), (1, 0, 0, 12)
ASAL_AWAL = pd.Period("2021-01", "M")
GRID = [((p, 1, q), (P, 0, 0, 12)) for p, q, P in itertools.product((0, 1), (0, 1), (0, 1))]


def fit(y, X, orde=ORDE, musim=MUSIM):
    return SARIMAX(y, exog=X, order=orde, seasonal_order=musim).fit(disp=False)


def fit_aic(y, X):
    best = None
    for o, s in GRID:
        try:
            m = fit(y, X, o, s)
        except Exception:
            continue
        if np.isfinite(m.aic) and (best is None or m.aic < best.aic):
            best = m
    return best


def main():
    y, _ = sg.harga()
    L = sg.luas()
    idx = pd.period_range(y.index.min(), max(y.index.max(), L.index.max()) + sg.H, freq="M")
    hp = np.log(sg.hpp(idx))
    lL = np.log(L.reindex(idx))
    _, oni = sg.iklim(idx)
    ly = np.log(y.reindex(idx))
    lr = ly - hp
    awal = max(L.index.min(), y.index.min())
    akhir = y.dropna().index.max()
    V = up.potensi()
    Lf = L.reindex(pd.period_range(L.index.min(), idx.max(), freq="M"))
    taks = np.log(pd.concat([Lf.shift(12 * k) for k in (1, 2, 3)], axis=1).mean(axis=1))

    MODEL = {  # nama: (target, kolom eksogen, pilih orde AIC?)
        "sarima": ("ly", [], False),
        "hpp_luas": ("ly", ["hpp", "luas"], False),
        "hpp_luas_oni": ("ly", ["hpp", "luas", "oni"], False),
        "hpp_luas_aic": ("ly", ["hpp", "luas"], True),
        "rasio": ("lr", [], False),
        "rasio_luas": ("lr", ["luas"], False),
        "rasio_luas_oni": ("lr", ["luas", "oni"], False),
        "rasio_luas_aic": ("lr", ["luas"], True),
    }
    baris = []
    for T in pd.period_range(ASAL_AWAL, akhir - 1, freq="M"):
        fut = pd.period_range(T + 1, T + sg.H, freq="M")
        if not any(t in y.dropna().index for t in fut):
            continue
        terbit = V[V.tanggal_rilis <= (T + 1).to_timestamp()] if V is not None else None
        lf = []
        for t in fut:
            c = terbit[terbit.target == t].sort_values("tanggal_rilis") if terbit is not None else []
            lf.append(np.log(c.luas_panen_ha.iloc[-1]) if len(c) else taks.get(t, np.nan))
        Xl = pd.DataFrame({"hpp": hp, "luas": lL, "oni": oni})
        Xf = pd.DataFrame({"hpp": hp[fut].to_numpy(), "luas": lf, "oni": oni[fut].to_numpy()}, index=fut)
        for nama, (tg, kol, aic) in MODEL.items():
            yy = (ly if tg == "ly" else lr)[awal:T].to_numpy()
            Xt = Xl.loc[awal:T, kol].to_numpy() if kol else None
            try:
                m = fit_aic(yy, Xt) if aic else fit(yy, Xt)
                f = m.get_forecast(sg.H, exog=Xf[kol].to_numpy() if kol else None)
            except Exception as e:
                print("gagal", nama, T, e)
                continue
            mu = np.asarray(f.predicted_mean) + (hp[fut].to_numpy() if tg == "lr" else 0)
            for h, t in enumerate(fut, 1):
                if not np.isnan(y.get(t, np.nan)):
                    baris.append(dict(origin=str(T), target=str(t), h=h, model=nama, aktual=y[t], prakiraan=np.exp(mu[h - 1])))
        naif = y[T] if not np.isnan(y.get(T, np.nan)) else np.nan
        for h, t in enumerate(fut, 1):
            if not np.isnan(y.get(t, np.nan)):
                baris.append(dict(origin=str(T), target=str(t), h=h, model="naif", aktual=y[t], prakiraan=naif))
        print("origin", T, flush=True)

    U = pd.DataFrame(baris).dropna(subset=["prakiraan"])
    nf = U[U.model.eq("naif")].set_index(["origin", "h"]).prakiraan
    gab = []
    for nama in MODEL:
        g = U[U.model.eq(nama)].copy()
        n = nf.reindex(pd.MultiIndex.from_frame(g[["origin", "h"]])).to_numpy()
        g["prakiraan"] = np.exp((np.log(g.prakiraan.to_numpy()) + np.log(n)) / 2)
        g["model"] = "gab_" + nama
        gab.append(g.dropna(subset=["prakiraan"]))
    U = pd.concat([U] + gab)
    # nilai hanya pasangan (origin, h) yang dimiliki semua model
    k = U.groupby(["origin", "h"]).model.nunique()
    U = U.set_index(["origin", "h"]).loc[k[k == U.model.nunique()].index].reset_index()
    U["ape"] = (U.prakiraan / U.aktual - 1).abs() * 100
    U["galat"] = U.prakiraan - U.aktual
    yr = U.origin.str[:4].astype(int)
    U["periode"] = np.select([yr <= 2022, yr <= 2024], ["asal 2021-22", "asal 2023-24"], "asal 2025-26")
    pd.set_option("display.width", 250)

    def tabel(df):
        r = df.groupby(["model", "h"]).agg(mape=("ape", "mean"), rmse=("galat", lambda g: np.sqrt((g ** 2).mean())), n=("ape", "size")).reset_index()
        r["rel"] = r.rmse / r.h.map(r[r.model.eq("naif")].set_index("h").rmse)
        return r.pivot(index="model", columns="h", values=["mape", "rel"]).round(3).sort_values(("rel", 2))

    print("== SEMUA (asal 2021-01 dst):\n", tabel(U).to_string())
    print("== SEJAK 2023:\n", tabel(U[yr >= 2023]).to_string())
    print("== PER PERIODE (MAPE):\n", U.pivot_table(index="model", columns=["periode", "h"], values="ape").round(2).to_string())
    print("n per periode:", U[U.model.eq("naif")].groupby(["periode", "h"]).size().to_dict())
    U.round(1).to_csv(D / "satelit/k3_cari_sarimax_gkp_uji.csv", index=False)


if __name__ == "__main__":
    main()
