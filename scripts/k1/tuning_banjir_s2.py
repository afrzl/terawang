"""TERAWANG K1 · Penyetelan ambang aturan banjir optik Sentinel-2, dipilih hanya dari data latih 2025, diuji sekali di Jan-Sep 2026.

Parameter yang disetel: batas EVI saat banjir (EVI_MAX), EVI minimum verifikasi padi (EVI_VER), selisih LSWI (DELTA), jeda panen L.

  python scripts/k1/tuning_banjir_s2.py
"""
import datetime as dt
import itertools
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, "scripts/k1")
import siklus_tanam as st  # noqa: E402

HARI = 12


def peristiwa(lswi, evi, evi_max, evi_ver, delta, jeda_min=6):
    n = len(lswi)
    out, i = [], 0
    while i < n:
        if not (np.isnan(lswi[i]) or np.isnan(evi[i])) and lswi[i] + delta >= evi[i] and evi[i] <= evi_max:
            ke = evi[i + 3:i + 7]
            if len(ke) and np.nanmax(np.where(np.isnan(ke), -1, ke)) >= evi_ver:
                out.append(i)
                i += jeda_min
                continue
        i += 1
    return out


def main():
    s = pd.read_csv("data/satelit/s2_titik_12harian_kabkota.csv.gz")
    v = pd.read_csv(st.TITIK)
    tgl = [dt.date.fromisoformat(c) for c in v.columns[3:]]
    lswi = s[[c for c in s.columns if c.startswith("lswi_")]].to_numpy(float)
    evi = s[[c for c in s.columns if c.startswith("evi_")]].to_numpy(float)
    kab = s.kabkota.to_numpy()

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
    for evi_max, evi_ver, delta in itertools.product((0.30, 0.35, 0.45), (0.30, 0.40, 0.50), (0.0, 0.05, 0.10)):
        ev = [peristiwa(lswi[i], evi[i], evi_max, evi_ver, delta) for i in range(len(s))]
        for L in (7, 8, 9):
            est = est_dari(ev, L)
            if est.empty:
                continue
            beta, rj, rk = metrik(est)
            hasil.append(dict(evi_max=evi_max, evi_ver=evi_ver, delta=delta, L=L, rj=rj, rk=rk, beta=beta, est=est,
                              ip=np.mean([len(e) for e in ev])))
    top = sorted(hasil, key=lambda h: -(h["rk"] if h["rk"] == h["rk"] else -9))
    print("Latih 2025: 8 kombinasi terbaik menurut korelasi dalam kabupaten")
    for h in top[:8]:
        print(f"  EVI<= {h['evi_max']:.2f}  verifikasi EVI>= {h['evi_ver']:.2f}  LSWI+{h['delta']:.2f}  jeda {h['L']} | siklus/titik {h['ip']:.2f} | r Jatim {h['rj']:.2f} r dalam kab {h['rk']:.2f} koef {h['beta']:.2f}")
    b = top[0]
    w = uji(b["est"], b["beta"])
    print(f"\nTerpilih dari data latih 2025 saja. Uji Jan-Sep 2026: WAPE produksi semua {w[0]:.1f}% kab {w[1]:.1f}% kota {w[2]:.1f}% bias {w[3]:+.1f}% | Jatim bulanan {w[4]:.1f}%")
    print("Pembanding: aturan awal (EVI<=0,35, verifikasi 0,40, LSWI+0,05, jeda 8) = 14,0%; baseline BPS 4,5%")
    print("\nKepekaan: WAPE uji 2026 untuk 6 kombinasi terbaik latih")
    for h in top[:6]:
        w2 = uji(h["est"], h["beta"])
        print(f"  EVI<= {h['evi_max']:.2f} ver {h['evi_ver']:.2f} +{h['delta']:.2f} L{h['L']}: r dalam kab {h['rk']:.2f} -> WAPE uji {w2[0]:.1f}% (kota {w2[2]:.1f}%)")


if __name__ == "__main__":
    main()
