"""TERAWANG K1 · Aturan banjir optik Sentinel-2 (Xiao 2006, Dong 2016) untuk tanggal tanam, lalu luas panen bulanan.

Per titik: jendela banjir = LSWI + 0,05 >= EVI dan EVI <= 0,35. Dianggap tanam jika EVI mencapai >= 0,4 dalam 3-6 jendela
(36-72 hari) sesudahnya (verifikasi padi). Tanggal panen = jendela banjir + L jendela (L dipilih dari data latih 2025).
Dibandingkan dengan penanda SAR ("naik >= 4 dB" + 10 jendela) dan gabungan keduanya.

  python scripts/k1/aturan_banjir_s2.py
"""
import datetime as dt
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, "scripts/k1")
import siklus_tanam as st  # noqa: E402

S2 = "data/satelit/s2_titik_12harian_kabkota.csv.gz"
HARI = 12


def peristiwa_banjir(lswi, evi, jeda_min=6):
    """Indeks jendela awal banjir terverifikasi (EVI naik >= 0,4 dalam 3-6 jendela sesudahnya)."""
    n = len(lswi)
    out = []
    i = 0
    while i < n:
        if not (np.isnan(lswi[i]) or np.isnan(evi[i])) and lswi[i] + 0.05 >= evi[i] and evi[i] <= 0.35:
            ke = evi[i + 3:i + 7]
            if len(ke) and np.nanmax(np.where(np.isnan(ke), -1, ke)) >= 0.4:
                out.append(i)
                i += jeda_min
                continue
        i += 1
    return out


def main():
    s = pd.read_csv(S2)
    v = pd.read_csv(st.TITIK)
    n = v.shape[1] - 3
    tgl = [dt.date.fromisoformat(c) for c in v.columns[3:]]

    def bulan_idx(i):
        t = tgl[0] + dt.timedelta(days=HARI * i + HARI // 2)
        return t.year * 12 + t.month

    lswi = s[[c for c in s.columns if c.startswith("lswi_")]].to_numpy(float)
    evi = s[[c for c in s.columns if c.startswith("evi_")]].to_numpy(float)
    kab = s.kabkota.to_numpy()
    assert (v.kabkota.to_numpy() == kab).all() and lswi.shape[1] == n, "urutan titik S2 harus sama dengan VH"
    print(f"sel kosong S2: {np.isnan(evi).mean() * 100:.0f}%")

    ev_opt = [peristiwa_banjir(lswi[i], evi[i]) for i in range(len(s))]
    ip = np.mean([len([e for e in ev if bulan_idx(e) // 12 * 1 >= 0 and 2025 * 12 + 1 <= bulan_idx(e) <= 2025 * 12 + 12]) for ev in ev_opt])
    print(f"kejadian banjir terverifikasi per titik pada 2025: {ip:.2f} (indeks pertanaman Jatim BPS sekitar 1,4-1,6)")

    ev_sar = []
    for i in range(len(v)):
        x = st.bersihkan(v.iloc[i, 3:].to_numpy())
        ev_sar.append([c[1] for c in st.siklus(x, 3.0)] if x is not None else [])

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

    # peluang sebuah banjir terlihat: minimal 1 dari 2 jendela berturut-turut bebas awan; c = porsi titik jernih per kab dan jendela
    jernih = pd.DataFrame(~np.isnan(evi)).groupby(kab).mean()

    def bobot(k, e):
        c = float(np.nanmean(jernih.loc[k].to_numpy()[max(0, e - 1):e + 2]))
        return 1.0 / max(1 - (1 - c) ** 2, 0.25)

    def estimasi(events, lag, koreksi=False):
        rows = {}
        for k, evs in zip(kab, events):
            for e in evs:
                m = bulan_idx(e + lag)
                rows[(k, m)] = rows.get((k, m), 0) + (bobot(k, e) if koreksi else 1)
        jml = pd.Series(kab).value_counts()
        return pd.DataFrame([(k, m, c / jml[k] * sawah[k]) for (k, m), c in rows.items()], columns=["kabkota", "t", "est"])

    def metrik(est):
        dd = b25.merge(est, on=["kabkota", "t"], how="left").fillna({"est": 0})
        beta = dd.luas.sum() / dd.est.sum()
        dc = dd.copy()
        for c in ("luas", "est"):
            dc[c] = dc[c] - dc.groupby("kabkota")[c].transform("mean")
        j = dd.groupby("ba")[["luas", "est"]].sum()
        return beta, j.luas.corr(j.est), dc.luas.corr(dc.est)

    print("\nLatih 2025: aturan banjir optik, jeda L (jendela 12 hari)")
    hasil = {}
    for L in range(7, 13):
        est = estimasi(ev_opt, L)
        beta, rj, rk = metrik(est)
        hasil[("opt", L)] = (est, beta, rj, rk)
        print(f"  optik banjir+{L:2d} ({L * 12:3d} hari)  koef {beta:.2f}  r Jatim {rj:.2f}  r dalam kab {rk:.2f}")
    print("\nLatih 2025: optik + koreksi awan (bobot 1 / peluang terlihat)")
    for L in range(7, 13):
        est = estimasi(ev_opt, L, koreksi=True)
        beta, rj, rk = metrik(est)
        hasil[("optc", L)] = (est, beta, rj, rk)
        print(f"  optik+koreksi banjir+{L:2d} ({L * 12:3d} hari)  koef {beta:.2f}  r Jatim {rj:.2f}  r dalam kab {rk:.2f}")
    est_sar = estimasi(ev_sar, 10)
    beta_s, rj_s, rk_s = metrik(est_sar)
    print(f"  SAR naik+10 (pembanding)           koef {beta_s:.2f}  r Jatim {rj_s:.2f}  r dalam kab {rk_s:.2f}")

    L_best = max(range(7, 13), key=lambda L: hasil[("opt", L)][3])
    est_opt, beta_o, rj_o, rk_o = hasil[("opt", L_best)]
    Lc = max(range(7, 13), key=lambda L: hasil[("optc", L)][3])
    est_optc, beta_c, rj_c, rk_c = hasil[("optc", Lc)]
    print(f"\nJeda terpilih (korelasi dalam kab, data latih 2025): optik {L_best} jendela; optik+koreksi {Lc} jendela")

    # gabungan: rata-rata dua estimasi yang masing-masing sudah dikalibrasi
    g = est_opt.merge(est_sar, on=["kabkota", "t"], how="outer", suffixes=("_o", "_s")).fillna(0)
    g["est"] = (g.est_o * beta_o + g.est_s * beta_s) / 2
    beta_g, rj_g, rk_g = metrik(g[["kabkota", "t", "est"]].assign(est=lambda x: x.est))
    print(f"  gabungan optik+SAR (rata-rata)     r Jatim {rj_g:.2f}  r dalam kab {rk_g:.2f}")

    lo, hi = 2026 * 12 + 1, 2026 * 12 + 9
    print("\nUji Jan-Sep 2026 per kab/kota")
    for nama, est, beta in [("optik", est_opt, beta_o), ("opt+awan", est_optc, beta_c), ("SAR", est_sar, beta_s), ("gabungan", g[["kabkota", "t", "est"]], beta_g)]:
        e26 = est[(est.t >= lo) & (est.t <= hi)].groupby("kabkota").est.sum() * beta
        t = T.join(e26.rename("luas_sat")).fillna({"luas_sat": 0})
        t["beras_sat"] = t.luas_sat * t.prod25
        kb, kt = t[t.jenis == "KABUPATEN"], t[t.jenis == "KOTA"]
        jt = est.groupby("t").est.sum() * beta
        bl = range(1, 10)
        wj = st.wape([prov[2026 * 12 + m] for m in bl], [jt.get(2026 * 12 + m, 0) for m in bl])
        print(f"  {nama:9s} produksi WAPE semua {st.wape(t.beras, t.beras_sat):5.1f}% kab {st.wape(kb.beras, kb.beras_sat):5.1f}% kota {st.wape(kt.beras, kt.beras_sat):5.1f}% bias {(t.beras_sat.sum() - t.beras.sum()) / t.beras.sum() * 100:+5.1f}% | Jatim bulanan WAPE {wj:5.1f}% | r luas {t.luas.corr(t.luas_sat):.2f}")
    print(f"  baseline  produksi WAPE {st.wape(T.beras, T.beras_lalu):.1f}%; Jatim bulanan naif {st.wape([prov[2026 * 12 + m] for m in range(1, 10)], [prov[2025 * 12 + m] for m in range(1, 10)]):.1f}%")

    # nilai tambah di atas baseline: pola 2025 diubah rasio sinyal optik (Jan-Sep 2026 / Jan-Sep 2025)
    e = est_opt
    a26 = e[(e.t >= 2026 * 12 + 1) & (e.t <= 2026 * 12 + 9)].groupby("kabkota").est.sum()
    a25 = e[(e.t >= 2025 * 12 + 1) & (e.t <= 2025 * 12 + 9)].groupby("kabkota").est.sum()
    r_kab = (a26 / a25).reindex(T.index)
    r_jtm = a26.sum() / a25.sum()
    t = T.copy()
    t["b_kab"] = t.beras_lalu * r_kab.clip(0.5, 1.5).fillna(1)
    t["b_jtm"] = t.beras_lalu * r_jtm
    kb, kt = t[t.jenis == "KABUPATEN"], t[t.jenis == "KOTA"]
    print(f"\nBaseline x rasio sinyal optik (rasio Jatim {r_jtm:.3f}; rasio luas panen BPS sebenarnya {t.luas.sum() / t.luas_lalu.sum():.3f})")
    for nama, c in [("rasio per kab/kota (dibatasi 0,5-1,5)", "b_kab"), ("rasio Jatim", "b_jtm"), ("baseline polos", "beras_lalu")]:
        print(f"  {nama:38s} WAPE semua {st.wape(t.beras, t[c]):5.1f}%  kab {st.wape(kb.beras, kb[c]):5.1f}%  kota {st.wape(kt.beras, kt[c]):5.1f}%")

    jt = est_optc.groupby("t").est.sum() * beta_c
    print("\nJatim bulanan (ribu ha), optik+koreksi awan: bulan BPS26 citra26 | BPS25 citra25")
    for m in range(1, 10):
        print(f"  {m:2d}  {prov[2026 * 12 + m] / 1000:5.0f} {jt.get(2026 * 12 + m, 0) / 1000:6.0f} | {prov[2025 * 12 + m] / 1000:5.0f} {jt.get(2025 * 12 + m, 0) / 1000:6.0f}")


if __name__ == "__main__":
    main()
