# Harga gabah tingkat petani, Jawa Timur (BPS)

`bps_jatim_harga_gkp_petani_bulanan.csv` — rata-rata harga **Gabah Kering Panen (GKP) di tingkat petani**, Provinsi Jawa Timur, Rp/kg, bulanan. Kolom: `tahun, bulan, harga_gkp_petani_rp_kg, sumber` (URL tempat angka dibaca). Status: **ASLI**.

| Tahun | Sumber | Ketelitian |
|---|---|---|
| 2016–2021, 2024 | Publikasi tahunan BPS Jatim *Statistik Harga Produsen Gabah Provinsi Jawa Timur* (edisi tahun berikutnya), tabel bulanan "Rata-rata Harga Gabah … di Tingkat Petani", kolom GKP | 2 desimal |
| 2023 | BRS Jatim 2 Jan 2024 "Perkembangan NTP, Harga Gabah dan Beras" (baris GKP bulanan 2023). Edisi publikasi 2023 hanya memuat grafik tanpa angka. Cocok dengan rentang di teks publikasi (5.252,58–7.009,67) | rupiah bulat |

Validasi: 12 angka bulanan 2024 di BRS bulanan (Feb 2024–Jan 2025) sama dengan tabel publikasi setelah pembulatan.

## Kosong

- **2022 (12 bulan):** publikasi edisi 2022 hanya menampilkan grafik tanpa label; teks hanya memberi rentang 4.278,23–5.542,08. Tidak diisi.
- **2025 (12 bulan):** publikasi edisi 2025 belum terbit; BRS NTP Jatim berhenti memuat bagian harga gabah sejak Feb 2025.
- Untuk model, bulan sesudah Des 2024 disambung dengan rata-rata panel harian GKP petani Bapanas (`data/bapanas/panel_harga/kabkota_harian_gkp_petani.csv`); rasio BPS/Bapanas pada 12 bulan tumpang 2024 = 1,0005, korelasi 0,96 (`scripts/k3/sarimax_gkp.py`).

## Sumber yang dicoba dan tidak berisi angka bulanan

Tabel statistik BPS Jatim (hanya "Harga Dasar Gabah"), BRS NTP Jatim 2020–2023 (tanpa harga GKP), *Jawa Timur Dalam Angka* 2023 dan 2026, tabel dan publikasi bps.go.id (nasional atau tahunan per provinsi).
