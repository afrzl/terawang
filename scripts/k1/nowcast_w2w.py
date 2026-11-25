"""TERAWANG K1 · Taksiran luas panen dari genangan WALL-TO-WALL (scripts/gee/genangan_w2w.py), dikoreksi awan dengan titik sampel.

Langkah:
  1. Tabel genangan per kab per jendela k (luas ha awal genangan menurut jendela verifikasi j = 3..6, atau 0 = tidak terverifikasi).
  2. Untuk bulan target dan jarak prakiraan L, kejadian yang sudah terverifikasi pada tanggal potong berbobot 1, yang belum lengkap
     berbobot p(n) (sama dengan nowcast_est2.py), lalu panen = awal + 8 jendela dengan kernel 0,25/0,5/0,25.
  3. Koreksi awan (estimator rasio): aturan yang sama dijalankan pada titik sampel MENTAH (optik saja) -> taksiran_titik_optik.
     Rasio R(kab, bulan kalender) = taksiran fusi titik (est_nowcast2) / taksiran_titik_optik, dari tahun latih saja.
     Taksiran akhir = taksiran_w2w_optik x R. Rasio menyerap jendela berawan; derau sampling titik hanya masuk lewat rasio.

  python scripts/k1/nowcast_w2w.py <genangan_w2w.csv.gz>       # tulis est_w2w_lead{0,28,56}.csv ke folder yang sama
"""
import datetime as dt
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, "scripts/k1")
from multitahun import muat  # noqa: E402
from nowcast_est import KERNEL, LAG  # noqa: E402

HARI = 12
AWAL = dt.date(2018, 8, 8)
P_N = {0: 0.38, 1: 0.30, 2: 0.22, 3: 0.13}  # peluang terverifikasi (nowcast_est2.py, riwayat <= 2025)
SAWAH = "data/satelit/vh_panen_bulanan_kabkota.csv"
TAHUN_LATIH_RASIO = (2019, 2020, 2021)


def idx_jendela(d):
    return (d - AWAL).days // HARI


def bulan_dari_idx(i):
    t = AWAL + dt.timedelta(days=HARI * i + HARI // 2)
    return t.year * 12 + t.month


def taksiran(T, lead, mulai=(2019, 4), akhir=(2026, 12)):
    """T: DataFrame kabkota, k (indeks jendela), a3..a6, a0 (ha). Kembalikan kabkota, t, est (luas panen ha)."""
    kab = sorted(T.kabkota.unique())
    A = {c: T.pivot(index="kabkota", columns="k", values=c).reindex(kab).fillna(0) for c in ("a3", "a4", "a5", "a6", "a0")}
    kmax = int(T.k.max())
    out = []
    y, m = mulai
    while (y, m) <= akhir:
        t_abs = y * 12 + m
        C = dt.date(y, m, 1) - dt.timedelta(days=lead)
        c = idx_jendela(C) - 1  # jendela terakhir yang sudah selesai sebelum tanggal potong
        c = min(c, kmax)
        acc = np.zeros(len(kab))
        for k in range(max(0, c - 20), c + 1):
            if k not in A["a0"].columns:
                continue
            w_k = sum(wk for dk, wk in KERNEL if bulan_dari_idx(k + LAG + dk) == t_abs)
            if w_k == 0:
                continue
            n_av = max(0, min(k + 7, c + 1) - (k + 3))
            tot = np.zeros(len(kab))
            for j in (3, 4, 5, 6):
                a = A[f"a{j}"][k].to_numpy()
                tot += a if k + j <= c else a * (P_N[n_av] if n_av < 4 else 0.0)
            tot += A["a0"][k].to_numpy() * (P_N[n_av] if n_av < 4 else 0.0)
            acc += w_k * tot
        out += [(kb, t_abs, v) for kb, v in zip(kab, acc)]
        y, m = (y + (m == 12), m % 12 + 1)
    return pd.DataFrame(out, columns=["kabkota", "t", "est"])


def tabel_titik_optik():
    """Aturan genangan_w2w.py pada titik sampel mentah (tanpa isi celah awan), dalam ha per kab per jendela."""
    kab, tgl, vh, vv, L, E = muat()
    assert tgl[0] == AWAL
    ok = ~(np.isnan(L) | np.isnan(E))
    gen = ok & (L + 0.05 >= E) & (E <= 0.35)
    hij = ok & (E >= 0.5)
    sawah = pd.read_csv(SAWAH).drop_duplicates("kabkota").set_index("kabkota").luas_sawah_ha
    jml = pd.Series(kab).value_counts()
    N, W = gen.shape
    rows = []
    for k in range(W):
        awal = gen[:, k].copy()
        for i in (k - 1, k - 2):
            if i >= 0:
                awal &= ~gen[:, i]
        sudah = np.zeros(N, bool)
        kelas = {}
        for j in (3, 4, 5, 6):
            hj = hij[:, k + j] if k + j < W else np.zeros(N, bool)
            kelas[f"a{j}"] = awal & hj & ~sudah
            sudah |= hj
        kelas["a0"] = awal & ~sudah
        d = pd.DataFrame({c: v.astype(float) for c, v in kelas.items()})
        d["kabkota"] = kab
        g = d.groupby("kabkota").sum()
        g = g.mul(sawah.reindex(g.index) / jml.reindex(g.index), axis=0)
        g["k"] = k
        rows.append(g.reset_index())
    return pd.concat(rows)


def baca_w2w(path):
    T = pd.read_csv(path)
    T["k"] = [idx_jendela(dt.date.fromisoformat(s)) for s in T.jendela]
    return T.fillna(0)


def rasio(est_fusi, est_opt, tahun=TAHUN_LATIH_RASIO):
    """R per (kab, bulan kalender) dari tahun latih; dibatasi 0,5-3 dan ditarik ke rasio kab bila datanya tipis."""
    d = est_fusi.merge(est_opt, on=["kabkota", "t"], suffixes=("_f", "_o"))
    d["tahun"], d["bulan"] = (d.t - 1) // 12, (d.t - 1) % 12 + 1
    d = d[d.tahun.isin(tahun)]
    rk = d.groupby("kabkota").est_f.sum() / d.groupby("kabkota").est_o.sum().clip(lower=1e-9)
    g = d.groupby(["kabkota", "bulan"])[["est_f", "est_o"]].sum()
    tau = g.est_o.groupby(level=0).transform("mean")  # penarikan: bulan sepi panen -> mendekati rasio kab
    r = (g.est_f + tau * rk.reindex(g.index.get_level_values(0)).to_numpy()) / (g.est_o + tau)
    return r.clip(0.5, 3.0).rename("R").reset_index()


def main():
    path = sys.argv[1]
    folder = os.path.dirname(path)
    W = baca_w2w(path)
    P = tabel_titik_optik()
    for L in (0, 28, 56):
        fusi = pd.read_csv(f"data/satelit/est_nowcast2_lead{L}.csv")[["kabkota", "t", "est"]]
        f26 = f"data/satelit/est_nowcast2_lead{L}_2026.csv"
        if os.path.exists(f26):
            fusi = pd.concat([fusi, pd.read_csv(f26)[["kabkota", "t", "est"]]]).drop_duplicates(["kabkota", "t"], keep="last")
        opt = taksiran(P, L)
        R = rasio(fusi, opt)
        w = taksiran(W, L)
        w["bulan"] = (w.t - 1) % 12 + 1
        w = w.merge(R, on=["kabkota", "bulan"], how="left")
        w["est_optik"] = w.est
        w["est"] = w.est * w.R.fillna(1.0)
        w[["kabkota", "t", "est", "est_optik", "R"]].to_csv(os.path.join(folder, f"est_w2w_lead{L}.csv"), index=False)
        print(f"lead {L}: tersimpan est_w2w_lead{L}.csv, rasio median {R.R.median():.2f}", flush=True)


if __name__ == "__main__":
    main()
