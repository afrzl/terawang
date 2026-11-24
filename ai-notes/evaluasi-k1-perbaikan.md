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
