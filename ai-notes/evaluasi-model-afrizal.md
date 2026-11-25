# Evaluasi perbaikan model (branch model-afrizal), 25 Nov 2026

Dasar: branch `k1-perbaikan-model` (PR #7, commit 72a61e1). Rekomendasi yang diuji berasal dari dokumen "Referensi metodologi model TERAWANG". Semua uji memakai data di repo, tanpa database, dan bisa diulang dengan perintah di akhir catatan ini.

Luas panen wall-to-wall sudah diuji (25 Nov sore, proyek GEE baru terawang-515805), lihat bagian K1 kedua di bawah. Peta padi 10 m dan curah hujan CHIRPS belum diuji. Perbaikan yang butuh data baru (titik KSA, ubinan, harga gabah petani, stok SCBN) juga belum.

## Ringkasan

| Kasus | Perbaikan yang diuji | Hasil | Keputusan |
|---|---|---|---|
| K1 | Jeda genangan-panen per kab (84/96/108/120 hari), dipilih dari 2019-2021 | Tidak lebih baik dari 96 hari tetap | **Tidak dipakai.** Opsi `--lags` tetap ada untuk uji |
| K1 | Luas panen wall-to-wall (semua piksel sawah Sentinel-2) ganti 400 titik | Setara, tidak lebih baik | **Tidak dipakai.** Derau sampling ternyata bukan sumber galat utama |
| K1 | Titik sampel ±2.000 per kab (60.203 titik baru) ganti 400 | Setara di jarak 0/28 hari, memburuk di 56 hari | **Tidak dipakai** |
| K2 | Status = anomali neraca 3 bulan terhadap normal musiman (tanpa jangkar) | AUC 0,50-0,52 terhadap kenaikan harga; model sekarang 0,43 | **Belum dipasang.** Lebih jujur, tetapi belum terbukti memprediksi harga |
| K3 | Galat dibobot eksponensial (paruh 60 hari) | Brier 4-11% lebih baik, F1 medium naik di semua horizon, pita lebih dekat 80% | **Dipakai** di `k3_harga_operasional.py` |
| K3 | Sebaran bersyarat momentum / anomali FAO, conformal adaptif | Tambahan kecil atau tidak konsisten | Tidak dipakai |

## K1: jeda tanam-panen per kab

Skrip: `scripts/k1/nowcast_est2.py --lags 7,8,9,10` (taksiran citra untuk 4 jeda sekaligus, satu kali deteksi), lalu `scripts/k1/uji_jeda_per_kab.py`. Jeda per kab dipilih **hanya dari 2019-2021** (WAPE bulanan setelah diskalakan per kab), jadi tidak bocor ke tahun uji.

Pemeriksaan: jeda 8 yang dihitung ulang memberi angka **persis sama** dengan berkas operasional.

| Varian | Bergulir 2022-25 WAPE (jarak 0 / 28 / 56 hari) | Uji Jan-Sep 2026 MAPE (0 / 28 / 56) | MAPE kota 2026 (28 hari) |
|---|---|---|---|
| **96 hari tetap (sekarang)** | **28,8 / 29,3 / 31,0** | 13,2 / **14,3** / 15,1 | 26,8 |
| 84 hari tetap | 31,0 / 32,4 / 33,2 | 12,7 / 14,3 / 14,5 | 26,7 |
| 108 hari tetap | 29,7 / 31,0 / 32,6 | 13,0 / 14,6 / 15,3 | 27,0 |
| 120 hari tetap | 32,6 / 33,7 / 35,4 | 13,1 / 15,7 / 16,2 | 26,2 |
| per kab | 28,7 / 29,2 / 31,0 | 13,1 / 14,8 / 15,2 | 28,2 |
| per kab per musim | 28,9 / 29,4 / 31,8 | 12,9 / 14,3 / 15,0 | 27,1 |

Jeda terpilih per kab (jarak 28 hari): 84 hari 6 kab, 96 hari 22, 108 hari 7, 120 hari 3. Mayoritas tetap 96 hari. Perbedaan per kab paling banyak 0,5 poin dan tidak konsisten antar jarak, jadi **masih derau**.

Kesimpulan: 96 hari tetap sudah tepat untuk data sekarang. Dugaan saat itu: galat bulanan (±29%) berasal dari derau sampling 400 titik. Dugaan ini diuji di bagian berikut dan **ternyata keliru**.

## K1: luas panen wall-to-wall

Skrip: `scripts/gee/genangan_w2w.py` (tarikan GEE, 38 wilayah x 252 jendela 12 hari, Agu 2018 s.d. Nov 2026, ±3,5 jam), `scripts/k1/nowcast_w2w.py` (taksiran luas panen per jarak), `scripts/k1/uji_w2w.py` (uji). Data: `data/satelit/genangan_w2w.csv.gz`.

Cara kerja: aturan genangan sama dengan titik (LSWI + 0,05 >= EVI, EVI <= 0,35, diverifikasi EVI >= 0,5 pada 3-6 jendela sesudahnya, panen = genangan + 96 hari), tetapi dihitung di **semua piksel sawah** (ESA WorldCover kelas 40, 20 m) dengan Sentinel-2 saja. Jendela berawan dikoreksi dengan rasio taksiran fusi / taksiran optik pada titik sampel, per kab per bulan kalender, dari 2019-2021.

Diagnosa citra saja (diskalakan per kab dari 2019-2021, dinilai 2022-2025, jarak 28 hari):

| Taksiran | WAPE kab-bulan | Korelasi dengan BPS | WAPE total Jatim per bulan |
|---|---|---|---|
| 400 titik (sekarang) | 41,7% | 0,855 | 28,6% |
| wall-to-wall, dikoreksi rasio | 41,2% | 0,855 | 28,7% |
| wall-to-wall, optik saja | 41,4% | 0,855 | 28,6% |
| rerata keduanya | 40,8% | 0,860 | 28,6% |

Model gabungan (uji sama dengan bagian sebelumnya):

| Varian | Bergulir 2022-25 WAPE (0 / 28 / 56) | Uji Jan-Sep 2026 MAPE (0 / 28 / 56) | MAPE kota 2026 (28 hari) |
|---|---|---|---|
| **400 titik (sekarang)** | 28,8 / 29,3 / 31,0 | **13,2 / 14,3 / 15,1** | 26,8 |
| wall-to-wall, dikoreksi rasio | 28,3 / 29,1 / 31,2 | 13,8 / 15,2 / 15,5 | 27,6 |
| wall-to-wall, optik saja | 28,2 / 29,2 / 31,3 | 13,1 / 15,1 / 15,7 | 27,1 |
| rerata keduanya | 28,3 / 29,0 / 31,0 | 13,6 / 14,7 / 15,3 | 27,3 |

Taksiran titik dan wall-to-wall sangat mirip: korelasi bulanan 0,98 (median per kab 0,96), selisih kab-bulan ±15%. Jadi derau sampling 400 titik hanya sekitar 15%, sedangkan galat terhadap BPS sekitar 41%. Kalau keduanya independen, menghapus derau sampling hanya menurunkan galat ke sekitar 38%, dan uji di atas menunjukkan perbaikan yang lebih kecil lagi.

Kesimpulan: **wall-to-wall tidak dipakai**. Sisa galat berasal dari hal yang sama pada titik maupun wall-to-wall: aturan genangan dan jeda tetap 96 hari (waktu panen per petak tidak tepat), masker WorldCover yang mencampur tegalan, dan derau angka BPS bulanan sendiri (KSA). Menambah titik juga tidak membantu (bagian berikut). Arah yang lebih menjanjikan: tanggal tanam dari minimum VH per piksel (Manago 2020) dan kalibrasi ke titik KSA, bukan jumlah sampel.

## K1: titik sampel ±2.000 per kab

Skrip: `scripts/gee/tambah_titik.py` (1.600 titik baru per kab dari ESA WorldCover kelas 40, seed 101; 60.203 titik, deret sama dengan titik lama, 252 jendela s.d. 6 Nov 2026), lalu `TERAWANG_TITIK_TAMBAHAN=<folder> nowcast_est2.py --lead L --akhir 2026-12` dan `scripts/k1/uji_folder_est.py`. Berkas titik (±101 MB) disimpan di VPS (`~/.local/share/terawang/titik_tambahan`), tidak di-commit.

| Varian | Citra saja WAPE kab-bulan 2022-25 (0 / 28 / 56) | Bergulir 2022-25 WAPE (0 / 28 / 56) | Uji Jan-Sep 2026 MAPE (0 / 28 / 56) | MAPE kota 2026 (28 hari) |
|---|---|---|---|---|
| **400 titik (sekarang)** | 39,7 / 41,7 / 43,5 | 28,8 / 29,3 / 31,0 | **13,2 / 14,3 / 15,1** | **26,8** |
| ±2.000 titik | 38,8 / 40,7 / 53,3 | 28,4 / 29,4 / 34,7 | 13,8 / 15,8 / 15,5 | 34,5 |

Pemeriksaan:
- Kontrol: 400 titik dihitung ulang dengan kode dan data yang sama memberi angka **identik** dengan berkas operasional, jadi perbedaan berasal dari titik tambahan.
- Kualitas data titik baru sama dengan titik lama: fraksi awan, sebaran VH/LSWI/EVI, laju genangan, keselarasan LSWI-EVI dan VH dalam satu titik, semuanya cocok sampai digit ketiga. Tidak ada salah urut atau geser jendela.
- Di jarak 56 hari, bagian terverifikasi (est_ver) turun 5%, tetapi bagian belum terverifikasi (est_pend, berbobot peluang) naik 62%, terpusat di beberapa bulan (mis. Kediri Mar 2021, Tuban Mar 2021, Bojonegoro Mei 2026). Bagian ini bergantung pada jendela yang diisi model fusi (HistGradientBoosting) di dekat tanggal potong. Model fusi dilatih ulang pada sampel latih yang berbeda (560 ribu sel dari 75 ribu titik), jadi taksiran jarak 56 hari **tidak stabil** terhadap pelatihan ulang fusi. Ini perlu dicatat sebagai kelemahan, bukan diperbaiki dengan menambah titik.

Kesimpulan: menambah titik tidak memperbaiki K1, sejalan dengan hasil wall-to-wall (derau sampling kecil). Tetap 400 titik.

## K2: status sebagai anomali musiman

Skrip: `scripts/k2/uji_k2_anomali.py`, hasil `data/satelit/k2_uji_anomali.csv`.

`A = (produksi beras 3 bulan terakhir - rerata periode yang sama pada tahun lain) / konsumsi bulanan`. Konsumsi dan jangkar stok awal hilang dari perbandingan. Produksi = luas panen BPS bulanan x rasio beras/luas BPS tahunan, 2019-2025.

Validasi: apakah kab dengan anomali paling negatif lebih sering mengalami kenaikan harga beras medium dalam 28 hari berikutnya? (1.824 kab-bulan, 2022-2025)

| Skor | Kejadian | AUC | Peluang naik, 20% kab paling ketat | Peluang naik, sisanya |
|---|---|---|---|---|
| Anomali 3 bulan, 2022-2025 | naik >= 2% | 0,50 | 23,8% | 21,0% |
| Anomali 3 bulan, 2022-2025 | naik >= 1% di atas median Jatim | 0,51 | 29,0% | 26,1% |
| Anomali 3 bulan, 2025 | naik >= 1% di atas median Jatim | 0,52 | 29,3% | 25,5% |
| **Cakupan stok model sekarang, 2025** | naik >= 1% di atas median Jatim | **0,43** | 21,7% | 27,5% |
| Anomali 3 bulan, tingkat provinsi | median Jatim naik >= 2% | 0,59 | (hanya 6 kejadian dari 48 bulan) | |

Hasilnya:
- Status stok sekarang justru **terbalik** (AUC 0,43): kab yang "defisit" lebih jarang mengalami kenaikan harga. Penyebabnya, level stok bergantung pada jangkar dan struktur arus, bukan pada data.
- Status anomali tidak terbalik dan tidak bergantung asumsi jangkar, tetapi hampir tidak punya daya prediksi harga per kab (AUC 0,50-0,52). Ini sesuai literatur: harga antar kab terintegrasi, dan harga baru peka saat stok hampir habis.
- Di tingkat provinsi ada isyarat lemah (AUC 0,59), tetapi kejadiannya terlalu sedikit untuk disimpulkan.

Keputusan: belum dipasang ke `k2_operasional.py`, karena keluarannya dipakai dasbor dan perlu dites dengan database. Usulan: tampilkan anomali sebagai status utama (tidak bergantung asumsi), dan level stok sebagai informasi skenario. Validasi tetap butuh data stok nyata (SCBN/Bulog).

## K3: peringatan dini harga

Skrip uji: `scripts/k3/uji_k3_varian.py`, hasil `data/satelit/k3_uji_varian.csv`. Uji sejak 22 Agu 2025 (HET berlaku), hanya galat yang targetnya sudah terjadi pada tanggal asal.

Yang dipasang: galat dibobot eksponensial dengan paruh waktu 60 hari (`PARUH = 60` di `k3_harga_operasional.py`). Prakiraan titik (median) tidak berubah. Yang berubah adalah peluang melewati HET dan lebar pita.

Beras medium (kab yang masih <= HET):

| Horizon | Brier skill vs sekarang | AUC sekarang -> baru | F1 sekarang -> baru | Cakupan P10-P90 sekarang -> baru (nominal 80%) | Lebar pita |
|---|---|---|---|---|---|
| 7 hari | +3,7% | 0,883 -> 0,897 | 0,137 -> 0,141 | 86,2% -> 85,6% | 0,96% -> 0,72% |
| 14 hari | +5,9% | 0,865 -> 0,877 | 0,165 -> 0,195 | 87,1% -> 84,6% | 2,64% -> 2,14% |
| 21 hari | +6,6% | 0,852 -> 0,857 | 0,183 -> 0,219 | 87,2% -> 85,4% | 3,67% -> 3,21% |
| 28 hari | +6,8% | 0,851 -> 0,849 | 0,215 -> 0,237 | 88,3% -> 85,8% | 4,82% -> 4,00% |

Beras premium: Brier skill +6,4% s.d. +10,8%. AUC tetap rendah (0,56-0,57), karena harga premium sudah di sekitar HET.

MAPE harga titik 0,29% (7 hari) s.d. 0,79% (28 hari), jauh di bawah target 5%. Tidak berubah karena prakiraan titik tetap.

Ambang WASPADA dikalibrasi ulang otomatis oleh skrip (F1 maksimum). Medium: 0,10 / 0,25 / 0,20 / 0,25.

Varian lain:
- Jendela 90/180 hari: Brier mirip EW60, tetapi alarm palsunya lebih banyak di beberapa horizon.
- Bersyarat momentum 14 hari / anomali FAO: Brier skill -1% s.d. +7%, tidak konsisten. Tidak dipakai.
- Conformal adaptif (pita saja): cakupan 84-85% (medium), mirip EW60. Tidak dipakai karena EW60 lebih sederhana.
- Nilai ekonomi relatif (Richardson 2000) pada rasio biaya/rugi 0,1-0,3 **negatif untuk semua varian**. Artinya, dengan kejadian lewat HET yang jarang (2-5%), bertindak berdasarkan peringatan masih lebih mahal daripada tidak bertindak, kecuali kerugian akibat terlambat jauh lebih besar daripada biaya operasi SPHP (rasio < 0,1). Ini perlu ditulis jujur di proposal: K3 berguna sebagai pemantau peluang, bukan pemicu otomatis.

## Cara mengulang

```
python scripts/k1/nowcast_est2.py --lead 28 --akhir 2026-12 --lags 7,8,9,10   # TERAWANG_K1_DIR=<folder>; ±30 menit per jarak
python scripts/k1/uji_jeda_per_kab.py <folder>
python scripts/k2/uji_k2_anomali.py
python scripts/k3/uji_k3_varian.py                                              # ±2 menit
python scripts/gee/genangan_w2w.py --project <proyek GEE> --keluar <folder>       # ±3,5 jam, sudah ada di data/satelit/genangan_w2w.csv.gz
python scripts/k1/nowcast_w2w.py <folder>/genangan_w2w.csv.gz                    # ±10 detik
python scripts/k1/uji_w2w.py <folder>                                            # ±1 menit
```
