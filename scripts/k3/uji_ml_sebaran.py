"""TERAWANG K3 · Uji ML untuk peluang perubahan harga (model sebaran bersyarat).

Peristiwa E(delta): log(p_{t+h}/p_t) > delta. Satu GBM klasifikasi dengan delta sebagai fitur (monoton menurun), dilatih pada beberapa nilai delta.
Pembanding:  (a) empiris tak bersyarat (sebaran galat gabungan; metode produksi sekarang),
             (b) GBM hanya delta (+ harga/jarak ke HET) = setara (a),
             (c) GBM penuh dengan fitur dinamika harga, sebaran antar-kab (breadth, dispersi), lama harga datar, premium, musim panen.
Ukuran: AUC dan Brier; selisih Brier (c vs a) dengan selang kepercayaan bootstrap blok antar-tanggal.
Uji: latih dengan target <= tanggal potong; peristiwa generik (naik >= 1%, 2%, 3%) di 2024, 2025, 2026, dan penyeberangan HET Rp13.500 sejak 22 Agu 2025.
"""
import sys
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score, brier_score_loss

sys.path.insert(0, "scripts/k3")
from prediksi_harga import muat

W1, W2 = muat(1), muat(2)
idx = W1.index.intersection(W2.index); W1, W2 = W1.loc[idx], W2.loc[idx]
L1, L2 = np.log(W1), np.log(W2)
HET = 13500
b = pd.read_csv("data/bps/produksi_padi/kabkota/bulanan/bps_jatim_padi_kabkota_bulanan_luas_panen_2019_2024.csv")
clim = b.groupby(["nama_repo", "bulan"]).luas_panen_ha.mean().unstack(); clim = clim.div(clim.sum(axis=1), axis=0)

def pivot_const(vals_by_week):  # vektor per minggu -> DataFrame (minggu x kab)
    return pd.DataFrame(np.repeat(np.asarray(vals_by_week)[:, None], L1.shape[1], 1), index=L1.index, columns=L1.columns)

prov = L1.mean(axis=1)
G = {}  # kelompok fitur -> dict nama -> DataFrame
G["dinamika"] = {f"d{k}": L1.diff(k) for k in (1, 2, 4, 8, 13)}
G["dinamika"]["dev"] = L1.sub(prov, axis=0)
G["dinamika"]["vol"] = L1.diff().rolling(8).std()
G["dinamika"]["musim_s"] = pivot_const(np.sin(2 * np.pi * L1.index.isocalendar().week.to_numpy() / 52))
G["dinamika"]["musim_c"] = pivot_const(np.cos(2 * np.pi * L1.index.isocalendar().week.to_numpy() / 52))
G["antar_kab"] = {"breadth1": pivot_const((L1.diff(1) > 0).mean(axis=1)), "breadth4": pivot_const((L1.diff(4) > 0).mean(axis=1)),
                  "breadth_turun4": pivot_const((L1.diff(4) < 0).mean(axis=1)), "disp": pivot_const(L1.std(axis=1)),
                  "pd4": pivot_const(prov.diff(4)), "pd1": pivot_const(prov.diff(1)),
                  "frac_hetgap": pivot_const((W1 > HET * 0.98).mean(axis=1))}
flat = (L1.diff().abs() < 1e-9).astype(int)
run = flat.copy()
for c in run.columns:
    r, s = 0, []
    for v in flat[c]: r = r + 1 if v else 0; s.append(r)
    run[c] = s
G["lama_datar"] = {"datar_minggu": run, "frac_datar4": flat.rolling(4).mean()}
G["premium"] = {"prem_d4": L2.diff(4), "prem_d1": L2.diff(1), "selisih": L2 - L1}
bln = L1.index.month
def panen(lagb):
    return pd.DataFrame({k: [clim.loc[k, ((m - 1 - lagb) % 12) + 1] if k in clim.index else np.nan for m in bln] for k in L1.columns}, index=L1.index)
G["panen"] = {"panen0": panen(0), "panen2": panen(2)}
LVL = {"lvl": L1 - np.log(HET)}  # jarak harga ke 13.500 (fitur level)

def stack(d): 
    return pd.concat({k: v.rename_axis(columns="kab").stack() for k, v in d.items()}, axis=1)
FEAT = {g: stack(d) for g, d in G.items()}; FEAT["lvl"] = stack(LVL)

def baris(h, grup):
    X = pd.concat([FEAT[g] for g in grup], axis=1)
    y = (L1.shift(-h) - L1).rename_axis(columns="kab").stack().rename("y")
    X = X.join(y); X.index.names = ["tgl", "kab"]
    X["tgt"] = X.index.get_level_values(0) + pd.Timedelta(weeks=h)
    return X

DELTAS = np.array([-0.03, -0.015, -0.007, 0.0, 0.003, 0.007, 0.012, 0.02, 0.03, 0.045])

def latih_gbm(tr, cols):
    n = len(tr)
    Xs = pd.concat([tr[cols].assign(delta=d) for d in DELTAS]); ys = np.concatenate([(tr.y.to_numpy() > d).astype(int) for d in DELTAS])
    mono = [0] * len(cols) + [-1]
    m = HistGradientBoostingClassifier(max_depth=4, learning_rate=0.06, max_iter=200, min_samples_leaf=200, l2_regularization=2.0, monotonic_cst=mono, random_state=0)
    return m.fit(Xs.fillna(-9), ys)

def prob(m, te, cols, delta):
    return m.predict_proba(te[cols].assign(delta=delta).fillna(-9)[cols + ["delta"]])[:, 1]

def emp_roll(Xall, te, d, minggu=52):
    """Peluang empiris dari galat yang SUDAH diketahui pada tanggal asal, jendela {minggu} minggu terakhir."""
    out = np.full(len(te), np.nan)
    tgl = te.index.get_level_values(0).to_numpy()
    tg = Xall.tgt.to_numpy(); yy = Xall.y.to_numpy()
    for t0 in np.unique(tgl):
        m = (tg <= t0) & (tg > t0 - np.timedelta64(7 * minggu, 'D')) & ~np.isnan(yy)
        e = np.sort(yy[m]); sel = tgl == t0
        out[sel] = 1 - np.searchsorted(e, d[sel], side="right") / max(len(e), 1)
    return out

def boot_ci(tgl, dif, n=400, blok=4, seed=0):
    rng = np.random.default_rng(seed)
    d = pd.Series(dif, index=tgl).groupby(level=0).mean().sort_index().to_numpy()
    nb = max(1, len(d) // blok); out = []
    for _ in range(n):
        st = rng.integers(0, len(d) - blok + 1, nb); out.append(np.mean(np.concatenate([d[s:s + blok] for s in st])))
    return np.percentile(out, [2.5, 97.5])

def evaluasi(h, nama_fold, potong, te_mask_fn, events, grup_full, label_extra=None):
    X = baris(h, ["dinamika", "antar_kab", "lama_datar", "premium", "panen", "lvl"])
    tr = X[X.tgt <= potong].dropna(subset=["y"]); te = X[te_mask_fn(X)].dropna(subset=["y"])
    base_cols = ["lvl"]
    cols_full = [c for g in grup_full for c in FEAT[g].columns]
    m_b = latih_gbm(tr, base_cols); m_f = latih_gbm(tr, cols_full)
    rows = []
    for nm, dl in events:
        d = dl(te) if callable(dl) else np.full(len(te), dl)
        ev = (te.y.to_numpy() > d).astype(int)
        if ev.min() == ev.max(): continue
        p_emp = np.array([(tr.y.to_numpy() > x).mean() for x in np.unique(d)]); mp = dict(zip(np.unique(d), p_emp)); pe = np.array([mp[x] for x in d])
        pb = prob(m_b, te.assign(), base_cols, d); pf = prob(m_f, te, cols_full, d)
        pr = emp_roll(X, te, d)
        br = {k: np.mean((p - ev) ** 2) for k, p in (("emp", pe), ("roll", pr), ("gbm_dasar", pb), ("gbm_penuh", pf))}
        dif = (pf - ev) ** 2 - (pr - ev) ** 2
        lo, hi = boot_ci(te.index.get_level_values(0), dif)
        rows.append((nama_fold, h, nm, ev.mean() * 100, roc_auc_score(ev, pr), roc_auc_score(ev, pf), br["emp"], br["roll"], br["gbm_penuh"], (br["roll"] - br["gbm_penuh"]) / br["roll"] * 100, lo, hi))
    return rows

if __name__ == "__main__":
    hasil = []
    gen = [("naik>=1%", 0.01), ("naik>=2%", 0.02), ("naik>=3%", 0.03)]
    for h in (2, 4):
        for th in (2024, 2025, 2026):
            potong = pd.Timestamp(f"{th - 1}-12-31")
            hasil += evaluasi(h, f"uji {th}", potong, (lambda X, th=th: (X.tgt.dt.year == th) & (X.tgt <= W1.index.max()) & (X.tgt > potong)), gen, ["dinamika", "antar_kab", "lama_datar", "premium", "panen", "lvl"])
        potong = pd.Timestamp("2025-08-21")
        hasil += evaluasi(h, "lewat HET sejak 22 Agu 2025", potong, (lambda X: (X.index.get_level_values(0) >= pd.Timestamp("2025-08-22")) & (X.tgt <= W1.index.max())),
                          [("melewati HET 13.500", lambda te: -te["lvl"].to_numpy())],
                          ["dinamika", "antar_kab", "lama_datar", "premium", "panen", "lvl"])
    R = pd.DataFrame(hasil, columns=["fold", "h", "peristiwa", "kejadian_%", "AUC_roll52", "AUC_gbm", "Brier_semuariwayat", "Brier_roll52", "Brier_gbm", "GBM_vs_roll52_%", "CI_lo", "CI_hi"])
    pd.set_option("display.width", 250)
    print(R.round(4).to_string(index=False))
    R.to_csv("data/satelit/k3_uji_ml_sebaran.csv", index=False)
