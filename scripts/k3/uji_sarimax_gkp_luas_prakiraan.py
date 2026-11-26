"""TERAWANG K3 · SARIMAX harga GKP (HPP + luas panen) dengan luas panen yang BENAR-BENAR tersedia saat prakiraan.

Model dilatih dengan luas panen aktual BPS s.d. origin T (seperti sarimax_gkp.py, varian hpp_luas), lalu
prakiraan T+1..T+3 diberi luas panen bulan target dari salah satu sumber:
  aktual    : angka aktual BPS (orakel, batas atas; tidak tersedia saat prakiraan)
  taksiran  : rata-rata bulan yang sama 1-3 tahun sebelumnya
  k1        : nowcast satelit K1 (est_nowcast2_lead28 untuk h1, lead56 untuk h2-h3; jumlah 38 kab/kota),
              dikalibrasi per origin: log(aktual) = a + b log(est) pada bulan <= T-3 (aktual BPS terbit terlambat)
              Catatan: untuk h3, lead56 memakai citra s.d. ±1 bulan sesudah origin (sedikit optimistis).
  potensi_k1: angka potensi/sementara BPS bila edisi BRS-nya sudah terbit pada akhir bulan T, sisanya k1
              (data/bps/produksi_padi/provinsi/bulanan/bps_jatim_luas_panen_potensi_vintage.csv, bila ada)

  python scripts/k3/uji_sarimax_gkp_luas_prakiraan.py
"""
import pathlib
import sys
import warnings

import numpy as np
import pandas as pd
from statsmodels.tsa.statespace.sarimax import SARIMAX

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import sarimax_gkp as sg  # noqa: E402

warnings.filterwarnings("ignore")
D = sg.D
ORDE, MUSIM = (0, 1, 0), (1, 0, 0, 12)  # dipilih AIC pra-uji di sarimax_gkp.py


def k1_est(lead):
    fs = [D / f"satelit/est_nowcast2_lead{lead}.csv", D / f"satelit/est_nowcast2_lead{lead}_2026.csv"]
    d = pd.concat([pd.read_csv(f) for f in fs if f.exists()])
    s = d.groupby("t").est.sum()
    s.index = pd.PeriodIndex.from_fields(year=((s.index.to_numpy() - 1) // 12), month=((s.index.to_numpy() - 1) % 12 + 1), freq="M")
    return s[~s.index.duplicated()].sort_index()


def potensi():
    # angka teliti (tabel/label ribu ha) didahulukan; sisanya dari label grafik BRS (juta ha 2 desimal, ±5.000 ha)
    P = D / "bps/produksi_padi/provinsi/bulanan"
    fs = [P / "bps_jatim_luas_panen_potensi_vintage.csv", P / "bps_jatim_luas_panen_potensi_vintage_grafik.csv"]
    fs = [f for f in fs if f.exists()]
    if not fs:
        return None
    v = pd.concat([pd.read_csv(f, parse_dates=["tanggal_rilis"]) for f in fs])
    v = v.drop_duplicates(["tanggal_rilis", "tahun", "bulan"], keep="first")
    v["target"] = sg.bulan(v)
    return v


def main():
    y, _ = sg.harga()
    L = sg.luas()
    idx = pd.period_range(y.index.min(), max(y.index.max(), L.index.max()) + sg.H, freq="M")
    hp = np.log(sg.hpp(idx))
    lL = np.log(L.reindex(idx))
    ly = np.log(y.reindex(idx))
    awal = max(L.index.min(), y.index.min())
    akhir = y.dropna().index.max()
    E = {28: k1_est(28), 56: k1_est(56)}
    V = potensi()
    Lf = L.reindex(pd.period_range(L.index.min(), idx.max(), freq="M"))
    taks = np.log(pd.concat([Lf.shift(12 * k) for k in (1, 2, 3)], axis=1).mean(axis=1))

    baris, galat_luas = [], []
    for T in pd.period_range(sg.UJI_MULAI - 1, akhir - 1, freq="M"):
        X = pd.DataFrame({"hpp": hp, "luas": lL})
        m = SARIMAX(ly[awal:T].to_numpy(), exog=X.loc[awal:T].to_numpy(), order=ORDE, seasonal_order=MUSIM).fit(disp=False)
        fut = pd.period_range(T + 1, T + sg.H, freq="M")
        src = {"aktual": lL[fut].to_numpy(), "taksiran": taks.reindex(fut).to_numpy()}
        k1 = []
        for h, t in enumerate(fut, 1):
            e = E[28 if h == 1 else 56]
            kal = e.index[(e.index <= T - 3) & e.index.isin(L.index)]
            b, a = np.polyfit(np.log(e[kal]), np.log(L[kal]), 1)
            k1.append(a + b * np.log(e[t]) if t in e.index else taks.get(t, np.nan))
        src["k1"] = np.array(k1)
        if V is not None:
            terbit = V[V.tanggal_rilis <= (T + 1).to_timestamp()]  # terbit s.d. akhir bulan T
            pk, pt = [], []
            for h, t in enumerate(fut):
                c = terbit[terbit.target == t].sort_values("tanggal_rilis")
                pk.append(np.log(c.luas_panen_ha.iloc[-1]) if len(c) else src["k1"][h])
                pt.append(np.log(c.luas_panen_ha.iloc[-1]) if len(c) else src["taksiran"][h])
            src["potensi_k1"] = np.array(pk)
            src["potensi_taksiran"] = np.array(pt)
        for nama, lv in src.items():
            f = m.get_forecast(sg.H, exog=np.column_stack([hp[fut].to_numpy(), lv]))
            mu, ci = f.predicted_mean, f.conf_int(alpha=0.2)
            for h, t in enumerate(fut, 1):
                if t <= akhir:
                    baris.append(dict(origin=str(T), target=str(t), h=h, model=f"hpp_luas_{nama}", aktual=y[t],
                                      prakiraan=np.exp(mu[h - 1]), p10=np.exp(ci[h - 1, 0]), p90=np.exp(ci[h - 1, 1])))
                    if nama != "aktual" and t in L.index and not np.isnan(lv[h - 1]):
                        galat_luas.append(dict(sumber=nama, h=h, ape=abs(np.exp(lv[h - 1]) / L[t] - 1) * 100))
        for h, t in enumerate(fut, 1):
            if t <= akhir:
                baris.append(dict(origin=str(T), target=str(t), h=h, model="naif", aktual=y[t], prakiraan=y[T]))
        print("origin", T, flush=True)

    U = pd.DataFrame(baris)
    U["ape"] = (U.prakiraan / U.aktual - 1).abs() * 100
    U["galat"] = U.prakiraan - U.aktual
    U["periode"] = np.where(U.target.str[:4].astype(int) <= 2024, "2023-24", "2025-26")
    ring = U.groupby(["model", "h"]).agg(n=("ape", "count"), mape=("ape", "mean"),
                                         rmse=("galat", lambda g: np.sqrt((g ** 2).mean()))).reset_index()
    ring["rmse_rel_naif"] = ring.rmse / ring.h.map(ring[ring.model.eq("naif")].set_index("h").rmse)
    print(ring.round(3).to_string(index=False))
    print(U.pivot_table(index="model", columns=["periode", "h"], values="ape").round(2).to_string())
    G = pd.DataFrame(galat_luas).groupby(["sumber", "h"]).ape.mean().unstack().round(1)
    # bulan target yang benar-benar memakai angka potensi BPS
    if V is not None:
        pk = U[U.model.eq("hpp_luas_potensi_k1")].merge(V[["target"]].astype(str).drop_duplicates(), left_on="target", right_on="target")
        print("prakiraan yang memakai potensi BPS (kira-kira):", len(pk))
    print("MAPE luas panen provinsi (%):\n", G.to_string())
    U.round(1).to_csv(D / "satelit/k3_sarimax_gkp_luas_prakiraan_uji.csv", index=False)
    ring.round(3).to_csv(D / "satelit/k3_sarimax_gkp_luas_prakiraan_ringkas.csv", index=False)
    G.to_csv(D / "satelit/k3_sarimax_gkp_luas_prakiraan_galat_luas.csv")


if __name__ == "__main__":
    main()
