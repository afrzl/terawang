"""TERAWANG K3 · Prediksi harga beras mingguan per kab/kota (1-4 minggu ke depan) dan uji bergulir.

Data: SISKAPERBAPO harian per kab (silver.harga_kabkota_harian), dirata-ratakan per minggu.
Model: HistGradientBoosting gabungan semua kab, target = log(p_{t+h}/p_t), satu model per horizon h (1-4 minggu), kuantil 10/50/90%.
Fitur: perubahan log 1/2/4/8 minggu, simpangan kab terhadap rerata provinsi, perubahan provinsi 1/4 minggu, volatilitas 8 minggu, musim.
Pembanding (baseline): NAIF (harga minggu ini), dan tren-redam.
Uji: rolling-origin tahunan, latih hanya dengan target <= tanggal potong.

  python scripts/k3/prediksi_harga.py [--komoditas 1]
"""
import argparse
import sys

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

sys.path.insert(0, "scripts/k2")
import model_stok as ms  # noqa: E402

HOR = (1, 2, 3, 4)
FITUR = ["d1", "d2", "d4", "d8", "dev", "pd1", "pd4", "vol", "s", "c"]


def muat(kom):
    h = ms.sql(f"select w.nama_repo kab,h.tanggal,h.harga_rata2_rp_kg p from silver.harga_kabkota_harian h join ref.wilayah w on w.id=h.wilayah_id where h.komoditas_id={kom}")
    h["tanggal"] = pd.to_datetime(h.tanggal)
    W = h.set_index("tanggal").groupby("kab").p.resample("W-SUN").mean().unstack(0)  # minggu berakhir Minggu
    return W.interpolate(limit=2).dropna(how="all")


def fitur(W):
    L = np.log(W)
    prov = L.mean(axis=1)
    F = {}
    for k in (1, 2, 4, 8):
        F[f"d{k}"] = L.diff(k)
    F["dev"] = L.sub(prov, axis=0)
    F["pd1"] = pd.DataFrame(np.repeat(prov.diff(1).to_numpy()[:, None], L.shape[1], 1), index=L.index, columns=L.columns)
    F["pd4"] = pd.DataFrame(np.repeat(prov.diff(4).to_numpy()[:, None], L.shape[1], 1), index=L.index, columns=L.columns)
    F["vol"] = L.diff().rolling(8).std()
    wk = L.index.isocalendar().week.to_numpy().astype(float)
    F["s"] = pd.DataFrame(np.repeat(np.sin(2 * np.pi * wk / 52)[:, None], L.shape[1], 1), index=L.index, columns=L.columns)
    F["c"] = pd.DataFrame(np.repeat(np.cos(2 * np.pi * wk / 52)[:, None], L.shape[1], 1), index=L.index, columns=L.columns)
    D = pd.concat({k: v.stack() for k, v in F.items()}, axis=1)
    return D


def latih_prediksi(W, potong, h, tgt_akhir=None):
    """Latih dengan target <= potong; prediksi untuk asal minggu dengan target dalam (potong, tgt_akhir]."""
    L = np.log(W)
    D = fitur(W)
    y = (L.shift(-h) - L).stack().rename("y")
    D = D.join(y)
    tgl = D.index.get_level_values(0)
    tr = D[(tgl + pd.Timedelta(weeks=h) <= potong)].dropna()
    te = D[(tgl + pd.Timedelta(weeks=h) > potong)]
    if tgt_akhir is not None:
        te = te[(te.index.get_level_values(0) + pd.Timedelta(weeks=h)) <= tgt_akhir]
    te = te.dropna(subset=FITUR)
    out = pd.DataFrame(index=te.index)
    for q in (0.1, 0.5, 0.9):
        m = HistGradientBoostingRegressor(loss="quantile", quantile=q, max_depth=4, learning_rate=0.05, max_iter=250, min_samples_leaf=40, random_state=0)
        m.fit(tr[FITUR], tr.y)
        out[f"q{int(q * 100)}"] = m.predict(te[FITUR])
    out["y"] = te.y
    return out


def uji(kom):
    W = muat(kom)
    akhir = W.index.max()
    hasil = []
    for tahun in (2024, 2025, 2026):
        potong = pd.Timestamp(f"{tahun - 1}-12-31")
        for h in HOR:
            o = latih_prediksi(W, potong, h, akhir).dropna(subset=["y"])
            o = o[(o.index.get_level_values(0) + pd.Timedelta(weeks=h)).year == tahun]
            p0 = np.exp(np.log(W).stack().reindex(o.index))
            real = p0 * np.exp(o.y)
            for nama, pred in (("naif", p0), ("GBM", p0 * np.exp(o.q50))):
                hasil.append((tahun, h, nama, (pred - real).abs().sum() / real.sum() * 100, (pred - real).abs().mean(), len(o)))
            cov = ((o.y >= o.q10) & (o.y <= o.q90)).mean() * 100
            hasil.append((tahun, h, "cakupan P10-P90 (%)", cov, np.nan, len(o)))
    R = pd.DataFrame(hasil, columns=["tahun", "h_minggu", "model", "WAPE_atau_cakupan", "MAE_Rp", "n"])
    return R


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--komoditas", type=int, default=1)
    a = ap.parse_args()
    R = uji(a.komoditas)
    pv = R.pivot_table(index=["tahun", "h_minggu"], columns="model", values="WAPE_atau_cakupan").round(2)
    print(pv.to_string())
    print("\nMAE rata-rata (Rp/kg) per model dan horizon:")
    print(R[R.model.isin(["naif", "GBM"])].pivot_table(index="h_minggu", columns="model", values="MAE_Rp").round(0).to_string())
