"""TERAWANG · Proksi stok beras Bulog per kantor cabang Jatim, 2026.

Bulog tidak menerbitkan stok per kantor cabang. Yang ada:
  - pengadaan 2025 per cabang (BPS, Jawa Timur Dalam Angka 2026, Tabel 10.1.6; ASLI);
  - pernyataan pimpinan cabang di media (data/bulog/stok_beras/kantor_cabang/berita/..._berita_2026.csv, kolom dipakai = ya).

Cara: cabang yang punya angka berita memakai angka itu apa adanya (BERITA). Total Jatim ditaksir dengan rasio
    S = jumlah stok berita / jumlah porsi pengadaan 2025 cabang-cabang tersebut,
lalu cabang lain = porsi pengadaan 2025 x S (TAKSIRAN). Asumsinya: stok cabang sebanding dengan pengadaannya tahun lalu.
Pernyataan total Kanwil 1,75 juta ton (Nov 2026) sengaja tidak dipakai karena tidak cocok dengan angka cabang (lihat catatan di CSV berita).

  python scripts/bulog/proksi_stok_cabang.py            # cetak tabel dan tulis CSV proksi
"""
import pathlib

import pandas as pd

AKAR = pathlib.Path(__file__).resolve().parents[2]
BERITA = AKAR / "data/bulog/stok_beras/kantor_cabang/berita/bulog_jatim_stok_beras_kantorcabang_berita_2026.csv"
PENGADAAN = AKAR / "data/bulog/pengadaan_beras/kantor_cabang/tahunan/bulog_jatim_pengadaan_beras_kantorcabang_tahunan_2024_2025.csv"
KELUAR = AKAR / "data/bulog/stok_beras/kantor_cabang/proksi/bulog_jatim_stok_beras_kantorcabang_proksi_2026.csv"


def pengadaan_csv(tahun=2025):
    """Pengadaan per cabang (kg) dari CSV repo, semua saluran."""
    p = pd.read_csv(PENGADAAN).set_index("kantor_cabang")
    return p.filter(like=f"_{tahun}_kg").sum(axis=1)


def proksi(pengadaan=None, berita=None):
    """pengadaan: Series kg per kantor_cabang (nama seperti Tabel 10.1.6). Kembalikan DataFrame per cabang:
    kantor_cabang, stok_ton, jenis (BERITA/TAKSIRAN), tanggal_posisi, url; atribut attrs['total_ton'] dan attrs['rasio']."""
    peng = pengadaan_csv() if pengadaan is None else pengadaan
    b = pd.read_csv(BERITA) if berita is None else berita
    b = b[(b.dipakai == "ya") & b.kantor_cabang.isin(peng.index)].set_index("kantor_cabang")
    if b.empty:
        raise ValueError("tidak ada angka stok cabang dari berita yang cocok dengan nama cabang pengadaan")
    porsi = peng / peng.sum()
    S = b.stok_ton.sum() / porsi[b.index].sum()
    out = pd.DataFrame({"kantor_cabang": peng.index, "stok_ton": (porsi * S).round(0).to_numpy(), "jenis": "TAKSIRAN", "tanggal_posisi": "", "url": ""})
    out = out.set_index("kantor_cabang")
    out.loc[b.index, "stok_ton"] = b.stok_ton.astype(float)
    out.loc[b.index, "jenis"] = "BERITA"
    out.loc[b.index, "tanggal_posisi"] = b.tanggal_posisi
    out.loc[b.index, "url"] = b.url
    out = out.reset_index()
    out.attrs.update(total_ton=float(out.stok_ton.sum()), rasio=float(S), posisi=str(b.tanggal_posisi.max()))
    return out


def main():
    P = proksi()
    P.to_csv(KELUAR, index=False)
    lama = (pengadaan_csv() / pengadaan_csv().sum() * 906_988.6).round(0)  # dummy lama: stok akhir Okt 2025 x porsi pengadaan
    print(P.assign(dummy_lama_ton=P.kantor_cabang.map(lama)).drop(columns="url").to_string(index=False))
    print(f"total proksi {P.attrs['total_ton'] / 1e3:.0f} rb ton (dummy lama 907 rb ton); posisi s.d. {P.attrs['posisi']}; ditulis ke {KELUAR.relative_to(AKAR)}")


if __name__ == "__main__":
    main()
