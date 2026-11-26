"""TERAWANG K3a · Uji fitur pendukung Panel Harga Bapanas untuk peringatan lewat HET (beras medium, kejadian KAPAN).

Pembanding (lihat uji_k3_peringatan_episode.py): EW60 + logit fitur kecil (latih sejak Jun 2024), gabungan rerata peringkat.
Fitur baru (diketahui pada tanggal asal t, isi maju <= 7 hari; kab tanpa data memakai median Jatim + penanda):
  pg_het      log(harga beras medium penggilingan kab / HET)   margin penggilingan terhadap HET
  pg_m28      perubahan log 28 hari harga penggilingan (kab, cadangan median Jatim)
  gkg_m28     perubahan log 28 hari GKG penggilingan (median Jatim)
  gkp_m28     perubahan log 28 hari GKP petani (median Jatim)
  ns_het      log(harga medium non-SPHP kab / HET)
  sphp_ada    porsi 7 hari terakhir kab punya harga beras SPHP tercatat (penanda SPHP beredar)
  sphp_prov   porsi kab Jatim dengan harga SPHP tercatat hari itu

  python scripts/k3/uji_k3_fitur_bapanas.py [folder CSV Bapanas, bawaan data/bapanas/panel_harga]
"""
import os
import sys

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score

sys.path.insert(0, "scripts/k3")
import uji_k3_peringatan as U  # noqa: E402

DIRB = sys.argv[1] if len(sys.argv) > 1 else "data/bapanas/panel_harga"
KECIL = ["d", "di_het", "atas90", "atas365", "hari_sejak_atas", "pasar_di_het", "pasar_di_atas", "pasar_maks", "m28", "prov_atas"]
BARU = ["pg_het", "pg_m28", "pg_hilang", "gkg_m28", "gkp_m28", "ns_het", "ns_hilang", "sphp_ada", "sphp_prov"]
MULAI_LATIH = pd.Timestamp("2024-06-01")


def nama(s):
    s = s.strip()
    return "Kabupaten " + s[5:].strip() if s.startswith("Kab.") else s


def seri(fn, P):
    f = os.path.join(DIRB, f"kabkota_harian_{fn}.csv")
    b = pd.read_csv(f, parse_dates=["tanggal"])
    b["kab"] = b.kabkota_sumber.map(nama)
    lain = sorted(set(b.kab) - set(P.columns))
    if lain:
        print(f"  {fn}: nama tidak cocok {lain[:6]}")
    W = b.pivot_table(index="tanggal", columns="kab", values="harga_rp_kg").reindex(index=P.index, columns=P.columns)
    return W


def fitur_bapanas(P, H):
    lh = np.log(H)
    pg = seri("beras_medium_penggilingan", P)
    gkg, gkp = seri("gkg_penggilingan", P), seri("gkp_petani", P)
    ns, sp = seri("beras_medium_non_sphp_konsumen", P), seri("beras_sphp_konsumen", P)
    kons = lambda v: pd.DataFrame(np.repeat(np.asarray(v)[:, None], P.shape[1], 1), index=P.index, columns=P.columns)
    pgf = np.log(pg.ffill(limit=7))
    pg_prov = np.log(pg.median(axis=1).ffill(limit=7))
    pg_isi = pgf.apply(lambda c: c.fillna(pg_prov))
    nsf = np.log(ns.ffill(limit=7))
    ns_isi = nsf.apply(lambda c: c.fillna(np.log(ns.median(axis=1).ffill(limit=7))))
    F = {
        "pg_het": pg_isi.sub(lh, axis=0), "pg_m28": pg_isi.diff(28), "pg_hilang": pgf.isna().astype(float),
        "gkg_m28": kons(np.log(gkg.median(axis=1).ffill(limit=7)).diff(28)), "gkp_m28": kons(np.log(gkp.median(axis=1).ffill(limit=7)).diff(28)),
        "ns_het": ns_isi.sub(lh, axis=0), "ns_hilang": nsf.isna().astype(float),
        "sphp_ada": sp.notna().astype(float).rolling(7, min_periods=1).mean(), "sphp_prov": kons(sp.notna().mean(axis=1)),
    }
    return pd.concat({k: U.tumpuk(v) for k, v in F.items()}, axis=1)


def main():
    P, P2, H, pas = U.muat()
    X, _ = U.fitur(P, P2, H, pas)
    X = X.join(fitur_bapanas(P, H))
    cek = X.loc[X.index.get_level_values("tgl") >= U.MULAI_UJI, BARU]
    print("cakupan fitur baru (porsi tidak kosong, periode uji):", cek.notna().mean().round(2).to_dict())
    L = np.log(P)
    run = U.panjang_rangkaian(P.gt(H, axis=0).astype(float).where(P.notna()))
    bulan = pd.date_range(U.MULAI_UJI.replace(day=1), P.index.max(), freq="MS")
    ev, out = "KAPAN", []
    for h in (7, 14, 28):
        D = X.join(U.label(P, H, h, run))
        D["tgt"] = D.index.get_level_values("tgl") + pd.Timedelta(days=h)
        D = D[(D.index.get_level_values("tgl") >= MULAI_LATIH) & (D.d >= 0)].dropna(subset=[ev])
        G = pd.DataFrame({"max": U.tumpuk(U.maju_maks(L, h) - L)}).dropna()
        G["tgt"] = G.index.get_level_values("tgl") + pd.Timedelta(days=h)
        buf = {}
        for bm in bulan:
            tg = D.index.get_level_values("tgl")
            te = D[(tg >= max(bm, U.MULAI_UJI)) & (tg < bm + pd.offsets.MonthBegin(1))]
            if te.empty:
                continue
            tr = D[D.tgt < bm]
            res = {"EW60": U.p_ew60(G, "max", te),
                   "LOGIT_kecil": U.latih("LOGIT", tr, KECIL, ev)(te[KECIL].to_numpy()),
                   "LOGIT_kecil+bapanas": U.latih("LOGIT", tr, KECIL + BARU, ev)(te[KECIL + BARU].to_numpy())}
            for k, v in res.items():
                buf.setdefault(k, []).append(pd.Series(v, index=te.index))
        y = D.loc[D.index.get_level_values("tgl") >= U.MULAI_UJI, ev].astype(int)
        S = {k: pd.concat(v).reindex(y.index) for k, v in buf.items()}
        S["EW60+LOGIT"] = (S["EW60"].rank(pct=True) + S["LOGIT_kecil"].rank(pct=True)) / 2
        S["EW60+LOGIT+bapanas"] = (S["EW60"].rank(pct=True) + S["LOGIT_kecil+bapanas"].rank(pct=True)) / 2
        for k, s in S.items():
            pap = average_precision_score(y, s)
            for q in np.linspace(0.80, 0.999, 60):
                al = s >= s.quantile(q)
                e = U.episode(al, P, H, h, ev, run)
                tp = (al & (y == 1)).sum()
                prec, rec = tp / max(al.sum(), 1), tp / max(y.sum(), 1)
                out.append(dict(h=h, model=k, pr_auc=pap, q=q, recall_ep=e["recall_episode"], hari_alarm_ep=e["hari_alarm_per_episode"],
                                presisi=prec, recall=rec, f1=2 * prec * rec / max(prec + rec, 1e-9), episode=e["episode"]))
        print("h", h, "selesai", flush=True)
    R = pd.DataFrame(out)
    R.to_csv("data/satelit/k3_uji_fitur_bapanas.csv", index=False)
    for (h, k), g in R.groupby(["h", "model"]):
        best = g.loc[g.f1.idxmax()]

        def at(r):
            c = g[g.recall_ep >= r]
            if c.empty:
                return "-"
            b = c.loc[c.presisi.idxmax()]
            return f"pres {b.presisi:.2f}, {b.hari_alarm_ep:.0f} hari/ep"
        print(f"h{h} {k:20s} PR-AUC {g.pr_auc.iloc[0]:.3f} | F1max {best.f1:.3f} (recall_ep {best.recall_ep:.2f}) | recall_ep>=0.5: {at(0.5)} | >=0.7: {at(0.7)}")


if __name__ == "__main__":
    main()
