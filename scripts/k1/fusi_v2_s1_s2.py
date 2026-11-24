"""TERAWANG K1 · Fusi S1+S2 versi 2: SAR + nilai optik jernih terdekat (waktu) untuk mengisi celah awan.

Beda dari fusi_s1_s2.py (hanya VH): model juga melihat EVI/LSWI jernih sebelum dan sesudah celah (nilai dan jarak jendela),
hasil interpolasi linear, dan perubahan VH sejak pengamatan optik terakhir. Model menebak SELISIH terhadap interpolasi.

Evaluasi adil: sebagian pengamatan jernih disembunyikan (blok pendek acak, ~30%), model menebaknya kembali. Dibandingkan dengan
(a) interpolasi linear saja, (b) model VH saja (versi 1). Dilatih pada jendela <= 2025, diuji pada 2026.
Keluaran: deret EVI/LSWI terisi (disimpan ke berkas npz) untuk dievaluasi aturan banjir lewat fusi_s1_s2.py <berkas>.

  python scripts/k1/fusi_v2_s1_s2.py [keluaran.npz]
"""
import datetime as dt
import sys

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import r2_score

sys.path.insert(0, "scripts/k1")
import siklus_tanam as st  # noqa: E402
from fusi_s1_s2 import fitur  # noqa: E402

HARI = 12


def tetangga(E, L, vh):
    """Fitur optik tetangga untuk tiap sel; nilai sel itu sendiri tidak dipakai."""
    N, W = E.shape
    w = np.arange(W)[None, :].repeat(N, 0).astype(float)
    ada = ~np.isnan(E)
    idx = np.where(ada, w, np.nan)
    dE, dL, dI = pd.DataFrame(E), pd.DataFrame(L), pd.DataFrame(idx)
    pE = dE.ffill(axis=1).shift(1, axis=1).to_numpy()
    pL = dL.ffill(axis=1).shift(1, axis=1).to_numpy()
    pI = dI.ffill(axis=1).shift(1, axis=1).to_numpy()
    nE = dE.bfill(axis=1).shift(-1, axis=1).to_numpy()
    nL = dL.bfill(axis=1).shift(-1, axis=1).to_numpy()
    nI = dI.bfill(axis=1).shift(-1, axis=1).to_numpy()
    dp, dn = w - pI, nI - w
    # interpolasi linear (bila hanya satu sisi ada, pakai sisi itu)
    with np.errstate(invalid="ignore", divide="ignore"):
        a = dn / (dp + dn)
        iE = np.where(~np.isnan(pE) & ~np.isnan(nE), pE * a + nE * (1 - a), np.where(~np.isnan(pE), pE, nE))
        iL = np.where(~np.isnan(pL) & ~np.isnan(nL), pL * a + nL * (1 - a), np.where(~np.isnan(pL), pL, nL))
    vhp = np.take_along_axis(vh, np.nan_to_num(pI, nan=0).astype(int), axis=1)
    vhn = np.take_along_axis(vh, np.nan_to_num(nI, nan=0).astype(int), axis=1)
    vhp = np.where(np.isnan(pI), np.nan, vhp)
    vhn = np.where(np.isnan(nI), np.nan, vhn)
    cols = [pE, pL, dp, nE, nL, dn, iE, iL, vh - vhp, vhn - vh]
    return np.stack([c.reshape(-1) for c in cols], axis=1), iE.reshape(-1), iL.reshape(-1)


def main():
    v = pd.read_csv(st.TITIK)
    s = pd.read_csv("data/satelit/s2_titik_12harian_kabkota.csv.gz")
    tgl = [dt.date.fromisoformat(c) for c in v.columns[3:]]
    W = len(tgl)
    E0 = s[[c for c in s.columns if c.startswith("evi_")]].to_numpy(float)
    L0 = s[[c for c in s.columns if c.startswith("lswi_")]].to_numpy(float)
    both = np.isnan(E0) | np.isnan(L0)
    E0[both] = np.nan
    L0[both] = np.nan
    N = len(s)
    vh = np.vstack([x if (x := st.bersihkan(r)) is not None else np.full(W, np.nan) for r in v.iloc[:, 3:].to_numpy()])
    doy = np.array([(t + dt.timedelta(days=HARI // 2)).timetuple().tm_yday for t in tgl], float)
    Xvh = fitur(vh, doy)
    cut = max(i for i, t in enumerate(tgl) if t <= dt.date(2025, 12, 31))
    win = np.tile(np.arange(W), N)

    # simulasi celah: sembunyikan blok pendek acak pada pengamatan jernih
    rng = np.random.default_rng(11)
    h = rng.random((N, W)) < 0.12
    h = h | np.roll(h, 1, axis=1) & (rng.random((N, W)) < 0.6) | np.roll(h, -1, axis=1) & (rng.random((N, W)) < 0.4)
    Em, Lm = E0.copy(), L0.copy()
    Em[h] = np.nan
    Lm[h] = np.nan
    Xn, iE, iL = tetangga(Em, Lm, vh)
    X2 = np.hstack([Xvh, Xn])
    ye, yl = E0.reshape(-1), L0.reshape(-1)
    clear = ~np.isnan(ye)
    hid = h.reshape(-1) & clear
    tr = clear & (win <= cut)
    te = hid & (win > cut)
    print(f"sel jernih {clear.mean() * 100:.0f}%; disembunyikan untuk uji (2026): {te.sum():,}; latih {tr.sum():,}")

    base_e = np.where(np.isnan(iE), np.nanmean(ye), iE)
    base_l = np.where(np.isnan(iL), np.nanmean(yl), iL)
    sel = np.random.default_rng(3).choice(np.where(tr)[0], size=min(400_000, tr.sum()), replace=False)
    prm = dict(max_iter=250, learning_rate=0.08, random_state=7)
    m_e2 = HistGradientBoostingRegressor(**prm).fit(X2[sel], (ye - base_e)[sel])
    m_l2 = HistGradientBoostingRegressor(**prm).fit(X2[sel], (yl - base_l)[sel])
    m_e1 = HistGradientBoostingRegressor(**prm).fit(Xvh[sel], ye[sel])
    m_l1 = HistGradientBoostingRegressor(**prm).fit(Xvh[sel], yl[sel])
    pe2 = base_e + m_e2.predict(X2)
    pl2 = base_l + m_l2.predict(X2)
    pe1, pl1 = m_e1.predict(Xvh), m_l1.predict(Xvh)
    print("\nMenebak pengamatan yang disembunyikan di 2026 (belum pernah dilihat model)")
    print(f"{'':32s}{'EVI R2':>8s}{'EVI MAE':>9s}{'LSWI R2':>9s}{'LSWI MAE':>10s}")
    for nama, a, b in [("interpolasi linear saja", base_e, base_l), ("v1: VH saja", pe1, pl1), ("v2: VH + optik tetangga", pe2, pl2)]:
        print(f"  {nama:30s}{r2_score(ye[te], a[te]):8.2f}{np.mean(np.abs(ye[te] - a[te])):9.3f}{r2_score(yl[te], b[te]):9.2f}{np.mean(np.abs(yl[te] - b[te])):10.3f}")
    fa = (yl[te] + 0.05 >= ye[te]) & (ye[te] <= 0.35)
    for nama, a, b in [("interpolasi linear saja", base_e, base_l), ("v1: VH saja", pe1, pl1), ("v2: VH + optik tetangga", pe2, pl2)]:
        fp = (b[te] + 0.05 >= a[te]) & (a[te] <= 0.35)
        print(f"  kelas banjir, {nama:24s}: presisi {np.mean(fa[fp]) * 100:3.0f}%  recall {np.mean(fp[fa]) * 100:3.0f}%  (porsi banjir asli {fa.mean() * 100:.0f}%)")

    # isi celah awan nyata dengan v2 (fitur dari data asli)
    Xr, iEr, iLr = tetangga(E0, L0, vh)
    Xr2 = np.hstack([Xvh, Xr])
    be = np.where(np.isnan(iEr), np.nanmean(ye), iEr)
    bl = np.where(np.isnan(iLr), np.nanmean(yl), iLr)
    ef = np.where(np.isnan(E0.reshape(-1)), be + m_e2.predict(Xr2), E0.reshape(-1)).reshape(E0.shape)
    lf = np.where(np.isnan(L0.reshape(-1)), bl + m_l2.predict(Xr2), L0.reshape(-1)).reshape(L0.shape)
    out = sys.argv[1] if len(sys.argv) > 1 else "fusi_v2.npz"
    np.savez(out, evi=ef, lswi=lf)
    print(f"\nderet terisi (celah awan nyata {np.isnan(E0).mean() * 100:.0f}%) disimpan: {out}")


if __name__ == "__main__":
    main()
