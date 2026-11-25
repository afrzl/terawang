# Evaluasi dan perbaikan model K1 (24 Nov 2026)

Evaluasi lengkap: `evaluasi-model-k1.md` di folder proyek. Catatan ini merangkum apa yang **diubah**, apa yang **diuji tetapi tidak dipakai**, dan buktinya. Semua angka dari data di repo dan bisa diulang tanpa database.

## Yang diubah

### 1. Bobot gabungan terpisah untuk kota dan kabupaten (`scripts/k1/k1_prakiraan.py`)
Sebelumnya satu set bobot NNLS dipakai untuk 38 wilayah, sehingga didominasi kabupaten besar. Untuk kota, "tahun lalu" saja jauh lebih baik daripada gabungan.

Uji akhir produksi beras Jan-Sep 2026 per wilayah (model dilatih 2019-2025):

| Jarak | WAPE lama → baru | MAPE lama → baru | MAPE kota lama → baru | MAPE kab |
|---|---|---|---|---|
| 0 hari | 7,6% → 7,6% | 14,9% → **13,2%** | 34,4% → **27,4%** | 8,8% |
| 28 hari | 9,3% → 9,3% | 16,3% → **14,3%** | 35,2% → **26,8%** | 10,4% |
| 56 hari | 8,4% → 8,4% | 16,8% → **15,1%** | 39,7% → **32,3%** | 9,7% |

Uji bergulir 2022-2025 (luas panen bulanan per kab) tidak memburuk: WAPE 28,8% / 29,3% / 31,0% (jarak 0/28/56), sama dengan sebelumnya.

### 2. Tidak ada lagi "citra = 0" diam-diam
- `nowcast_est2.py`: bila jendela citra terakhir belum menjangkau masa tanam bulan target (data citra basi), taksiran sekarang **kosong (NaN) dan dicetak PERINGATAN**, bukan 0.
- `k1_prakiraan.py`: bila taksiran citra bulan target kosong atau tahunnya belum dihitung, wilayah itu memakai **bobot cadangan tanpa citra** (rata-rata musiman + tahun lalu, juga dilatih leave-one-year-out per kelompok) dan muncul `UserWarning`. Sebelumnya komponen citra diisi 0 sehingga prakiraan turun ±40-50%.
  Contoh: Jan 2028 (citra belum ada) → 55.105 ha dengan cadangan, sebanding dengan Jan 2027 yang memakai citra (55.143 ha).

### 3. Tahun tidak di-hardcode
- `k1_prakiraan.prakiraan(tr=None)`: tahun latih bawaan = semua tahun BPS bulanan yang lengkap (`tahun_final`).
- `nowcast_est2.py --akhir-latih`: batas latih fusi dan peluang verifikasi bawaan = 31 Des tahun sebelum citra terakhir (sekarang tetap 2025-12-31, otomatis 2026-12-31 setelah citra 2027 masuk).
- `k2_operasional.py`: `TAHUN_LATIH = None`, `HARI_INI = hari ini` (pipeline tetap mengirim tanggalnya sendiri).

### 4. Pita ketidakpastian empiris (`k1_prakiraan.galat_empiris`, `data/satelit/k1_galat_empiris.csv`)
Sebelumnya konstanta 0,15 (bulan berjalan) dan 0,30 (prakiraan) untuk semua wilayah. Sekarang dari uji bergulir 2022-2025: kuantil P10/P90 log(aktual/prediksi) luas panen bulanan per wilayah, per jarak dan jenis wilayah.

| Jarak | Kabupaten | Kota |
|---|---|---|
| 0 | 0,46 | 0,59 |
| 1 bulan | 0,47 | 0,58 |
| 2 bulan | 0,51 | 0,61 |

- Bulan Jan-Sep 2026 yang sudah diskalakan ke total BPS tetap 0,15 (tinggal galat pola bulanan).
- `sd_prod` di K2 kini per wilayah (Series); format lama (angka) tetap diterima.
- Konsekuensi: pita P10-P90 produksi dan peluang status stok K2 jadi lebih lebar (lebih jujur). Hitung ulang dengan `python scripts/k1/k1_prakiraan.py --galat`.

## Yang diuji tetapi TIDAK dipakai

### a. Membawa level tahun berjalan ke bulan prakiraan
Ide: kalikan prakiraan Okt-Des dengan rasio (BPS Jan-Sep / model Jan-Sep) tahun yang sama. Uji 2021-2025, Okt-Des bulanan per kab: WAPE 26,2% (tanpa) → 27,1% / 28,4% / 32,7% (faktor ditarik 25% / 50% / penuh). **Memperburuk**, jadi tidak dipakai: level Jan-Sep tidak meramalkan Okt-Des.

### b. Potensi BPS Okt-Des 2026 sebagai jangkar
Tidak bisa diuji mundur (tidak ada arsip potensi). Sebagai pembanding: model Okt-Des 2026 se-Jatim 233 ribu ha, potensi BPS 240 ribu ha (selisih −3%; per kab WAPE 11,7%), keduanya jauh di bawah Okt-Des 2025 (279 ribu ha). Model sudah menangkap penurunan secara mandiri, jadi tidak dijadikan jangkar. Bandingkan lagi dengan angka tetap BPS (±Feb/Mar 2027) sebagai uji murni.

### c. Normalisasi VH Sentinel-1A → 1D (`scripts/k1/uji_normalisasi_vh.py`)
Offset VH seluruh titik terhadap klimatologi: ±−0,35 dB Mei-Agu 2026, lalu −0,9 s.d. −1,4 dB Okt-Nov (sebagian kemungkinan genangan tanam yang asli). Fusi dilatih ulang ≤ 2025 dan dinilai pada 77.530 pengamatan optik jernih 2026 yang disembunyikan:

| Varian | EVI R2 | LSWI R2 | Banjir presisi / recall |
|---|---|---|---|
| mentah (sekarang) | 0,148 | 0,710 | 73,4% / 58,7% |
| koreksi per jendela | 0,148 | 0,710 | 74,0% / 56,8% |
| konstan (−0,36 dB sejak Apr 2026) | 0,147 | 0,710 | 73,9% / 56,7% |

Fusi bersandar terutama pada optik tetangga, jadi pergeseran VH hampir tidak berpengaruh. **Tidak diubah.** Catatan: uji ini hanya mencakup 2026 s.d. awal Nov (musim kering); ulangi setelah data Des 2026-Feb 2027 masuk, saat awan 23-36%.

## Belum dikerjakan (butuh data atau GEE)
- Menambah titik sampel 400 → 2.000-4.000 per kab atau hitungan wall-to-wall (derau sampling ±26% per kab-bulan adalah sumber galat bulanan terbesar). Butuh penarikan ulang GEE.
- Fay-Herriot dengan RSE KSA/ubinan.
- Data BPS bulanan 2026 per kab (komponen "tahun lalu" untuk Jan 2027 masih memakai Jan 2025).

## Perbaikan 25 Nov 2026: penggabungan (versi 2026.11c)

Diuji di luar repo dengan kerangka `uji_bergulir` yang sama (tahun uji 2022-2025, luas panen bulanan per kab/kota, WAPE).

### Pembanding: potensi BPS
Jan-Mar 2026 seluruh Jatim, informasi setara rilis BPS 2 Feb 2026 (latih 2019-2024), realisasi 630 rb ha (angka tetap, dibulatkan 10 rb ha per bulan):
potensi BPS +3,1%; K1 2026.11b -21,8% (Jan 80, Feb 127, Mar 285 terhadap 80, 160, 390). Realisasi Jan-Mar per kab tidak diterbitkan terpisah, jadi uji ini hanya tingkat provinsi.
Okt-Des 2026 (realisasi belum ada): total K1 -1,1% dari potensi BPS, selisih per kab 12,1%.

### Diuji, TIDAK dipakai: kernel kohort (sebaran jeda tanam-panen dipelajari)
Sebaran jeda dari 2019-2021: 72 hari 11%, 84 hari 15%, 96 hari 39%, 108 hari 36% (rata-rata 96 hari, sama dengan asumsi lama).
WAPE gabungan 28,8/29,3/31,0% (lama) menjadi 29,1/29,9/31,1% (jarak 0/28/56); Jan-Mar 2026 -21,3%. Waktu panen bukan sumber galat utama.

### Diagnosis
Komponen Jan-Mar 2026 (rb ha): citra 112/170/302, rata-rata musiman 52/98/319, tahun lalu (2024) 47/53/228, realisasi 80/160/390.
Februari: citra sudah tepat tetapi gabungan berbobot tetap menariknya turun; "tahun lalu" memakai 2024 yang menyimpang. Maret: semua komponen kurang (besaran puncak).

### Diubah (`scripts/k1/k1_prakiraan.py`)
1. Bobot NNLS per musim (Jan-Apr, Mei-Agu, Sep-Des), tetap terpisah kota dan kabupaten.
2. Komponen "musiman" = rata-rata 3 tahun final terakhir, bukan satu tahun.

| Varian | Jarak 0 | 28 hari | 56 hari | Puncak Feb-Apr | Jan-Mar 2026 |
|---|---|---|---|---|---|
| Lama | 28,8% | 29,3% | 31,0% | 30,9% | -21,8% |
| Bobot per musim | 28,3% | 28,7% | 30,7% | 31,4% | -15,9% |
| Rata-rata 3 tahun | 28,4% | 29,0% | 30,3% | 29,6% | -18,2% |
| **Keduanya (dipakai)** | **27,8%** | **28,3%** | **29,9%** | **29,8%** | **-13,5%** |

Kota tidak membaik (57-60%). Masih jauh dari potensi BPS di puncak Maret (305 terhadap 390 rb ha).
Pita galat `data/satelit/k1_galat_empiris.csv` BELUM dihitung ulang untuk versi ini (`python scripts/k1/k1_prakiraan.py --galat`).

### Berikutnya
Memakai potensi BPS sebagai masukan begitu terbit (provinsi +3,1%), citra untuk memecah per kab dan per bulan; kalibrasi besaran citra per musim.

## Uji 25 Nov 2026: kalibrasi besaran citra per musim/bulan (TIDAK dipakai)

Koefisien citra per kab (sekarang satu angka sepanjang tahun) dikalikan faktor koreksi yang dipelajari dari angka tetap BPS tahun latih, ditarik ke 1 sebanding volume. Uji bergulir yang sama (2022-2025).

| Varian | Jarak 0 | Kota | Feb-Apr | 28 hari | 56 hari | Jan-Mar 2026 |
|---|---|---|---|---|---|---|
| 11c (sekarang) | 27,8% | 57,1% | 29,8% | 28,3% | 29,9% | -13,5% |
| per bulan se-Jatim | 27,8% | 56,6% | 29,4% | 28,2% | 30,2% | -18,9% |
| per kab x musim | 27,6% | 57,0% | 29,3% | 28,0% | 29,5% | -13,6% |
| per kab x bulan | 28,0% | 56,9% | 29,2% | 29,0% | 30,5% | -20,6% |

Perbaikan paling banyak 0,4 poin, dan kalibrasi per bulan memperburuk Jan-Mar 2026. Penyebabnya, rasio BPS/citra se-Jatim (jarak 0):
- setahun 1,61-1,94 (sd/rata-rata 0,06), Feb-Apr 1,68-2,36 (0,12): **besaran citra stabil**;
- Maret saja 1,45-3,45 (0,32): yang tidak stabil adalah **pembagian antarbulan**. Porsi Maret dalam Feb-Apr menurut BPS 0,32-0,53, menurut citra 0,24-0,61, dan tidak searah tiap tahun (2023: BPS 0,49, citra 0,31).

Kesimpulan: galat puncak berasal dari penempatan bulan panen, bukan besaran, dan pergeserannya berbeda tiap tahun sehingga faktor tetap tidak bisa mengoreksinya. Koefisien per kab yang ada sudah cukup untuk besaran. Skrip uji: di luar repo (scratchpad `kohort/kalibrasi.py`).

## Ringkasan akurasi versi 2026.11c (uji bergulir, angka tetap BPS)

Luas panen, batas informasi nyata (citra sampai tanggal potong; BPS tahun lalu dianggap rilis 1 Maret).

| Ukuran | Jarak 0 | 28 hari | 56 hari |
|---|---|---|---|
| Per kab, bulanan | 27,8% | 28,3% | 29,9% |
| Per kab, triwulan kalender | 15,7% | 16,2% | 17,3% |
| Jatim, bulanan | 15,7% | 16,0% | 16,3% |
| Jatim, triwulan kalender | 9,2% | 9,4% | 10,2% |
| Jatim, tahunan | 3,6% | 2,2% | 3,7% |

**Prakiraan 3 bulan ke depan** (terbit awal bulan M: M jarak 0 + M+1 jarak 28 + M+2 jarak 56), 56 penerbitan 2021-2025:
per kab/kota **13,9%** (kab 13,8%, kota 32,0%), seluruh Jatim **6,7%**. Uji 18 Nov (versi awal): 14,2% / 8,0%. Ini angka utama untuk dilaporkan; WAPE bulanan lebih besar karena panen yang bergeser ke bulan sebelah dihitung meleset.

## Arah perbaikan berikutnya: fase tanaman dari label KSA

Galat yang tersisa terutama soal waktu (bulan jatuhnya panen), bukan besaran. Aturan ambang (genangan LSWI/EVI + jeda tetap 96 hari) tidak bisa menangkap pergeseran waktu yang berbeda tiap tahun.

Usulan: ganti aturan ambang dengan **klasifikasi fase tanaman terawasi**, dilatih dengan pengamatan Survei KSA BPS sebagai label.
- Label: fase per subsegmen KSA per bulan (persiapan lahan, vegetatif awal, vegetatif akhir, generatif, panen, puso, bukan padi), dengan koordinat.
- Fitur: deret Sentinel-1 VH/VV dan Sentinel-2 EVI/LSWI di sekitar tanggal amatan (beberapa jendela ke belakang).
- Model: gradient boosting atau model deret waktu kecil; uji dengan memisahkan segmen (bukan acak per baris) dan memisahkan tahun.
- Keluaran: fase per titik per 12 hari, lalu prakiraan panen dari umur fase (generatif hari ini = panen 1-2 bulan lagi), jadi jeda tanam-panen tidak lagi tetap.
- Keuntungan: definisi panen sama dengan BPS (luas panen BPS dihitung dari KSA), dan bisa wall-to-wall, bukan 400 titik.
- Kebutuhan: mikrodata KSA (koordinat subsegmen dan kode fase bulanan) dari BPS. Tidak publik; perlu permintaan data resmi.

## Uji 25 Nov 2026: jangkar puncak EVI (akhir vegetatif) tanpa label (TIDAK dipakai)

Ide: perbedaan umur varietas ada di fase vegetatif, jadi jarak puncak EVI ke panen seharusnya lebih stabil daripada jarak genangan ke panen. Per titik: bila puncak EVI sudah terlihat sebelum tanggal potong (argmax EVI pada genangan +3..+9 jendela, EVI >= 0,5, dan sesudahnya turun >= 0,05), panen = puncak + jeda; bila belum, tetap genangan + 96 hari. Uji bergulir yang sama.

| Varian | Bulanan 0 / 28 / 56 | 3 bulan kab / Jatim | Feb-Apr | Jan-Mar 2026 |
|---|---|---|---|---|
| 11c (genangan + 96 hari) | 27,8 / 28,3 / 29,9 | 13,9 / 6,7 | 29,8 | -13,5% |
| puncak + 24 hari | 30,1 / 28,0 / 29,9 | 14,1 / 7,5 | 32,1 | -14,0% |
| puncak + 36 hari | 29,8 / 28,3 / 29,9 | 14,3 / 7,6 | 33,1 | -15,9% |
| puncak + 48 hari | 29,1 / 29,4 / 29,9 | 14,9 / 8,2 | 32,8 | -15,3% |
| puncak, jeda dipelajari (48 hari) | 28,7 / 29,2 / 29,9 | 14,3 / 7,5 | 31,5 | -13,9% |
| idem, puncak wajib dari citra jernih | 28,6 / 29,1 / 29,9 | 14,2 / 7,3 | 31,1 | -13,4% |

Semua varian lebih buruk atau sama. Catatan:
- Puncak hanya sempat terlihat untuk 40% taksiran jarak 0, 2% jarak 28, 0% jarak 56: puncak terjadi ±1,5 bulan sebelum panen, jadi jangkar ini hanya bisa menolong bulan berjalan.
- Puncak EVI berupa dataran (beberapa jendela hampir sama), sehingga posisinya bergeser ±1-2 jendela (12-24 hari) karena derau; awal genangan adalah kejadian tajam. Mensyaratkan puncak dari citra jernih (bukan tebakan fusi) tidak mengubah hasil, jadi masalahnya bukan awan.
- Kesimpulan: tanpa label lapangan, genangan tetap penanda fase terbaik. Penentuan fase berikutnya menunggu label KSA. Skrip: scratchpad `kohort/fitur_puncak.py`, `banding_puncak.py`.

## Uji 25 Nov 2026: sumber peta sawah (TIDAK diubah)

**Luas sawah resmi per kab (LBS) menggantikan WorldCover:** tidak diuji karena secara matematis hampir tanpa efek. Luas sawah hanya pengali skala per kab, dan koefisien kalibrasi per kab (Σ BPS / Σ citra) membatalkan skala itu; yang tersisa hanya efek kecil dari penarikan koefisien ke rata-rata Jatim. (LBS Jatim total 1.206.475 ha menurut ATR/BPN; tabel per kab Kementan 2015-2019 belum diunduh.)

**Masker padi dari riwayat citra:** skor titik = siklus padi terverifikasi per tahun (aturan genangan, deret terisi fusi, 2019-2025, tanpa label BPS). Median 0,57 siklus/tahun; 31% titik < 0,25 (praktis tidak pernah tanam padi: tebu, tegalan, kebun), 46% < 0,5. Titik di bawah ambang dibuang.

| Ambang (siklus/thn) | Titik dibuang | Bulanan 0 / 28 / 56 | 3 bulan kab | kota | Jatim | Jan-Mar 2026 |
|---|---|---|---|---|---|---|
| 0 (sekarang) | 0% | 27,8 / 28,3 / 29,9 | 13,9 | 32,0 | 6,7 | -13,5% |
| 0,25 | 31% | 27,6 / 28,1 / 29,7 | 13,8 | 30,6 | 6,6 | -13,8% |
| 0,5 | 46% | 27,4 / 28,1 / 29,7 | 13,8 | 30,6 | 6,5 | -13,3% |
| 0,75 | 56% | 27,8 / 28,6 / 29,9 | 14,1 | 31,2 | 6,8 | -13,2% |
| 1,0 | 61% | 28,2 / 28,9 / 30,1 | 14,4 | 31,5 | 7,1 | -13,5% |

Perbaikan paling banyak 0,4 poin (kota 1,4 poin). Titik bukan padi hampir tidak pernah memicu genangan terverifikasi, jadi kontribusinya memang sudah mendekati nol. Catatan: skor memakai citra 2019-2025 yang mencakup tahun uji (tanpa label, tetapi sedikit bocor), jadi angka di atas sedikit optimistis. Tidak diterapkan sekarang; layak dipasang saat titik sampel ditarik ulang (RTL: sebar titik sebanding luas sawah, hanya di titik padi). Skrip: scratchpad `kohort/masker_padi.py`, `banding_masker.py`.
