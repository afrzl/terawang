# Evaluasi perbaikan model (branch model-afrizal), 25 Nov 2026

Dasar: branch `k1-perbaikan-model` (PR #7, commit 72a61e1). Rekomendasi yang diuji berasal dari dokumen "Referensi metodologi model TERAWANG". Semua uji memakai data di repo, tanpa database, dan bisa diulang dengan perintah di akhir catatan ini.

Perbaikan yang butuh GEE (peta padi 10 m, luas wall-to-wall, curah hujan CHIRPS) belum diuji karena kuota GEE habis. Perbaikan yang butuh data baru (titik KSA, ubinan, harga gabah petani, stok SCBN) juga belum.

## Ringkasan

| Kasus | Perbaikan yang diuji | Hasil | Keputusan |
|---|---|---|---|
| K1 | Jeda genangan-panen per kab (84/96/108/120 hari), dipilih dari 2019-2021 | Tidak lebih baik dari 96 hari tetap | **Tidak dipakai.** Opsi `--lags` tetap ada untuk uji |
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

Kesimpulan: 96 hari tetap sudah tepat untuk data sekarang. Galat bulanan (±29%) memang berasal dari derau sampling 400 titik, bukan dari jeda. Prioritas K1 berikutnya tetap luas panen wall-to-wall + masker padi, yang butuh GEE.

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
```
