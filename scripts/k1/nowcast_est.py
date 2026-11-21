"""TERAWANG K1 · Taksiran citra yang JUJUR secara waktu (nowcast): untuk tiap bulan target t dan jarak waktu 'lead',
hanya memakai informasi yang tersedia pada tanggal potong C = (hari pertama bulan t) - lead hari.

Aturan informasi pada tanggal potong C:
  - jendela citra yang dipakai hanya yang sudah berakhir sebelum C (c = jendela terakhir yang lengkap);
  - VH dihaluskan di sekitar jendela, jadi dua jendela terakhir dikosongkan (tidak boleh mengintip masa depan);
  - fusi v2 mengisi jendela berawan hanya dari tetangga sebelum/sampai c (tetangga "sesudah" yang belum ada dibiarkan kosong);
  - verifikasi tanam (EVI naik dalam 3-6 jendela sesudah banjir) hanya memakai jendela sampai c;
  - kejadian tanam e menyumbang ke bulan target bila e + 8 jendela (jeda tanam-panen) jatuh di bulan itu (kernel .25/.5/.25).
Model fusi dilatih sekali pada jendela jernih <= 2025 (tanpa label BPS).

  python scripts/k1/nowcast_est.py --lead 28      # juga 56 dan 0; hasil: data/satelit/est_nowcast_lead<lead>.csv
"""
import argparse
import datetime as dt
import sys
import time

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

sys.path.insert(0, "scripts/k1")
import siklus_tanam as st  # noqa: E402
from fusi_s1_s2 import fitur  # noqa: E402
from fusi_v2_s1_s2 import tetangga  # noqa: E402
from multitahun import muat  # noqa: E402
from tuning_banjir_s2 import peristiwa  # noqa: E402

HARI = 12
LAG = 8
KERNEL = ((-1, 0.25), (0, 0.5), (1, 0.25))


def latih_fusi(E0, L0, vh, doy, tgl, chunk=1900):
    N, W = E0.shape
    cut = max(i for i, t in enumerate(tgl) if t <= dt.date(2025, 12, 31))
    rng = np.random.default_rng(11)
    win = np.tile(np.arange(W), chunk)
    mu_e, mu_l = np.nanmean(E0[:, :cut]), np.nanmean(L0[:, :cut])
    per_chunk = 560_000 // int(np.ceil(N / chunk))
    Xt, Ye, Yl = [], [], []
    for a in range(0, N, chunk):
        sl = slice(a, min(a + chunk, N))
        E, L, v = E0[sl].copy(), L0[sl].copy(), vh[sl]
        n = E.shape[0]
        both = np.isnan(E) | np.isnan(L)
        E[both] = np.nan
        L[both] = np.nan
        h = rng.random((n, W)) < 0.12
        h = h | np.roll(h, 1, axis=1) & (rng.random((n, W)) < 0.6) | np.roll(h, -1, axis=1) & (rng.random((n, W)) < 0.4)
        Em, Lm = E.copy(), L.copy()
        Em[h] = np.nan
        Lm[h] = np.nan
        Xn, iE, iL = tetangga(Em, Lm, v)
        X = np.hstack([fitur(v, doy), Xn]).astype(np.float32)
        ye, yl = E.reshape(-1), L.reshape(-1)
        idx = np.where(~np.isnan(ye) & (win[: n * W] <= cut))[0]
        idx = rng.choice(idx, size=min(per_chunk, len(idx)), replace=False)
        be, bl = np.where(np.isnan(iE), mu_e, iE), np.where(np.isnan(iL), mu_l, iL)
        Xt.append(X[idx]); Ye.append((ye - be)[idx]); Yl.append((yl - bl)[idx])
    Xt = np.vstack(Xt)
    prm = dict(max_iter=250, learning_rate=0.08, random_state=7)
    return (HistGradientBoostingRegressor(**prm).fit(Xt, np.concatenate(Ye)),
            HistGradientBoostingRegressor(**prm).fit(Xt, np.concatenate(Yl)), mu_e, mu_l)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lead", type=int, required=True, help="hari sebelum awal bulan target")
    ap.add_argument("--mulai", default="2019-04")
    ap.add_argument("--akhir", default="2026-09")
    a = ap.parse_args()

    kab, tgl, vh_raw, vv_raw, L0, E0 = muat()
    N, W = E0.shape
    both = np.isnan(E0) | np.isnan(L0)
    E0[both] = np.nan
    L0[both] = np.nan
    vh = np.vstack([x if (x := st.bersihkan(r)) is not None else np.full(W, np.nan) for r in vh_raw])
    doy = np.array([(t + dt.timedelta(days=HARI // 2)).timetuple().tm_yday for t in tgl], float)
    t0 = time.time()
    me, ml, mu_e, mu_l = latih_fusi(E0, L0, vh, doy, tgl)
    print(f"fusi dilatih ({time.time() - t0:.0f} detik)", flush=True)

    def bulan_idx(i):
        t = tgl[0] + dt.timedelta(days=HARI * i + HARI // 2)
        return t.year * 12 + t.month

    bidx = np.array([bulan_idx(i) for i in range(W)])
    sawah = pd.read_csv(st.SAWAH).drop_duplicates("kabkota").set_index("kabkota").luas_sawah_ha
    jml = pd.Series(kab).value_counts()
    kab_u = list(jml.index)
    kab_i = np.array([kab_u.index(k) for k in kab])
    skala = np.array([sawah[k] / jml[k] for k in kab_u])

    th0, tm0 = (int(x) for x in a.mulai.split("-"))
    th1, tm1 = (int(x) for x in a.akhir.split("-"))
    bulan = [(y, m) for y in range(th0, th1 + 1) for m in range(1, 13) if (th0, tm0) <= (y, m) <= (th1, tm1)]
    hasil = []
    for (y, m) in bulan:
        t_abs = y * 12 + m
        C = dt.date(y, m, 1) - dt.timedelta(days=a.lead)
        sel = [i for i, t in enumerate(tgl) if t + dt.timedelta(days=HARI) <= C]
        if not sel:
            continue
        c = max(sel)
        Wt = np.where(bidx == t_abs)[0]
        if len(Wt) == 0:
            continue
        e_lo, e_hi = Wt.min() - LAG - 1, Wt.max() - LAG + 1
        s0 = max(0, e_lo - 12)
        seg0 = max(0, min(s0, c) - 12)
        if c < e_lo:  # belum ada jendela sama sekali untuk kejadian yang relevan
            hasil += [(k, t_abs, 0.0) for k in kab_u]
            continue
        sl = slice(seg0, c + 1)
        E, L, v, d = E0[:, sl].copy(), L0[:, sl].copy(), vh[:, sl].copy(), doy[sl]
        v[:, -2:] = np.nan  # penghalusan VH terpusat: dua jendela terakhir belum lengkap
        Xn, iE, iL = tetangga(E, L, v)
        X = np.hstack([fitur(v, d), Xn]).astype(np.float32)
        kosong = np.isnan(E.reshape(-1))
        be, bl = np.where(np.isnan(iE), mu_e, iE), np.where(np.isnan(iL), mu_l, iL)
        Ef, Lf = E.reshape(-1).copy(), L.reshape(-1).copy()
        if kosong.any():
            Ef[kosong] = be[kosong] + me.predict(X[kosong])
            Lf[kosong] = bl[kosong] + ml.predict(X[kosong])
        Ef, Lf = Ef.reshape(E.shape), Lf.reshape(L.shape)
        off = max(0, s0 - seg0)
        acc = np.zeros(len(kab_u))
        for i in range(N):
            for e in peristiwa(Lf[i, off:], Ef[i, off:], 0.35, 0.50, 0.05):
                e_abs = seg0 + off + e
                if e_abs < e_lo or e_abs > e_hi:
                    continue
                for dk, wk in KERNEL:
                    j = e_abs + LAG + dk
                    if 0 <= j < W and bidx[j] == t_abs:
                        acc[kab_i[i]] += wk
        hasil += [(k, t_abs, acc[j] * skala[j]) for j, k in enumerate(kab_u)]
        if m == 12 or (y, m) == bulan[-1]:
            print(f"  lead {a.lead}: sampai {y}-{m:02d} selesai ({time.time() - t0:.0f} detik)", flush=True)
    out = pd.DataFrame(hasil, columns=["kabkota", "t", "est"])
    p = f"data/satelit/est_nowcast_lead{a.lead}.csv"
    out.to_csv(p, index=False)
    print("tersimpan", p, len(out), "baris", flush=True)


if __name__ == "__main__":
    main()
