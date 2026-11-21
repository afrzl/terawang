"""TERAWANG K1 · Nowcast v2: kejadian banjir yang BELUM selesai diverifikasi dihitung dengan bobot peluang.

Beda dari nowcast_est.py: pada tanggal potong, genangan yang jendela verifikasinya (EVI naik >= 0,5 dalam 3-6 jendela sesudahnya)
belum lengkap tidak dibuang, melainkan diberi bobot p(n) = peluang genangan semacam itu akhirnya terverifikasi, dengan n =
jumlah jendela verifikasi yang sudah tersedia (0-3) dan belum ada yang >= 0,5. Peluang dipelajari dari riwayat citra <= 2025
(tanpa label BPS). Genangan yang sudah terverifikasi berbobot 1; yang verifikasinya lengkap tetapi gagal berbobot 0.
Keluaran: est (nilai harapan), est_ver (hanya yang terverifikasi), est_pend (kontribusi bobot peluang).

  python scripts/k1/nowcast_est2.py --lead 28
"""
import argparse
import datetime as dt
import sys
import time

import numpy as np
import pandas as pd

sys.path.insert(0, "scripts/k1")
import siklus_tanam as st  # noqa: E402
from fusi_s1_s2 import fitur  # noqa: E402
from fusi_v2_s1_s2 import tetangga  # noqa: E402
from multitahun import muat  # noqa: E402
from nowcast_est import KERNEL, LAG, latih_fusi  # noqa: E402

HARI = 12


def nanmax0(x):
    x = np.asarray(x, float)
    return -1.0 if x.size == 0 or np.all(np.isnan(x)) else float(np.nanmax(x))


def genangan(l, e, i, evi_max=0.35, delta=0.05):
    return not (np.isnan(l[i]) or np.isnan(e[i])) and l[i] + delta >= e[i] and e[i] <= evi_max


def hitung_p(Lf, Ef, batas):
    """p[n]: peluang genangan terverifikasi lengkap, bila n jendela verifikasi awal (0-3) belum ada yang >= 0,5."""
    tot = {n: [0, 0] for n in range(4)}
    for i in range(Lf.shape[0]):
        l, e = Lf[i, :batas], Ef[i, :batas]
        j = 0
        while j < batas - 7:
            if genangan(l, e, j):
                V = nanmax0(e[j + 3:j + 7]) >= 0.5
                tot[0][0] += V
                tot[0][1] += 1
                for n in (1, 2, 3):
                    if nanmax0(e[j + 3:j + 3 + n]) < 0.5:
                        tot[n][0] += V
                        tot[n][1] += 1
                j += 6 if V else 1
            else:
                j += 1
    return {n: (tot[n][0] / tot[n][1] if tot[n][1] else 0.0) for n in tot}, {n: tot[n][1] for n in tot}


def deteksi(l, e, p, evi_ver=0.5):
    """Daftar (indeks, bobot, terverifikasi) pada deret yang berakhir di c (= panjang - 1)."""
    n = len(l)
    out, i = [], 0
    while i < n:
        if genangan(l, e, i):
            lo, hi = i + 3, min(i + 7, n)
            n_av = max(0, hi - lo)
            if n_av > 0 and nanmax0(e[lo:hi]) >= evi_ver:
                out.append((i, 1.0, True))
                i += 6
                continue
            if n_av < 4:
                out.append((i, p[n_av], False))
                i += 6
                continue
        i += 1
    return out


def isi_penuh(E0, L0, vh, doy, me, ml, mu_e, mu_l, chunk=1900):
    N = E0.shape[0]
    Ef, Lf = E0.copy(), L0.copy()
    for a in range(0, N, chunk):
        sl = slice(a, min(a + chunk, N))
        E, L, v = E0[sl].copy(), L0[sl].copy(), vh[sl]
        Xn, iE, iL = tetangga(E, L, v)
        X = np.hstack([fitur(v, doy), Xn]).astype(np.float32)
        be, bl = np.where(np.isnan(iE), mu_e, iE), np.where(np.isnan(iL), mu_l, iL)
        pe, pl = (be + me.predict(X)).reshape(E.shape), (bl + ml.predict(X)).reshape(L.shape)
        Ef[sl], Lf[sl] = np.where(np.isnan(E), pe, E), np.where(np.isnan(L), pl, L)
    return Ef, Lf


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lead", type=int, required=True)
    ap.add_argument("--mulai", default="2019-04")
    ap.add_argument("--akhir", default="2026-09")
    ap.add_argument("--sufiks", default="")
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
    Ef, Lf = isi_penuh(E0, L0, vh, doy, me, ml, mu_e, mu_l)
    batas = max(i for i, t in enumerate(tgl) if t <= dt.date(2025, 12, 31)) + 1
    p, n_kasus = hitung_p(Lf, Ef, batas)
    print(f"fusi dilatih dan peluang dihitung ({time.time() - t0:.0f} detik)")
    print("  peluang terverifikasi | p0 (belum ada jendela) %.2f (n=%d) | p1 %.2f (n=%d) | p2 %.2f (n=%d) | p3 %.2f (n=%d)" % (
        p[0], n_kasus[0], p[1], n_kasus[1], p[2], n_kasus[2], p[3], n_kasus[3]), flush=True)

    def bulan_idx(i):
        t = tgl[0] + dt.timedelta(days=HARI * i + HARI // 2)
        return t.year * 12 + t.month

    bidx = np.array([bulan_idx(i) for i in range(W + 40)])  # termasuk jendela masa depan (untuk prakiraan bulan yang belum terjadi)
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
        Wt = np.where(bidx == t_abs)[0]
        if not sel or len(Wt) == 0:
            continue
        c = max(sel)
        e_lo, e_hi = Wt.min() - LAG - 1, Wt.max() - LAG + 1
        if c < e_lo:
            hasil += [(k, t_abs, 0.0, 0.0, 0.0) for k in kab_u]
            continue
        s0 = max(0, e_lo - 12)
        seg0 = max(0, min(s0, c) - 12)
        sl = slice(seg0, c + 1)
        E, L, v, d = E0[:, sl].copy(), L0[:, sl].copy(), vh[:, sl].copy(), doy[sl]
        v[:, -2:] = np.nan
        Xn, iE, iL = tetangga(E, L, v)
        X = np.hstack([fitur(v, d), Xn]).astype(np.float32)
        kosong = np.isnan(E.reshape(-1))
        be, bl = np.where(np.isnan(iE), mu_e, iE), np.where(np.isnan(iL), mu_l, iL)
        Ef2, Lf2 = E.reshape(-1).copy(), L.reshape(-1).copy()
        if kosong.any():
            Ef2[kosong] = be[kosong] + me.predict(X[kosong])
            Lf2[kosong] = bl[kosong] + ml.predict(X[kosong])
        Ef2, Lf2 = Ef2.reshape(E.shape), Lf2.reshape(L.shape)
        off = max(0, s0 - seg0)
        acc_v, acc_p = np.zeros(len(kab_u)), np.zeros(len(kab_u))
        for i in range(N):
            for e, w, ver in deteksi(Lf2[i, off:], Ef2[i, off:], p):
                e_abs = seg0 + off + e
                if e_abs < e_lo or e_abs > e_hi:
                    continue
                for dk, wk in KERNEL:
                    j = e_abs + LAG + dk
                    if 0 <= j < len(bidx) and bidx[j] == t_abs:
                        (acc_v if ver else acc_p)[kab_i[i]] += wk * w
        hasil += [(k, t_abs, (acc_v[j] + acc_p[j]) * skala[j], acc_v[j] * skala[j], acc_p[j] * skala[j]) for j, k in enumerate(kab_u)]
        if m == 12 or (y, m) == bulan[-1]:
            print(f"  lead {a.lead}: sampai {y}-{m:02d} ({time.time() - t0:.0f} detik)", flush=True)
    out = pd.DataFrame(hasil, columns=["kabkota", "t", "est", "est_ver", "est_pend"])
    path = f"data/satelit/est_nowcast2_lead{a.lead}{a.sufiks}.csv"
    out.to_csv(path, index=False)
    print("tersimpan", path, len(out), "baris", flush=True)


if __name__ == "__main__":
    main()
