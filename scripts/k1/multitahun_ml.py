"""TERAWANG K1 · Pengganti pembobot sederhana: model kecil pada fitur citra + klimatologi + musiman (uji bergulir yang sama).

Fitur per (kab, tahun, bulan), semuanya dinormalisasi dengan rata-rata bulanan kab itu di tahun latih:
  est (taksiran citra), est bulan sebelum/sesudah, jumlah 3 bulan, klimatologi bulan itu, bulan yang sama tahun lalu, bulan (sin/cos).
Model: gradient boosting dangkal dan ridge. Latih tahun < Y, uji Y (2021-2025), lalu uji akhir 2026 Jan-Sep.

  python scripts/k1/multitahun.py        # prasyarat (menulis data/satelit/est_luas_panen_kabkota_bulanan.csv)
  python scripts/k1/multitahun_ml.py
"""
import io
import subprocess
import sys

import numpy as np
import pandas as pd
from scipy.optimize import nnls
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import Ridge

sys.path.insert(0, "scripts/k1")
import siklus_tanam as st  # noqa: E402


def wape(a, p):
    a, p = np.asarray(a, float), np.asarray(p, float)
    return np.abs(p - a).sum() / a.sum() * 100


def sql(q):
    return pd.read_csv(io.StringIO(subprocess.run(["psql", "-d", "terawang", "--csv", "-c", q], capture_output=True, text=True, check=True).stdout))


def main():
    est = pd.read_csv("data/satelit/est_luas_panen_kabkota_bulanan.csv")
    b = pd.read_csv("data/bps/produksi_padi/kabkota/bulanan/bps_jatim_padi_kabkota_bulanan_luas_panen_2019_2024.csv")
    b25 = pd.read_csv("data/bps/produksi_padi/kabkota/bulanan/bps_jatim_padi_kabkota_bulanan_2025.csv")
    y = pd.concat([b[["nama_repo", "tahun", "bulan", "luas_panen_ha"]], b25[["nama_repo", "tahun", "bulan", "luas_panen_ha"]]]).rename(
        columns={"nama_repo": "kabkota", "luas_panen_ha": "y"})
    kk = sorted(y.kabkota.unique())
    P = pd.MultiIndex.from_product([kk, range(2019, 2027), range(1, 13)], names=["kabkota", "tahun", "bulan"]).to_frame(index=False)
    P["t"] = P.tahun * 12 + P.bulan
    P = P.merge(y, on=["kabkota", "tahun", "bulan"], how="left").merge(est[["kabkota", "t", "est"]], on=["kabkota", "t"], how="left")
    P["est"] = P.est.fillna(0.0)
    P = P.sort_values(["kabkota", "t"]).reset_index(drop=True)
    g = P.groupby("kabkota")
    P["est_m1"] = g.est.shift(1)
    P["est_p1"] = g.est.shift(-1)
    P["est_3"] = P[["est", "est_m1", "est_p1"]].sum(axis=1, min_count=1)
    P["prev"] = g.y.shift(12)
    P.loc[(P.tahun == 2019) & (P.bulan <= 3), ["y", "est"]] = np.nan  # awal deret citra belum lengkap
    P["sin"], P["cos"] = np.sin(2 * np.pi * P.bulan / 12), np.cos(2 * np.pi * P.bulan / 12)

    def siapkan(tr, th):
        d = P[P.tahun.isin(tr + [th])].copy()
        trd = d[d.tahun.isin(tr)]
        sc = trd.groupby("kabkota").y.mean().rename("sc")
        clim = trd.groupby(["kabkota", "bulan"]).y.mean().rename("klim")
        d = d.join(sc, on="kabkota").join(clim, on=["kabkota", "bulan"])
        d["prev"] = d.prev.fillna(d.klim)
        for c in ("est", "est_m1", "est_p1", "est_3", "klim", "prev"):
            d[c + "_n"] = d[c] / d.sc
        d["y_n"] = d.y / d.sc
        return d

    FIT = ["est_n", "est_m1_n", "est_p1_n", "est_3_n", "klim_n", "prev_n", "sin", "cos"]

    def evaluasi_tahun(th, tr):
        d = siapkan(tr, th)
        trd = d[d.tahun.isin(tr)].dropna(subset=["y_n", "est_n"])
        te = d[d.tahun == th]
        out = {}
        gb = HistGradientBoostingRegressor(max_depth=3, max_iter=250, learning_rate=0.04, min_samples_leaf=25, l2_regularization=1.0, random_state=3)
        gb.fit(trd[FIT].fillna(0), trd.y_n)
        out["gboost"] = gb.predict(te[FIT].fillna(0)) * te.sc.to_numpy()
        rg = Ridge(alpha=3.0).fit(trd[FIT].fillna(0), trd.y_n)
        out["ridge"] = np.clip(rg.predict(te[FIT].fillna(0)), 0, None) * te.sc.to_numpy()
        w, _ = nnls(trd[["est_n", "klim_n", "prev_n"]].fillna(0).to_numpy(), trd.y_n.to_numpy())
        out["nnls"] = (te[["est_n", "klim_n", "prev_n"]].fillna(0).to_numpy() @ w) * te.sc.to_numpy()
        out["klim"] = te.klim.to_numpy()
        out["musiman"] = te.prev.to_numpy()
        return te, out

    print("=== Uji bergulir (WAPE luas panen %): bulanan per kab | Jan-Sep per kab | Jatim bulanan ===")
    modelo = ["musiman", "klim", "nnls", "ridge", "gboost"]
    tot = {m: [] for m in modelo}
    for th in range(2021, 2026):
        te, out = evaluasi_tahun(th, list(range(2019, th)))
        ok = te.y.notna().to_numpy()
        js = (te.bulan <= 9).to_numpy()
        print(f"\nY={th}")
        for m in modelo:
            p = out[m]
            a = te.y.to_numpy()
            r = (wape(a[ok], p[ok]),
                 wape(pd.Series(a[ok & js]).groupby(te.kabkota.to_numpy()[ok & js]).sum(), pd.Series(p[ok & js]).groupby(te.kabkota.to_numpy()[ok & js]).sum()),
                 wape(pd.Series(a[ok]).groupby(te.bulan.to_numpy()[ok]).sum(), pd.Series(p[ok]).groupby(te.bulan.to_numpy()[ok]).sum()))
            tot[m].append(r)
            print(f"   {m:8s} {r[0]:6.1f} | {r[1]:6.1f} | {r[2]:6.1f}")
    print("\nRata-rata 2021-2025")
    for m in modelo:
        a = np.mean(tot[m], axis=0)
        print(f"   {m:8s} bulanan {a[0]:5.1f}% | Jan-Sep per kab {a[1]:5.1f}% | Jatim bulanan {a[2]:5.1f}% | terburuk bulanan {max(x[0] for x in tot[m]):5.1f}%")

    # uji akhir 2026 Jan-Sep
    tr = list(range(2019, 2026))
    d = siapkan(tr, 2026)
    trd = d[d.tahun.isin(tr)].dropna(subset=["y_n", "est_n"])
    te = d[(d.tahun == 2026) & (d.bulan <= 9)]
    gb = HistGradientBoostingRegressor(max_depth=3, max_iter=250, learning_rate=0.04, min_samples_leaf=25, l2_regularization=1.0, random_state=3).fit(trd[FIT].fillna(0), trd.y_n)
    rg = Ridge(alpha=3.0).fit(trd[FIT].fillna(0), trd.y_n)
    w, _ = nnls(trd[["est_n", "klim_n", "prev_n"]].fillna(0).to_numpy(), trd.y_n.to_numpy())
    te = te.assign(gboost=gb.predict(te[FIT].fillna(0)) * te.sc, ridge=np.clip(rg.predict(te[FIT].fillna(0)), 0, None) * te.sc,
                   nnls=(te[["est_n", "klim_n", "prev_n"]].fillna(0).to_numpy() @ w) * te.sc)
    agg = te.groupby("kabkota")[["gboost", "ridge", "nnls", "klim"]].sum()
    bps = sql("""select w.nama_repo kabkota, w.jenis, p.granularitas g, p.tahun, p.bulan_awal ba, p.bulan_akhir bk, p.luas_panen_ha luas, p.produksi_beras_ton beras
                 from silver.produksi_padi p join ref.wilayah w on w.id=p.wilayah_id where w.level='KABKOTA'""")
    s26 = bps[(bps.g == "PERIODE") & (bps.tahun == 2026) & (bps.ba == 1) & (bps.bk == 9)].set_index("kabkota")
    s25 = bps[(bps.g == "PERIODE") & (bps.tahun == 2025) & (bps.ba == 1) & (bps.bk == 9)].set_index("kabkota")
    T = s26[["jenis", "luas", "beras"]].join(s25[["luas", "beras"]].add_suffix("_lalu")).join(agg)
    T["prod25"] = T.beras_lalu / T.luas_lalu
    T["musiman"] = T.luas_lalu
    kb, kt = T[T.jenis == "KABUPATEN"], T[T.jenis == "KOTA"]
    print("\n=== UJI AKHIR Jan-Sep 2026 (latih 2019-2025) ===")
    for m in ("musiman", "klim", "nnls", "ridge", "gboost"):
        pb = T[m] * T.prod25
        print(f"   {m:8s} luas panen WAPE {wape(T.luas, T[m]):5.1f}% | produksi WAPE {wape(T.beras, pb):5.1f}% (kab {wape(kb.beras, kb[m] * kb.prod25):5.1f}%, kota {wape(kt.beras, kt[m] * kt.prod25):5.1f}%, bias {(pb.sum() - T.beras.sum()) / T.beras.sum() * 100:+5.1f}%)")


if __name__ == "__main__":
    main()
