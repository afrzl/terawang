"""TERAWANG K3a · Uji fitur lag spasial pada peringatan dini beras medium lewat HET (27 Nov 2026). TIDAK dipakai operasional.

Memakai backtest walk-forward bulanan yang sama persis dengan scripts/k3/k3_peringatan_gabungan.py (EW60 + logit + Bapanas,
kejadian KAPAN, asal sejak 22 Agu 2025), lalu menambah fitur tetangga (bobot kernel jarak jalan, lebar 60 km, tanpa diri sendiri):
  sp_atas    porsi tetangga (berbobot) yang harganya di atas HET
  sp_d       rata-rata tetangga log(HET/harga)
  sp_gap     log harga tetangga - log harga sendiri
  sp_m28     kenaikan log 28 hari tetangga
  sp_pasar   rata-rata tetangga porsi pasar di atas HET
Varian juga: + prakiraan kenaikan 28 hari dari GNN (berkas hasil uji_spasio_temporal.py) bila --gnn.

  python scripts/k3/uji_spasio_peringatan.py
"""
import argparse
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, "scripts/k3")
import k3_peringatan_gabungan as pg  # noqa: E402
import uji_spasio_temporal as ust  # noqa: E402

HET = 13500.0
pg_hor = (7, 14, 21, 28)
SP = ["sp_atas", "sp_d", "sp_gap", "sp_m28", "sp_pasar"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gnn", action="store_true")
    ap.add_argument("--lebar", type=float, default=60.0)
    a = ap.parse_args()
    ust.LEBAR = a.lebar
    P, Dm = ust.muat("medium")
    W = ust.bobot_spasial(Dm)
    asli_bapanas = pg.fitur_bapanas
    kol_asli = list(pg.KOLOM)

    def fitur_sp(folder, P_, H):
        B = asli_bapanas(folder, P_, H)
        L = np.log(P_)
        Lf = L.ffill().T.fillna(L.ffill().mean(axis=1)).T
        lw = lambda df: pd.DataFrame(df.fillna(0).to_numpy() @ W.T, index=df.index, columns=df.columns)  # noqa: E731
        atas = P_.gt(H, axis=0).astype(float)
        d = (-Lf).add(np.log(H), axis=0)
        ps = pg.pasar(pg_folder_harga, H, P_.columns)["pasar_di_atas"].unstack().reindex(index=P_.index, columns=P_.columns).ffill(limit=7)
        F = {"sp_atas": lw(atas), "sp_d": lw(d), "sp_gap": lw(Lf) - Lf, "sp_m28": lw(Lf.diff(28)), "sp_pasar": lw(ps)}
        if a.gnn:
            g = pd.read_csv("data/satelit/uji_spasio_temporal_medium.csv.gz", parse_dates=["tgl"])
            g = g[(g.model == "GNN") & (g.h == 28)].pivot(index="tgl", columns="kab", values="yhat").reindex(index=P_.index, columns=P_.columns)
            F["gnn28"] = g
        return B.join(pd.concat({k: pg.tumpuk(v) for k, v in F.items()}, axis=1))

    pg_folder_harga = "data/siskaperbapo/harga_beras"
    hasil, tangkap = {}, {}
    asli_ap = pg.average_precision_score

    def ap_tangkap(y, sk):  # simpan label & skor backtest untuk bootstrap
        tangkap.setdefault(nm_kini[0], []).append((np.asarray(y), np.asarray(sk)))
        return asli_ap(y, sk)
    pg.average_precision_score = ap_tangkap
    nm_kini = [None]
    varian = [("SEKARANG", kol_asli, False), ("+SPASIAL", kol_asli + SP, True)]
    if a.gnn:
        varian.append(("+SPASIAL+GNN", kol_asli + SP + ["gnn28"], True))
    for nm, kol, patch in varian:
        pg.KOLOM = kol
        pg.fitur_bapanas = fitur_sp if patch else asli_bapanas
        nm_kini[0] = nm
        print(f"\n== {nm}")
        _, kal = pg.hitung(P, HET, pg_folder_harga, "data/bapanas/panel_harga", log=print)
        hasil[nm] = kal
    rows = [dict(varian=nm, h=h, **{k: v[k] for k in ("pr_auc", "auc", "f1", "presisi", "recall", "kejadian")}) for nm, kal in hasil.items() for h, v in kal.items()]
    R = pd.DataFrame(rows)
    print("\n" + R.to_string(index=False))
    R.to_csv("data/satelit/uji_spasio_peringatan.csv", index=False)
    # bootstrap blok (baris backtest terurut tanggal; blok = 14 hari x 38 kab) untuk selisih PR-AUC terhadap SEKARANG
    rng = np.random.default_rng(0)
    for nm in list(tangkap)[1:]:
        for j, h in enumerate(pg_hor):
            (y0, s0), (y1, s1) = tangkap["SEKARANG"][j], tangkap[nm][j]
            assert (y0 == y1).all()
            n, b = len(y0), 38 * 14
            st = np.arange(0, n - b, b)
            dif = []
            for _ in range(300):
                idx = np.concatenate([np.arange(k, k + b) for k in rng.choice(st, len(st))])
                if y0[idx].sum() == 0:
                    continue
                dif.append(asli_ap(y1[idx], s1[idx]) - asli_ap(y0[idx], s0[idx]))
            lo, hi = np.percentile(dif, [2.5, 97.5])
            print(f"{nm} h{h}: selisih PR-AUC {asli_ap(y1, s1) - asli_ap(y0, s0):+.3f} (95% {lo:+.3f} s.d. {hi:+.3f})")


if __name__ == "__main__":
    main()
