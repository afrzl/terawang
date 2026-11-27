"""TERAWANG K3a · Uji: peluang lewat HET langsung dari regresi logistik vs EW60 vs gabungan (27 Nov 2026). TIDAK operasional.

Backtest sama dengan k3_peringatan_gabungan.py (beras medium, kab <= HET, kejadian lewat HET kapan saja dalam h hari, asal sejak 22 Agu 2025,
logit dilatih ulang bulanan sejak Jun 2024). Dibandingkan sebagai PELUANG (Brier, kalibrasi) dan sebagai PERINGKAT (AUC, PR-AUC):
  EW60          peluang empiris berbobot
  LOGIT-BOBOT   logit berbobot kelas (yang dipakai di gabungan; peluangnya sengaja tidak terkalibrasi)
  LOGIT-KAL     logit tanpa bobot kelas (peluang terkalibrasi)
  GABUNGAN      rerata peringkat EW60 + LOGIT-BOBOT (operasional; hanya skor, bukan peluang)
"""
import sys

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, "scripts/k3")
import k3_peringatan_gabungan as pg  # noqa: E402
import uji_spasio_temporal as ust  # noqa: E402


def latih(tr, bobot):
    X, y = np.nan_to_num(tr[pg.KOLOM].to_numpy()), tr.y.to_numpy().astype(int)
    w = np.where(y == 1, (len(y) - y.sum()) / max(y.sum(), 1), 1.0) if bobot else np.ones(len(y))
    m = make_pipeline(StandardScaler(), LogisticRegression(C=0.3, max_iter=3000))
    return m.fit(X, y, logisticregression__sample_weight=w)


def main():
    P, _ = ust.muat("medium")
    P = P[P.index >= pg.HET_RIWAYAT[0][0] - pd.Timedelta(days=30)]
    H = pg.het_seri(P.index, 13500.0)
    X = pg.fitur_harga(P, H, pg.pasar("data/siskaperbapo/harga_beras", H, P.columns)).join(pg.fitur_bapanas("data/bapanas/panel_harga", P, H))
    L = np.log(P)
    atas = P.gt(H, axis=0).astype(float).where(P.notna() & H.notna().to_numpy()[:, None])
    rows = []
    for h in (7, 14, 21, 28):
        y = pg.tumpuk(pg.maju_maks(atas, h).where((H.shift(-h) == H), axis=0)).rename("y")
        D = X.join(y)
        D["tgt"] = D.index.get_level_values("tgl") + pd.Timedelta(days=h)
        D = D[(D.index.get_level_values("tgl") >= pg.MULAI_LATIH) & (D.d >= 0)].dropna(subset=["y"])
        G = pd.DataFrame({"max": pg.tumpuk(pg.maju_maks(L, h) - L)}).dropna()
        G["tgt"] = G.index.get_level_values("tgl") + pd.Timedelta(days=h)
        tg = D.index.get_level_values("tgl")
        ew, lb, lk = (pd.Series(np.nan, index=D.index) for _ in range(3))
        for bm in pd.date_range(pg.MULAI_UJI.replace(day=1), P.index.max(), freq="MS"):
            sel = (tg >= max(bm, pg.MULAI_UJI)) & (tg < bm + pd.offsets.MonthBegin(1))
            if not sel.any():
                continue
            te, tr = D[sel], D[D.tgt < bm]
            Xte = np.nan_to_num(te[pg.KOLOM].to_numpy())
            lb[sel] = latih(tr, True).predict_proba(Xte)[:, 1]
            lk[sel] = latih(tr, False).predict_proba(Xte)[:, 1]
            for t in te.index.get_level_values("tgl").unique():
                s = sel & (tg == t)
                ew[s] = pg._p_ew(G, t, D.d[s].to_numpy())
        u = ew.notna()
        yb = D.y[u].to_numpy().astype(int)
        e, b, k = np.clip(ew[u].to_numpy(), 0, 1), lb[u].to_numpy(), lk[u].to_numpy()
        gab = (pg._pct(e, e) + pg._pct(b, b)) / 2
        # kalibrasi Platt berjalan: tiap bulan, regresi logistik 1-d logit(p) -> y pada hasil backtest bulan-bulan SEBELUMNYA
        # yang targetnya sudah terjadi (tgt < awal bulan); bulan tanpa riwayat >= 60 hari dibiarkan apa adanya
        tgu, tgtu = tg[u], D.tgt[u].to_numpy()
        z = np.log(np.clip(k, 1e-6, 1 - 1e-6) / (1 - np.clip(k, 1e-6, 1 - 1e-6)))
        kp = k.copy()
        for bm in pd.date_range(pg.MULAI_UJI.replace(day=1), P.index.max(), freq="MS"):
            sel = np.asarray((tgu >= bm) & (tgu < bm + pd.offsets.MonthBegin(1)))
            hist = tgtu < np.datetime64(bm)
            if sel.any() and (tgu[hist].nunique() if hist.any() else 0) >= 60 and yb[hist].sum() >= 5:
                c = LogisticRegression(C=1e6).fit(z[hist, None], yb[hist])
                kp[sel] = c.predict_proba(z[sel, None])[:, 1]
        for nm, s, peluang in (("EW60", e, True), ("LOGIT-BOBOT", b, True), ("LOGIT-KAL", k, True), ("LOGIT-KAL+PLATT", kp, True), ("GABUNGAN", gab, False)):
            rows.append(dict(h=h, model=nm, kejadian=int(yb.sum()), n=len(yb), prevalensi=yb.mean(),
                             rata_peluang=s.mean() if peluang else np.nan,
                             brier=brier_score_loss(yb, s) if peluang else np.nan,
                             auc=roc_auc_score(yb, s), pr_auc=average_precision_score(yb, s)))
        print(f"selesai h{h}", flush=True)
    R = pd.DataFrame(rows)
    base = R[R.model == "EW60"].set_index("h").brier
    R["bss_vs_ew60"] = 1 - R.brier / R.h.map(base)
    pd.set_option("display.width", 200)
    print(R.round(4).to_string(index=False))
    R.to_csv("data/satelit/uji_peluang_het_logit.csv", index=False)


if __name__ == "__main__":
    main()
