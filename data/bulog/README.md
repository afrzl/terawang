# Data Bulog (Jawa Timur)

Stok, pengadaan, dan harga acuan beras dari **Kantor Wilayah Perum Bulog Provinsi Jawa Timur**, sebagaimana dimuat BPS dalam publikasi di bawah. Dipakai untuk kalibrasi neraca stok K2 dan sisi pasokan SPHP K3. Status sumber: **asli** (lihat [aturan data](../../ai-notes/01-aturan-data.md)).

## Sumber

**BPS Provinsi Jawa Timur.** *Provinsi Jawa Timur Dalam Angka 2026*, Bab 10 (Harga, Nilai Tukar Petani, dan Perbankan), Tabel 10.1.3 sampai 10.1.7, hlm. 518–522 (PDF hlm. 542–546). Sumber asli semua tabel: Kantor Wilayah Perum Bulog Provinsi Jawa Timur.
https://jatim.bps.go.id/en/publication/2026/02/27/19b010f5faca007f15a32d23/provinsi-jawa-timur-dalam-angka-2026.html

Semua angka dalam **kg** (apa adanya dari publikasi, termasuk dua desimal). Bagi 1.000 untuk ton.

## Struktur folder

```
data/bulog/
├── stok_beras/
│   ├── provinsi/bulanan/bulog_jatim_stok_beras_provinsi_bulanan_2025.csv                      # Tabel 10.1.3
│   └── kanwil/tahunan/bulog_nasional_stok_beras_kanwil_tahunan_2023_2025.csv                  # Tabel 10.1.7
├── pengadaan_beras/
│   └── kantor_cabang/tahunan/bulog_jatim_pengadaan_beras_kantorcabang_tahunan_2024_2025.csv   # Tabel 10.1.6
├── harga_penggilingan/
│   └── kantor_cabang/tahunan/bulog_jatim_harga_beras_penggilingan_kantorcabang_tahunan_2023_2025.csv   # Tabel 10.1.5
└── harga_acuan/
    └── provinsi/tahunan/bulog_jatim_harga_pembelian_pemerintah_gabah_beras_provinsi_tahunan_1999_2025.csv   # Tabel 10.1.4
```

## Isi dan kolom

| Berkas | Isi | Kolom |
|---|---|---|
| Stok bulanan Jatim 2025 | Persediaan beras Bulog Jatim per bulan | `tahun`, `bulan`, `persediaan_awal_kg`, `pemasukan_kg`, `persediaan_dikuasai_kg`, `pengeluaran_kg`, `persediaan_akhir_kg` |
| Stok per kantor wilayah 2023–2025 | 26 provinsi + Indonesia | `kantor_wilayah`, `stok_2023_kg`, `stok_2024_kg`, `stok_2025_kg` |
| Pengadaan per kantor cabang | 13 kantor cabang Bulog Jatim, menurut saluran | `kantor_cabang`, `kud_*`, `non_kud_ktna_*`, `satgas_upgb_draying_*` (2024 dan 2025, kg) |
| Harga beras penggilingan | 13 kantor cabang, "harga rill" | `kantor_cabang`, `harga_2023_rp_kg`, `harga_2024_rp_kg`, `harga_2025_rp_kg` |
| Harga dasar dan pembelian pemerintah | Gabah dan beras, 1999–2025 | `tahun`, `keterangan` (Wil I/II/III atau GKP), `harga_dasar_gabah_rp_kg`, `gabah_kud_`, `gabah_non_kud_`, `beras_kud_`, `beras_non_kud_` (Rp/kg) |

Nama kantor cabang: Surabaya Utara, Surabaya Selatan, Bojonegoro, Madiun, Kediri, Bondowoso, Malang, Probolinggo, Banyuwangi, Tulungagung, Jember, Madura, Ponorogo.

## Gambaran isi

- **Stok Bulog Jatim 2025:** persediaan awal Januari 250,4 ribu ton, akhir Desember 796,4 ribu ton. Stok akhir bulan tertinggi Juni (984,0 ribu ton). Pemasukan setahun 1.532,6 ribu ton.
- **Pengadaan 2025:** 688,5 ribu ton (non-KUD/KTNA 577,4; satgas 111,1; KUD tidak ada). Tahun 2024 hanya 81,6 ribu ton, jadi naik sekitar 8 kali lipat.
- **Jatim di tingkat nasional (Tabel 10.1.7):** 808,9 ribu ton pada 2025, sekitar 24% dari persediaan Bulog nasional (3.364,8 ribu ton).
- **Harga pembelian pemerintah 2025:** gabah Rp6.500/kg, beras Rp12.000/kg. Beras Rp12.000 sama dengan "HPP Nasional" yang tertera di Panel Harga Bapanas.

## Catatan pemakaian dan kualitas

1. **Stok ini hanya milik Bulog**, bukan total stok beras di Jawa Timur. Stok pedagang, penggilingan, dan rumah tangga tidak ada di sini. Gunakan sebagai jangkar kalibrasi bagian Bulog, bukan sebagai stok total.
2. **Tabel 10.1.3 dan 10.1.7 tidak sama definisinya.** Stok akhir Desember 2025 di 10.1.3 (796,4 ribu ton) berbeda 1,6% dari Jatim 2025 di 10.1.7 (808,9 ribu ton). Stok awal Januari 2025 di 10.1.3 (250,4 ribu ton) juga berbeda dari Jatim 2024 di 10.1.7 (292,2 ribu ton). Tanggal acuan 10.1.7 tidak dijelaskan di tabel. Untuk K2 gunakan 10.1.3, karena bulanan dan konsisten secara akuntansi.
3. **Pemasukan 2025 (1.532,6 ribu ton) jauh lebih besar dari pengadaan (688,5 ribu ton, 45%).** Selisihnya berasal dari sumber pemasukan lain yang tidak dirinci di publikasi (kemungkinan antarwilayah dan impor; belum dipastikan).
4. **Harga beras penggilingan 2025 sama dengan 2024 × 1,0200 di semua 13 kantor cabang** (rasio minimum dan maksimum keduanya 1,0200), termasuk rata-ratanya. Itu menandakan angka 2025 diturunkan dengan kenaikan 2%, bukan hasil pengamatan independen. Jangan diperlakukan sebagai harga pasar.
5. **Rata-rata 2023 di Tabel 10.1.5 tidak cocok dengan jumlah barisnya** (11.418,65 hasil hitung vs 11.464,28 di publikasi, selisih 0,4%), sedangkan 2024 dan 2025 cocok persis. Selisih setara kira-kira Rp593 pada salah satu dari 13 nilai 2023, kemungkinan salah ketik di sumber. Belum bisa ditentukan baris mana, jadi tidak diubah.
6. **Baris "Rata-Rata Jawa Timur" di Tabel 10.1.6 sebenarnya total** (jumlah 13 kantor cabang, cocok persis).
7. **Kolom KUD di Tabel 10.1.6 kosong (0) di semua cabang** pada 2024 dan 2025, sesuai tanda "–" di sumber.
8. **Kantor cabang Bulog tidak sama dengan kabupaten.** Satu cabang melayani beberapa kabupaten, dan pemetaannya tidak ada di publikasi. Tanpa pemetaan itu, data ini belum bisa dipecah ke tingkat kabupaten.
9. **Tabel HPP:** rentang 1999–2025, dengan label wilayah (Wil I/II/III) untuk 1999 dan jenis gabah (GKP) untuk 2003 dan seterusnya. Untuk 2020 dan 2021 berlaku fleksibilitas 10% di atas HPP (catatan kaki sumber). Dipakai apa adanya, belum dicocokkan dengan peraturan Bapanas.

## Validasi

Dijalankan saat berkas dibuat:

1. **Stok bulanan:** persediaan awal + pemasukan = persediaan dikuasai, dan dikuasai − pengeluaran = akhir, benar di 12 bulan. Stok akhir bulan t sama dengan stok awal bulan t+1 (rantai 12 bulan tanpa celah).
2. **Pengadaan:** jumlah 13 kantor cabang sama persis dengan baris total untuk semua 6 kolom (selisih 0,00).
3. **Stok per kantor wilayah:** jumlah 26 provinsi sama dengan baris Indonesia untuk 2023, 2024, dan 2025 (selisih ≤ 0,01 kg).
4. **Harga penggilingan:** rata-rata 2024 dan 2025 sama persis dengan baris rata-rata (lihat catatan 4 dan 5 untuk 2023 dan konsistensi 2025).
5. **HPP:** 29 baris (1999–2025); nilai 2025 (6.500 / 6.500 / 6.500 / 12.000 / 12.000) cocok dengan HPP beras yang tampil di Panel Harga Bapanas.

Berkas diekstrak dari teks PDF publikasi, bukan diekspor dari BPS.

## Belum ada

- **Stok Bulog menurut kabupaten atau gudang.** Tidak dipublikasikan.
- **Pemetaan kantor cabang Bulog ke kabupaten** (wilayah kerja). Perlu dari Bulog.
- **Stok bulanan sebelum 2025.** Edisi *Jawa Timur Dalam Angka 2025* kemungkinan memuat 2024 (belum dicek).
- **Realisasi penyaluran SPHP** per wilayah.
- Sumber pemasukan di luar pengadaan (lihat catatan 3).
