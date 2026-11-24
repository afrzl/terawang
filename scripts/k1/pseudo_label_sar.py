"""TERAWANG K1 · Pseudo-label lintas modalitas (gaya FARM): optik mengajari radar mengenali tanam.

Guru : aturan banjir (verifikasi EVI) pada deret optik terisi fusi v2 -> label "ada tanam di jendela w" (tanpa label lapangan).
Murid: gradient boosting yang hanya melihat RADAR (VH, VV, VV-VH pada w-4..w+4, selisih, musim). Dilatih pada jendela <= 2025.
Keluaran: peluang tanam per titik per jendela -> panen = w + 8 jendela -> luas panen bulanan (koefisien dari BPS 2025) -> uji Jan-Sep 2026.

  python scripts/k1/fusi_v2_s1_s2.py <fusi_v2.npz>   # prasyarat
  python scripts/k1/pseudo_label_sar.py <fusi_v2.npz>
"""
import datetime as dt
import sys

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import average_precision_score, roc_auc_score

sys.path.insert(0, "scripts/k1")
import siklus_tanam as st  # noqa: E402
from tuning_banjir_s2 import peristiwa  # noqa: E402

HARI = 12
LAG = 8
K = 4  # radar w-K .. w+K


def geser(a, k):
    """b[:, w] = a[:, w+k] (NaN di luar rentang)."""
    b = np.full_like(a, np.nan)
    if k > 0:
        b[:, :-k] = a[:, k:]
    elif k < 0:
        b[:, -k:] = a[:, :k]
    else:
        b[:] = a
    return b


def fitur_radar(vh, vv, doy):
    N, W = vh.shape
    cols = []
    for k in range(-K, K + 1):
        cols.append(geser(vh, k))
    if vv is not None:
        for k in range(-K, K + 1):
            cols.append(geser(vv, k))
    for k in range(-K, K + 1):
        if k:
            cols.append(geser(vh, k) - vh)
    if vv is not None:
        cols.append(vv - vh)
    stack = np.stack([geser(vh, k) for k in range(-K, K + 1)], axis=2)
    cols += [np.nanmin(stack, axis=2), np.nanmax(stack, axis=2)]
    d = np.broadcast_to(doy[None, :], (N, W))
    cols += [np.sin(2 * np.pi * d / 365.0), np.cos(2 * np.pi * d / 365.0)]
    return np.stack([c.reshape(-1) for c in cols], axis=1)


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
    SEED = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    if len(sys.argv) > 3 and sys.argv[3] == 'vh':
        vv = None  # varian VH saja
    doy = np.array([(t + dt.timedelta(days=HARI // 2)).timetuple().tm_yday for t in tgl], float)

    # label guru: banjir terverifikasi pada deret optik terisi fusi
    y = np.zeros((N, W), dtype=np.int8)
    for i in range(N):
        for e in peristiwa(Lf[i], Ef[i], 0.35, 0.50, 0.05):
            y[i, e] = 1
    valid_w = np.arange(W) < W - 7  # jendela dekat ujung tidak bisa diverifikasi
    cut = max(i for i, t in enumerate(tgl) if t <= dt.date(2025, 12, 31))
    win = np.tile(np.arange(W), N)
    X = fitur_radar(vh, vv, doy)
    yy = y.reshape(-1)
    ok = valid_w[win]
    tr = ok & (win <= cut - 6)
    te = ok & (win > cut)
    print(f"label guru: {yy[ok].mean() * 100:.1f}% jendela = tanam ({y.sum() / N:.2f} kejadian/titik); latih {tr.sum():,}, uji {te.sum():,}")

    rng = np.random.default_rng(SEED)
    pos = np.where(tr & (yy == 1))[0]
    neg = np.where(tr & (yy == 0))[0]
    sel = np.concatenate([pos, rng.choice(neg, size=min(len(neg), 450_000), replace=False)])
    clf = HistGradientBoostingClassifier(max_iter=250, learning_rate=0.08, random_state=SEED, class_weight=None)
    clf.fit(X[sel], yy[sel])
    p = clf.predict_proba(X)[:, 1]
    # koreksi bobot subsampel negatif agar peluang kira-kira terkalibrasi
    f = len(neg) / max(1, min(len(neg), 450_000))
    p = p / (p + (1 - p) * f)
    print(f"\nMurid (radar saja) meniru guru pada jendela 2026: AUC {roc_auc_score(yy[te], p[te]):.3f}, average precision {average_precision_score(yy[te], p[te]):.3f} (acak = {yy[te].mean():.3f})")

    def bulan_idx(i):
        t = tgl[0] + dt.timedelta(days=HARI * i + HARI // 2)
        return t.year * 12 + t.month

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

    def estimasi(skor, lag):
        d = pd.DataFrame({"kab": np.repeat(kab, W), "w": win, "p": skor})
        d = d[ok]
        d["t"] = d.w.map(lambda w: bulan_idx(int(w) + lag))
        g = d.groupby(["kab", "t"]).p.sum().reset_index()
        g["est"] = g.p / g.kab.map(jml) * g.kab.map(sawah)
        return g.rename(columns={"kab": "kabkota"})[["kabkota", "t", "est"]]

    def metrik(est):
        dd = b25.merge(est, on=["kabkota", "t"], how="left").fillna({"est": 0})
        beta = dd.luas.sum() / dd.est.sum()
        dc = dd.copy()
        for c in ("luas", "est"):
            dc[c] = dc[c] - dc.groupby("kabkota")[c].transform("mean")
        j = dd.groupby("ba")[["luas", "est"]].sum()
        return beta, j.luas.corr(j.est), dc.luas.corr(dc.est)

    def uji(est, beta):
        lo, hi = 2026 * 12 + 1, 2026 * 12 + 9
        e26 = est[(est.t >= lo) & (est.t <= hi)].groupby("kabkota").est.sum() * beta
        t = T.join(e26.rename("l")).fillna({"l": 0})
        t["b"] = t.l * t.prod25
        kb, kt = t[t.jenis == "KABUPATEN"], t[t.jenis == "KOTA"]
        jt = est.groupby("t").est.sum() * beta
        wj = st.wape([prov[2026 * 12 + m] for m in range(1, 10)], [jt.get(2026 * 12 + m, 0) for m in range(1, 10)])
        return st.wape(t.beras, t.b), st.wape(kb.beras, kb.b), st.wape(kt.beras, kt.b), (t.b.sum() - t.beras.sum()) / t.beras.sum() * 100, wj, jt

    print("\nLatih 2025 (luas panen BPS bulanan) dan uji Jan-Sep 2026, jeda tanam-panen L jendela")
    hasil = {}
    for L in (7, 8, 9):
        est = estimasi(p, L)
        beta, rj, rk = metrik(est)
        hasil[L] = (est, beta, rj, rk)
        print(f"  radar-murid L={L}: latih r Jatim {rj:.2f}, dalam kab {rk:.2f}")
    Lb = max(hasil, key=lambda L: hasil[L][3])
    est, beta, rj, rk = hasil[Lb]
    w = uji(est, beta)
    print(f"\nTerpilih dari latih: L={Lb}. UJI 2026: WAPE produksi {w[0]:.1f}% (kab {w[1]:.1f}%, kota {w[2]:.1f}%, bias {w[3]:+.1f}%, Jatim bulanan {w[4]:.1f}%)")
    print("Pembanding: aturan banjir + fusi v2 (optik, guru) 15,4% ; SAR 'naik' + jeda 30,9% ; baseline BPS 4,5%")
    print("\nJatim bulanan (ribu ha) bulan BPS26 radar-murid | BPS25 radar-murid")
    jt = w[5]
    for m in range(1, 10):
        print(f"  {m:2d}  {prov[2026 * 12 + m] / 1000:5.0f} {jt.get(2026 * 12 + m, 0) / 1000:7.0f} | {prov[2025 * 12 + m] / 1000:5.0f} {jt.get(2025 * 12 + m, 0) / 1000:7.0f}")


if __name__ == "__main__":
    main()
