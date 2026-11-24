"""TERAWANG K1 · Fusi S1+S2 versi 3: v2 + VV dan selisih VV-VH (VV peka genangan).

Pembanding pada pengamatan optik jernih 2026 yang disembunyikan: interpolasi saja, v2 (VH + optik tetangga), v3 (v2 + VV).
Keluaran: deret terisi v3 ke berkas npz, lalu dievaluasi aturan banjir lewat fusi_s1_s2.py <berkas>.

  python scripts/k1/fusi_v3_vv.py [keluaran.npz]
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
from fusi_v2_s1_s2 import tetangga  # noqa: E402

HARI = 12


def main():
    v = pd.read_csv(st.TITIK)
    vvd = pd.read_csv("data/satelit/vv_titik_12harian_kabkota.csv.gz")
    s = pd.read_csv("data/satelit/s2_titik_12harian_kabkota.csv.gz")
    assert (vvd.kabkota.to_numpy() == v.kabkota.to_numpy()).all()
    tgl = [dt.date.fromisoformat(c) for c in v.columns[3:]]
    W, N = len(tgl), len(s)
    E0 = s[[c for c in s.columns if c.startswith("evi_")]].to_numpy(float)
    L0 = s[[c for c in s.columns if c.startswith("lswi_")]].to_numpy(float)
    both = np.isnan(E0) | np.isnan(L0)
    E0[both] = np.nan
    L0[both] = np.nan

    def seri(df):
        return np.vstack([x if (x := st.bersihkan(r)) is not None else np.full(W, np.nan) for r in df.iloc[:, 3:].to_numpy()])

    vh = seri(v)
    vv = seri(vvd)
    doy = np.array([(t + dt.timedelta(days=HARI // 2)).timetuple().tm_yday for t in tgl], float)
    Xvh = fitur(vh, doy)
    Xvv = fitur(vv, doy)[:, :-2]
    Xrt = fitur(vv - vh, doy)[:, :-2]
    cut = max(i for i, t in enumerate(tgl) if t <= dt.date(2025, 12, 31))
    win = np.tile(np.arange(W), N)

    rng = np.random.default_rng(11)  # sama dengan v2: sel yang disembunyikan identik
    h = rng.random((N, W)) < 0.12
    h = h | np.roll(h, 1, axis=1) & (rng.random((N, W)) < 0.6) | np.roll(h, -1, axis=1) & (rng.random((N, W)) < 0.4)
    Em, Lm = E0.copy(), L0.copy()
    Em[h] = np.nan
    Lm[h] = np.nan
    Xn, iE, iL = tetangga(Em, Lm, vh)
    X2 = np.hstack([Xvh, Xn])
    X3 = np.hstack([Xvh, Xn, Xvv, Xrt])
    ye, yl = E0.reshape(-1), L0.reshape(-1)
    clear = ~np.isnan(ye)
    tr = clear & (win <= cut)
    te = h.reshape(-1) & clear & (win > cut)
    base_e = np.where(np.isnan(iE), np.nanmean(ye), iE)
    base_l = np.where(np.isnan(iL), np.nanmean(yl), iL)
    sel = np.random.default_rng(3).choice(np.where(tr)[0], size=min(400_000, tr.sum()), replace=False)
    prm = dict(max_iter=250, learning_rate=0.08, random_state=7)
    mods = {}
    for nama, X in (("v2", X2), ("v3", X3)):
        mods[nama] = (HistGradientBoostingRegressor(**prm).fit(X[sel], (ye - base_e)[sel]),
                      HistGradientBoostingRegressor(**prm).fit(X[sel], (yl - base_l)[sel]), X)
    print(f"uji: {te.sum():,} pengamatan jernih 2026 yang disembunyikan")
    print(f"{'':30s}{'EVI R2':>8s}{'EVI MAE':>9s}{'LSWI R2':>9s}{'LSWI MAE':>10s}{'banjir recall':>15s}{'presisi':>9s}")
    fa = (yl[te] + 0.05 >= ye[te]) & (ye[te] <= 0.35)
    rows = [("interpolasi saja", base_e, base_l)]
    for nama, (me, ml, X) in mods.items():
        rows.append((f"{nama}: " + ("VH + optik tetangga" if nama == "v2" else "+ VV, VV-VH"), base_e + me.predict(X), base_l + ml.predict(X)))
    for nama, a, b in rows:
        fp = (b[te] + 0.05 >= a[te]) & (a[te] <= 0.35)
        print(f"  {nama:28s}{r2_score(ye[te], a[te]):8.2f}{np.mean(np.abs(ye[te] - a[te])):9.3f}{r2_score(yl[te], b[te]):9.2f}{np.mean(np.abs(yl[te] - b[te])):10.3f}{np.mean(fp[fa]) * 100:14.0f}%{np.mean(fa[fp]) * 100:8.0f}%")

    # isi celah awan nyata dengan v3
    Xr, iEr, iLr = tetangga(E0, L0, vh)
    Xr3 = np.hstack([Xvh, Xr, Xvv, Xrt])
    me3, ml3, _ = mods["v3"]
    be = np.where(np.isnan(iEr), np.nanmean(ye), iEr)
    bl = np.where(np.isnan(iLr), np.nanmean(yl), iLr)
    ef = np.where(np.isnan(E0.reshape(-1)), be + me3.predict(Xr3), E0.reshape(-1)).reshape(E0.shape)
    lf = np.where(np.isnan(L0.reshape(-1)), bl + ml3.predict(Xr3), L0.reshape(-1)).reshape(L0.shape)
    out = sys.argv[1] if len(sys.argv) > 1 else "fusi_v3.npz"
    np.savez(out, evi=ef, lswi=lf)
    print(f"deret terisi v3 disimpan: {out}")


if __name__ == "__main__":
    main()
