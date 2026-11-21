"""TERAWANG K3 · Uji ML pada data HARIAN: model sebaran bersyarat (GBM klasifikasi, delta sebagai fitur monoton) vs empiris jendela 365 hari.
Peristiwa: naik >= 1/2/3% dalam h hari, dan melewati HET Rp13.500. Selisih Brier dengan bootstrap blok 14 hari."""
import sys
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score

sys.path.insert(0, "scripts/k2")
import model_stok as ms

def ambil(k):
    h = ms.sql(f"select w.nama_repo kab,h.tanggal,h.harga_rata2_rp_kg p from silver.harga_kabkota_harian h join ref.wilayah w on w.id=h.wilayah_id where h.komoditas_id={k}")
    h["tanggal"] = pd.to_datetime(h.tanggal)
    return h.pivot(index="tanggal", columns="kab", values="p").asfreq("D").ffill(limit=3)
P1, P2 = ambil(1), ambil(2); L1, L2 = np.log(P1), np.log(P2); HET = 13500
prov = L1.mean(axis=1)
def kons(v): return pd.DataFrame(np.repeat(np.asarray(v)[:, None], L1.shape[1], 1), index=L1.index, columns=L1.columns)
b = pd.read_csv("data/bps/produksi_padi/kabkota/bulanan/bps_jatim_padi_kabkota_bulanan_luas_panen_2019_2024.csv")
clim = b.groupby(["nama_repo", "bulan"]).luas_panen_ha.mean().unstack(); clim = clim.div(clim.sum(axis=1), axis=0)
flat = (L1.diff().abs() < 1e-9)
run = flat.astype(int).copy()
for c in run.columns:
    r, s = 0, []
    for v in flat[c].to_numpy(): r = r + 1 if v else 0; s.append(r)
    run[c] = s
doy = L1.index.dayofyear.to_numpy()
F = {f"d{k}": L1.diff(k) for k in (1, 3, 7, 14, 28, 56)}
F["dev"] = L1.sub(prov, axis=0); F["vol28"] = L1.diff().rolling(28).std(); F["datar"] = run
F["naik_7"] = (L1.diff(7) > 0).astype(float).rolling(1).mean()
F["pd7"], F["pd28"] = kons(prov.diff(7)), kons(prov.diff(28))
F["breadth7"], F["breadth28"] = kons((L1.diff(7) > 0).mean(axis=1)), kons((L1.diff(28) > 0).mean(axis=1))
F["disp"] = kons(L1.std(axis=1)); F["nearHET"] = kons((P1 > HET * 0.98).mean(axis=1))
F["s"], F["c"] = kons(np.sin(2 * np.pi * doy / 365)), kons(np.cos(2 * np.pi * doy / 365))
F["prem7"], F["prem28"], F["selisih"] = L2.diff(7), L2.diff(28), L2 - L1
for lag in (0, 2):
    F[f"panen{lag}"] = pd.DataFrame({k: [clim.loc[k, ((m - 1 - lag) % 12) + 1] if k in clim.index else np.nan for m in L1.index.month] for k in L1.columns}, index=L1.index)
F["lvl"] = L1 - np.log(HET)
X0 = pd.concat({k: v.rename_axis(columns="kab").stack() for k, v in F.items()}, axis=1); X0.index.names = ["tgl", "kab"]
COLS = list(F)
DELTAS = np.array([-0.03, -0.015, -0.007, 0.0, 0.003, 0.007, 0.012, 0.02, 0.03, 0.045])

def data(h):
    y = (L1.shift(-h) - L1).rename_axis(columns="kab").stack().rename("y")
    y.index.names = ["tgl", "kab"]
    X = X0.join(y); assert len(X) == len(X0), (len(X), len(X0)); X["tgt"] = X.index.get_level_values(0) + pd.Timedelta(days=h); return X

def gbm(tr, cols):
    tr = tr.iloc[::7]  # sub-sampel untuk kecepatan dan memori
    Xs = pd.concat([tr[cols].assign(delta=d) for d in DELTAS]).fillna(-9); ys = np.concatenate([(tr.y.to_numpy() > d).astype(int) for d in DELTAS])
    m = HistGradientBoostingClassifier(max_depth=4, learning_rate=0.06, max_iter=150, min_samples_leaf=300, l2_regularization=2.0, monotonic_cst=[0] * len(cols) + [-1], random_state=0)
    return m.fit(Xs, ys)

def emp_roll(Xall, te, d, hari=365):
    out = np.full(len(te), np.nan); tgl = te.index.get_level_values(0).to_numpy(); tg = Xall.tgt.to_numpy(); yy = Xall.y.to_numpy()
    for t0 in np.unique(tgl):
        m = (tg <= t0) & (tg > t0 - np.timedelta64(hari, "D")) & ~np.isnan(yy); e = np.sort(yy[m]); sel = tgl == t0
        out[sel] = 1 - np.searchsorted(e, d[sel], side="right") / max(len(e), 1)
    return out

def boot(tgl, dif, n=400, blok=14, seed=0):
    rng = np.random.default_rng(seed); d = pd.Series(dif, index=tgl).groupby(level=0).mean().sort_index().to_numpy(); nb = max(1, len(d) // blok)
    o = [np.mean(np.concatenate([d[s:s + blok] for s in rng.integers(0, len(d) - blok + 1, nb)])) for _ in range(n)]
    return np.percentile(o, [2.5, 97.5])

hasil = []
for h in (7, 28):
    X = data(h); print('data h', h, X.shape, flush=True)
    folds = [("2025", pd.Timestamp("2024-12-31"), lambda X: (X.tgt.dt.year == 2025) & (X.tgt <= P1.index.max()) & (X.tgt > pd.Timestamp("2024-12-31"))),
             ("2026", pd.Timestamp("2025-12-31"), lambda X: (X.tgt.dt.year == 2026) & (X.tgt <= P1.index.max()) & (X.tgt > pd.Timestamp("2025-12-31"))),
             ("HET sejak 22 Agu 2025", pd.Timestamp("2025-08-21"), lambda X: (X.index.get_level_values(0) >= pd.Timestamp("2025-08-22")) & (X.tgt <= P1.index.max()))]
    for nf, potong, mk in folds:
        tr = X[X.tgt <= potong].dropna(subset=["y"]); te = X[mk(X)].dropna(subset=["y"])
        m = gbm(tr, COLS); print('latih', h, nf, len(tr), flush=True)
        evs = [("HET", -te["lvl"].to_numpy())] if nf.startswith("HET") else [(f"naik>={int(r*100)}%", np.full(len(te), r)) for r in (0.01, 0.02, 0.03)]
        for nm, d in evs:
            ev = (te.y.to_numpy() > d).astype(int)
            if ev.min() == ev.max(): continue
            pr = emp_roll(X, te, d)
            pf = m.predict_proba(te[COLS].assign(delta=d).fillna(-9)[COLS + ["delta"]])[:, 1]
            bw = (d >= 0) if nm == "HET" else np.ones(len(te), bool)
            dif = ((pf - ev) ** 2 - (pr - ev) ** 2)[bw]; lo, hi = boot(te.index.get_level_values(0)[bw], dif)
            hasil.append((h, nf, nm, ev[bw].mean() * 100, roc_auc_score(ev[bw], pr[bw]), roc_auc_score(ev[bw], pf[bw]), np.mean((pr[bw] - ev[bw]) ** 2), np.mean((pf[bw] - ev[bw]) ** 2), (np.mean((pr[bw] - ev[bw]) ** 2) - np.mean((pf[bw] - ev[bw]) ** 2)) / np.mean((pr[bw] - ev[bw]) ** 2) * 100, lo, hi))
R = pd.DataFrame(hasil, columns=["h_hari", "uji", "peristiwa", "kejadian_%", "AUC_empiris365", "AUC_GBM", "Brier_empiris365", "Brier_GBM", "GBM_vs_empiris_%", "CI_lo", "CI_hi"])
pd.set_option("display.width", 250); print(R.round(4).to_string(index=False)); R.to_csv("data/satelit/k3_uji_ml_harian.csv", index=False)
