"""TERAWANG K3a · Uji fitur PIHPS BI (pedagang besar & produsen) di atas model gabungan EW60 + logit + Bapanas (kejadian KAPAN).

Fitur (diketahui pada t, isi maju <= 7 hari karena PIHPS hanya hari kerja; kab tanpa data memakai median Jatim + penanda):
  pb_het   log(harga pedagang besar beras medium I kab / HET)   (8 kota/kab)
  pb_m28   perubahan log 28 hari pedagang besar medium I (median Jatim)
  pbs_het  log(median Jatim pedagang besar beras super I / HET)
  pr_het   log(harga produsen beras medium I kab / HET)          (14 kab)
  pr_m28   perubahan log 28 hari produsen medium I (median Jatim)

  python scripts/k3/uji_k3_fitur_pihps.py
"""
import os
import sys

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score

sys.path.insert(0, "scripts/k3")
import uji_k3_peringatan as U  # noqa: E402
import uji_k3_fitur_bapanas as B  # noqa: E402


def fitur_pihps(P, H):
    lh = np.log(H)
    B.DIRB = "data/pihps"
    kons = lambda v: pd.DataFrame(np.repeat(np.asarray(v)[:, None], P.shape[1], 1), index=P.index, columns=P.columns)
    F = {}
    for kode, fn in (("pb", "pedagang_besar_beras_kualitas_medium_i"), ("pr", "produsen_beras_kualitas_medium_i")):
        W = B.seri(fn, P)
        prov = np.log(W.median(axis=1).ffill(limit=7))
        wf = np.log(W.ffill(limit=7))
        isi = wf.apply(lambda c: c.fillna(prov))
        F[f"{kode}_het"], F[f"{kode}_hilang"] = isi.sub(lh, axis=0), wf.isna().astype(float)
        F[f"{kode}_m28"] = kons(prov.diff(28))
    S = B.seri("pedagang_besar_beras_kualitas_super_i", P)
    F["pbs_het"] = kons(np.log(S.median(axis=1).ffill(limit=7)) - lh)
    B.DIRB = "data/bapanas/panel_harga"
    return pd.concat({k: U.tumpuk(v) for k, v in F.items()}, axis=1), list(F)


def main():
    P, P2, H, pas = U.muat()
    X, _ = U.fitur(P, P2, H, pas)
    X = X.join(B.fitur_bapanas(P, H))
    Fp, PI = fitur_pihps(P, H)
    X = X.join(Fp)
    if os.environ.get("PIHPS_FITUR"):  # uji subset, mis. PIHPS_FITUR=pb_het
        PI = [f for f in PI if f in os.environ["PIHPS_FITUR"].split(",")]
    cek = X.loc[X.index.get_level_values("tgl") >= U.MULAI_UJI, PI]
    print("cakupan (periode uji):", cek.notna().mean().round(2).to_dict(), "| porsi kab punya data sendiri:",
          {k: round(1 - cek[k].mean(), 2) for k in PI if k.endswith("hilang")})
    L = np.log(P)
    run = U.panjang_rangkaian(P.gt(H, axis=0).astype(float).where(P.notna()))
    bulan = pd.date_range(U.MULAI_UJI.replace(day=1), P.index.max(), freq="MS")
    ev = "KAPAN"
    MODEL = {"bapanas": B.KECIL + B.BARU, "bapanas+pihps": B.KECIL + B.BARU + PI,
             "pihps_saja": B.KECIL + PI, "kecil": B.KECIL}
    out = []
    for h in (7, 14, 28):
        D = X.join(U.label(P, H, h, run))
        D["tgt"] = D.index.get_level_values("tgl") + pd.Timedelta(days=h)
        D = D[(D.index.get_level_values("tgl") >= B.MULAI_LATIH) & (D.d >= 0)].dropna(subset=[ev])
        G = pd.DataFrame({"max": U.tumpuk(U.maju_maks(L, h) - L)}).dropna()
        G["tgt"] = G.index.get_level_values("tgl") + pd.Timedelta(days=h)
        buf, koef = {}, None
        for bm in bulan:
            tg = D.index.get_level_values("tgl")
            te = D[(tg >= max(bm, U.MULAI_UJI)) & (tg < bm + pd.offsets.MonthBegin(1))]
            if te.empty:
                continue
            tr = D[D.tgt < bm]
            res = {"EW60": U.p_ew60(G, "max", te)}
            for nm, cs in MODEL.items():
                res[nm] = U.latih("LOGIT", tr, cs, ev)(te[cs].to_numpy())
            for k, v in res.items():
                buf.setdefault(k, []).append(pd.Series(v, index=te.index))
        y = D.loc[D.index.get_level_values("tgl") >= U.MULAI_UJI, ev].astype(int)
        S = {k: pd.concat(v).reindex(y.index) for k, v in buf.items()}
        for nm in MODEL:
            s = (S["EW60"].rank(pct=True) + S[nm].rank(pct=True)) / 2
            for q in np.linspace(0.80, 0.999, 60):
                al = s >= s.quantile(q)
                e = U.episode(al, P, H, h, ev, run)
                tp = (al & (y == 1)).sum()
                prec, rec = tp / max(al.sum(), 1), tp / max(y.sum(), 1)
                out.append(dict(h=h, model="EW60+" + nm, pr_auc=average_precision_score(y, s), q=q, recall_ep=e["recall_episode"],
                                presisi=prec, recall=rec, f1=2 * prec * rec / max(prec + rec, 1e-9)))
        print("h", h, "selesai", flush=True)
    R = pd.DataFrame(out)
    R.to_csv("data/satelit/k3_uji_fitur_pihps" + ("_" + os.environ["PIHPS_FITUR"].replace(",", "_") if os.environ.get("PIHPS_FITUR") else "") + ".csv", index=False)
    for (h, k), g in R.groupby(["h", "model"], sort=False):
        best = g.loc[g.f1.idxmax()]
        c = g[g.recall_ep >= 0.5]
        p50 = f"{c.presisi.max():.2f}" if len(c) else "-"
        print(f"h{h} {k:22s} PR-AUC {g.pr_auc.iloc[0]:.3f} | F1max {best.f1:.3f} (recall_ep {best.recall_ep:.2f}) | presisi@recall_ep>=0,5 {p50}")


if __name__ == "__main__":
    main()
