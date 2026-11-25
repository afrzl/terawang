# Data BPS: konsumsi beras per kapita

Topik: rata-rata konsumsi beras per kapita, tingkat **kabupaten/kota Jawa Timur** (Susenas Maret 2025) dan **provinsi** (Susenas September 2025). Dipakai untuk konsumsi beras bulanan di neraca stok K2. Status sumber: **asli** (lihat [aturan data](../../../ai-notes/01-aturan-data.md)).

## Struktur folder

```
data/bps/konsumsi_beras/
├── kabkota/
│   └── tahunan/
│       └── bps_jatim_konsumsi_beras_kabkota_tahunan_2025.csv     # 38 kab/kota, kg per kapita per MINGGU
└── provinsi/
    └── periode/
        └── bps_indonesia_konsumsi_beras_provinsi_sep_2025.csv    # Indonesia + 38 provinsi, kg per kapita per BULAN
```

## Pakai yang mana

| Kebutuhan | Berkas |
|---|---|
| **Konsumsi beras per kabupaten/kota (utama)** | `kabkota/tahunan/…_tahunan_2025.csv`. Kalikan **30/7** untuk jadi per bulan. |
| Pembanding provinsi dan nasional, serta pemisahan kota/desa | `provinsi/periode/…_sep_2025.csv` |

**Perhatikan satuan dan putaran survei berbeda:** berkas kab/kota dalam kg **per minggu** dari Susenas **Maret** 2025, berkas provinsi dalam kg **per bulan** dari Susenas **September** 2025.

## Sumber

**Tingkat kabupaten/kota:** BPS, tabel dinamis **"Rata-rata Konsumsi Perkapita Seminggu Menurut Kelompok Padi-Padian per Kabupaten/Kota (Satuan Komoditas), 2025"** (tabel nomor 2094, terakhir diperbarui 5 Januari 2026). Baris yang diambil: "Beras (beras lokal, kualitas unggul, impor)". Tabel itu memuat 514 kab/kota se-Indonesia dan tahun 2018–2025; hanya 38 baris Jawa Timur 2025 yang disimpan. Menurut keterangan halaman, sumbernya Susenas Maret modul konsumsi dan pengeluaran. Diambil langsung dari halaman lewat browser (halaman dirender dengan JavaScript).
https://www.bps.go.id/id/statistics-table/2/MjA5NCMy/rata-rata-konsumsi-perkapita-seminggu-menurut-kelompok-padi-padian-per-kabupaten-kota.html

**Tingkat provinsi:** BPS. *Pengeluaran untuk Konsumsi Penduduk Indonesia September 2025* (katalog 3201004), Susenas September 2025. Tabel 7.1 sampai 7.38 (per provinsi); Jawa Timur ada di Tabel 7.16 (hlm. 156 buku, hlm. 182 PDF). Baris yang diambil: "Beras (beras lokal, kualitas unggul, impor)".
https://www.bps.go.id/id/publication/2026/05/29/057b21b35bc236c5ede9d160/pengeluaran-untuk-konsumsi-penduduk-indonesia-september-2025.html

Verifikasi silang dengan *Ringkasan Eksekutif Pengeluaran dan Konsumsi Penduduk Indonesia September 2025*, narasi dan Lampiran 9.
https://www.bps.go.id/id/publication/2026/05/29/8e17bb92aa7082b2dd52475f/ringkasan-eksekutif-pengeluaran-dan-konsumsi-penduduk-indonesia-september-2025.html

## Kolom

**Berkas kab/kota:** `wilayah` (nama BPS), `jenis`, `nama_repo` (`Kota Batu` menjadi `Batu`), `konsumsi_beras_2025_kg_kapita_minggu` (kg per kapita per **minggu**, Susenas Maret 2025).

**Berkas provinsi:**

- `provinsi`: nama provinsi (baris pertama `Indonesia`).
- `konsumsi_beras_{kota,desa,total}_kg_kapita_bulan`: konsumsi beras, kg per kapita per bulan, menurut klasifikasi perkotaan, perdesaan, dan gabungan.
- `nilai_beras_{kota,desa,total}_rp_kapita_bulan`: nilai pengeluaran untuk beras, rupiah per kapita per bulan.
- Sel kosong berarti klasifikasi itu tidak ada di provinsi tersebut (DKI Jakarta tidak punya perdesaan).

## Catatan pemakaian

- **Angka 6,39 kg yang dipakai di proposal dan repo (`data.ts` baris 125) adalah angka nasional** (kota 6,03, desa 6,92). Untuk **Jawa Timur: 6,22 kg** (kota 5,95, desa 6,60), sekitar 2,7% di bawah nasional. Pakai angka Jawa Timur.
- Konsumsi nasional September 2024 adalah 6,49 kg (narasi Ringkasan Eksekutif), jadi September 2025 turun 1,49%.
- **Minggu ke bulan: kalikan 30/7 (= 4,2857).** Faktor ini dipakai BPS sendiri: pengeluaran beras Rp 20.514 per minggu menjadi Rp 87.916 per bulan (Ringkasan Eksekutif Sep 2025, Lampiran 15, dan tabel provinsi). Contoh: Kab. Malang 1,291 kg/minggu menjadi 5,53 kg/bulan.
- **Rentang antarwilayah:** 1,134 (Kota Madiun) sampai 1,980 (Bangkalan) kg/kapita/minggu, atau sekitar 4,9 sampai 8,5 kg/bulan. Madura dan wilayah tapal kuda lebih tinggi, kota-kota lebih rendah. Jadi memakai satu angka rata-rata untuk semua wilayah akan meleset cukup jauh di sebagian wilayah.
- **Rata-rata tertimbang penduduk** (penduduk BPS 2025) dari berkas kab/kota: 1,475 kg/minggu, atau 6,32 kg/bulan. Dekat dengan 6,22 di Susenas September 2025 (provinsi), selisih 1,6%, wajar untuk putaran survei yang berbeda.
- Angka kab/kota ini sudah **asli per kabupaten**, tidak perlu lagi memakai 6,22 untuk semua wilayah.
- Ini konsumsi **per bulan**. Kalau butuh per tahun, kalikan 12 (nasional: sekitar 77 kg per tahun).

## Validasi

**Berkas kab/kota:**

1. Checksum dihitung langsung dari halaman BPS lewat browser (38 baris Jawa Timur, jumlah 55.198 per seribu, checksum berbobot posisi 1.061.799) dan cocok persis dengan salinan di berkas.
2. Rata-rata tertimbang penduduk × 30/7 = 6,32 kg/bulan, dekat dengan provinsi (6,22).
3. Faktor minggu ke bulan 30/7 cocok dengan angka BPS (87.916 / 20.514 = 4,2857).

**Berkas provinsi:**

1. Parser menemukan 39 tabel beras (1 Indonesia + 38 provinsi) dengan nama unik.
2. Baris Indonesia (6,03 / 6,92 / 6,39) sama persis dengan narasi dan Lampiran 9 Ringkasan Eksekutif.
3. Untuk semua provinsi yang punya kota dan desa, kg total berada di antara kg kota dan kg desa.
4. Judul tabel Jawa Timur dicek manual: "Provinsi/Province: JAWA TIMUR", Tabel 7.16, "Rata-Rata Konsumsi dan Pengeluaran per Kapita Sebulan ... September 2025".

Berkas diekstrak dari teks PDF publikasi, bukan diekspor dari BPS.

## Belum ada

- Tahun 2018–2024 per kab/kota: **ada di tabel yang sama** (pilih tahun lewat dropdown), belum disalin. Berguna kalau nanti butuh tren.
- Pemisahan kota/desa per kabupaten.
- Periode lain (Maret 2025 dan sebelumnya) untuk melihat tren.
