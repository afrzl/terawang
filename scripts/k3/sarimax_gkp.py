"""TERAWANG K3 · SARIMAX harga GKP tingkat petani Jawa Timur (bulanan), uji mundur bergulir.

Target  : log harga GKP petani Jatim (BPS 2016-2024, 2022 kosong; bulan sesudah BPS terakhir disambung rata-rata
          panel harian Bapanas 38 kab/kota, diskalakan dengan rasio BPS/Bapanas pada bulan tumpang 2024).
          Bulan kosong (2022) dibiarkan NaN; filter Kalman SARIMAX menanganinya.
Eksogen (bulan target t):
  hpp   : log HPP GKP petani yang berlaku pada tanggal 15 bulan t          (data/kebijakan/hpp_gkp_petani.csv)
  luas  : log luas panen padi provinsi bulan t (uji: angka aktual BPS)     (data/bps/produksi_padi)
  hujan : anomali log hujan CHIRPS provinsi, jumlah bulan t-6..t-4          (data/iklim/chirps_jatim_bulanan.csv)
  oni   : ONI NOAA musim berpusat di bulan t-5                              (data/iklim/noaa_oni_bulanan.csv)
Lag iklim >= 4 bulan, jadi untuk horizon 1-3 nilainya sudah diketahui saat prakiraan dibuat.

Uji: origin bergulir bulanan; latih s.d. origin T (jendela mengembang), prakirakan T+1..T+3.
Pembanding: naif (harga T) dan naif musiman (harga T+h-12 × harga T / harga T-12).
Semua model memakai sampel mulai yang sama (bulan pertama luas panen tersedia) agar adil.

  python scripts/k3/sarimax_gkp.py            # tulis data/satelit/k3_sarimax_gkp_*.csv
"""
import itertools
import multiprocessing as mp
import pathlib
import warnings

import numpy as np
import pandas as pd
from statsmodels.tsa.statespace.sarimax import SARIMAX

warnings.filterwarnings("ignore")
R = pathlib.Path(__file__).resolve().parents[2]
D = R / "data"
H = 3
UJI_MULAI = pd.Period("2023-02", "M")  # origin pertama = UJI_MULAI - 1 (BPS 2022 kosong)


def bulan(df, th="tahun", bl="bulan"):
    return pd.PeriodIndex.from_fields(year=df[th].astype(int), month=df[bl].astype(int), freq="M")


def harga():
    b = pd.read_csv(D / "bps/harga_gabah/bps_jatim_harga_gkp_petani_bulanan.csv")
    b = pd.Series(b.harga_gkp_petani_rp_kg.to_numpy(float), index=bulan(b)).dropna().sort_index()
    p = pd.read_csv(D / "bapanas/panel_harga/kabkota_harian_gkp_petani.csv", parse_dates=["tanggal"])
    p = p[p.harga_rp_kg.between(3000, 15000)]
    p = p.groupby(p.tanggal.dt.to_period("M")).harga_rp_kg.mean()
    p = p[p.index < pd.Timestamp.today().to_period("M")]  # buang bulan berjalan
    lap = b.index.intersection(p.index)
    rasio = float(np.exp(np.log(b[lap] / p[lap]).mean())) if len(lap) else 1.0
    tambah = (p[p.index > b.index.max()] * rasio).rename("harga")
    s = pd.concat([b, tambah]).sort_index()
    s = s.reindex(pd.period_range(s.index.min(), s.index.max(), freq="M"))
    info = dict(bps_awal=str(b.index.min()), bps_akhir=str(b.index.max()), bapanas_sambung=len(tambah),
                rasio_bps_bapanas=round(rasio, 4), bulan_tumpang=len(lap),
                korelasi_tumpang=round(float(np.corrcoef(b[lap], p[lap])[0, 1]), 3) if len(lap) > 2 else None)
    return s, info


def hpp(idx):
    k = pd.read_csv(D / "kebijakan/hpp_gkp_petani.csv", parse_dates=["berlaku_mulai"]).sort_values("berlaku_mulai")
    if "jenis" in k:  # hanya HPP resmi sebagai lantai; fleksibilitas sementara dicatat terpisah
        k = k[k.jenis.str.lower().eq("hpp")]
    t = pd.Series(idx.to_timestamp() + pd.Timedelta(days=14), index=idx)
    pos = np.searchsorted(k.berlaku_mulai.to_numpy(), t.to_numpy(), side="right") - 1
    return pd.Series(np.where(pos >= 0, k.hpp_gkp_petani_rp_kg.to_numpy(float)[np.clip(pos, 0, None)], np.nan), index=idx)


def luas():
    P = D / "bps/produksi_padi"
    bag = []
    for f in sorted((P / "kabkota/bulanan").glob("bps_jatim_padi_kabkota_bulanan*.csv")):
        k = pd.read_csv(f)
        bag.append(k.groupby(["tahun", "bulan"]).luas_panen_ha.sum())
    for f in sorted((P / "provinsi/bulanan").glob("bps_jatim_luas_panen_provinsi_bulanan_*.csv")):
        bag.append(pd.read_csv(f).set_index(["tahun", "bulan"]).luas_panen_ha)
    pv = pd.read_csv(P / "provinsi/bulanan/bps_jatim_padi_provinsi_bulanan_2024_2026.csv")
    bag.append(pv.set_index(["tahun", "bulan"]).luas_panen_juta_ha * 1e6)  # hanya mengisi bulan yang belum ada
    s = pd.concat(bag)
    s = s[~s.index.duplicated(keep="first")]
    s.index = pd.PeriodIndex.from_fields(year=[a for a, _ in s.index], month=[b for _, b in s.index], freq="M")
    return s.sort_index()


def iklim(idx):
    c = pd.read_csv(D / "iklim/chirps_jatim_bulanan.csv")
    c = c[c.tingkat.eq("provinsi")]
    c = c[c.hari_data >= pd.PeriodIndex(bulan(c)).days_in_month]
    h = pd.Series(np.log(c.hujan_mm.to_numpy(float) + 10), index=bulan(c)).asfreq("M")
    klim = h[h.index.year <= 2020].groupby(h[h.index.year <= 2020].index.month).mean()  # klimatologi pra-uji
    anom = h - klim.reindex(h.index.month).to_numpy()
    full = pd.period_range(min(anom.index.min(), idx.min()), idx.max(), freq="M")
    hujan = anom.reindex(full).rolling(3).sum().shift(4)  # t-6..t-4
    o = pd.read_csv(D / "iklim/noaa_oni_bulanan.csv")
    oni = pd.Series(o.oni.to_numpy(float), index=bulan(o))
    oni = oni.reindex(pd.period_range(oni.index.min(), idx.max(), freq="M")).shift(5)
    return hujan.reindex(idx), oni.reindex(idx)


VARIAN = {
    "sarima": [],
    "hpp": ["hpp"],
    "hpp_luas": ["hpp", "luas"],
    "hpp_luas_iklim": ["hpp", "luas", "hujan", "oni"],
    "hpp_iklim": ["hpp", "hujan", "oni"],
}


def pilih_orde(y, X):
    best = None
    for p, q, P, Q in itertools.product((0, 1, 2), (0, 1), (0, 1), (0, 1)):
        try:
            m = SARIMAX(y, exog=X, order=(p, 1, q), seasonal_order=(P, 0, Q, 12)).fit(disp=False)
            if best is None or m.aic < best[0]:
                best = (m.aic, (p, 1, q), (P, 0, Q, 12))
        except Exception:
            pass
    return best


_uji = None


def _jalan(nama):
    return _uji(nama)


def main():
    y, info = harga()
    L = luas()
    idx = pd.period_range(y.index.min(), max(y.index.max(), L.index.max()) + H, freq="M")
    hujan, oni = iklim(idx)
    X = pd.DataFrame({"hpp": np.log(hpp(idx)), "luas": np.log(L.reindex(idx)), "hujan": hujan, "oni": oni}, index=idx)
    ly = np.log(y.reindex(idx))
    awal = max(L.index.min(), y.index.min(), X.dropna().index.min())
    akhir_y = y.dropna().index.max()
    print("harga:", info)
    print("sampel bersama:", awal, "s.d.", akhir_y, "| luas panen:", L.index.min(), "-", L.index.max())

    # orde dipilih dengan AIC pada data latih pra-uji, model sarima tanpa eksogen; dipakai sama untuk semua varian
    pra = ly[awal:UJI_MULAI - 1]
    aic, orde, musim = pilih_orde(pra.to_numpy(), None)
    print("orde terpilih (AIC pra-uji):", orde, musim, round(aic, 1))

    origins = pd.period_range(UJI_MULAI - 1, akhir_y - 1, freq="M")

    def uji_varian(nama):
        kol, hasil = VARIAN[nama], []
        for T in origins:
            Xt = X.loc[awal:T, kol].to_numpy() if kol else None
            Xf = X.loc[T + 1:T + H, kol].to_numpy() if kol else None
            try:
                m = SARIMAX(ly[awal:T].to_numpy(), exog=Xt, order=orde, seasonal_order=musim).fit(disp=False)
                f = m.get_forecast(H, exog=Xf)
                mu, ci = f.predicted_mean, f.conf_int(alpha=0.2)
            except Exception as e:
                print("gagal", nama, T, e)
                continue
            for h in range(1, H + 1):
                t = T + h
                if t <= akhir_y:
                    hasil.append(dict(origin=str(T), target=str(t), h=h, model=nama, aktual=y[t],
                                      prakiraan=np.exp(mu[h - 1]), p10=np.exp(ci[h - 1, 0]), p90=np.exp(ci[h - 1, 1])))
        print("selesai", nama, flush=True)
        return hasil

    global _uji
    _uji = uji_varian
    with mp.get_context("fork").Pool(min(len(VARIAN), mp.cpu_count())) as pool:
        baris = [r for rr in pool.map(_jalan, list(VARIAN)) for r in rr]
    for T in origins:
        for h in range(1, H + 1):
            t = T + h
            if t > akhir_y:
                continue
            baris.append(dict(origin=str(T), target=str(t), h=h, model="naif", aktual=y[t], prakiraan=y[T]))
            baris.append(dict(origin=str(T), target=str(t), h=h, model="naif_musiman", aktual=y[t],
                              prakiraan=y[T] * y[t - 12] / y[T - 12]))
    U = pd.DataFrame(baris)
    U["ape"] = (U.prakiraan / U.aktual - 1).abs() * 100
    U["galat"] = U.prakiraan - U.aktual
    U["cakup"] = ((U.aktual >= U.p10) & (U.aktual <= U.p90)).astype(float).where(U.p10.notna())
    ring = U.groupby(["model", "h"]).agg(n=("ape", "count"), mape=("ape", "mean"),
                                         rmse=("galat", lambda g: np.sqrt((g ** 2).mean())),
                                         bias=("galat", "mean"), cakupan_p10_p90=("cakup", "mean")).reset_index()
    nf = ring[ring.model.eq("naif")].set_index("h").rmse
    ring["rmse_rel_naif"] = ring.rmse / ring.h.map(nf)
    ring = ring.round(3)
    print(ring.to_string(index=False))

    # model akhir pada seluruh sampel: koefisien
    koef = []
    for nama, kol in VARIAN.items():
        m = SARIMAX(ly[awal:akhir_y].to_numpy(), exog=X.loc[awal:akhir_y, kol].to_numpy() if kol else None,
                    order=orde, seasonal_order=musim).fit(disp=False)
        nm = kol + [f"p{i}" for i in range(len(m.params) - len(kol))]
        for n, b, se, pv in zip(nm, m.params, m.bse, m.pvalues):
            koef.append(dict(model=nama, parameter=n, koef=b, se=se, p=pv, aic=m.aic, n=m.nobs))
    K = pd.DataFrame(koef).round(4)
    print(K[K.parameter.isin(["hpp", "luas", "hujan", "oni"])].to_string(index=False))

    out = D / "satelit"
    U.round(1).to_csv(out / "k3_sarimax_gkp_uji.csv", index=False)
    ring.to_csv(out / "k3_sarimax_gkp_ringkas.csv", index=False)
    K.to_csv(out / "k3_sarimax_gkp_koef.csv", index=False)
    pd.Series({**info, "sampel_awal": str(awal), "sampel_akhir": str(akhir_y), "orde": str(orde),
               "musim": str(musim)}).to_csv(out / "k3_sarimax_gkp_info.csv", header=["nilai"])


if __name__ == "__main__":
    main()
