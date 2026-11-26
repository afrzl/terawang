# Data BPS: harga gabah Jawa Timur

Topik: harga gabah tingkat produsen (gabah kering panen/GKP dan gabah kering giling/GKG), rata-rata Provinsi Jawa Timur per bulan. Dipakai untuk uji transmisi harga vertikal (gabah ke beras eceran) di K3. Status sumber: **asli** (lihat [aturan data](../../../ai-notes/01-aturan-data.md)).

## Struktur folder

```
data/bps/harga_gabah/
└── provinsi/
    └── bulanan/
        └── bps_jatim_harga_gabah_provinsi_bulanan_2016_2025.csv   # 83 bulan
```

## Sumber

**BPS Provinsi Jawa Timur.** *Statistik Harga Produsen Gabah Provinsi Jawa Timur* (Katalog 7103005.35), terbitan tahunan, hasil Survei Harga Produsen Gabah. Halaman publikasi di https://jatim.bps.go.id, contoh:

- 2017: https://jatim.bps.go.id/en/publication/2018/08/03/5045dc0b01b5b9e51531e2e9/statistik-harga-produsen-gabah-provinsi-jawa-timur-2017.html
- 2020: https://jatim.bps.go.id/en/publication/2021/08/06/bddce99cc1924900f5267b73/statistik-harga-produsen-gabah-provinsi-jawa-timur-2020.html
- 2024: https://jatim.bps.go.id/en/publication/2025/02/17/28bd96a8b5e9c3751f7981b8/statistik-harga-produsen-gabah-provinsi-jawa-timur-2024.html

| Tahun | Tabel | Halaman PDF | Tingkat |
|---|---|---|---|
| 2016 | Tabel 3 | 23 | petani |
| 2017 | Tabel 3 | 24 | petani |
| 2019 | Tabel 3 | 32 | petani |
| 2020 | Tabel 3 | 32 | petani |
| 2023 | Tabel 4 | 35 | **penggilingan** (tabel tingkat petani di publikasi ini berupa gambar) |
| 2024 | Tabel 4 | 40 | petani |

**2025 (Jan–Nov):** Kementerian Pertanian, *Statistik Harga Komoditas Pertanian 2025*, Tabel 1.9 "Perkembangan Rata-rata Harga GKP di Tingkat Petani Menurut Provinsi" (PDF hlm. 39), sumber data BPS. Hanya GKP, tanpa GKG.
https://satudata.pertanian.go.id/assets/docs/publikasi/c9c87ec57f8a22249659ace0dc306047.pdf

Diambil 26 November 2026.

## Kolom

- `tahun`, `bulan` (1–12).
- `tingkat`: `petani` atau `penggilingan`.
- `gkp_rp_kg`: rata-rata harga gabah kering panen (Rp/kg).
- `gkg_rp_kg`: rata-rata harga gabah kering giling (Rp/kg); kosong untuk 2025.
- `sumber`: publikasi, tabel, dan halaman PDF.

## Catatan pemakaian

- **Tahun tidak lengkap:** 2018, 2021, dan 2022 belum ada, dan 2026 belum terbit. Deret ini belum bisa dipakai sebagai variabel operasional K3a; baru untuk uji historis.
- **Tingkat 2023 berbeda** (penggilingan, bukan petani). Harga penggilingan biasanya sedikit lebih tinggi daripada harga petani, jadi hati-hati bila menghitung perubahan antara Des 2023 dan Jan 2024.
- **Hanya tingkat provinsi.** Publikasi tidak memuat harga gabah per kab/kota secara bulanan.
- Rata-rata GKP per tahun (Rp/kg): 2016 4.302; 2017 4.459; 2019 4.728; 2020 4.775; 2023 6.090; 2024 6.516; 2025 (Jan–Nov) 6.767.

## Validasi

1. Semua 155 nilai (83 GKP dan 72 GKG) dicocokkan otomatis dengan teks tabel di PDF sumber pada halaman di atas: 155 cocok, 0 tidak ditemukan.
2. GKG lebih tinggi daripada GKP di semua 72 bulan yang memuat keduanya, sesuai kadar air yang lebih rendah.
3. Pola musiman wajar: harga terendah pada panen raya Maret–April (contoh 2016: Rp3.670 pada Maret) dan naik menjelang akhir tahun.

Berkas PDF sumber tidak disimpan di repo (sekitar 20 MB); unduh ulang dari tautan di atas.

## Belum ada

- 2018, 2021, 2022 (publikasi tahunan belum diambil) dan 2026.
- Harga gabah per kab/kota.
