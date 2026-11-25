"""TERAWANG K1 · Uji aturan fisika VH "zero ground-truth" persis seperti diusulkan (ambang dB dan hari tetap).

Aturan per titik (deret VH 12-harian):
  t0     minimum lokal dengan VH < -20 dB
  valid  dalam 45-75 hari sesudah t0 (jendela +4..+6): VH puncak > -15 dB dan puncak - VH(t0) >= 5 dB
  panen  Cara A: turun >= 3 dB dari puncak pada 95-130 hari sesudah t0 (jendela +8..+11)
         Cara B: t0 + 110 hari (jendela +9)
Kalibrasi koefisien dan pengujian sama dengan skrip lain (latih 2025 bulanan, uji Jan-Sep 2026).

  python scripts/k1/aturan_fisika_vh.py
"""
import datetime as dt
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, "scripts/k1")
import siklus_tanam as st  # noqa: E402

HARI = 12


def siapkan(x, halus):
    x = x.astype(float).copy()
    x[(x > -5) | (x < -35)] = np.nan
    ok = ~np.isnan(x)
    if ok.sum() < len(x) * 0.6:
        return None
    x = np.interp(np.arange(len(x)), np.arange(len(x))[ok], x[ok])
    return pd.Series(x).rolling(3, center=True, min_periods=1).median().to_numpy() if halus else x


def aturan(x):
    """Kembalikan daftar (t0, indeks puncak, indeks panen cara A atau None)."""
    n = len(x)
    out, i = [], 2
    while i < n - 6:
        lokal_min = x[i] <= x[max(0, i - 2):i + 3].min()
        if lokal_min and x[i] < -20:
            w = x[i + 4:i + 7]
            if len(w) and w.max() > -15 and w.max() - x[i] >= 5:
                pk = i + 4 + int(np.argmax(w))
                a = None
                for j in range(i + 8, min(i + 12, n)):
                    if x[pk:j + 1].max() - x[j] >= 3:
                        a = j
                        break
                out.append((i, pk, a))
                i += 8
                continue
        i += 1
    return out


def main():
    v = pd.read_csv(st.TITIK)
    tgl = [dt.date.fromisoformat(c) for c in v.columns[3:]]
    kab = v.kabkota.to_numpy()

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

    def est_dari(events):  # events: per titik daftar indeks jendela panen
        rows = {}
        for k, evs in zip(kab, events):
            for e in evs:
                m = bulan_idx(e)
                rows[(k, m)] = rows.get((k, m), 0) + 1
        return pd.DataFrame([(k, m, c / jml[k] * sawah[k]) for (k, m), c in rows.items()], columns=["kabkota", "t", "est"])

    def metrik(est):
        dd = b25.merge(est, on=["kabkota", "t"], how="left").fillna({"est": 0})
        beta = dd.luas.sum() / dd.est.sum() if dd.est.sum() > 0 else np.nan
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
        return (f"WAPE produksi semua {st.wape(t.beras, t.b):5.1f}% kab {st.wape(kb.beras, kb.b):5.1f}% kota {st.wape(kt.beras, kt.b):5.1f}% "
                f"bias {(t.b.sum() - t.beras.sum()) / t.beras.sum() * 100:+5.1f}% | Jatim bulanan WAPE {wj:5.1f}%")

    for halus in (True, False):
        seri = [siapkan(r, halus) for r in v.iloc[:, 3:].to_numpy()]
        ev = [aturan(x) if x is not None else [] for x in seri]
        n_t0 = np.mean([len(e) > 0 for e in ev])
        print(f"\n=== {'dengan' if halus else 'tanpa'} penghalusan median-3 ===")
        print(f"titik dengan >= 1 siklus lolos aturan: {n_t0 * 100:.0f}%; siklus per titik: {np.mean([len(e) for e in ev]):.2f} (IP Jatim ~1,4-1,6)")
        for nama, f in [("Cara A (turun >= 3 dB)", lambda e: [c[2] for c in e if c[2] is not None]),
                        ("Cara B (t0 + 110 hari)", lambda e: [c[0] + 9 for c in e])]:
            est = est_dari([f(e) for e in ev])
            if est.empty:
                print(f"  {nama}: tidak ada kejadian")
                continue
            beta, rj, rk = metrik(est)
            print(f"  {nama:24s} latih 2025: r Jatim {rj:5.2f}, r dalam kab {rk:5.2f}, koef {beta:.2f}")
            print(f"  {'':24s} uji 2026: {uji(est, beta)}")
    print(f"\nPembanding: baseline BPS produksi WAPE {st.wape(T.beras, T.beras_lalu):.1f}%; aturan banjir optik 14,0%; SAR naik+10 30,9%")


if __name__ == "__main__":
    main()
