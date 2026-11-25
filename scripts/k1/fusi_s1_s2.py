"""TERAWANG K1 · Fusi Sentinel-1 + Sentinel-2: SAR mengisi jendela optik yang berawan.

1. Model (gradient boosting) belajar memprediksi EVI dan LSWI sebuah titik dari deret VH di sekitar jendela itu (+-2 jendela,
   perubahan, min/maks, musim). Dilatih hanya pada jendela BEBAS AWAN sampai akhir 2025.
2. Deret fusi = nilai optik asli bila jernih, prediksi model bila berawan.
3. Aturan banjir yang sama (peristiwa_banjir) dijalankan pada deret fusi; panen = banjir + L jendela.
4. Dibandingkan dengan optik saja dan baseline BPS. Pemilihan parameter hanya dari data latih 2025; uji Jan-Sep 2026.

  python scripts/k1/fusi_s1_s2.py
"""
import datetime as dt
import sys

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import r2_score

sys.path.insert(0, "scripts/k1")
import siklus_tanam as st  # noqa: E402
from tuning_banjir_s2 import peristiwa  # noqa: E402

HARI = 12


def fitur(vh, doy):
    """vh: (N, W) VH terinterpolasi. Kembalikan matriks (N*W, F) dengan baris urut titik lalu jendela."""
    N, W = vh.shape
    pad = np.pad(vh, ((0, 0), (2, 2)), constant_values=np.nan)
    k = [pad[:, j:j + W] for j in range(5)]  # i-2 .. i+2
    stack = np.stack(k, axis=2)  # N, W, 5
    f = [stack[:, :, j] for j in range(5)]
    f.append(k[3] - k[1])  # VH(i+1) - VH(i-1)
    f.append(np.nanmin(stack, axis=2))
    f.append(np.nanmax(stack, axis=2))
    f.append(np.nanmax(stack, axis=2) - np.nanmin(stack, axis=2))
    d = np.broadcast_to(doy[None, :], (N, W))
    f.append(np.sin(2 * np.pi * d / 365.0))
    f.append(np.cos(2 * np.pi * d / 365.0))
    return np.stack([a.reshape(-1) for a in f], axis=1)


def main():
    v = pd.read_csv(st.TITIK)
    s = pd.read_csv("data/satelit/s2_titik_12harian_kabkota.csv.gz")
    tgl = [dt.date.fromisoformat(c) for c in v.columns[3:]]
    kab = s.kabkota.to_numpy()
    assert (v.kabkota.to_numpy() == kab).all()
    W = len(tgl)
    lswi = s[[c for c in s.columns if c.startswith("lswi_")]].to_numpy(float)
    evi = s[[c for c in s.columns if c.startswith("evi_")]].to_numpy(float)
    vh = np.vstack([x if (x := st.bersihkan(r)) is not None else np.full(W, np.nan) for r in v.iloc[:, 3:].to_numpy()])
    doy = np.array([(t + dt.timedelta(days=HARI // 2)).timetuple().tm_yday for t in tgl], float)
    X = fitur(vh, doy)
    ye, yl = evi.reshape(-1), lswi.reshape(-1)
    clear = ~np.isnan(ye) & ~np.isnan(yl)
    cut = max(i for i, t in enumerate(tgl) if t <= dt.date(2025, 12, 31))
    win = np.tile(np.arange(W), len(s))
    tr = clear & (win <= cut)
    te = clear & (win > cut)
    print(f"baris: {len(ye):,}; bebas awan {clear.mean() * 100:.0f}%; latih {tr.sum():,} (<=2025), uji {te.sum():,} (2026)")

    # subsampel latih agar cepat
    rng = np.random.default_rng(7)
    idx = np.where(tr)[0]
    idx = rng.choice(idx, size=min(400_000, len(idx)), replace=False)
    m_e = HistGradientBoostingRegressor(max_iter=250, learning_rate=0.08, random_state=7).fit(X[idx], ye[idx])
    m_l = HistGradientBoostingRegressor(max_iter=250, learning_rate=0.08, random_state=7).fit(X[idx], yl[idx])
    pe, pl = m_e.predict(X), m_l.predict(X)
    print("\nKualitas penebakan optik dari SAR, pada jendela jernih 2026 (belum pernah dilihat model)")
    print(f"  EVI : R2 {r2_score(ye[te], pe[te]):.2f}, MAE {np.mean(np.abs(ye[te] - pe[te])):.3f}")
    print(f"  LSWI: R2 {r2_score(yl[te], pl[te]):.2f}, MAE {np.mean(np.abs(yl[te] - pl[te])):.3f}")
    fl_a = (yl[te] + 0.05 >= ye[te]) & (ye[te] <= 0.35)
    fl_p = (pl[te] + 0.05 >= pe[te]) & (pe[te] <= 0.35)
    print(f"  kelas 'banjir' (aturan): akurasi {np.mean(fl_a == fl_p) * 100:.0f}%, presisi {np.mean(fl_a[fl_p]) * 100:.0f}%, recall {np.mean(fl_p[fl_a]) * 100:.0f}% (porsi banjir asli {fl_a.mean() * 100:.0f}%)")

    # deret fusi
    evi_f = np.where(np.isnan(ye), pe, ye).reshape(evi.shape)
    lswi_f = np.where(np.isnan(yl), pl, yl).reshape(lswi.shape)
    if len(sys.argv) > 1:  # deret terisi dari fusi_v2_s1_s2.py
        z = np.load(sys.argv[1])
        evi_f, lswi_f = z["evi"], z["lswi"]
        print(f"memakai deret terisi dari {sys.argv[1]}")
    print(f"  sel berawan yang diisi: {np.isnan(evi).mean() * 100:.0f}%")

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

    def est_dari(events, lag):
        rows = {}
        for k, evs in zip(kab, events):
            for e in evs:
                m = bulan_idx(e + lag)
                rows[(k, m)] = rows.get((k, m), 0) + 1
        return pd.DataFrame([(k, m, c / jml[k] * sawah[k]) for (k, m), c in rows.items()], columns=["kabkota", "t", "est"])

    def metrik(est):
        dd = b25.merge(est, on=["kabkota", "t"], how="left").fillna({"est": 0})
        if dd.est.sum() == 0:
            return np.nan, np.nan, np.nan
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
        return st.wape(t.beras, t.b), st.wape(kb.beras, kb.b), st.wape(kt.beras, kt.b), (t.b.sum() - t.beras.sum()) / t.beras.sum() * 100, wj

    hasil = []
    for nama, L_, E_ in [("optik saja", lswi, evi), ("fusi S1+S2", lswi_f, evi_f)]:
        for evi_ver, delta in [(0.40, 0.05), (0.50, 0.05), (0.40, 0.10), (0.50, 0.10)]:
            ev = [peristiwa(L_[i], E_[i], 0.35, evi_ver, delta) for i in range(len(s))]
            ip25 = np.mean([sum(1 for e in x if 2025 * 12 + 1 <= bulan_idx(e) <= 2025 * 12 + 12) for x in ev])
            for L in (7, 8, 9):
                est = est_dari(ev, L)
                if est.empty:
                    continue
                beta, rj, rk = metrik(est)
                hasil.append(dict(nama=nama, ver=evi_ver, delta=delta, L=L, rj=rj, rk=rk, beta=beta, est=est, ip=ip25))
    print("\nLatih 2025: tiga kombinasi terbaik per sumber (menurut korelasi dalam kabupaten)")
    for nama in ("optik saja", "fusi S1+S2"):
        top = sorted([h for h in hasil if h["nama"] == nama], key=lambda h: -(h["rk"] if h["rk"] == h["rk"] else -9))
        for h in top[:3]:
            print(f"  {nama:11s} verifikasi EVI>={h['ver']:.2f} LSWI+{h['delta']:.2f} jeda {h['L']} | siklus/titik 2025 {h['ip']:.2f} | r Jatim {h['rj']:.2f} r dalam kab {h['rk']:.2f}")
        b = top[0]
        w = uji(b["est"], b["beta"])
        print(f"    -> terpilih dari latih; uji Jan-Sep 2026: WAPE produksi {w[0]:.1f}% (kab {w[1]:.1f}%, kota {w[2]:.1f}%), bias {w[3]:+.1f}%, Jatim bulanan {w[4]:.1f}%")
        if nama == "fusi S1+S2":
            jt = b["est"].groupby("t").est.sum() * b["beta"]
            print("    Jatim bulanan (ribu ha) bulan BPS26 fusi26 | BPS25 fusi25")
            for m in range(1, 10):
                print(f"      {m:2d}  {prov[2026 * 12 + m] / 1000:5.0f} {jt.get(2026 * 12 + m, 0) / 1000:6.0f} | {prov[2025 * 12 + m] / 1000:5.0f} {jt.get(2025 * 12 + m, 0) / 1000:6.0f}")
    print(f"\nPembanding: baseline BPS {st.wape(T.beras, T.beras_lalu):.1f}%")


if __name__ == "__main__":
    main()
