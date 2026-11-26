# Harga beras per kab/kota Jawa Timur (SISKAPERBAPO)

Harga **konsumen** (eceran, pasar tradisional) **beras medium** dan **beras premium**, harian, 38 kab/kota Jawa Timur, 30 Des 2015 sampai 25 Nov 2026. Bahan utama K3 (prediksi harga dan status waspada/siaga). Status sumber: **asli** (lihat [aturan data](../../../ai-notes/01-aturan-data.md)).

## Sumber

**SISKAPERBAPO** (Sistem Informasi Ketersediaan dan Perkembangan Harga Bahan Pokok di Jawa Timur), situs Pemprov Jawa Timur. Halaman "Harga Konsumen (per Komoditas)":
https://siskaperbapo.jatimprov.go.id/harga-komoditas

| Komoditas | Kode di sumber | Berkas (`<nama>`) |
|---|---|---|
| Beras Medium / kg | 4 | `beras_medium` |
| Beras Premium / kg | 2 | `beras_premium` |

Diambil pertama kali 17 November 2026 (sejak 29 Des 2021), lalu diperpanjang ke belakang sampai 30 Des 2015 pada 25 November 2026. Halaman itu berupa formulir (`tanggal_akhir`, `komoditas`) yang menampilkan 7 hari berakhir pada tanggal yang dipilih, untuk semua pasar. Dibutuhkan sekitar 570 permintaan per komoditas, jeda 1,2 detik antarpermintaan, tanpa login dan tanpa kunci API.

## Struktur folder

```
data/siskaperbapo/harga_beras/
├── kabkota_harian_<nama>.csv       # UTAMA: rata-rata per kab/kota per hari (38 × 3.984 = 151.392 baris)
├── pasar_harian_<nama>.csv.gz      # mentah per pasar per hari (121 pasar, 482.064 baris), apa adanya dari sumber
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

  | | 2016 | 2017 | 2018 | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 |
  |---|---|---|---|---|---|---|---|---|---|---|---|
  | Medium | 8.937 | 8.862 | 9.710 | 9.499 | 9.699 | 9.426 | 9.684 | 10.731 | 11.960 | 12.669 | 12.957 |
  | Premium | 10.279 | 10.431 | 11.475 | 11.191 | 11.333 | 11.241 | 11.420 | 12.907 | 14.382 | 14.735 | 14.960 |

  (angka provinsi publikasi sumber; 2026 sampai 25 Nov)

  Perhatikan saat memodelkan dan memilih data latih.
- **Selisih premium dan medium** di tingkat provinsi: Rp1.464 sampai Rp3.427 per kg (rata-rata Rp2.082). Premium tidak pernah lebih murah dari medium.
- **Jumlah pasar per kab/kota hanya 2–6.** Kab/kota dengan 1–2 pasar bernilai lebih mudah bergejolak. Gunakan `pasar_bernilai` sebagai bobot kepercayaan.
- Ini harga **eceran** (konsumen). Cocok dibandingkan dengan HET eceran, bukan dengan harga produsen/penggilingan di Panel Harga Bapanas. Penamaan kelas mutu juga tidak sama dengan PIHPS Bank Indonesia (Medium I/II, Super I/II), jadi angkanya tidak bisa dicampur.

## Pembersihan

Nilai pasar mustahil di sumber (salah ketik) dikecualikan dari rata-rata kab/kota, ditandai di kolom `pasar_dikecualikan`: medium 39 sel (29 terlalu rendah, 10 terlalu tinggi), premium 41 sel (40 dan 1). Hampir semuanya sebelum 2022. Contoh sejak 2022:

| Komoditas | Tanggal | Pasar | Nilai di sumber | Dampak |
|---|---|---|---|---|
| Medium | 2022-10-02 | Pasar Besar Kota Batu | Rp1.170 (3 pasar lain Rp11.000) | rata-rata Kota Batu Rp11.000, bukan Rp8.542 kalau dibiarkan |
| Medium | 2023-04-04 | Pasar Legi, Kab. Ponorogo | Rp1.000 (Pasar Sumoroto Rp11.000) | rata-rata Kab. Ponorogo Rp11.000, bukan Rp6.000 kalau dibiarkan |
| Premium | 2023-03-06 | Pasar Pasirian, Kab. Lumajang | Rp2.500 | rata-rata Kab. Lumajang Rp12.250 |

Contoh sebelum 2022: Pasar Pandaan (Kab. Pasuruan) Rp88.000–92.000 pada Apr–Mei 2016 dan Pasar Baru (Kab. Lumajang) Rp97.000 pada 8 Apr 2016, kemungkinan nol berlebih. Tanpa pembersihan, rata-rata Kab. Pasuruan 4 Mei 2016 menjadi Rp90.000.

Aturan: harga pasar di bawah Rp5.000/kg atau di atas Rp30.000/kg dianggap tidak valid (harga wajar tertinggi Rp19.000). **Berkas mentah per pasar tidak diubah.** Karena itu angka provinsi sumber pada hari-hari tersebut berbeda dari hitungan kita (lebih rendah bila salah ketiknya terlalu kecil, lebih tinggi bila terlalu besar).

## Validasi

1. Kedua komoditas terunduh lengkap: 3.984 hari berurutan (30 Des 2015 sampai 25 Nov 2026) tanpa hari hilang, 482.064 sel pasar-hari per komoditas. Bagian 29 Des 2021 dan seterusnya identik dengan unduhan pertama.
2. **Sejak 2022, rata-rata antar-kab/kota (dipotong) sama dengan angka provinsi sumber pada hampir semua hari.** Angka di bawah dihitung pada unduhan pertama (29 Des 2021 sampai 17 Nov 2026). Untuk 2016–2021 hanya 10–25% hari yang sama persis, dengan selisih median Rp2–14/kg; beberapa hari selisihnya ratusan sampai ribuan rupiah karena angka provinsi sumber ikut memasukkan salah ketik. Tampaknya cara sumber menghitung angka provinsi sebelum 2022 berbeda; harga per pasar tetap dipakai apa adanya:
   - Medium: 1.776 dari 1.785 hari persis sama, +1 pada 3 hari (pembulatan). Sisanya: 3 hari awal Des 2021 (+8/+9, jendela pertama), 22 Sep 2022 (-4), dan 2 hari salah ketik (+64, +131).
   - Premium: 1.778 dari 1.785 hari persis sama, +1 pada 5 hari, -3 pada 1 hari, dan 1 hari salah ketik (+86).
3. Cakupan pasar terisi: medium 93,4% (2016: 80,4%; 2026: 98,1%), premium 88,5% (2016: 71,9%; 2026: 100%). Kab/kota-hari tanpa nilai: medium 921, premium 7.656 (terbanyak Kab. Banyuwangi 2.589, Kab. Ponorogo 1.362, Kota Pasuruan 1.179); hampir semuanya sebelum 2023.
4. Rentang harga pasar setelah pembersihan: medium Rp7.000–19.000, premium Rp8.000–19.000. Rata-rata kab/kota: medium Rp7.000–15.500, premium Rp8.500–16.667, tanpa lonjakan harian di atas 40%.
5. **Kewajaran terhadap peristiwa yang sudah diketahui** (bukan pembanding independen): harga medium Jatim naik dari Rp10.328 (Jul 2023) ke Rp11.559 (Okt 2023), +12%, sesuai lonjakan harga beras Agustus–Oktober 2023, lalu terus naik sampai Rp12.964 (Sep 2025).

## Pembanding independen

Belum ada. Dataset bulanan harga konsumen per provinsi dari Bapanas di data.go.id berstatus "Dataset Terbatas" (hanya lewat aplikasi SAPA dengan permintaan akses), sehingga tidak dipakai. PIHPS Bank Indonesia memakai penamaan kelas mutu yang berbeda dan butuh unduhan interaktif, belum dicek.

## Perbandingan dengan Panel Harga Bapanas

Panel Harga Bapanas (panelharga.badanpangan.go.id) di antarmuka publiknya **hanya menampilkan harga produsen** (penggilingan/petani), dan hanya 30 dari 38 kab/kota Jatim yang dipantau (8 kota tidak). Harga konsumen di sana hanya tersedia lewat API yang meminta kunci, sehingga tidak dipakai. SISKAPERBAPO dipilih karena eceran, harian, dan mencakup seluruh 38 kab/kota.

## Belum ada

- Riwayat sebelum 30 Des 2015.
- Komoditas lain (misalnya SPHP, gula, minyak goreng). Cukup ganti kode komoditas.
- Pembanding independen (lihat di atas).
