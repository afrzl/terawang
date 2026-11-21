"""K3 · Uji lanjutan: model rata-rata (ridge, GBM kuadrat) + sebaran galat residual, untuk peluang melewati HET (uji sejak 22 Agu 2025)."""
import sys
exec(open("scripts/k3/uji_model_harga.py").read().split("hasil = []")[0])
from sklearn.metrics import roc_auc_score
HET = 13500; potong = pd.Timestamp("2025-08-21")
def gbm2(tr, te, cols):
    m = HistGradientBoostingRegressor(loss="squared_error", max_depth=3, learning_rate=0.05, max_iter=200, min_samples_leaf=80, l2_regularization=1.0, random_state=0)
    m.fit(tr[cols], tr.y); return m.predict(te[cols]), m.predict(tr[cols])
for h in (2, 4):
    y = (L1.shift(-h) - L1).stack().rename("y"); X = D.join(y); tg = X.index.get_level_values(0)
    tr = X[(tg + pd.Timedelta(weeks=h) <= potong)].dropna(subset=FITUR + ["y"]).copy()
    te = X[(tg >= pd.Timestamp("2025-08-22")) & (tg + pd.Timedelta(weeks=h) <= W1.index.max())].dropna(subset=FITUR + ["y"]).copy()
    for d in (tr, te):
        for c in ext: d[c] = d[c].fillna(0)
    p0 = np.exp(L1.stack().reindex(te.index)); thr = np.log(HET / p0).to_numpy(); ev = (te.y.to_numpy() > thr).astype(int)
    c7 = ["d1", "d2", "d4", "d8", "dev", "pd1", "pd4"]
    rg = RidgeCV(alphas=np.logspace(-4, 1, 12)).fit(tr[c7].fillna(0), tr.y)
    modelmu = {"naif (mu=0)": (np.zeros(len(te)), np.zeros(len(tr))), "ridge": (rg.predict(te[c7].fillna(0)), rg.predict(tr[c7].fillna(0))),
               "GBM kuadrat dasar": gbm2(tr, te, FITUR), "GBM kuadrat+tambahan": gbm2(tr, te, EXT)}
    print(f"\nHorizon {h} minggu | kejadian>HET {ev.mean()*100:.1f}% | n={len(te)}; baru melewati HET: {ev[(p0<=HET).to_numpy()].sum()}")
    for nm, (mu_te, mu_tr) in modelmu.items():
        res = (tr.y.to_numpy() - mu_tr)  # sebaran residual dari data latih
        pe = np.array([(res > (t - m)).mean() for t, m in zip(thr, mu_te)])
        bw = (p0 <= HET).to_numpy()
        # peringatan dini: kab di bawah HET sekarang
        auc_bw = roc_auc_score(ev[bw], pe[bw]) if len(set(ev[bw])) > 1 else np.nan
        det = ((pe[bw] >= .3) & (ev[bw] == 1)).sum(); fa = ((pe[bw] >= .3) & (ev[bw] == 0)).sum()
        print(f"  {nm:22s} AUC semua {roc_auc_score(ev, pe):.3f} | AUC kab di bawah HET {auc_bw:.3f} | ambang 30%: terdeteksi {det}/{ev[bw].sum()} alarm palsu {fa}")
