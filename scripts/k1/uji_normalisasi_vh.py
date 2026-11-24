"""TERAWANG K1 · Uji normalisasi VH antar satelit (Sentinel-1A berhenti Jul 2026, 1D masuk Apr 2026) untuk fusi v2.

Masalah: median VH seluruh titik sawah sejak Mei 2026 lebih rendah 0,5-1,5 dB dari bulan yang sama 2025, sedangkan model fusi
dilatih dengan level VH mentah <= 2025. Varian yang diuji (fusi dilatih ulang <= 2025, dinilai pada 30% pengamatan optik jernih
2026 yang disembunyikan):
  mentah   : seperti sekarang;
  koreksi  : tiap jendela sejak 2026-04 dikurangi offset = median VH semua titik pada jendela itu - median klimatologi
             (hari ke-n yang sama, 2019-2025), offset dihaluskan 3 jendela. Sebelum 2026-04 tidak diubah;
  konstan  : satu offset tetap (median offset Mei-Sep 2026, musim kemarau yang stabil) untuk semua jendela sejak 2026-04.
             Alasan: pergeseran kalibrasi satelit mestinya konstan; penurunan VH Okt-Nov bisa jadi sinyal genangan tanam yang asli.

  python scripts/k1/uji_normalisasi_vh.py [mentah koreksi konstan]
"""
import datetime as dt
import sys

import numpy as np
from sklearn.metrics import r2_score

sys.path.insert(0, "scripts/k1")
import siklus_tanam as st  # noqa: E402
from fusi_s1_s2 import fitur  # noqa: E402
from fusi_v2_s1_s2 import tetangga  # noqa: E402
from multitahun import muat  # noqa: E402
from nowcast_est import latih_fusi  # noqa: E402

HARI = 12
MULAI_S1D = dt.date(2026, 4, 1)


def offset_vh(vh, tgl, mulai=MULAI_S1D, ref=(2019, 2025)):
    """Offset per jendela (dB) relatif klimatologi hari ke-n; nol sebelum 'mulai'. vh: (N, W) sudah dibersihkan."""
    med = np.nanmedian(vh, axis=0)
    doy = np.array([t.timetuple().tm_yday for t in tgl])
    yr = np.array([t.year for t in tgl])
    off = np.zeros(len(tgl))
    for j, t in enumerate(tgl):
        if t < mulai:
            continue
        m = (yr >= ref[0]) & (yr <= ref[1]) & (np.abs(((doy - doy[j] + 182) % 365) - 182) <= 9)
        off[j] = med[j] - np.nanmedian(med[m])
    # haluskan (median 3 jendela) agar satu jendela anomali tidak mendominasi
    sm = off.copy()
    for j in range(len(off)):
        if tgl[j] >= mulai:
            sm[j] = np.median(off[max(0, j - 1):j + 2])
    return sm


def main():
    kab, tgl, vh_raw, vv_raw, L0, E0 = muat()
    N, W = E0.shape
    both = np.isnan(E0) | np.isnan(L0)
    E0[both], L0[both] = np.nan, np.nan
    vh = np.vstack([x if (x := st.bersihkan(r)) is not None else np.full(W, np.nan) for r in vh_raw])
    doy = np.array([(t + dt.timedelta(days=HARI // 2)).timetuple().tm_yday for t in tgl], float)
    off = offset_vh(vh, tgl)
    print("offset VH (dB) per bulan sejak 2026-04:", {f"{t:%Y-%m-%d}": round(float(o), 2) for t, o in zip(tgl, off) if t >= MULAI_S1D})

    cut = max(i for i, t in enumerate(tgl) if t <= dt.date(2025, 12, 31))
    rng = np.random.default_rng(11)
    h = rng.random((N, W)) < 0.12
    h = h | np.roll(h, 1, axis=1) & (rng.random((N, W)) < 0.6) | np.roll(h, -1, axis=1) & (rng.random((N, W)) < 0.4)
    win = np.arange(W)[None, :].repeat(N, 0)
    te = h & ~np.isnan(E0) & (win > cut)
    after = np.array([t >= MULAI_S1D for t in tgl])[None, :].repeat(N, 0)
    Em, Lm = E0.copy(), L0.copy()
    Em[te], Lm[te] = np.nan, np.nan
    ye, yl = E0[te], L0[te]
    fa = (yl + 0.05 >= ye) & (ye <= 0.35)
    print(f"uji: {te.sum():,} sel jernih 2026 disembunyikan ({(te & after).sum():,} sejak 2026-04)")
    tt = np.array(tgl)
    kon = float(np.median(off[(tt >= dt.date(2026, 5, 1)) & (tt <= dt.date(2026, 9, 30))]))
    off_k = np.where(tt >= MULAI_S1D, kon, 0.0)
    print(f"offset konstan: {kon:.2f} dB")
    varian = {"mentah": vh, "koreksi": vh - off[None, :], "konstan": vh - off_k[None, :]}
    for nama in (sys.argv[1:] or list(varian)):
        v = varian[nama]
        me, ml, mu_e, mu_l = latih_fusi(Em, Lm, v, doy, tgl)
        Xn, iE, iL = tetangga(Em, Lm, v)
        X = np.hstack([fitur(v, doy), Xn]).astype(np.float32)
        t = te.reshape(-1)
        pe = (np.where(np.isnan(iE), mu_e, iE) + 0)[t] + me.predict(X[t])
        pl = (np.where(np.isnan(iL), mu_l, iL) + 0)[t] + ml.predict(X[t])
        fp = (pl + 0.05 >= pe) & (pe <= 0.35)
        a = after[te]
        print(f"  {nama:8s} EVI R2 {r2_score(ye, pe):.3f} | LSWI R2 {r2_score(yl, pl):.3f} (sejak Apr: {r2_score(yl[a], pl[a]):.3f}) | "
              f"banjir presisi {np.mean(fa[fp]) * 100:.1f}% recall {np.mean(fp[fa]) * 100:.1f}%", flush=True)


if __name__ == "__main__":
    main()
