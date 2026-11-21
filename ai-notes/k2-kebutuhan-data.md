# K2 (stok beredar): yang dummy sekarang dan data yang dibutuhkan untuk operasional

Alur: prakiraan produksi K1 -> neraca bulanan per kabupaten -> stok sebagai keadaan laten (filter Kalman) -> cakupan stok, status, hitung mundur ke defisit.
Skrip: `scripts/k2/k2_operasional.py` (hasil di `app.estimasi_stok`, semua baris berlabel **DUMMY**). Prakiraan K1: `scripts/k1/k1_prakiraan.py`.

## Yang sudah data nyata atau model

| Bahan | Sumber | Label |
|---|---|---|
| Produksi bulan lalu | BPS luas panen bulanan per kab, produktivitas BPS | asli |
| Produksi bulan ke depan | Prakiraan K1 (model gabungan, galat ±30% per kab per bulan) | model |
| Konsumsi | Penduduk proyeksi x Susenas Maret 2025 per kab | asli/model |
| Arus antar kabupaten | Optimasi jarak jalan (surplus -> defisit) | model |

## Yang dummy dan data operasional yang dibutuhkan

| Bahan (dummy sekarang) | Data yang dibutuhkan | Dari |
|---|---|---|
| **Pengamatan stok** (triwulanan, simulasi) | Hasil survei stok beras per provinsi/kabupaten, minimal triwulanan (pedagang, penggilingan, rumah tangga) | BPS + Bapanas (SCBN) |
| **Stok Bulog** (hanya provinsi) | Stok Bulog per cabang dan pemetaan cabang ke kabupaten | Perum Bulog |
| **Keluar provinsi / penggunaan non-rumah tangga** (diasumsikan dari kelebihan panen, ketidakpastian 20%) | Arus beras antar provinsi dan konsumsi non-rumah tangga | Bapanas, Bulog |
| **Arus antar kabupaten** (model jarak) | Realisasi distribusi (SPHP, pedagang besar) | Bulog, Dinas Pangan |
| **Ambang status** (cukup >= 1,0; defisit < 0,75 bulan konsumsi, dari teks aplikasi) | Penetapan resmi ambang | Bapanas / Dinas |

## Mengganti dummy dengan data nyata

- Hanya pengamatan stok yang diganti (daftar pengamatan di filter). Persamaan, antarmuka, dan label tidak berubah; label berubah dari DUMMY ke ASLI.
- Selang kepercayaan sekarang **ikut dummy** (pengamatan dummy berderau kecil), jadi di aplikasi tampilkan catatan "berdasarkan data dummy".
- Tanpa pengamatan nyata, stok per kabupaten tidak teridentifikasi (satu titik pengamatan nasional memberi ketidakpastian ±1,2-1,4 bulan konsumsi). Lihat catatan 2026-11-19 di `progress.md`.
