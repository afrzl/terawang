"""TERAWANG K3a · Uji prediksi ARAH harga beras per kab: naik (> +1%) / tetap / turun (< -1%) dalam h hari (27 Nov 2026). TIDAK operasional.

Pembanding:
  KLIM-EW60  peluang tiap arah dari kejadian 365 hari terakhir (gabungan 38 kab, bobot paruh 60 hari) = cara model K3a sekarang,
             sama untuk semua kab.
  KLIM-KAB   sama, tetapi per kab.
  LOGIT      regresi logistik multinomial (fitur harga sendiri, provinsi, tetangga, jarak ke HET, harga penggilingan Bapanas).
  GBM        HistGradientBoostingClassifier, fitur sama.
Walk-forward: latih ulang tiap awal bulan, hanya target yang sudah terjadi. Uji asal 1 Jan 2025 s.d. data terakhir.
Metrik: Brier skill score (BSS, terhadap KLIM-EW60), AUC & PR-AUC naik-vs-lain dan turun-vs-lain, akurasi seimbang
(arah = argmax peluang/klim, yaitu arah yang peluangnya paling naik dibanding biasanya), per tahun.

  python scripts/k3/uji_arah_harga.py [--batas 0.01] [--komoditas medium]
"""
import argparse
import sys

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, balanced_accuracy_score, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, "scripts/k3")
import k3_peringatan_gabungan as pg  # noqa: E402
import uji_spasio_temporal as ust  # noqa: E402

HOR = (7, 14, 21, 28)
MULAI_UJI = pd.Timestamp("2025-01-01")
PARUH, JENDELA = 60, 365
HET_KINI = {"medium": 13500.0, "premium": 14900.0}
KELAS = ["turun", "tetap", "naik"]


def klim(lab, tgt, kab, t, per_kab):
    m = (tgt <= t) & (tgt > t - pd.Timedelta(days=JENDELA))
    w = np.exp(-np.log(2) * (t - tgt[m]).days.to_numpy() / PARUH)
    df = pd.DataFrame({"k": kab[m], "c": lab[m], "w": w})
    if not per_kab:
        p = df.groupby("c").w.sum().reindex(range(3), fill_value=0) + 1e-3
        return (p / p.sum()).to_numpy()
    p = df.pivot_table(index="k", columns="c", values="w", aggfunc="sum").reindex(columns=range(3), fill_value=0).fillna(0) + 0.5
    return p.div(p.sum(1), axis=0)


def ringkas(nm, P_, y, tgl):
    out = {}
    for per, m in (("semua", np.ones(len(y), bool)), ("2025", tgl.year == 2025), ("2026", tgl.year == 2026)):
        yy, pp = y[m], P_[m]
        out[per] = dict(brier=np.mean(np.sum((pp - np.eye(3)[yy]) ** 2, 1)),
                        auc_naik=roc_auc_score(yy == 2, pp[:, 2]) if 0 < (yy == 2).mean() < 1 else np.nan,
                        prauc_naik=average_precision_score(yy == 2, pp[:, 2]),
                        auc_turun=roc_auc_score(yy == 0, pp[:, 0]) if 0 < (yy == 0).mean() < 1 else np.nan,
                        prauc_turun=average_precision_score(yy == 0, pp[:, 0]))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--batas", type=float, default=0.01)
    ap.add_argument("--komoditas", default="medium")
    a = ap.parse_args()
    P, Dm = ust.muat(a.komoditas)
    P = P[P.index >= pd.Timestamp("2022-01-01")]
    L = np.log(P)
    X, DASAR, SP = ust.fitur(L, ust.bobot_spasial(Dm))
    H = pg.het_seri(P.index, HET_KINI[a.komoditas]).bfill()  # sebelum Mar 2023 pakai HET pertama (fitur saja)
    d = pg.tumpuk((-L).add(np.log(H), axis=0)).rename("d_het")
    X = X.join(d)
    kol = SP + ["d_het"]
    if a.komoditas == "medium":
        B = pg.fitur_bapanas("data/bapanas/panel_harga", P, H)[["pg_het", "pg_m28", "pg_hilang", "gkg_m28", "gkp_m28"]]
        X = X.join(B)
        kol += list(B.columns)
    X = X[X.index.get_level_values("tgl") >= ust.MULAI]
    tg = X.index.get_level_values("tgl")
    kabs = X.index.get_level_values("kab")
    akhir = P.index.max()
    bulan = pd.date_range(MULAI_UJI, akhir, freq="MS")
    baris, contoh = [], {}
    for h in HOR:
        y = ust.target(L, h).reindex(X.index).to_numpy()
        ok = ~np.isnan(y)
        lab = np.where(y > a.batas, 2, np.where(y < -a.batas, 0, 1))
        tgt = tg + pd.Timedelta(days=h)
        pr = {m: np.full((len(X), 3), np.nan) for m in ("KLIM-EW60", "KLIM-KAB", "LOGIT", "GBM")}
        for bm in bulan:
            tr = np.asarray(tgt < bm) & ok
            te = np.asarray((tg >= bm) & (tg < bm + pd.offsets.MonthBegin(1)))
            if not te.any():
                continue
            Xtr, ytr = np.nan_to_num(X.loc[tr, kol].to_numpy()), lab[tr]
            Xte = np.nan_to_num(X.loc[te, kol].to_numpy())
            lg = make_pipeline(StandardScaler(), LogisticRegression(C=0.1, max_iter=2000)).fit(Xtr, ytr)
            pr["LOGIT"][te] = lg.predict_proba(Xte)
            sub = np.arange(tr.sum()) % 2 == 0
            gb = HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=200, min_samples_leaf=300, l2_regularization=2.0, random_state=0)
            pr["GBM"][te] = gb.fit(X.loc[tr, kol].to_numpy()[sub], ytr[sub]).predict_proba(X.loc[te, kol].to_numpy())
            for t in pd.DatetimeIndex(np.unique(tg[te])):
                s = np.asarray(tg == t)
                pool = np.asarray(tgt <= t) & ok
                pr["KLIM-EW60"][s] = klim(lab[pool], tgt[pool], kabs[pool], t, False)
                pk = klim(lab[pool], tgt[pool], kabs[pool], t, True)
                pr["KLIM-KAB"][s] = pk.reindex(kabs[s]).fillna(1 / 3).to_numpy()
        uji = np.asarray(tg >= MULAI_UJI) & ok & np.asarray(tgt <= akhir)
        yy, tt = lab[uji], pd.DatetimeIndex(tg[uji])
        base = ringkas("KLIM-EW60", pr["KLIM-EW60"][uji], yy, tt)
        for m, pp in pr.items():
            r = ringkas(m, pp[uji], yy, tt)
            ba = balanced_accuracy_score(yy, np.argmax(pp[uji] / pr["KLIM-EW60"][uji], 1)) if m != "KLIM-EW60" else 1 / 3
            for per, v in r.items():
                baris.append(dict(h=h, model=m, periode=per, n=int((tt.year == int(per)).sum()) if per != "semua" else len(yy),
                                  p_naik=float(np.mean(yy[(tt.year == int(per)) if per != "semua" else slice(None)] == 2)),
                                  p_turun=float(np.mean(yy[(tt.year == int(per)) if per != "semua" else slice(None)] == 0)),
                                  bss=1 - v["brier"] / base[per]["brier"], **{k: v[k] for k in v if k != "brier"},
                                  akurasi_seimbang=ba if per == "semua" else np.nan))
        contoh[h] = pd.DataFrame(pr["LOGIT"][uji], columns=KELAS).assign(tgl=tt, kab=kabs[uji], y=yy)
        print(f"selesai h{h}", flush=True)
    R = pd.DataFrame(baris)
    pd.set_option("display.width", 220)
    print(f"\nArah harga beras {a.komoditas}, batas +/-{a.batas:.0%}, asal uji {MULAI_UJI.date()} s.d. {akhir.date()}")
    print(R.round(3).to_string(index=False))
    R.to_csv(f"data/satelit/uji_arah_harga_{a.komoditas}.csv", index=False)


if __name__ == "__main__":
    main()
