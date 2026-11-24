# Harga beras per kab/kota Jawa Timur (SISKAPERBAPO)

Harga **konsumen** (eceran, pasar tradisional) **beras medium** dan **beras premium**, harian, 38 kab/kota Jawa Timur, 29 Des 2021 sampai 17 Nov 2026. Bahan utama K3 (prediksi harga dan status waspada/siaga). Status sumber: **asli** (lihat [aturan data](../../../ai-notes/01-aturan-data.md)).

## Sumber

**SISKAPERBAPO** (Sistem Informasi Ketersediaan dan Perkembangan Harga Bahan Pokok di Jawa Timur), situs Pemprov Jawa Timur. Halaman "Harga Konsumen (per Komoditas)":
https://siskaperbapo.jatimprov.go.id/harga-komoditas

| Komoditas | Kode di sumber | Berkas (`<nama>`) |
|---|---|---|
| Beras Medium / kg | 4 | `beras_medium` |
| Beras Premium / kg | 2 | `beras_premium` |

Diambil pada 17 November 2026. Halaman itu berupa formulir (`tanggal_akhir`, `komoditas`) yang menampilkan 7 hari berakhir pada tanggal yang dipilih, untuk semua pasar. Dibutuhkan 255 permintaan per komoditas, jeda 1,2 detik antarpermintaan, tanpa login dan tanpa kunci API.

## Struktur folder

```
data/siskaperbapo/harga_beras/
├── kabkota_harian_<nama>.csv       # UTAMA: rata-rata per kab/kota per hari (38 × 1.785 = 67.830 baris)
├── pasar_harian_<nama>.csv.gz      # mentah per pasar per hari (121 pasar, 215.985 baris), apa adanya dari sumber
└── provinsi_harian_<nama>.csv      # angka rata-rata provinsi yang dipublikasikan sumber (pembanding)
```

## Cara memperbarui

Skrip di [scripts/siskaperbapo/ambil_harga.py](../../../scripts/siskaperbapo/ambil_harga.py), hanya memakai pustaka standar Python (dari root repo):

```bash
python3 scripts/siskaperbapo/ambil_harga.py --komoditas 4 --nama beras_medium
python3 scripts/siskaperbapo/ambil_harga.py --komoditas 2 --nama beras_premium
```

Hasil unduhan disimpan per tanggal di `~/.cache/terawang-siskaperbapo/`, jadi menjalankan ulang hanya mengambil hari yang belum ada. Empat belas hari terakhir selalu diunduh ulang karena sumber bisa merevisi (`--segarkan`). Skrip terbukti mereproduksi berkas Beras Medium secara identik dari cache.

## Kolom

- `kabkota_harian_…csv`: `tanggal`, `kabkota` (nama sumber, contoh `Kabupaten Malang`, `Kota Batu`), `jenis`, `harga_rata2_rp_kg`, `pasar_bernilai` (pasar yang terisi), `pasar_total`, `pasar_dikecualikan`.
- `pasar_harian_…csv.gz`: `tanggal`, `kabkota`, `pasar`, `harga_rp_kg` (kosong = tidak ada data).
- `provinsi_harian_…csv`: `tanggal`, `harga_provinsi_publikasi_rp_kg`.

Nama kab/kota di berkas ini **berbeda** dari BPS: memakai awalan `Kabupaten`/`Kota` (BPS: `Pacitan`, `Kota Kediri`). Untuk menggabungkan dengan `data/bps/`, hapus awalan `Kabupaten ` dan pertahankan `Kota `.

## Metode agregasi

Sumber hanya mempublikasikan harga **per pasar**, bukan per kabupaten. Harga kab/kota dihitung sebagai rata-rata pasar yang terisi, dan harga provinsi sebagai rata-rata antar-kab/kota (dipotong ke bawah). Metode ini diverifikasi terhadap angka provinsi yang dipublikasikan sumber.

## Catatan pemakaian

- **Resolusi efektif mendekati mingguan.** Harga provinsi (medium) sama dengan hari sebelumnya pada 22% hari Sabtu dan Minggu, dibandingkan 8–10% pada Senin–Rabu. Untuk model, pertimbangkan rata-rata mingguan atau hanya hari kerja.
- **Tidak stasioner.** Rata-rata provinsi per tahun (Rp per kg):

  | | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 |
  |---|---|---|---|---|---|---|
  | Medium | 9.366 | 9.683 | 10.730 | 11.960 | 12.668 | 12.955 |
  | Premium | 11.227 | 11.420 | 12.907 | 14.381 | 14.735 | 14.956 |

  Perhatikan saat memodelkan dan memilih data latih.
- **Selisih premium dan medium** di tingkat provinsi: Rp1.464 sampai Rp3.427 per kg (rata-rata Rp2.082). Premium tidak pernah lebih murah dari medium.
- **Jumlah pasar per kab/kota hanya 2–6.** Kab/kota dengan 1–2 pasar bernilai lebih mudah bergejolak. Gunakan `pasar_bernilai` sebagai bobot kepercayaan.
- Ini harga **eceran** (konsumen). Cocok dibandingkan dengan HET eceran, bukan dengan harga produsen/penggilingan di Panel Harga Bapanas. Penamaan kelas mutu juga tidak sama dengan PIHPS Bank Indonesia (Medium I/II, Super I/II), jadi angkanya tidak bisa dicampur.

## Pembersihan

Tiga nilai pasar mustahil di sumber (salah ketik) dikecualikan dari rata-rata kab/kota, ditandai di kolom `pasar_dikecualikan`:

| Komoditas | Tanggal | Pasar | Nilai di sumber | Dampak |
|---|---|---|---|---|
| Medium | 2022-10-02 | Pasar Besar Kota Batu | Rp1.170 (3 pasar lain Rp11.000) | rata-rata Kota Batu Rp11.000, bukan Rp8.542 kalau dibiarkan |
| Medium | 2023-04-04 | Pasar Legi, Kab. Ponorogo | Rp1.000 (Pasar Sumoroto Rp11.000) | rata-rata Kab. Ponorogo Rp11.000, bukan Rp6.000 kalau dibiarkan |
| Premium | 2023-03-06 | Pasar Pasirian, Kab. Lumajang | Rp2.500 | rata-rata Kab. Lumajang Rp12.250 |

Aturan: harga pasar di bawah Rp5.000/kg dianggap tidak valid. **Berkas mentah per pasar tidak diubah.** Karena itu angka provinsi sumber pada hari-hari tersebut sedikit lebih rendah daripada hitungan kita.

## Validasi

1. Kedua komoditas terunduh lengkap: 255 dari 255 jendela, 1.785 hari berurutan tanpa hari hilang, 215.985 sel pasar-hari per komoditas.
2. **Rata-rata antar-kab/kota (dipotong) sama dengan angka provinsi sumber pada mayoritas hari:**
   - Medium: 1.776 dari 1.785 hari persis sama, +1 pada 3 hari (pembulatan). Sisanya: 3 hari awal Des 2021 (+8/+9, jendela pertama), 22 Sep 2022 (-4), dan 2 hari salah ketik (+64, +131).
   - Premium: 1.778 dari 1.785 hari persis sama, +1 pada 5 hari, -3 pada 1 hari, dan 1 hari salah ketik (+86).
3. Cakupan pasar terisi: medium 96,7% (2021: 94,2%; 2026: 98,1%), premium 96,4%. Kab/kota tanpa nilai hanya 9 hari (medium, semuanya Kab. Probolinggo).
4. Rentang wajar: medium Rp1.000 (salah ketik) sampai Rp16.000, median Rp12.000; premium Rp2.500 (salah ketik) sampai Rp19.000, median Rp14.000.
5. **Kewajaran terhadap peristiwa yang sudah diketahui** (bukan pembanding independen): harga medium Jatim naik dari Rp10.328 (Jul 2023) ke Rp11.559 (Okt 2023), +12%, sesuai lonjakan harga beras Agustus–Oktober 2023, lalu terus naik sampai Rp12.964 (Sep 2025).

## Pembanding independen

Belum ada. Dataset bulanan harga konsumen per provinsi dari Bapanas di data.go.id berstatus "Dataset Terbatas" (hanya lewat aplikasi SAPA dengan permintaan akses), sehingga tidak dipakai. PIHPS Bank Indonesia memakai penamaan kelas mutu yang berbeda dan butuh unduhan interaktif, belum dicek.

## Perbandingan dengan Panel Harga Bapanas

Panel Harga Bapanas (panelharga.badanpangan.go.id) di antarmuka publiknya **hanya menampilkan harga produsen** (penggilingan/petani), dan hanya 30 dari 38 kab/kota Jatim yang dipantau (8 kota tidak). Harga konsumen di sana hanya tersedia lewat API yang meminta kunci, sehingga tidak dipakai. SISKAPERBAPO dipilih karena eceran, harian, dan mencakup seluruh 38 kab/kota.

## Belum ada

- Riwayat sebelum akhir 2021. Uji coba menunjukkan data tersedia sampai 2020 ke belakang (`--mulai`).
- Komoditas lain (misalnya SPHP, gula, minyak goreng). Cukup ganti kode komoditas.
- Pembanding independen (lihat di atas).
