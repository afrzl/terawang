"""TERAWANG K1 · Kalibrasi multi-tahun (BPS bulanan 2019-2025) dengan uji bergulir per tahun.

Langkah:
 1. Gabung deret citra 2018-2026 (riwayat 2018-2024 + deret 2024-2026) pada 15.200 titik yang sama.
 2. Fusi v2 (VH + optik tetangga) mengisi jendela berawan; dilatih hanya pada jendela jernih sampai 2025, tanpa label BPS.
 3. Aturan banjir -> kejadian tanam; panen = tanam + 8 jendela, dihaluskan kernel [.25,.5,.25] -> taksiran luas panen per kab per bulan (est).
 4. Model pada target luas panen BPS bulanan per kab, uji BERGULIR: latih pada tahun < Y, uji pada Y (2021..2025), lalu 2026 Jan-Sep.
      musiman  : bulan yang sama tahun lalu                    | klimatologi: rata-rata bulan yang sama di tahun latih
      sat-glob : koefisien global x est                         | sat-kab    : koefisien per kab (menyusut ke global) x est
      gabungan : bobot non-negatif atas {sat-kab, klimatologi, musiman}, dipelajari lewat leave-one-year-out di tahun latih

  python scripts/gee/riwayat_titik.py --gabung     # prasyarat
  python scripts/k1/multitahun.py
"""
import datetime as dt
import io
import os
import subprocess
import sys

import numpy as np
import pandas as pd
from scipy.optimize import nnls
from sklearn.ensemble import HistGradientBoostingRegressor

sys.path.insert(0, "scripts/k1")
import siklus_tanam as st  # noqa: E402
from fusi_s1_s2 import fitur  # noqa: E402
from fusi_v2_s1_s2 import tetangga  # noqa: E402
from tuning_banjir_s2 import peristiwa  # noqa: E402

HARI = 12
LAG = 8
KERNEL = (0.25, 0.5, 0.25)


def sql(q):
    out = subprocess.run(["psql", "-d", "terawang", "--csv", "-c", q], capture_output=True, text=True, check=True).stdout
    return pd.read_csv(io.StringIO(out))


def wape(a, p):
    a, p = np.asarray(a, float), np.asarray(p, float)
    return np.abs(p - a).sum() / a.sum() * 100


def data_bps(rel):
    """Berkas data/... dari lapisan konektor (TERAWANG_DATA_DIR, mis. BPS WebAPI) bila ada, selain itu dari repo."""
    lapis = os.environ.get("TERAWANG_DATA_DIR")
    p = os.path.join(lapis, rel[len("data/"):]) if lapis and rel.startswith("data/") else None
    return p if p and os.path.exists(p) else rel


def muat():
    """Kembalikan kab, lon/lat, tanggal jendela, dan matriks VH, VV, LSWI, EVI (N x W, NaN = kosong)."""
    S = "data/satelit/"
    T = os.environ.get("TERAWANG_TITIK_DIR", "data/satelit").rstrip("/") + "/"  # pipeline: deret 12-harian yang diperpanjang otomatis
    old_vh = pd.read_csv(T + "vh_titik_12harian_kabkota.csv.gz")
    old_vv = pd.read_csv(T + "vv_titik_12harian_kabkota.csv.gz")
    old_s2 = pd.read_csv(T + "s2_titik_12harian_kabkota.csv.gz")
    new = {k: pd.read_csv(S + f"{k}_titik_riwayat_2018_2024.csv.gz") for k in ("vh", "vv", "lswi", "evi")}
    kab = old_vh.kabkota.to_numpy()
    for d in (old_vv, old_s2, *new.values()):
        assert (d.kabkota.to_numpy() == kab).all()
    assert np.allclose(new["vh"].lon, old_vh.lon, atol=1e-4)
    d_new = [dt.date.fromisoformat(c) for c in new["vh"].columns[3:]]
    d_old = [dt.date.fromisoformat(c) for c in old_vh.columns[3:]]
    assert (d_old[0] - d_new[-1]).days == 12, "deret baru harus menyambung tepat dengan deret lama"
    tgl = d_new + d_old
    vh = np.hstack([new["vh"].iloc[:, 3:].to_numpy(float), old_vh.iloc[:, 3:].to_numpy(float)])
    vv = np.hstack([new["vv"].iloc[:, 3:].to_numpy(float), old_vv.iloc[:, 3:].to_numpy(float)])
    lswi = np.hstack([new["lswi"].iloc[:, 3:].to_numpy(float), old_s2[[c for c in old_s2.columns if c.startswith("lswi_")]].to_numpy(float)])
    evi = np.hstack([new["evi"].iloc[:, 3:].to_numpy(float), old_s2[[c for c in old_s2.columns if c.startswith("evi_")]].to_numpy(float)])
    return kab, tgl, vh, vv, lswi, evi


def isi_celah(E0, L0, vh, doy, tgl, chunk=1900):
    """Fusi v2 per bagian titik (hemat memori). Dilatih pada jendela jernih <= 2025."""
    N, W = E0.shape
    cut = max(i for i, t in enumerate(tgl) if t <= dt.date(2025, 12, 31))
    rng = np.random.default_rng(11)
    win = np.tile(np.arange(W), chunk)
    Xt, Yt_e, Yt_l, Bt_e, Bt_l = [], [], [], [], []
    mu_e, mu_l = np.nanmean(E0[:, :cut]), np.nanmean(L0[:, :cut])
    per_chunk = 560_000 // int(np.ceil(N / chunk))
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
        w_ = win[: n * W]
        idx = np.where(~np.isnan(ye) & (w_ <= cut))[0]
        idx = rng.choice(idx, size=min(per_chunk, len(idx)), replace=False)
        be = np.where(np.isnan(iE), mu_e, iE)
        bl = np.where(np.isnan(iL), mu_l, iL)
        Xt.append(X[idx]); Yt_e.append((ye - be)[idx]); Yt_l.append((yl - bl)[idx])
    Xt = np.vstack(Xt)
    prm = dict(max_iter=250, learning_rate=0.08, random_state=7)
    me = HistGradientBoostingRegressor(**prm).fit(Xt, np.concatenate(Yt_e))
    ml = HistGradientBoostingRegressor(**prm).fit(Xt, np.concatenate(Yt_l))
    Ef, Lf = E0.copy(), L0.copy()
    for a in range(0, N, chunk):
        sl = slice(a, min(a + chunk, N))
        E, L, v = E0[sl].copy(), L0[sl].copy(), vh[sl]
        both = np.isnan(E) | np.isnan(L)
        E[both] = np.nan
        L[both] = np.nan
        Xn, iE, iL = tetangga(E, L, v)
        X = np.hstack([fitur(v, doy), Xn]).astype(np.float32)
        be = np.where(np.isnan(iE), mu_e, iE)
        bl = np.where(np.isnan(iL), mu_l, iL)
        pe = (be + me.predict(X)).reshape(E.shape)
        pl = (bl + ml.predict(X)).reshape(L.shape)
        Ef[sl] = np.where(np.isnan(E), pe, E)
        Lf[sl] = np.where(np.isnan(L), pl, L)
    return Ef, Lf


def main():
    kab, tgl, vh_raw, vv_raw, L0, E0 = muat()
    N, W = E0.shape
    print(f"titik {N}, jendela {W}: {tgl[0]} .. {tgl[-1]}; sel kosong optik {np.isnan(E0).mean() * 100:.0f}%")
    vh = np.vstack([x if (x := st.bersihkan(r)) is not None else np.full(W, np.nan) for r in vh_raw])
    doy = np.array([(t + dt.timedelta(days=HARI // 2)).timetuple().tm_yday for t in tgl], float)

    # cakupan optik per tahun (untuk mendeteksi awal deret yang belum punya Sentinel-2)
    thn = np.array([t.year for t in tgl])
    print("porsi sel optik terisi per tahun jendela:", {int(y): round(float((~np.isnan(E0[:, thn == y])).mean()), 2) for y in sorted(set(thn))})

    Ef, Lf = isi_celah(E0, L0, vh, doy, tgl)
    print("fusi selesai")

    def bulan_idx(i):
        t = tgl[0] + dt.timedelta(days=HARI * i + HARI // 2)
        return t.year * 12 + t.month

    ev = [peristiwa(Lf[i], Ef[i], 0.35, 0.50, 0.05) for i in range(N)]
    print(f"kejadian tanam: {np.mean([len(e) for e in ev]):.2f} per titik selama {W} jendela")
    sawah = pd.read_csv(st.SAWAH).drop_duplicates("kabkota").set_index("kabkota").luas_sawah_ha
    jml = pd.Series(kab).value_counts()
    acc = {}
    for k, e_list in zip(kab, ev):
        for e in e_list:
            for dk, wk in zip((-1, 0, 1), KERNEL):
                key = (k, bulan_idx(e + LAG + dk))
                acc[key] = acc.get(key, 0.0) + wk
    est = pd.DataFrame([(k, t, c / jml[k] * sawah[k]) for (k, t), c in acc.items()], columns=["kabkota", "t", "est"])
    est["tahun"] = (est.t - 1) // 12
    est["bulan"] = (est.t - 1) % 12 + 1

    # ----- target BPS
    b = pd.read_csv(data_bps("data/bps/produksi_padi/kabkota/bulanan/bps_jatim_padi_kabkota_bulanan_luas_panen_2019_2024.csv"))
    b25 = pd.read_csv(data_bps("data/bps/produksi_padi/kabkota/bulanan/bps_jatim_padi_kabkota_bulanan_2025.csv"))
    y = pd.concat([b[["nama_repo", "tahun", "bulan", "luas_panen_ha"]], b25[["nama_repo", "tahun", "bulan", "luas_panen_ha"]]]).rename(
        columns={"nama_repo": "kabkota", "luas_panen_ha": "y"})
    kk = sorted(y.kabkota.unique())
    P = pd.MultiIndex.from_product([kk, range(2019, 2026), range(1, 13)], names=["kabkota", "tahun", "bulan"]).to_frame(index=False)
    P = P.merge(y, on=["kabkota", "tahun", "bulan"], how="left").merge(est[["kabkota", "tahun", "bulan", "est"]], on=["kabkota", "tahun", "bulan"], how="left")
    P["est"] = P.est.fillna(0.0)
    # awal deret: Jan-Mar 2019 bergantung pada tanam Okt-Des 2018 (Sentinel-2 belum penuh) -> tidak dipakai
    P.loc[(P.tahun == 2019) & (P.bulan <= 3), ["y", "est"]] = np.nan
    print(f"\ndata bulanan BPS: {P.y.notna().sum()} baris kab-bulan (2019-2025)")

    wide = {v: P.pivot(index=["kabkota", "bulan"], columns="tahun", values=v) for v in ("y", "est")}
    Y, ES = wide["y"], wide["est"]

    def latih(tr):
        """Parameter dari tahun latih tr: beta global, beta per kab (menyusut), klimatologi y per kab-bulan."""
        sy = Y[tr].sum(axis=1, min_count=1)
        se = ES[tr].sum(axis=1, min_count=1)
        mask = sy.notna() & se.notna()
        bg = sy[mask].sum() / se[mask].sum()
        tau = se[mask].groupby(level=0).sum().mean() / max(len(tr), 1)  # sekitar satu tahun est
        sk = sy[mask].groupby(level=0).sum()
        ek = se[mask].groupby(level=0).sum()
        bk = (sk + tau * bg) / (ek + tau)
        clim = Y[tr].mean(axis=1)
        return bg, bk, clim

    def prediksi(par, th):
        bg, bk, clim = par
        es = ES[th]
        kab_idx = es.index.get_level_values(0)
        sat_g = bg * es
        sat_k = es * bk.reindex(kab_idx).to_numpy()
        prev = Y[th - 1] if (th - 1) in Y.columns else clim
        prev = prev.fillna(clim)
        return pd.DataFrame({"sat_glob": sat_g.to_numpy(), "sat_kab": sat_k.to_numpy(), "klim": clim.to_numpy(), "musiman": prev.to_numpy()}, index=es.index)

    def bobot(tr):
        """Bobot non-negatif atas {sat_kab, klim, musiman}, dari prediksi leave-one-year-out di tahun latih."""
        rows = []
        for th in tr:
            if th == 2019:
                continue
            par = latih([x for x in tr if x != th])
            pr = prediksi(par, th)
            d = pr.assign(y=Y[th].to_numpy()).dropna()
            rows.append(d)
        if not rows:
            return np.array([0.5, 0.5, 0.0])
        d = pd.concat(rows)
        w, _ = nnls(d[["sat_kab", "klim", "musiman"]].to_numpy(), d.y.to_numpy())
        return w

    def skor(th, tr):
        par = latih(tr)
        pr = prediksi(par, th)
        w = bobot(tr)
        pr["gabungan"] = pr[["sat_kab", "klim", "musiman"]].to_numpy() @ w
        y = Y[th]
        ok = y.notna().to_numpy()
        res = {}
        js = (pr.index.get_level_values(1) <= 9)
        for m in ("musiman", "klim", "sat_glob", "sat_kab", "gabungan"):
            p = pr[m].to_numpy()
            a = y.to_numpy()
            res[m] = dict(bulanan=wape(a[ok], p[ok]), janSep=wape(pd.Series(a[ok & js], index=y.index[ok & js]).groupby(level=0).sum(),
                                                                      pd.Series(p[ok & js], index=y.index[ok & js]).groupby(level=0).sum()),
                          jatim=wape(pd.Series(a[ok], index=y.index[ok]).groupby(level=1).sum(), pd.Series(p[ok], index=y.index[ok]).groupby(level=1).sum()))
        return res, w, pr

    print("\n=== Uji bergulir: latih tahun < Y, uji tahun Y (WAPE luas panen, %) ===")
    print("kolom: bulanan per kab | Jan-Sep per kab | Jatim bulanan")
    modelo = ("musiman", "klim", "sat_glob", "sat_kab", "gabungan")
    tot = {m: [] for m in modelo}
    for th in range(2021, 2026):
        res, w, _ = skor(th, list(range(2019, th)))
        print(f"\nY={th} (latih {2019}-{th - 1}; bobot gabungan sat_kab/klim/musiman = {np.round(w, 2).tolist()})")
        for m in modelo:
            r = res[m]
            tot[m].append((r["bulanan"], r["janSep"], r["jatim"]))
            print(f"   {m:9s} {r['bulanan']:6.1f} | {r['janSep']:6.1f} | {r['jatim']:6.1f}")
    print("\nRata-rata 2021-2025:")
    for m in modelo:
        a = np.mean(tot[m], axis=0)
        print(f"   {m:9s} bulanan {a[0]:5.1f}% | Jan-Sep per kab {a[1]:5.1f}% | Jatim bulanan {a[2]:5.1f}%")

    # ----- uji akhir 2026 Jan-Sep (latih 2019-2025)
    tr = list(range(2019, 2026))
    par = latih(tr)
    w = bobot(tr)
    es26 = est[(est.tahun == 2026) & (est.bulan <= 9)].groupby("kabkota").est.sum()
    bg, bk, clim = par
    bps = sql("""select w.nama_repo kabkota, w.jenis, p.granularitas g, p.tahun, p.bulan_awal ba, p.bulan_akhir bk,
                        p.luas_panen_ha luas, p.produksi_beras_ton beras
                 from silver.produksi_padi p join ref.wilayah w on w.id=p.wilayah_id where w.level='KABKOTA'""")
    s26 = bps[(bps.g == "PERIODE") & (bps.tahun == 2026) & (bps.ba == 1) & (bps.bk == 9)].set_index("kabkota")
    s25 = bps[(bps.g == "PERIODE") & (bps.tahun == 2025) & (bps.ba == 1) & (bps.bk == 9)].set_index("kabkota")
    T = s26[["jenis", "luas", "beras"]].join(s25[["luas", "beras"]].add_suffix("_lalu"))
    T["prod25"] = T.beras_lalu / T.luas_lalu
    T["sat_glob"] = es26.reindex(T.index).fillna(0) * bg
    T["sat_kab"] = es26.reindex(T.index).fillna(0) * bk.reindex(T.index)
    T["klim"] = clim.groupby(level=0).apply(lambda s: s.loc[:, :].iloc[:9].sum()).reindex(T.index)
    T["musiman"] = T.luas_lalu
    T["gabungan"] = w[0] * T.sat_kab + w[1] * T.klim + w[2] * T.musiman
    kb, kt = T[T.jenis == "KABUPATEN"], T[T.jenis == "KOTA"]
    print("\n=== UJI AKHIR Jan-Sep 2026 (latih 2019-2025), per kab/kota ===")
    print(f"bobot gabungan sat_kab/klim/musiman = {np.round(w, 2).tolist()}")
    for m in modelo:
        pb = T[m] * T.prod25
        print(f"   {m:9s} luas panen WAPE {wape(T.luas, T[m]):5.1f}% | produksi WAPE {wape(T.beras, pb):5.1f}% (kab {wape(kb.beras, kb[m] * kb.prod25):5.1f}%, kota {wape(kt.beras, kt[m] * kt.prod25):5.1f}%, bias {(pb.sum() - T.beras.sum()) / T.beras.sum() * 100:+5.1f}%)")
    print("Pembanding sebelumnya (kalibrasi 1 tahun): aturan banjir + fusi v2 = 15,4%; baseline BPS 2025 = 4,5%")
    est.to_csv("data/satelit/est_luas_panen_kabkota_bulanan.csv", index=False)


if __name__ == "__main__":
    main()
