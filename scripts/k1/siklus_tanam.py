"""TERAWANG K1 · Deteksi siklus tanam per titik sawah (ide: s1-rice-irrigation-tutorial, MIT) lalu luas panen per bulan.

Per titik: deret VH 12-harian -> bersihkan -> haluskan -> state machine:
  cari palung (genangan) -> VH naik >= A_NAIK dB dari palung = satu siklus (tanam) -> puncak (kanopi)
  -> VH turun >= A_TURUN dari puncak = akhir siklus -> cari palung lagi.
Tanggal panen ditaksir = tanggal "naik >= 4 dB" (konfirmasi tanam) + L jendela 12-harian. L dipilih memakai data latih 2025 saja.
(Penanda palung terlalu berisik; penanda "turun" tidak berkorelasi dengan panen BPS.)
Luas panen bulan m = (porsi titik yang panen di bulan m) x luas sawah kab/kota x koefisien (dilatih di 2025).

  python scripts/k1/siklus_tanam.py
"""
import datetime as dt
import io
import subprocess

import numpy as np
import pandas as pd

TITIK = "data/satelit/vh_titik_12harian_kabkota.csv.gz"
SAWAH = "data/satelit/vh_panen_bulanan_kabkota.csv"
A_NAIK = 4.0  # dB, sama dengan tutorial
HARI = 12


def sql(q):
    out = subprocess.run(["psql", "-d", "terawang", "--csv", "-c", q], capture_output=True, text=True, check=True).stdout
    return pd.read_csv(io.StringIO(out))


def wape(a, p):
    a, p = np.asarray(a, float), np.asarray(p, float)
    return np.abs(p - a).sum() / a.sum() * 100


def bersihkan(x):
    x = x.astype(float).copy()
    x[(x > -5) | (x < -35)] = np.nan  # band anomali ~0 dB (tutorial) atau tidak masuk akal
    idx = np.arange(len(x))
    ok = ~np.isnan(x)
    if ok.sum() < len(x) * 0.6:
        return None
    x = np.interp(idx, idx[ok], x[ok])
    med = pd.Series(x).rolling(3, center=True, min_periods=1).median()
    return med.rolling(3, center=True, min_periods=1).mean().to_numpy()


def siklus(x, a_turun):
    """State machine. Kembalikan daftar siklus: (idx palung, idx naik, idx puncak, idx turun atau None)."""
    out = []
    n = len(x)
    i = 0
    mn, mn_i = x[0], 0
    while i < n:
        v = x[i]
        if v < mn:
            mn, mn_i = v, i
        elif v - mn >= A_NAIK:  # naik >= 4 dB dari palung: siklus
            mx, mx_i, turun_i = v, i, None
            j = i + 1
            while j < n:
                if x[j] > mx:
                    mx, mx_i = x[j], j
                elif mx - x[j] >= a_turun:
                    turun_i = j
                    break
                j += 1
            out.append((mn_i, i, mx_i, turun_i))
            if turun_i is None:
                break
            i = turun_i
            mn, mn_i = x[i], i
        i += 1
    return out


def main():
    d = pd.read_csv(TITIK)
    tgl = [dt.date.fromisoformat(c) for c in d.columns[3:]]
    n_w = len(tgl)
    ms = np.array([t.year * 12 + t.month for t in tgl])  # bulan setiap jendela (awal jendela)

    def bulan_idx(i):  # indeks jendela (boleh melebihi) -> bulan absolut (tengah jendela)
        t = tgl[0] + dt.timedelta(days=HARI * i + HARI // 2)
        return t.year * 12 + t.month

    seri = {}
    for k, g in d.groupby("kabkota"):
        seri[k] = [bersihkan(r) for r in g.iloc[:, 3:].to_numpy()]
    sawah = pd.read_csv(SAWAH).drop_duplicates("kabkota").set_index("kabkota").luas_sawah_ha

    bps = sql("""select w.nama_repo kabkota, w.jenis, p.granularitas g, p.tahun, p.bulan_awal ba, p.bulan_akhir bk,
                        p.luas_panen_ha luas, p.produksi_beras_ton beras
                 from silver.produksi_padi p join ref.wilayah w on w.id=p.wilayah_id where w.level='KABKOTA'""")
    prov = sql("select p.tahun, p.bulan_awal bulan, p.luas_panen_ha luas from silver.produksi_padi p join ref.wilayah w on w.id=p.wilayah_id where w.level='PROVINSI' and p.granularitas='BULANAN'")
    prov["t"] = prov.tahun * 12 + prov.bulan
    prov = prov.set_index("t").luas
    b25 = bps[(bps.g == "BULANAN") & (bps.tahun == 2025)].copy()
    b25["t"] = b25.tahun * 12 + b25.ba
    s26 = bps[(bps.g == "PERIODE") & (bps.tahun == 2026) & (bps.ba == 1) & (bps.bk == 9)].set_index("kabkota")
    s25 = bps[(bps.g == "PERIODE") & (bps.tahun == 2025) & (bps.ba == 1) & (bps.bk == 9)].set_index("kabkota")
    T = s26[["jenis", "luas", "beras"]].join(s25[["luas", "beras"]].add_suffix("_lalu"))
    T["prod25"] = T.beras_lalu / T.luas_lalu

    # fraksi sawah ber-siklus (indikator kualitas): titik yang punya >= 1 siklus lengkap
    hasil = []
    for a_turun in (3.0, 4.0):
        sik = {k: [siklus(x, a_turun) if x is not None else [] for x in v] for k, v in seri.items()}
        pers = np.mean([len(s) > 0 for v in sik.values() for s in v])
        print(f"A_turun {a_turun:.0f} dB: titik dengan >=1 siklus {pers * 100:.0f}%; rata-rata siklus/titik {np.mean([len(s) for v in sik.values() for s in v]):.2f}")
        for nama, fn in {
            "naik+9 (108 hari)": lambda c: bulan_idx(c[1] + 9),
            "naik+10 (120 hari)": lambda c: bulan_idx(c[1] + 10),
            "naik+11 (132 hari)": lambda c: bulan_idx(c[1] + 11),
            "naik+12 (144 hari)": lambda c: bulan_idx(c[1] + 12),
            "puncak+3": lambda c: bulan_idx(c[2] + 3),
        }.items():
            # luas panen bulanan per kab: porsi titik x luas sawah
            rows = []
            for k, v in sik.items():
                cnt = {}
                for s in v:
                    for c in s:
                        m = fn(c)
                        if m is not None:
                            cnt[m] = cnt.get(m, 0) + 1
                for m, c in cnt.items():
                    rows.append((k, m, c / len(v) * sawah[k]))
            est = pd.DataFrame(rows, columns=["kabkota", "t", "est"])
            dd = b25.merge(est, on=["kabkota", "t"], how="left").fillna({"est": 0})
            beta = dd.luas.sum() / dd.est.sum()
            dc = dd.copy()
            for c in ("luas", "est"):
                dc[c] = dc[c] - dc.groupby("kabkota")[c].transform("mean")
            j = dd.groupby("ba")[["luas", "est"]].sum()
            hasil.append(dict(a_turun=a_turun, cara=nama, beta=beta, r_j=j.luas.corr(j.est), r_k=dc.luas.corr(dc.est),
                              w_bln=wape(dd.luas, dd.est * beta), est=est))
    print("\nLatih 2025 (bulanan per kab/kota, n=456): koef, korelasi Jatim, korelasi dalam kab, WAPE bulanan")
    for h in hasil:
        print(f"  A_turun {h['a_turun']:.0f} | {h['cara']:20s} | koef {h['beta']:.2f} | r Jatim {h['r_j']:.2f} | r dalam kab {h['r_k']:.2f} | WAPE {h['w_bln']:.0f}%")

    best = max(hasil, key=lambda h: h["r_k"])  # dipilih hanya dari data latih 2025
    print(f"\nTerpilih (korelasi dalam kab 2025): A_turun {best['a_turun']:.0f} dB, {best['cara']}")
    est, beta = best["est"], best["beta"]
    lo, hi = 2026 * 12 + 1, 2026 * 12 + 9
    e26 = est[(est.t >= lo) & (est.t <= hi)].groupby("kabkota").est.sum()
    t = T.join((e26 * beta).rename("luas_sat"))
    t["luas_sat"] = t.luas_sat.fillna(0)
    t["beras_sat"] = t.luas_sat * t.prod25
    kab, kota = t[t.jenis == "KABUPATEN"], t[t.jenis == "KOTA"]
    print("\nUji Jan-Sep 2026 (per kab/kota)")
    for nm, a, p in [("luas panen", "luas", "luas_sat"), ("produksi beras", "beras", "beras_sat")]:
        print(f"  {nm:16s} citra: semua {wape(t[a], t[p]):5.1f}%  kab {wape(kab[a], kab[p]):5.1f}%  kota {wape(kota[a], kota[p]):5.1f}%  bias {(t[p].sum() - t[a].sum()) / t[a].sum() * 100:+5.1f}%")
    print(f"  baseline (periode sama 2025): produksi {wape(t.beras, t.beras_lalu):.1f}%, luas {wape(t.luas, t.luas_lalu):.1f}%;  korelasi luas BPS vs citra {t.luas.corr(t.luas_sat):.3f}")

    jt = est.groupby("t").est.sum() * beta
    print("\nJatim bulanan (ribu ha): BPS vs citra")
    print("  bulan   BPS26  citra26 | BPS25  citra25")
    for m in range(1, 10):
        a, b_ = prov.get(2026 * 12 + m, np.nan), jt.get(2026 * 12 + m, 0)
        a5, b5 = prov.get(2025 * 12 + m, np.nan), jt.get(2025 * 12 + m, 0)
        print(f"  {m:5d}  {a / 1000:6.0f} {b_ / 1000:8.0f} | {a5 / 1000:6.0f} {b5 / 1000:8.0f}")
    bl = [m for m in range(1, 10)]
    print(f"  WAPE Jatim bulanan Jan-Sep 2026: citra {wape([prov[2026 * 12 + m] for m in bl], [jt.get(2026 * 12 + m, 0) for m in bl]):.1f}%; naif (bulan sama 2025) {wape([prov[2026 * 12 + m] for m in bl], [prov[2025 * 12 + m] for m in bl]):.1f}%")


if __name__ == "__main__":
    main()
