"""TERAWANG · Uraikan dan validasi luas panen padi bulanan per kab/kota BPS Jatim 2019-2024.

Sumber: tabel dinamis BPS Jatim "Rice Harvest Area by Regency/Municipality (Hectare)" (Survei KSA), dibaca lewat browser,
disimpan apa adanya di data/bps/produksi_padi/kabkota/bulanan/mentah/luas_panen_<tahun>.txt (13 angka tiap baris:
12 bulan + total tahunan; "-" = nol; 2019-2021 dibulatkan ke ha, 2022-2024 dua desimal).

Validasi: (1) jumlah 12 bulan = total tahunan tiap baris, (2) jumlah 38 wilayah = baris East Java untuk tiap bulan dan total.
Hasil: bps_jatim_padi_kabkota_bulanan_luas_panen_2019_2024.csv

  python scripts/bps/parse_luas_panen_bulanan.py
"""
import csv
import pathlib

D = pathlib.Path("data/bps/produksi_padi/kabkota/bulanan")
TAHUN = range(2019, 2025)


def angka(s):
    return 0.0 if s == "-" else float(s.replace(",", ""))


def baca(th):
    rows = {}
    for ln in (D / "mentah" / f"luas_panen_{th}.txt").read_text().splitlines():
        t = ln.split()
        nama = " ".join(t[:-13])
        rows[nama] = [angka(x) for x in t[-13:]]
    return rows


def main():
    ref = {}
    for r in csv.DictReader(open(D / "bps_jatim_padi_kabkota_bulanan_2025.csv")):
        ref[r["wilayah"]] = (r["jenis"], r["nama_repo"])
    out, masalah = [], []
    for th in TAHUN:
        rows = baca(th)
        tol = 0.06 if th >= 2022 else 6.5  # 2019-2021 dibulatkan ke ha per bulan
        jatim = rows.pop("East Java")
        assert set(rows) == set(ref), f"{th}: nama wilayah tidak cocok: {set(rows) ^ set(ref)}"
        for nama, v in rows.items():
            sel = sum(v[:12]) - v[12]
            if abs(sel) > tol:
                masalah.append((th, nama, "jumlah 12 bulan vs tahunan", round(sel, 2)))
        for m in range(13):
            sel = sum(v[m] for v in rows.values()) - jatim[m]
            if abs(sel) > (tol * 3 if th >= 2022 else 40):
                masalah.append((th, "East Java", f"jumlah 38 wilayah vs baris provinsi, kolom {m + 1 if m < 12 else 'tahunan'}", round(sel, 2)))
        for nama, v in rows.items():
            for m in range(12):
                out.append([nama, ref[nama][0], ref[nama][1], th, m + 1, v[m], ""])
        print(f"{th}: 38 wilayah x 12 bulan; total Jatim {jatim[12]:,.2f} ha; jumlah 38 wilayah {sum(v[12] for v in rows.values()):,.2f}")
    print(f"\nPeriksa: {len(masalah)} ketidakcocokan di atas toleransi")
    for x in masalah:
        print("  ", x)
    p = D / "bps_jatim_padi_kabkota_bulanan_luas_panen_2019_2024.csv"
    with open(p, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["wilayah", "jenis", "nama_repo", "tahun", "bulan", "luas_panen_ha", "koreksi"])
        w.writerows(out)
    print(f"\ntersimpan: {p} ({len(out)} baris)")


if __name__ == "__main__":
    main()
