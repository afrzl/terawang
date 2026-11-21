"""TERAWANG K1 · Kalibrasi sinyal VH Sentinel-1 ke luas panen BPS, dengan jeda tanam-panen.

Temuan: luas piksel yang VH-nya turun (genangan / olah tanah / tanam) memimpin luas panen BPS tepat 3 bulan
(korelasi Jatim bulanan 0,95; jeda 0 justru berkorelasi negatif). Jadi sinyal ini indikator dini panen 3 bulan ke depan.

Latih : luas panen BPS bulanan 2025 per kab/kota ~ koefisien x sinyal(bulan - 3)
Uji   : Jan-Sep 2026 (BPS sementara per kab/kota): luas panen dari sinyal Okt 2025 - Jun 2026, lalu x produktivitas 2025
Ambang turun dipilih hanya dari data latih 2025. Pembanding: baseline BPS (periode sama tahun lalu).

  python scripts/k1/kalibrasi_vh.py
"""
import io
import subprocess

import numpy as np
import pandas as pd

CSV = "data/satelit/vh_panen_bulanan_kabkota.csv"
JEDA = 3


def sql(q):
    out = subprocess.run(["psql", "-d", "terawang", "--csv", "-c", q], capture_output=True, text=True, check=True).stdout
    return pd.read_csv(io.StringIO(out))


def wape(a, p):
    a, p = np.asarray(a, float), np.asarray(p, float)
    return np.abs(p - a).sum() / a.sum() * 100


def lapor(nama, d, a, p):
    kab, kota = d[d.jenis == "KABUPATEN"], d[d.jenis == "KOTA"]
    print(f"  {nama:38s} semua {wape(d[a], d[p]):5.1f}%  kab {wape(kab[a], kab[p]):5.1f}%  kota {wape(kota[a], kota[p]):5.1f}%  bias {(d[p].sum() - d[a].sum()) / d[a].sum() * 100:+5.1f}%")


def main():
    v = pd.read_csv(CSV)
    v["t"] = v.tahun * 12 + v.bulan
    bps = sql("""select w.nama_repo kabkota, w.jenis, p.granularitas g, p.tahun, p.bulan_awal ba, p.bulan_akhir bk,
                        p.luas_panen_ha luas, p.produksi_beras_ton beras
                 from silver.produksi_padi p join ref.wilayah w on w.id=p.wilayah_id where w.level='KABKOTA'""")
    b25 = bps[(bps.g == "BULANAN") & (bps.tahun == 2025)].copy()
    b25["t"] = b25.tahun * 12 + b25.ba
    s26 = bps[(bps.g == "PERIODE") & (bps.tahun == 2026) & (bps.ba == 1) & (bps.bk == 9)].set_index("kabkota")
    s25 = bps[(bps.g == "PERIODE") & (bps.tahun == 2025) & (bps.ba == 1) & (bps.bk == 9)].set_index("kabkota")
    t = s26[["jenis", "luas", "beras"]].join(s25[["luas", "beras"]].add_suffix("_lalu"))
    t["prod25"] = t.beras_lalu / t.luas_lalu

    hasil = {}
    for amb in (2, 3, 4):
        c = f"luas_turun{amb}_ha"
        # sinyal bulan m-JEDA dipasangkan dengan bulan panen m
        s = v[["kabkota", "t", c]].assign(t=v.t + JEDA)
        d = b25.merge(s, on=["kabkota", "t"]).dropna(subset=[c])
        beta = d.luas.sum() / d[c].sum()
        j = d.groupby("ba")[["luas", c]].sum()
        dc = d.copy()
        for k in ("luas", c):
            dc[k] = dc[k] - dc.groupby("kabkota")[k].transform("mean")
        r_j, r_k = j.luas.corr(j[c]), dc.luas.corr(dc[c])
        w_bln = wape(d.luas, d[c] * beta)
        # uji: panen Jan-Sep 2026 = sinyal bulan Okt 2025 .. Jun 2026
        lo, hi = 2025 * 12 + 10, 2026 * 12 + 6
        sin = v[(v.t >= lo) & (v.t <= hi)].groupby("kabkota")[c].sum()
        tt = t.join(sin.rename("sin"))
        tt["luas_sat"] = tt["sin"] * beta
        tt["beras_sat"] = tt.luas_sat * tt.prod25
        # gabungan: baseline x perubahan sinyal (periode yang sama tahun lalu: Okt 2024 tidak ada -> pakai Des 2024..Jun 2025 untuk Mar-Sep 2025)
        hasil[amb] = dict(beta=beta, r_j=r_j, r_k=r_k, w_bln=w_bln, tt=tt, n=len(d))
        print(f"Ambang {amb} dB | latih 2025 (n={len(d)}): koef {beta:.3f}; korelasi Jatim {r_j:.2f}, dalam kab {r_k:.2f}; WAPE luas bulanan per kab {w_bln:.0f}%")

    pilih = max(hasil, key=lambda a: hasil[a]["r_k"])
    print(f"\nAmbang terpilih (korelasi dalam kab pada 2025): {pilih} dB")
    for amb, h in hasil.items():
        tt = h["tt"]
        print(f"\nUji Jan-Sep 2026, ambang {amb} dB{' <- terpilih' if amb == pilih else ''}")
        lapor("luas panen dari citra (jeda 3 bln)", tt, "luas", "luas_sat")
        lapor("produksi beras dari citra", tt, "beras", "beras_sat")
        print(f"  korelasi luas BPS vs citra {tt.luas.corr(tt.luas_sat):.3f}; rasio total citra/BPS {tt.luas_sat.sum() / tt.luas.sum():.3f}")
    tt = hasil[pilih]["tt"].assign(beras_A=lambda x: x.beras_lalu, luas_A=lambda x: x.luas_lalu)
    print("\nPembanding baseline (periode sama 2025)")
    lapor("produksi beras", tt, "beras", "beras_A")
    lapor("luas panen", tt, "luas", "luas_A")


if __name__ == "__main__":
    main()
