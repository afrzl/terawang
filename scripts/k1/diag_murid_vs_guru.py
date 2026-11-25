"""TERAWANG K1 · Diagnosis: mengapa murid radar bisa setara/lebih baik dari gurunya (optik + fusi)?

Hipotesis: bukan murid lebih akurat per titik, melainkan murid menghitung dengan PELUANG (halus), sedangkan guru dengan hitungan 0/1 (kasar).
Uji: (1) murid peluang, (2) murid keras (ambang peluang), (3) guru keras, (4) guru dihaluskan (kernel waktu) tanpa murid.

  python scripts/k1/diag_murid_vs_guru.py <fusi_v2.npz>
"""
import datetime as dt
import sys

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier

sys.path.insert(0, "scripts/k1")
import siklus_tanam as st  # noqa: E402
from pseudo_label_sar import fitur_radar  # noqa: E402
from tuning_banjir_s2 import peristiwa  # noqa: E402

HARI = 12


def main():
    npz = sys.argv[1]
    v = pd.read_csv(st.TITIK)
    vvd = pd.read_csv("data/satelit/vv_titik_12harian_kabkota.csv.gz")
    s = pd.read_csv("data/satelit/s2_titik_12harian_kabkota.csv.gz")
    kab = s.kabkota.to_numpy()
    tgl = [dt.date.fromisoformat(c) for c in v.columns[3:]]
    W, N = len(tgl), len(s)
    z = np.load(npz)
    Ef, Lf = z["evi"], z["lswi"]

    def seri(df):
        return np.vstack([x if (x := st.bersihkan(r)) is not None else np.full(W, np.nan) for r in df.iloc[:, 3:].to_numpy()])

    vh, vv = seri(v), seri(vvd)
    doy = np.array([(t + dt.timedelta(days=HARI // 2)).timetuple().tm_yday for t in tgl], float)
    y = np.zeros((N, W), dtype=np.int8)
    for i in range(N):
        for e in peristiwa(Lf[i], Ef[i], 0.35, 0.50, 0.05):
            y[i, e] = 1
    win = np.tile(np.arange(W), N)
    valid_w = np.arange(W) < W - 7
    ok = valid_w[win]
    cut = max(i for i, t in enumerate(tgl) if t <= dt.date(2025, 12, 31))
    tr = ok & (win <= cut - 6)
    X = fitur_radar(vh, vv, doy)
    yy = y.reshape(-1)
    rng = np.random.default_rng(5)
    pos = np.where(tr & (yy == 1))[0]
    neg = np.where(tr & (yy == 0))[0]
    sel = np.concatenate([pos, rng.choice(neg, size=min(len(neg), 450_000), replace=False)])
    clf = HistGradientBoostingClassifier(max_iter=250, learning_rate=0.08, random_state=5).fit(X[sel], yy[sel])
    p = clf.predict_proba(X)[:, 1]
    f = len(neg) / min(len(neg), 450_000)
    p = p / (p + (1 - p) * f)
    P = p.reshape(N, W)

    # peluang -> hitungan keras: ambang yang menyamakan jumlah kejadian dengan guru pada periode latih
    trm = (np.arange(W) <= cut - 6)[None, :] & valid_w[None, :]
    target = y[:, :][:, trm[0]].sum()
    tau = np.quantile(P[:, trm[0]].reshape(-1), 1 - target / P[:, trm[0]].size)
    hard = (P >= tau).astype(float)
    print(f"jumlah kejadian periode latih: guru {int(target)}; murid keras (ambang {tau:.2f}) {int(hard[:, trm[0]].sum())}; murid peluang (jumlah) {P[:, trm[0]].sum():.0f}")

    def blur(a, w):
        out = np.zeros_like(a, dtype=float)
        for k, wk in zip((-1, 0, 1), w):
            sh = np.roll(a.astype(float), k, axis=1)
            if k > 0:
                sh[:, :k] = 0
            elif k < 0:
                sh[:, k:] = 0
            out += wk * sh
        return out

    sawah = pd.read_csv(st.SAWAH).drop_duplicates("kabkota").set_index("kabkota").luas_sawah_ha
    bps = st.sql("""select w.nama_repo kabkota, w.jenis, p.granularitas g, p.tahun, p.bulan_awal ba, p.bulan_akhir bk,
                           p.luas_panen_ha luas, p.produksi_beras_ton beras
                    from silver.produksi_padi p join ref.wilayah w on w.id=p.wilayah_id where w.level='KABKOTA'""")
    prov = st.sql("select p.tahun*12+p.bulan_awal t, p.luas_panen_ha luas from silver.produksi_padi p join ref.wilayah w on w.id=p.wilayah_id where w.level='PROVINSI' and p.granularitas='BULANAN'").set_index("t").luas
    b25 = bps[(bps.g == "BULANAN") & (bps.tahun == 2025)].copy()
    b25["t"] = b25.tahun * 12 + b25.ba
    s26 = bps[(bps.g == "PERIODE") & (bps.tahun == 2026) & (bps.ba == 1) & (bps.bk == 9)].set_index("kabkota")
    s25 = bps[(bps.g == "PERIODE") & (bps.tahun == 2025) & (bps.ba == 1) & (bps.bk == 9)].set_index("kabkota")
    T = s26[["jenis", "luas", "beras"]].join(s25[["luas", "beras"]].add_suffix("_lalu"))
    T["prod25"] = T.beras_lalu / T.luas_lalu
    jml = pd.Series(kab).value_counts()

    def bulan_idx(i):
        t = tgl[0] + dt.timedelta(days=HARI * i + HARI // 2)
        return t.year * 12 + t.month

    def estimasi(skor, lag):
        d = pd.DataFrame({"kab": np.repeat(kab, W), "w": win, "p": skor.reshape(-1)})[ok]
        d["t"] = d.w.map(lambda w: bulan_idx(int(w) + lag))
        g = d.groupby(["kab", "t"]).p.sum().reset_index()
        g["est"] = g.p / g.kab.map(jml) * g.kab.map(sawah)
        return g.rename(columns={"kab": "kabkota"})[["kabkota", "t", "est"]]

    def evaluasi(skor):
        best = None
        for L in (7, 8, 9):
            est = estimasi(skor, L)
            dd = b25.merge(est, on=["kabkota", "t"], how="left").fillna({"est": 0})
            beta = dd.luas.sum() / dd.est.sum()
            dc = dd.copy()
            for c in ("luas", "est"):
                dc[c] = dc[c] - dc.groupby("kabkota")[c].transform("mean")
            rk = dc.luas.corr(dc.est)
            if best is None or rk > best[0]:
                best = (rk, L, est, beta)
        rk, L, est, beta = best
        lo, hi = 2026 * 12 + 1, 2026 * 12 + 9
        e26 = est[(est.t >= lo) & (est.t <= hi)].groupby("kabkota").est.sum() * beta
        t = T.join(e26.rename("l")).fillna({"l": 0})
        t["b"] = t.l * t.prod25
        kb, kt = t[t.jenis == "KABUPATEN"], t[t.jenis == "KOTA"]
        jt = est.groupby("t").est.sum() * beta
        wj = st.wape([prov[2026 * 12 + m] for m in range(1, 10)], [jt.get(2026 * 12 + m, 0) for m in range(1, 10)])
        return rk, L, st.wape(t.beras, t.b), st.wape(kb.beras, kb.b), st.wape(kt.beras, kt.b), wj

    print("\nPenaksir | latih r dalam kab | L | uji 2026: WAPE semua, kab, kota | Jatim bulanan WAPE")
    for nama, skor in [("guru keras (0/1)", y.astype(float)),
                       ("guru dihaluskan [1/3,1/3,1/3]", blur(y, (1 / 3, 1 / 3, 1 / 3))),
                       ("guru dihaluskan [.25,.5,.25]", blur(y, (0.25, 0.5, 0.25))),
                       ("murid keras (0/1)", hard),
                       ("murid peluang", P),
                       ("murid peluang dihaluskan [.25,.5,.25]", blur(P, (0.25, 0.5, 0.25)))]:
        rk, L, w, wk, wt, wj = evaluasi(skor)
        print(f"  {nama:38s} r {rk:.2f} | L={L} | {w:5.1f}% {wk:5.1f}% {wt:5.1f}% | {wj:5.1f}%")


if __name__ == "__main__":
    main()
