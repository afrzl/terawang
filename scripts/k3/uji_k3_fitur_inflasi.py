"""TERAWANG K3a · Uji fitur inflasi BPS per kab/kota IHK di atas model gabungan EW60 + logit + Bapanas (kejadian KAPAN).

Sumber: data/bps/inflasi_kota_jatim_bulanan.csv (scripts/bps/ambil_inflasi_kota.py; 11 kab/kota IHK Jatim, bulanan).
Fitur harian, diketahui pada t: nilai bulan terakhir yang SUDAH rilis (bulan m dianggap terbit tgl 1 bulan m+1).
Kab/kota tanpa IHK (27 dari 38) memakai median 11 kota IHK + penanda inf_hilang.
  inf_umum_yoy   inflasi umum y-on-y kab
  inf_mak_mtm    inflasi kelompok Makanan, Minuman & Tembakau m-to-m
  inf_mak_yoy    idem y-on-y
  inf_maks_mtm   subkelompok Makanan saja (01.1) m-to-m (proksi terdekat beras; beras per kota tidak ada di WebAPI)
  inf_maks_yoy   idem y-on-y

  python scripts/k3/uji_k3_fitur_inflasi.py      # INF_FITUR=inf_maks_mtm,inf_hilang untuk uji subset
"""
import os
import sys

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score

sys.path.insert(0, "scripts/k3")
import uji_k3_peringatan as U  # noqa: E402
import uji_k3_fitur_bapanas as B  # noqa: E402

UK = {"inf_umum_yoy": "umum_yoy", "inf_mak_mtm": "makanan_mtm", "inf_mak_yoy": "makanan_yoy",
      "inf_maks_mtm": "makanan_saja_mtm", "inf_maks_yoy": "makanan_saja_yoy"}


def nama(s):
    return "Kabupaten " + s[5:].strip() if s.startswith("Kab.") else s


def fitur_inflasi(P):
    d = pd.read_csv("data/bps/inflasi_kota_jatim_bulanan.csv", parse_dates=["tgl_rilis_asumsi"])
    d["kab"] = d.kabkota.map(nama)
    lain = sorted(set(d.kab) - set(P.columns))
    assert not lain, f"nama tidak cocok: {lain}"
    F = {}
    hilang = None
    for f, uk in UK.items():
        W = d[d.ukuran == uk].pivot_table(index="tgl_rilis_asumsi", columns="kab", values="nilai")
        prov = W.median(axis=1)
        W = W.reindex(columns=P.columns)
        hl = W.isna()
        W = W.apply(lambda c: c.fillna(prov))
        F[f] = W.reindex(W.index.union(P.index)).ffill().reindex(P.index)
        if hilang is None:  # penanda: kab tanpa IHK sendiri
            hilang = hl.astype(float).reindex(hl.index.union(P.index)).ffill().reindex(P.index).fillna(1.0)
    F["inf_hilang"] = hilang
    return pd.concat({k: U.tumpuk(v) for k, v in F.items()}, axis=1), list(F)


def main():
    P, P2, H, pas = U.muat()
    X, _ = U.fitur(P, P2, H, pas)
    X = X.join(B.fitur_bapanas(P, H))
    Fi, IN = fitur_inflasi(P)
    X = X.join(Fi)
    if os.environ.get("INF_FITUR"):
        IN = [f for f in IN if f in os.environ["INF_FITUR"].split(",")]
    cek = X.loc[X.index.get_level_values("tgl") >= U.MULAI_UJI, IN]
    print("cakupan (periode uji):", cek.notna().mean().round(2).to_dict())
    L = np.log(P)
    run = U.panjang_rangkaian(P.gt(H, axis=0).astype(float).where(P.notna()))
    bulan = pd.date_range(U.MULAI_UJI.replace(day=1), P.index.max(), freq="MS")
    ev = "KAPAN"
    MODEL = {"bapanas": B.KECIL + B.BARU, "bapanas+inflasi": B.KECIL + B.BARU + IN,
             "inflasi_saja": B.KECIL + IN, "kecil": B.KECIL}
    out = []
    for h in (7, 14, 28):
        D = X.join(U.label(P, H, h, run))
        D["tgt"] = D.index.get_level_values("tgl") + pd.Timedelta(days=h)
        D = D[(D.index.get_level_values("tgl") >= B.MULAI_LATIH) & (D.d >= 0)].dropna(subset=[ev])
        G = pd.DataFrame({"max": U.tumpuk(U.maju_maks(L, h) - L)}).dropna()
        G["tgt"] = G.index.get_level_values("tgl") + pd.Timedelta(days=h)
        buf = {}
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
    R.to_csv("data/satelit/k3_uji_fitur_inflasi" + ("_" + os.environ["INF_FITUR"].replace(",", "_") if os.environ.get("INF_FITUR") else "") + ".csv", index=False)
    for (h, k), g in R.groupby(["h", "model"], sort=False):
        best = g.loc[g.f1.idxmax()]
        c = g[g.recall_ep >= 0.5]
        p50 = f"{c.presisi.max():.2f}" if len(c) else "-"
        print(f"h{h} {k:24s} PR-AUC {g.pr_auc.iloc[0]:.3f} | F1max {best.f1:.3f} (recall_ep {best.recall_ep:.2f}) | presisi@recall_ep>=0,5 {p50}")


if __name__ == "__main__":
    main()
