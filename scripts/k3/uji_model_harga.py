"""TERAWANG K3 · Uji lebih luas model prediksi harga: naif, ridge (mean-reversion), GBM fitur dasar, GBM fitur diperluas.
Fitur tambahan: perubahan harga premium, selisih premium-medium, jarak harga ke HET, iklim panen bulanan kab (BPS 2019-2024, tanpa kebocoran).
Ukuran: WAPE semua kab-minggu; WAPE hanya pada minggu harga bergerak (|perubahan| > 0,5%); akurasi arah pada minggu bergerak.
"""
import sys
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import RidgeCV

sys.path.insert(0, "scripts/k3"); sys.path.insert(0, "scripts/k2")
import model_stok as ms
from prediksi_harga import muat, fitur, FITUR

W1, W2 = muat(1), muat(2)
idx = W1.index.intersection(W2.index); W1, W2 = W1.loc[idx], W2.loc[idx]
L1, L2 = np.log(W1), np.log(W2)
# iklim panen: porsi luas panen bulanan per kab, BPS 2019-2024
b = pd.read_csv("data/bps/produksi_padi/kabkota/bulanan/bps_jatim_padi_kabkota_bulanan_luas_panen_2019_2024.csv")
kol_k, kol_v = "nama_repo", "luas_panen_ha"
clim = b.groupby([kol_k, "bulan"])[kol_v].mean().unstack(); clim = clim.div(clim.sum(axis=1), axis=0)

D = fitur(W1)
ext = {}
ext["prem_d4"] = L2.diff(4).stack(); ext["prem_d1"] = L2.diff(1).stack()
ext["selisih"] = (L2 - L1).stack(); ext["gapHET"] = (W1 / 13500).pipe(np.log).stack()
bln = pd.Series(W1.index.month, index=W1.index)
def panen(lagb):
    out = {}
    for k in W1.columns:
        kk = k if k in clim.index else None
        out[k] = [clim.loc[kk, ((m - 1 - lagb) % 12) + 1] if kk else np.nan for m in bln]
    return pd.DataFrame(out, index=W1.index).rename_axis(columns="kab").stack()
ext["panen0"], ext["panen2"] = panen(0), panen(2)
D = D.join(pd.DataFrame(ext))
EXT = FITUR + list(ext)

def gbm(tr, te, cols):
    m = HistGradientBoostingRegressor(loss="absolute_error", max_depth=4, learning_rate=0.05, max_iter=250, min_samples_leaf=40, random_state=0)
    m.fit(tr[cols], tr.y); return m.predict(te[cols])
def ridge(tr, te, cols):
    c = ["d1", "d2", "d4", "d8", "dev", "pd1", "pd4"]
    m = RidgeCV(alphas=np.logspace(-4, 1, 12)); m.fit(tr[c].fillna(0), tr.y); return m.predict(te[c].fillna(0))

hasil = []
for tahun in (2024, 2025, 2026):
    potong = pd.Timestamp(f"{tahun-1}-12-31")
    for h in (1, 4):
        y = (L1.shift(-h) - L1).stack().rename("y")
        X = D.join(y); tg = X.index.get_level_values(0)
        tr = X[(tg + pd.Timedelta(weeks=h) <= potong)].dropna(subset=FITUR + ["y"])
        te = X[((tg + pd.Timedelta(weeks=h)).year == tahun) & (tg + pd.Timedelta(weeks=h) <= W1.index.max())].dropna(subset=FITUR + ["y"])
        p0 = np.exp(L1.stack().reindex(te.index)); real = p0 * np.exp(te.y)
        gerak = (te.y.abs() > 0.005)
        preds = {"naif": np.zeros(len(te)), "ridge": ridge(tr, te, None), "GBM dasar": gbm(tr, te, FITUR), "GBM+fitur tambahan": gbm(tr.dropna(subset=EXT), te.dropna(subset=EXT).reindex(te.index).fillna(0) if False else te, EXT) if False else None}
        te2 = te.copy(); tr2 = tr.copy()
        for c in ext: te2[c] = te2[c].fillna(0); tr2[c] = tr2[c].fillna(0)
        preds["GBM+fitur tambahan"] = gbm(tr2, te2, EXT)
        for nm, pr in preds.items():
            pp = p0 * np.exp(pr)
            wape = (pp - real).abs().sum() / real.sum() * 100
            wape_g = (pp[gerak] - real[gerak]).abs().sum() / real[gerak].sum() * 100
            arah = (np.sign(pr[gerak.to_numpy()]) == np.sign(te.y[gerak])).mean() * 100 if nm != "naif" else np.nan
            hasil.append((tahun, h, nm, wape, wape_g, arah, gerak.mean() * 100))
R = pd.DataFrame(hasil, columns=["tahun", "h", "model", "WAPE_semua", "WAPE_minggu_bergerak", "akurasi_arah_%", "porsi_bergerak_%"]).round(2)
print(R.to_string(index=False))
print("\nRata-rata ketiga tahun:"); print(R.groupby(["h", "model"])[["WAPE_semua", "WAPE_minggu_bergerak", "akurasi_arah_%"]].mean().round(2).to_string())
