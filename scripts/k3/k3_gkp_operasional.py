"""TERAWANG K3 · Prakiraan harga GKP tingkat petani Jawa Timur, bulanan, 1-3 bulan ke depan (operasional).

Model terpilih dari uji mundur (branch model-afrizal: scripts/k3/sarimax_gkp.py, uji_sarimax_gkp_luas_prakiraan.py,
cari_sarimax_gkp.py; catatan ai-notes/metodologi-k3-sarimax-gkp.md):
  gabungan 50:50 (rata-rata log) antara
    naif     : harga bulan terakhir yang lengkap
    SARIMAX  : log harga ~ log HPP GKP + log luas panen provinsi, SARIMA(0,1,0)(1,0,0)12, latih sejak 2019-01
  Luas panen bulan target (belum diketahui saat prakiraan): angka potensi/sementara BPS bila sudah terbit, selain itu
  rata-rata bulan yang sama 1-3 tahun sebelumnya. HPP bulan depan = HPP yang berlaku sekarang.
  Uji mundur sejak 2023: MAPE 1/2/3 bulan 3,2/4,8/5,9% (naif 3,6/5,5/6,4%); menang dari naif di semua periode.
  ONI dan hujan CHIRPS tidak dipakai (memperburuk di uji).
Per kab/kota (Bapanas sejak 2024, terlalu pendek untuk SARIMAX per kab): rata-rata log antara naif kab dan prakiraan provinsi
  x rasio kab/provinsi 3 bulan terakhir; kab tanpa data bulan acuan hanya bagian rasio, kab tanpa data >2 bulan dilewati.
Pita P10-P90: kuantil galat log prakiraan gabungan pada uji mundur bergulir 36 origin terakhir (dihitung ulang tiap run).

Harga: BPS 2016-2024 (data/bps/harga_gabah), bulan sesudahnya rata-rata panel harian Bapanas GKP petani
(data/bapanas/panel_harga atau TERAWANG_BAPANAS_DIR) x rasio BPS/Bapanas pada bulan tumpang. Bulan berjalan dibuang.

  python scripts/k3/k3_gkp_operasional.py           # cetak prakiraan
  hitung() dipanggil aset Dagster k3_prakiraan_gkp.
"""
from __future__ import annotations

import datetime as dt
import os
import pathlib
import warnings

import numpy as np
import pandas as pd
from statsmodels.tsa.statespace.sarimax import SARIMAX

warnings.filterwarnings("ignore")
VERSI = "k3-gkp-sarimax-gab-0.2"
R = pathlib.Path(__file__).resolve().parents[2]
D = R / "data"
H = 3
AWAL_LATIH = pd.Period("2019-01", "M")
ORDE, MUSIM = (0, 1, 0), (1, 0, 0, 12)
N_UJI = 36
MIN_HARI_KAB = 5   # bulan kab dihitung bila ada >=5 hari data Bapanas
KAB_MAKS_JEDA = 2  # kab dilewati bila data terakhirnya lebih dari 2 bulan sebelum bulan acuan


def _bulan(df):
    return pd.PeriodIndex.from_fields(year=df.tahun.astype(int), month=df.bulan.astype(int), freq="M")


def harga(hari_ini: dt.date, dir_bapanas: pathlib.Path):
    b = pd.read_csv(D / "bps/harga_gabah/bps_jatim_harga_gkp_petani_bulanan.csv")
    b = pd.Series(b.harga_gkp_petani_rp_kg.to_numpy(float), index=_bulan(b)).dropna().sort_index()
    fs = [D / "bapanas/panel_harga/kabkota_harian_gkp_petani.csv", dir_bapanas / "kabkota_harian_gkp_petani.csv"]
    p = pd.concat([pd.read_csv(f, parse_dates=["tanggal"]) for f in dict.fromkeys(fs) if f.exists()])
    p = p.drop_duplicates(["tanggal", "city_id"], keep="last")  # berkas terbaru menimpa riwayat repo
    p = p[p.harga_rp_kg.between(3000, 15000)]
    har = p.groupby("tanggal").harga_rp_kg.mean()
    bl = har.groupby(har.index.to_period("M")).agg(["mean", "size"])
    bl = bl[bl.index < pd.Period(hari_ini, "M")]  # bulan berjalan belum lengkap
    bap = bl["mean"]
    lap = b.index.intersection(bap.index)
    rasio = float(np.exp(np.log(b[lap] / bap[lap]).mean())) if len(lap) else 1.0
    s = pd.concat([b, bap[bap.index > b.index.max()] * rasio]).sort_index()
    s = s.reindex(pd.period_range(s.index.min(), s.index.max(), freq="M"))
    return s, p, {"bps_akhir": str(b.index.max()), "rasio_bps_bapanas": round(rasio, 4), "bulan_tumpang": len(lap), "hari_bapanas_bulan_terakhir": int(bl["size"].iloc[-1])}


def hpp(idx):
    k = pd.read_csv(D / "kebijakan/hpp_gkp_petani.csv", parse_dates=["berlaku_mulai"]).sort_values("berlaku_mulai")
    k = k[k.jenis.str.lower().eq("hpp")]
    t = idx.to_timestamp() + pd.Timedelta(days=14)
    pos = np.searchsorted(k.berlaku_mulai.to_numpy(), t.to_numpy(), side="right") - 1
    v = k.hpp_gkp_petani_rp_kg.to_numpy(float)
    return pd.Series(np.where(pos >= 0, v[np.clip(pos, 0, None)], np.nan), index=idx)


def luas():
    """Luas panen provinsi (ha): jumlah kab/kota 2019-2025 (tetap), lalu tabel provinsi; status non-tetap dipisah."""
    P = D / "bps/produksi_padi"
    bag = [pd.read_csv(f).groupby(["tahun", "bulan"]).luas_panen_ha.sum() for f in sorted((P / "kabkota/bulanan").glob("bps_jatim_padi_kabkota_bulanan*.csv"))]
    pv = pd.read_csv(P / "provinsi/bulanan/bps_jatim_padi_provinsi_bulanan_2024_2026.csv")
    tetap = pv[pv.status_angka.eq("tetap")].set_index(["tahun", "bulan"]).luas_panen_juta_ha * 1e6
    s = pd.concat(bag + [tetap])
    s = s[~s.index.duplicated(keep="first")]
    s.index = pd.PeriodIndex.from_fields(year=[a for a, _ in s.index], month=[m for _, m in s.index], freq="M")
    lain = pv[~pv.status_angka.eq("tetap")]  # sementara/potensi edisi terbaru: dipakai sebagai prakiraan, bukan data latih
    lain = pd.Series(lain.luas_panen_juta_ha.to_numpy(float) * 1e6, index=_bulan(lain))
    return s.sort_index(), lain


def potensi_vintage():
    P = D / "bps/produksi_padi/provinsi/bulanan"
    fs = [f for f in (P / "bps_jatim_luas_panen_potensi_vintage.csv", P / "bps_jatim_luas_panen_potensi_vintage_grafik.csv") if f.exists()]
    if not fs:
        return None
    v = pd.concat([pd.read_csv(f, parse_dates=["tanggal_rilis"]) for f in fs]).drop_duplicates(["tanggal_rilis", "tahun", "bulan"])
    v["target"] = _bulan(v)
    return v


def _luas_prakiraan(T, fut, L, taks, V, potensi_kini=None):
    """Luas panen bulan target yang tersedia pada akhir bulan T, beserta sumbernya."""
    out, src = [], []
    for t in fut:
        v = None
        if potensi_kini is not None and t in potensi_kini.index and t > L.index.max():
            v, s = potensi_kini[t], "bps_potensi_terbaru"
        elif V is not None:
            c = V[(V.target == t) & (V.tanggal_rilis <= (T + 1).to_timestamp())].sort_values("tanggal_rilis")
            if len(c):
                v, s = c.luas_panen_ha.iloc[-1], "bps_potensi"
        if v is None:
            v, s = np.exp(taks.get(t, np.nan)), "taksiran_musiman"
        out.append(np.log(v))
        src.append(s)
    return np.array(out), src


def _prakira(ly, X, T, fut, xf):
    m = SARIMAX(ly[AWAL_LATIH:T].to_numpy(), exog=X.loc[AWAL_LATIH:T].to_numpy(), order=ORDE, seasonal_order=MUSIM).fit(disp=False)
    mu = np.asarray(m.get_forecast(len(fut), exog=xf).predicted_mean)
    return (mu + ly[T]) / 2  # gabungan 50:50 dengan naif (log)


def _kab_bulanan(panel, hari_ini):
    """Rata-rata bulanan GKP petani per kab/kota (bulan dengan >=5 hari data) dan rata-rata provinsi Bapanas."""
    p = panel.copy()
    p["m"] = p.tanggal.dt.to_period("M")
    p = p[p.m < pd.Period(hari_ini, "M")]
    prov = p.groupby("tanggal").harga_rp_kg.mean()
    prov = prov.groupby(prov.index.to_period("M")).mean()
    nama = p.groupby("city_id").kabkota_sumber.last().str.replace(r"^Kab\.\s*", "", regex=True)
    m = p.groupby(["city_id", "m"]).harga_rp_kg.agg(["mean", "size"])
    K = m[m["size"] >= MIN_HARI_KAB]["mean"].unstack(0)
    K = K.reindex(pd.period_range(K.index.min(), prov.index.max(), freq="M"))
    return K, prov.reindex(K.index), nama


def _kab_prakira(K, prov, T, mu_prov, rasio):
    """Prakiraan log harga kab untuk T+1..T+H: rata-rata log naif kab dan (prakiraan provinsi x rasio kab/provinsi 3 bulan terakhir).
    Bila bulan T kosong untuk kab itu, hanya bagian rasio."""
    lr = np.log(K[:T]).sub(np.log(prov[:T]), axis=0)
    hasil = {}
    for c in K.columns:
        r = lr[c].dropna()
        if not len(r) or r.index[-1] < T - KAB_MAKS_JEDA:
            continue
        pr = np.asarray(mu_prov) - np.log(rasio) + r.iloc[-3:].mean()
        naif = K.at[T, c] if T in K.index else np.nan
        hasil[c] = ((pr + np.log(naif)) / 2, "gabungan") if not np.isnan(naif) else (pr, "rasio_provinsi")
    return hasil


def kabupaten(panel, hari_ini, T, mu, mu_uji, rasio):
    """Prakiraan GKP petani per kab/kota (Bapanas sejak 2024, belum cukup panjang untuk SARIMAX per kab).
    Uji mundur pada origin yang sama dengan provinsi (2025-26): MAPE 2,4/3,3/4,3% vs naif kab 2,4/3,5/4,5%."""
    K, prov, nama = _kab_bulanan(panel, hari_ini)
    gal = {h: [] for h in range(1, H + 1)}
    gal_naif = {h: [] for h in range(1, H + 1)}  # pembanding: harga kab bulan acuan, pada kasus yang sama (kab berdata di bulan acuan)
    gal_sama = {h: [] for h in range(1, H + 1)}
    for T0, m0 in mu_uji.items():
        if T0 not in K.index:
            continue
        for c, (pr, metode) in _kab_prakira(K, prov, T0, m0, rasio).items():
            for h in range(1, H + 1):
                t = T0 + h
                if t <= T and t in K.index and not np.isnan(K.at[t, c]):
                    gal[h].append(np.log(K.at[t, c]) - pr[h - 1])
                    if metode == "gabungan":
                        gal_sama[h].append(gal[h][-1])
                        gal_naif[h].append(np.log(K.at[t, c] / K.at[T0, c]))
    q = {h: (np.quantile(gal[h], [0.1, 0.9]) if len(gal[h]) >= 30 else (-0.05 * h, 0.05 * h)) for h in gal}
    keluar = []
    for c, (pr, metode) in sorted(_kab_prakira(K, prov, T, mu, rasio).items(), key=lambda kv: nama[kv[0]]):
        s = K[c].dropna()
        keluar.append({
            "nama": nama[c], "city_id": int(c), "bulan_data_terakhir": str(s.index[-1]), "metode": metode,
            "riwayat": [{"bulan": str(b), "harga": round(float(v), 1)} for b, v in K[c][T - 23:T].items() if not np.isnan(v)],
            "prakiraan": [{"bulan_target": str(T + h), "horizon_bulan": h, "harga_prediksi": round(float(np.exp(pr[h - 1])), 1),
                           "p10": round(float(np.exp(pr[h - 1] + q[h][0])), 1), "p90": round(float(np.exp(pr[h - 1] + q[h][1])), 1)}
                          for h in range(1, H + 1)]})
    mp = lambda e: round(float(np.mean(np.abs(np.expm1(-np.array(e)))) * 100), 2) if e else None
    uji = {f"h{h}": {"n": len(gal[h]), "mape": mp(gal[h]), "n_berdata": len(gal_sama[h]), "mape_berdata": mp(gal_sama[h]), "mape_naif": mp(gal_naif[h])}
           for h in gal}
    return keluar, uji


def hitung(hari_ini: dt.date | None = None, dir_bapanas: str | os.PathLike | None = None):
    """Keluaran: (DataFrame bulan_target, horizon_bulan, harga_prediksi, p10, p90, luas_panen_ha, sumber_luas, hpp), parameter dict."""
    hari_ini = hari_ini or dt.date.today()
    dir_bapanas = pathlib.Path(dir_bapanas or os.environ.get("TERAWANG_BAPANAS_DIR") or D / "bapanas/panel_harga")
    y, panel, info = harga(hari_ini, dir_bapanas)
    bps_akhir = pd.Period(info["bps_akhir"], "M")
    L, kini = luas()
    T = y.dropna().index.max()
    idx = pd.period_range(y.index.min(), T + H, freq="M")
    hp = np.log(hpp(idx))
    ly = np.log(y.reindex(idx))
    lL = np.log(L.reindex(idx))
    Lf = L.reindex(pd.period_range(L.index.min(), T + H, freq="M"))
    taks = np.log(pd.concat([Lf.shift(12 * k) for k in (1, 2, 3)], axis=1).mean(axis=1))
    V = potensi_vintage()
    X = pd.DataFrame({"hpp": hp, "luas": lL})
    # data latih: bulan dengan luas panen aktual; bulan sesudah luas aktual terakhir diisi luas prakiraan (perlu agar Kalman sampai T)
    akhir_luas = L.index.max()
    if akhir_luas < T:
        isi, _ = _luas_prakiraan(akhir_luas, pd.period_range(akhir_luas + 1, T, freq="M"), L, taks, V, kini)
        X.loc[akhir_luas + 1:T, "luas"] = isi

    # uji mundur singkat untuk pita P10-P90 dan metrik
    gal = {h: [] for h in range(1, H + 1)}
    mu_uji = {}
    for T0 in pd.period_range(T - N_UJI - H + 1, T - 1, freq="M"):
        if T0 not in ly.index or np.isnan(ly[T0]) or T0 > akhir_luas:
            continue
        f0 = pd.period_range(T0 + 1, T0 + H, freq="M")
        lf, _ = _luas_prakiraan(T0, f0, L, taks, V)
        X0 = X.copy()
        X0.loc[AWAL_LATIH:T0, "luas"] = lL[AWAL_LATIH:T0]
        mu = _prakira(ly, X0, T0, f0, np.column_stack([hp[f0].to_numpy(), lf]))
        mu_uji[T0] = mu
        for h, t in enumerate(f0, 1):
            if t <= T and not np.isnan(ly.get(t, np.nan)):
                gal[h].append(ly[t] - mu[h - 1])

    fut = pd.period_range(T + 1, T + H, freq="M")
    lf, src = _luas_prakiraan(T, fut, L, taks, V, kini)
    mu = _prakira(ly, X, T, fut, np.column_stack([hp[fut].to_numpy(), lf]))
    baris = []
    for h, t in enumerate(fut, 1):
        e = np.array(gal[h])
        q10, q90 = (np.quantile(e, [0.1, 0.9]) if len(e) >= 12 else (-0.05 * h, 0.05 * h))
        baris.append(dict(bulan_acuan=str(T), bulan_target=str(t), horizon_bulan=h, harga_prediksi=round(float(np.exp(mu[h - 1])), 1),
                          p10=round(float(np.exp(mu[h - 1] + q10)), 1), p90=round(float(np.exp(mu[h - 1] + q90)), 1),
                          luas_panen_ha=round(float(np.exp(lf[h - 1]))), sumber_luas=src[h - 1], hpp=round(float(np.exp(hp[t])))))
    out = pd.DataFrame(baris)
    kab, uji_kab = kabupaten(panel, hari_ini, T, mu, mu_uji, info["rasio_bps_bapanas"])
    par = {"versi": VERSI, "bulan_acuan": str(T), "harga_bulan_acuan": round(float(y[T]), 1), "orde": f"{ORDE}{MUSIM}",
           "latih_sejak": str(AWAL_LATIH), "luas_aktual_terakhir": str(akhir_luas), **info,
           "riwayat": [{"bulan": str(b), "harga": round(float(v), 1), "sumber": "BPS" if b <= bps_akhir else "Bapanas"}
                       for b, v in y.dropna()[T - 35:T].items()],
           "hpp_sekarang": round(float(np.exp(hp[T]))),
           "uji_mundur": {f"h{h}": {"n": len(gal[h]), "mape": round(float(np.mean(np.abs(np.expm1(-np.array(gal[h])))) * 100), 2) if gal[h] else None}
                          for h in gal},
           "kabupaten": kab, "uji_mundur_kab": uji_kab}
    return out, par


if __name__ == "__main__":
    o, p = hitung()
    print(o.to_string(index=False))
    print(p)
