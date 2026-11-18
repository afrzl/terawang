# Data BPS: luas panen dan produksi padi Jawa Timur

Topik: luas panen dan produksi padi (GKP, GKG, beras). Produktivitas tidak ada di publikasi, turunkan dari produksi dibagi luas panen.

Acuan validasi K1 (estimasi produksi) dan bahan neraca stok K2. Semua berkas diketik ulang dari publikasi BPS di bawah, lalu divalidasi (lihat bagian Validasi). Status sumber: **asli** (lihat [aturan data](../../../ai-notes/01-aturan-data.md)).

## Struktur folder

```
data/bps/produksi_padi/
├── kabkota/                       # tingkat kabupaten/kota (38 wilayah)
│   ├── tahunan/                   # angka satu tahun penuh
│   │   ├── bps_jatim_padi_kabkota_tahunan_2024_2025.csv
│   │   └── bps_jatim_padi_kabkota_tahunan_2025_2026s.csv
│   ├── periode/                   # angka per rentang bulan (untuk uji pra-panen)
│   │   ├── bps_jatim_padi_kabkota_periode_2025_2026.csv     # Jan–Sep dan Okt–Des
│   │   └── bps_jatim_padi_kabkota_janmar_2025_2026p.csv     # Jan–Mar
│   └── bulanan/                   # satu angka per bulan per kabupaten (luas panen dan produksi beras)
│       └── bps_jatim_padi_kabkota_bulanan_2025.csv
└── provinsi/
    └── bulanan/                   # satu angka per bulan, tingkat provinsi
        └── bps_jatim_padi_provinsi_bulanan_2024_2026.csv
```

Aturan pengelompokan: folder pertama = tingkat wilayah (`kabkota` atau `provinsi`), folder kedua = granularitas waktu (`tahunan`, `periode`, `bulanan`).

## Pakai yang mana

| Kebutuhan | Berkas |
|---|---|
| **Validasi produksi dan luas panen K1 (utama)** | `kabkota/tahunan/…_tahunan_2025_2026s.csv`. Memuat 2025 (tetap) dan 2026 (sementara), plus GKP. |
| Tahun tambahan (2024) | `kabkota/tahunan/…_tahunan_2024_2025.csv`. Angka 2025-nya identik dengan berkas di atas. |
| **Uji pra-panen** (bandingkan `est` dengan potensi Okt–Des 2026) | `kabkota/periode/…_periode_2025_2026.csv` |
| Potensi lama vs realisasi (potensi Jan–Mar 2026 dari rilis Feb, bandingkan dengan realisasinya di rilis Nov) | `kabkota/periode/…_janmar_2025_2026p.csv` |
| **Kalender panen dan pola bulanan K2, per kabupaten** | `kabkota/bulanan/…_bulanan_2025.csv` (luas panen dan produksi **beras** per kabupaten per bulan, 2025) |
| Kalender panen tingkat provinsi, 2024–2026 | `provinsi/bulanan/…_bulanan_2024_2026.csv` |

## Sumber

Dua Berita Resmi Statistik (BRS) BPS Provinsi Jawa Timur:

1. **BRS No. 71/11/35/Th. XXIV, 2 November 2026.** *Luas Panen dan Produksi Padi di Provinsi Jawa Timur 2026 (Angka Sementara, Hasil KSA Amatan September 2026).* Musim yang sama dengan citra satelit kita (tanggal acuan 30 Okt 2026). Berisi 2025 (angka tetap) dan 2026 (Jan–Agu tetap, Sep sementara, Okt–Des potensi), termasuk produksi GKP.
2. **BRS No. 11/02/35/Th. XXIV, 2 Februari 2026.** *Luas Panen dan Produksi Padi di Provinsi Jawa Timur 2025 (Angka Tetap).*
   https://jatim.bps.go.id/en/pressrelease/2026/02/02/1549/pada-2025--luas-panen-padi-mencapai-1-84-juta-hektare-dengan-produksi--padi-sebanyak-10-44-juta-ton-gabah-kering-giling--gkg-.html

Metode BPS: produksi padi = luas panen (Survei KSA) × produktivitas (Survei Ubinan), dihitung di tingkat kabupaten/kota.

## Asal tiap berkas

| Berkas | Asal |
|---|---|
| `kabkota/tahunan/…_2024_2025.csv` | BRS Feb 2026, Tabel 1–3. Luas panen, GKG, beras. Angka tetap. |
| `kabkota/tahunan/…_2025_2026s.csv` | **BRS Nov 2026**, Tabel 1–4. Luas panen, GKP, GKG, beras. 2025 tetap, 2026 sementara. |
| `kabkota/periode/…_periode_2025_2026.csv` | **BRS Nov 2026**, Tabel 5–8. Dipecah Jan–Sep dan Okt–Des. Okt–Des 2026 = potensi. |
| `kabkota/periode/…_janmar_2025_2026p.csv` | BRS Feb 2026, Tabel 4–6. Jan–Mar 2025 tetap, Jan–Mar 2026 potensi. |
| `provinsi/bulanan/…_2024_2026.csv` | BRS Nov 2026, Gambar 1–3, 5. 2026 sudah 12 bulan. **Menggantikan** versi lama yang hanya memuat Jan–Mar 2026. |
| `kabkota/bulanan/…_bulanan_2025.csv` | Tabel dinamis BPS Jatim (bukan BRS): [Rice Harvest Area by Regency/Municipality (Hectare), 2025](https://jatim.bps.go.id/en/statistics-table/2/NTc4IzI=/luas-panen-padi-menurut-kabupaten-kota.html) dan [Rice Production by Regency/Municipality (Tons), 2025](https://jatim.bps.go.id/en/statistics-table/2/NTgwIzI=/rice-production-by-regency-municipality.html). Diperbarui 6 Mar 2026, dari Survei KSA. Dibaca lewat browser (halaman dirender JavaScript). |

### Berkas bulanan per kabupaten (`kabkota/bulanan/`)

Kolom: `wilayah`, `jenis`, `nama_repo`, `tahun`, `bulan` (1–12), `luas_panen_ha`, `produksi_beras_ton`, `koreksi`. Format panjang: 38 wilayah × 12 bulan = 456 baris.

- **Produksi di tabel ini adalah beras (ton), bukan GKG.** Totalnya sama dengan produksi beras di BRS (Pacitan 76.517 ton). Konversi dari GKG: beras = 0,5774 × GKG.
- Pilihan tahun di tabel **luas panen** menampilkan **2025 sampai 2019** (daftar bisa lebih panjang, tidak saya telusuri). Tabel **produksi** belum saya periksa pilihan tahunnya. Baru **2025** yang tersimpan.
- Tahun 2026 belum ada di tabel itu (menunggu angka tetap, dijadwalkan Februari 2027).

**Salah ketik di tabel sumber (ditemukan lewat validasi, dikoreksi di berkas):**

| Wilayah | Bulan | Tertulis | Dikoreksi | Bukti |
|---|---|---|---|---|
| Magetan | Jan | 142,47 | 1.422,47 | Jumlah bulan kurang tepat 1.280,00 dari total tahunan; produktivitas hasil koreksi 3,57 t/ha sama dengan median baris |
| Sumenep | Jun | 33.399,51 | 3.339,51 | Jumlah bulan lebih tepat 30.060,00 dari total tahunan; produktivitas 2,87 t/ha (tertulis 28,7 t/ha) |
| Trenggalek | Jul | 102.299,60 | 10.299,60 | Total provinsi bulan Juli kurang tepat 90,00, hilang dengan nilai ini |
| Trenggalek | Nov | 7.431,01 | 7.341,01 | Total provinsi bulan November lebih tepat 90,00, hilang dengan nilai ini (angka tertukar); total baris tetap cocok |
| Jombang | Sep | 28.870,00 | 28.870,48 | Jumlah bulan kurang 0,48 dari total tahunan (selisih kecil, angka bulat mencurigakan) |

Nilai asli yang tertulis di sumber tersimpan di kolom `koreksi`. Satu salah ketik lain **tidak** ada di berkas karena hanya menyangkut total tahunan: luas panen Kota Batu tertulis 51.279,00 padahal jumlah bulannya 512,79 (BRS: 513 ha).

Pola nama: `bps_<provinsi>_<komoditas>_<tingkat>_<periode>_<tahun>.csv`. Akhiran pada tahun: **`s` = angka sementara**, **`p` = angka potensi**. Tanpa akhiran = angka tetap.

## Kolom

Berkas per kab/kota (38 baris, urutan sama dengan publikasi):

- `wilayah`: nama menurut BPS (contoh: `Kota Batu`).
- `jenis`: `kabupaten` atau `kota`.
- `nama_repo`: nama di `src/lib/gee_wilayah.json`, untuk digabungkan (`Kota Batu` menjadi `Batu`; selain itu sama).
- `luas_panen_*_ha`: luas panen padi, hektare.
- `produksi_gkp_*_ton`: gabah kering panen. `produksi_gkg_*_ton`: gabah kering giling. `produksi_beras_*_ton`: beras untuk konsumsi pangan penduduk.
- Pada berkas periode: `jan_sep` atau `okt_des` di tengah nama kolom.

Berkas bulanan: `tahun`, `bulan` (1–12), `status_angka` (`tetap`, `sementara`, `potensi`), lalu `luas_panen_juta_ha`, `produksi_gkp_juta_ton`, `produksi_gkg_juta_ton`, `produksi_beras_juta_ton`. Untuk 2026: bulan 1–8 tetap, bulan 9 sementara, bulan 10–12 potensi.

## Catatan pemakaian

- **Satuan estimasi satelit harus GKG** agar sebanding dengan `produksi_gkg_*`. Untuk neraca stok K2 pakai `produksi_beras_*`.
- **Konversi seragam di semua wilayah:** GKG = 0,8317 × GKP, beras = 0,5774 × GKG.
- Total provinsi tidak dimasukkan sebagai baris. Nilainya: 2025 luas 1.841.346 ha, GKG 10.438.361 ton, beras 6.027.320 ton. 2026s luas 1.854.455 ha, GKP 12.753.568 ton, GKG 10.607.303 ton, beras 6.124.870 ton.
- **Pembanding pra-panen:** kolom `*_okt_des_2026p_*` adalah potensi BPS untuk Okt–Des 2026. Kolom `est` di `gee_wilayah.json` adalah proyeksi panen ±3 bulan dari 30 Okt 2026 (±Nov–Jan), jadi jendelanya tidak persis sama. Bandingkan dengan hati-hati dan catat selisih jendela.
- Potensi Okt–Des 2026 memakai rata-rata produktivitas Subround III 2023–2025, jadi hanya menguji luas panen, bukan produktivitas. Angka final dijadwalkan Februari 2027.
- Produktivitas per kab/kota tidak ada di publikasi. Turunkan dari `produksi_gkg / luas_panen` (ton/ha).
- Seri bulanan dibulatkan BPS ke 2 desimal (juta), jadi jumlah 12 bulan bisa beda ±0,02 dari total tahunan.
- Tabel 1 di BRS Nov 2026 menulis kota tanpa awalan "Kota" (Kediri, Blitar, Malang, ... Batu). Dipetakan menurut urutan ke `Kota ...` dan diverifikasi dengan angka 2025 yang identik dengan BRS Februari.
- Produksi 2025 sebesar 10,44 juta ton GKG. Sebagian berita menyebut 10,53 juta ton (angka sementara lama). Pakai angka di berkas ini.

## Validasi

Dijalankan saat berkas dibuat:

1. Jumlah 38 baris tiap tabel cocok dengan baris "JAWA TIMUR" di publikasi, selisih maksimum 4 ton atau 2 ha (pembulatan di sisi BPS).
2. Per baris: Jan–Sep + Okt–Des sama dengan angka tahunan (selisih maksimum 1).
3. Rasio GKG/GKP konstan (0,8317–0,8318) dan beras/GKG dalam ±1 ton dari 0,5774 di semua baris, jadi tidak ada salah ketik.
4. Data 2025 di BRS Nov 2026 identik dengan BRS Feb 2026 (luas, GKG, beras, 38 wilayah).
5. Jumlah 12 bulan seri provinsi mendekati total tahunan (selisih < 0,06).
6. **Berkas bulanan per kabupaten:** jumlah 12 bulan tiap baris sama dengan total tahunan baris itu (selisih ≤ 0,1) setelah 5 koreksi di atas; jumlah 38 kab/kota per bulan sama dengan baris East Java bulan itu (selisih maksimum 0,02 ha dan 0,08 ton); jumlah tahunan sama dengan BRS Nov 2026 untuk 38 wilayah (selisih 0 ha dan 0 ton). Salinan diketik dari halaman, jadi validasi ini juga menangkap salah ketik salinan.

Berkas diketik dari publikasi, bukan diekspor dari BPS. Tabel resmi untuk cek ulang:
https://jatim.bps.go.id/id/statistics-table/3/WmpaNk1YbGFjR0pOUjBKYWFIQlBSU3MwVHpOVWR6MDkjMw==/luas-panen--produktivitas--dan-produksi-padi-menurut-kabupaten-kota-di-provinsi-jawa-timur.html

## Belum ada

- Angka 2023 dan sebelumnya per kab/kota (ada di Tabel 2 dan 3 rilis 2024, [PDF](https://jatim.bps.go.id/en/pressrelease/2025/03/03/1482/luas-panen-dan-produksi-padi-di-provinsi-jawa-timur-2024--angka-tetap-.html)).
- Realisasi Okt–Des 2026 dan angka final 2026 (dijadwalkan Februari 2027).
- Data ubinan, stok Bulog, dan harga (sumber lain).
