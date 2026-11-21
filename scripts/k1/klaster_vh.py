"""TERAWANG K1 · Klaster profil VH ala Rudiyanto dkk. (2019), tanpa label lapangan.

1. Titik sawah dikelompokkan dengan K-means berdasarkan bentuk deret VH 12-harian (seluruh Jatim sekaligus).
2. Kurva RATA-RATA tiap klaster dibaca dengan state machine (naik >= A_NAIK dB dari palung = satu siklus tanam).
   Rata-rata puluhan titik jauh lebih bersih dari kurva per piksel.
3. Semua anggota klaster mewarisi tanggal siklus klasternya; panen = tanggal naik + L jendela.
4. Koefisien dan jeda dipilih memakai data latih 2025 saja; uji Jan-Sep 2026.

  python scripts/k1/klaster_vh.py
"""
import datetime as dt
import sys

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans

sys.path.insert(0, "scripts/k1")
import siklus_tanam as st  # noqa: E402

HARI = 12


def siklus_a(x, a_naik, a_turun=3.0):
    """State machine seperti siklus_tanam.siklus, tetapi ambang naik bisa diatur. Kembalikan indeks 'naik'."""
    out, n = [], len(x)
    mn, i = x[0], 0
    while i < n:
        if x[i] < mn:
            mn = x[i]
        elif x[i] - mn >= a_naik:
            out.append(i)
            mx, j, turun = x[i], i + 1, None
            while j < n:
                if x[j] > mx:
                    mx = x[j]
                elif mx - x[j] >= a_turun:
                    turun = j
                    break
                j += 1
            if turun is None:
                break
            i, mn = turun, x[turun]
        i += 1
    return out


def main():
    v = pd.read_csv(st.TITIK)
    tgl = [dt.date.fromisoformat(c) for c in v.columns[3:]]
    kab = v.kabkota.to_numpy()
    seri = [st.bersihkan(r) for r in v.iloc[:, 3:].to_numpy()]
    ok = np.array([s is not None for s in seri])
    X = np.vstack([s for s in seri if s is not None])
    idx_ok = np.where(ok)[0]
    print(f"titik dipakai: {ok.sum()} dari {len(ok)}")

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

    def est_dari(events_per_point, lag):
        rows = {}
        for i, evs in events_per_point.items():
            for e in evs:
                m = bulan_idx(e + lag)
                rows[(kab[i], m)] = rows.get((kab[i], m), 0) + 1
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
    for k in (20, 40, 80):
        km = KMeans(n_clusters=k, n_init=4, random_state=7).fit(X)
        lab = km.labels_
        for a_naik in (2.0, 3.0, 4.0):
            ev_klaster = {c: siklus_a(km.cluster_centers_[c], a_naik) for c in range(k)}
            n_ev = np.mean([len(ev_klaster[l]) for l in lab])
            ev_titik = {int(i): ev_klaster[lab[j]] for j, i in enumerate(idx_ok)}
            for L in (7, 8, 9, 10, 11):
                est = est_dari(ev_titik, L)
                if est.empty:
                    continue
                beta, rj, rk = metrik(est)
                hasil.append(dict(k=k, a=a_naik, L=L, rj=rj, rk=rk, beta=beta, est=est, n_ev=n_ev))
    print("\nLatih 2025 (10 kombinasi terbaik menurut korelasi dalam kabupaten)")
    top = sorted(hasil, key=lambda h: -(h["rk"] if h["rk"] == h["rk"] else -9))[:10]
    for h in top:
        print(f"  k={h['k']:3d} naik>={h['a']:.0f} dB jeda {h['L']:2d} jend ({h['L'] * 12:3d} hr) | siklus/titik {h['n_ev']:.2f} | r Jatim {h['rj']:.2f} r dalam kab {h['rk']:.2f} koef {h['beta']:.2f}")
    best = top[0]
    w, wk, wt, bias, wj = uji(best["est"], best["beta"])
    print(f"\nTerpilih (hanya data latih 2025): k={best['k']}, naik>={best['a']:.0f} dB, jeda {best['L']}")
    print(f"Uji Jan-Sep 2026: WAPE produksi semua {w:.1f}% kab {wk:.1f}% kota {wt:.1f}% bias {bias:+.1f}% | Jatim bulanan WAPE {wj:.1f}%")
    print("Pembanding: baseline BPS 4,5% (Jatim bulanan naif 13,1%); aturan banjir optik 14,0% (28,4%); SAR naik+10 30,9% (36,7%)")
    print("\nSemua kombinasi: WAPE uji 2026 (untuk melihat kepekaan, bukan untuk memilih)")
    for h in sorted(hasil, key=lambda h: -(h["rk"] if h["rk"] == h["rk"] else -9))[:6]:
        w2 = uji(h["est"], h["beta"])
        print(f"  k={h['k']:3d} naik>={h['a']:.0f} L={h['L']:2d}: r dalam kab {h['rk']:.2f} -> WAPE uji {w2[0]:.1f}%")


if __name__ == "__main__":
    main()
