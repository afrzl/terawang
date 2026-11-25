"""TERAWANG K1 · Baseline produksi beras per kab/kota dari data BPS saja (tanpa citra).

Membaca silver.produksi_padi lalu menghitung galat tiga pembanding:
  A  sama dengan periode yang sama tahun lalu (naif musiman)
  B  A dikalikan rasio provinsi (batas atas untuk "luas dari citra": rasio diketahui setelahnya)
  C  luas panen tahun ini sebenarnya x produktivitas tahun lalu (batas atas untuk "luas panen dari citra")
Metrik: WAPE = sum|galat| / sum aktual (terbobot, tidak dibesar-besarkan kota kecil). Dipisah kabupaten dan kota.

  python scripts/k1/baseline_bps.py
"""
import io
import subprocess

import numpy as np
import pandas as pd

DB = "terawang"


def sql(q: str) -> pd.DataFrame:
    out = subprocess.run(["psql", "-d", DB, "--csv", "-c", q], capture_output=True, text=True, check=True).stdout
    return pd.read_csv(io.StringIO(out))


def wape(a, p):
    a, p = np.asarray(a, float), np.asarray(p, float)
    return np.abs(p - a).sum() / a.sum() * 100


def bias(a, p):
    return (np.sum(p) - np.sum(a)) / np.sum(a) * 100


def laporan(nama, d, aktual, pred):
    print(f"\n{nama}")
    for grup, g in [("Semua", d), ("Kabupaten", d[d.jenis == "KABUPATEN"]), ("Kota", d[d.jenis == "KOTA"])]:
        if len(g) == 0:
            continue
        ape = (np.abs(g[pred] - g[aktual]) / g[aktual] * 100)
        print(f"  {grup:10s} n={len(g):2d}  WAPE {wape(g[aktual], g[pred]):5.1f}%  bias {bias(g[aktual], g[pred]):+6.1f}%  MAPE median {ape.median():5.1f}%")


def main():
    p = sql("""select w.id wid, w.kode, w.nama, w.jenis, p.granularitas g, p.tahun, p.bulan_awal ba, p.bulan_akhir bk, p.status_angka st,
                      p.luas_panen_ha luas, p.produksi_beras_ton beras
               from silver.produksi_padi p join ref.wilayah w on w.id=p.wilayah_id where w.level='KABKOTA'""")

    def ambil(g, th, ba, bk):
        d = p[(p.g == g) & (p.tahun == th) & (p.ba == ba) & (p.bk == bk)].set_index("wid")
        return d[["nama", "jenis", "luas", "beras"]]

    print("=== Baseline BPS (tanpa citra) ===")

    # 1. tahunan: 2025 dari 2024
    t24, t25 = ambil("TAHUNAN", 2024, 1, 12), ambil("TAHUNAN", 2025, 1, 12)
    d = t25.join(t24[["luas", "beras"]].add_suffix("_lalu"))
    d["A"] = d.beras_lalu
    d["C"] = d.luas * (d.beras_lalu / d.luas_lalu)
    laporan("Tahunan 2025 (prediksi dari 2024)", d, "beras", "A")
    laporan("  C: luas panen 2025 sebenarnya x produktivitas 2024", d, "beras", "C")

    # 2. Jan-Sep 2026 (sementara) dari Jan-Sep 2025 (tetap)
    s25, s26 = ambil("PERIODE", 2025, 1, 9), ambil("PERIODE", 2026, 1, 9)
    d = s26.join(s25[["luas", "beras"]].add_suffix("_lalu"))
    d["A"] = d.beras_lalu
    d["B"] = d.beras_lalu * (d.beras.sum() / d.beras_lalu.sum())
    d["C"] = d.luas * (d.beras_lalu / d.luas_lalu)
    laporan("Jan-Sep 2026 (prediksi dari Jan-Sep 2025)", d, "beras", "A")
    laporan("  B: A x rasio provinsi (oracle)", d, "beras", "B")
    laporan("  C: luas panen 2026 sebenarnya x produktivitas 2025 (oracle luas)", d, "beras", "C")
    print(f"  luas panen: rasio 2026/2025 = {d.luas.sum() / d.luas_lalu.sum():.3f}; produktivitas beras/ha 2025 = {d.beras_lalu.sum() / d.luas_lalu.sum():.2f}, 2026 = {d.beras.sum() / d.luas.sum():.2f}")

    # produktivitas per kab: seberapa stabil antar tahun
    d["prod25"] = d.beras_lalu / d.luas_lalu
    d["prod26"] = d.beras / d.luas
    print(f"  produktivitas per kab/kota 2025 -> 2026: korelasi {d.prod25.corr(d.prod26):.2f}, selisih relatif median {((d.prod26 - d.prod25).abs() / d.prod25).median() * 100:.1f}%")

    # 3. korelasi luas panen vs produksi (apakah produksi praktis = luas x konstanta)
    b = p[(p.g == "BULANAN") & (p.tahun == 2025)].dropna(subset=["luas", "beras"])
    b = b.assign(pr=b.beras / b.luas)
    print(f"\nBulanan 2025 per kab/kota (n={len(b)}): produktivitas beras/ha median {b.pr.median():.2f}, P10 {b.pr.quantile(.1):.2f}, P90 {b.pr.quantile(.9):.2f}")
    print(f"  korelasi luas vs produksi: {b.luas.corr(b.beras):.3f}")
    bm = b.groupby("ba").apply(lambda x: x.beras.sum() / x.luas.sum(), include_groups=False)
    print("  produktivitas Jatim per bulan (beras ton/ha): " + " ".join(f"{k}:{v:.2f}" for k, v in bm.items()))


if __name__ == "__main__":
    main()
