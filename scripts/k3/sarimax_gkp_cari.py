"""TERAWANG K3 · Pencarian spesifikasi SARIMAX harga GKP petani Jatim, dipilih tanpa mengintip periode uji.

Data sama dengan scripts/k3/sarimax_gkp.py, ditambah harga GKP petani 2022 turunan
(penggilingan × rasio petani/penggilingan 2021 & 2023, data/bps/harga_gabah/..._turunan_2022.csv).

Origin bergulir Des 2020–Sep 2026, horizon 1-3, jendela latih mengembang mulai Jan 2019.
  PILIH : origin Des 2020–Des 2023  -> spesifikasi dipilih di sini (MAPE rata-rata h1-h3)
  UJI   : origin Jan 2024–Sep 2026  -> dilaporkan, tidak dipakai memilih
Ruang pencarian:
  target : log harga (HPP sebagai eksogen) | log(harga/HPP) (koef HPP = 1)
  eksogen: - | luas | luas+oni | luas+hujan
  orde   : (p,1,q) p,q in {0,1} × musiman (0,0,0) | (1,0,0,12) | (0,0,1,12)
  gabung : exp(w·log model + (1-w)·log naif), w in {0, .25, .5, .75, 1} dipilih di PILIH

  python scripts/k3/sarimax_gkp_cari.py
"""
import itertools
import multiprocessing as mp
import os
import sys
import warnings

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")

import numpy as np
import pandas as pd
from statsmodels.tsa.statespace.sarimax import SARIMAX

sys.path.insert(0, os.path.dirname(__file__))
import sarimax_gkp as G  # noqa: E402

warnings.filterwarnings("ignore")
D, H = G.D, 3
AWAL = pd.Period("2019-01", "M")
O_PILIH = pd.period_range("2020-12", "2023-12", freq="M")


def harga():
    y, info = G.harga()
    t = pd.read_csv(D / "bps/harga_gabah/bps_jatim_harga_gkp_petani_turunan_2022.csv")
    t = pd.Series(t.harga_gkp_petani_turunan_rp_kg.to_numpy(float), index=G.bulan(t))
    y = y.copy()
    y[t.index] = t
    return y, info


y, info = harga()
L = G.luas()
idx = pd.period_range(y.index.min(), "2027-06", freq="M")
hujan, oni = G.iklim(idx)
HPP = np.log(G.hpp(idx))
X = pd.DataFrame({"hpp": HPP, "luas": np.log(L.reindex(idx)), "hujan": hujan, "oni": oni}, index=idx)
ly = np.log(y.reindex(idx))
AKHIR = y.dropna().index.max()
ORIGINS = pd.period_range(O_PILIH[0], AKHIR - 1, freq="M")

EKSO = {"-": [], "luas": ["luas"], "luas+oni": ["luas", "oni"], "luas+hujan": ["luas", "hujan"]}
ORDE = [((p, 1, q), s) for p, q in itertools.product((0, 1), (0, 1))
        for s in ((0, 0, 0, 0), (1, 0, 0, 12), (0, 0, 1, 12))]
SPEK = [(tg, e, o, s) for tg in ("log", "rasio") for e in EKSO for o, s in ORDE]


def jalan(spek):
    tg, e, o, s = spek
    kol = EKSO[e] + (["hpp"] if tg == "log" else [])
    z = ly - HPP if tg == "rasio" else ly
    out = []
    for T in ORIGINS:
        try:
            m = SARIMAX(z[AWAL:T].to_numpy(), exog=X.loc[AWAL:T, kol].to_numpy() if kol else None,
                        order=o, seasonal_order=s).fit(disp=False)
            mu = m.forecast(H, exog=X.loc[T + 1:T + H, kol].to_numpy() if kol else None)
        except Exception:
            continue
        for h in range(1, H + 1):
            t = T + h
            if t <= AKHIR:
                f = mu[h - 1] + (HPP[t] if tg == "rasio" else 0)
                out.append((T, h, f))
    return spek, out


def mape(f, a):
    return float(np.mean(np.abs(np.exp(f - a) - 1)) * 100)


def main():
    print("harga:", info, "| 2022 turunan diisi | origin", ORIGINS[0], "-", ORIGINS[-1], "| spek", len(SPEK))
    with mp.get_context("fork").Pool(mp.cpu_count()) as pool:
        hasil = pool.map(jalan, SPEK)
    naif = {(T, h): ly[T] for T in ORIGINS for h in range(1, H + 1)}
    baris = []
    for spek, out in hasil:
        for T, h, f in out:
            baris.append(dict(target=spek[0], ekso=spek[1], orde=str(spek[2]), musim=str(spek[3]),
                              origin=T, h=h, f=f, naif=naif[(T, h)], aktual=ly[T + h]))
    U = pd.DataFrame(baris)
    U["set"] = np.where(U.origin <= O_PILIH[-1], "pilih", "uji")
    U["periode"] = pd.cut(U.origin.map(lambda p: p.year), [0, 2022, 2024, 9999], labels=["2021-22", "2023-24", "2025-26"])
    kunci = ["target", "ekso", "orde", "musim"]

    # gabungan dengan naif: bobot dipilih di set PILIH per spesifikasi
    rows = []
    for k, g in U.groupby(kunci):
        gp = g[g.set == "pilih"]
        best_w = min((0, .25, .5, .75, 1), key=lambda w: mape(w * gp.f + (1 - w) * gp.naif, gp.aktual))
        for w in sorted({1.0, best_w}):
            ff = w * g.f + (1 - w) * g.naif
            r = dict(zip(kunci, k), w=w)
            for st in ("pilih", "uji"):
                m = g.set == st
                r[f"mape_{st}"] = mape(ff[m], g.aktual[m])
                for h in (1, 2, 3):
                    mh = m & (g.h == h)
                    r[f"{st}_h{h}"] = mape(ff[mh], g.aktual[mh])
            for p in ("2021-22", "2023-24", "2025-26"):
                mp_ = g.periode == p
                r[f"per_{p}"] = mape(ff[mp_], g.aktual[mp_])
            rows.append(r)
    R = pd.DataFrame(rows)
    g0 = U[(U.target == "log") & (U.ekso == "-") & (U.orde == "(0, 1, 0)") & (U.musim == "(0, 0, 0, 0)")]
    nv = dict(target="naif", ekso="", orde="", musim="", w=0.0)
    for st in ("pilih", "uji"):
        m = g0.set == st
        nv[f"mape_{st}"] = mape(g0.naif[m], g0.aktual[m])
        for h in (1, 2, 3):
            nv[f"{st}_h{h}"] = mape(g0.naif[m & (g0.h == h)], g0.aktual[m & (g0.h == h)])
    for p in ("2021-22", "2023-24", "2025-26"):
        nv[f"per_{p}"] = mape(g0.naif[g0.periode == p], g0.aktual[g0.periode == p])
    R = pd.concat([R, pd.DataFrame([nv])], ignore_index=True).sort_values("mape_pilih").round(3)
    pd.set_option("display.width", 250)
    tampil = kunci + ["w", "mape_pilih", "mape_uji", "uji_h1", "uji_h2", "uji_h3", "per_2021-22", "per_2023-24", "per_2025-26"]
    print(R[tampil].head(25).to_string(index=False))
    print("\nnaif:\n", R[R.target == "naif"][tampil].to_string(index=False))
    print("\nterbaik per (target, ekso), w=1:")
    print(R[R.w == 1].sort_values("mape_pilih").groupby(["target", "ekso"]).head(1)[tampil].to_string(index=False))
    print("\nterbaik per (target, ekso), w bebas:")
    print(R.sort_values("mape_pilih").groupby(["target", "ekso"]).head(1)[tampil].to_string(index=False))
    R.to_csv(D / "satelit/k3_sarimax_gkp_cari.csv", index=False)


if __name__ == "__main__":
    main()
