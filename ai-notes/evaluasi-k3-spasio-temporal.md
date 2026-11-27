# Uji prediksi harga beras spasio-temporal (K3a), 27 Nov 2026

**Kesimpulan: belum layak dipasang.** Model "AI spasio-temporal" tidak mengalahkan model K3a sekarang pada MAPE. Graf jarak jalan juga tidak menambah apa-apa dibanding versi tanpa graf. Untuk peringatan lewat HET, fitur tetangga hanya sedikit menaikkan PR-AUC (+0,01 s.d. +0,02), dan kenaikan itu tidak signifikan. Operasional tidak diubah.

## Desain uji

- Data: SISKAPERBAPO beras medium harian, 38 kab/kota, 1 Jan 2022 s.d. 17 Nov 2026 (salinan di repo).
- Graf: jarak jalan OSRM (`data/geografi/jarak_kabkota`, dua arah dirata-ratakan), bobot `exp(-jarak/60 km)`.
- Asal uji harian 1 Jan 2025 s.d. 17 Nov 2026 (±25.000 pasangan kab × asal per horizon). Model dilatih ulang tiap bulan, GNN tiap 3 bulan. Data latih hanya memakai target yang sudah terjadi.
- Model yang dibandingkan:
  - **NAIF**: harga hari terakhir. Ini sama dengan titik tengah K3a sekarang, karena median galat EW60 = 0.
  - **RIDGE / GBM**: fitur waktu milik kab sendiri ditambah rata-rata provinsi.
  - **+SP** (opsi 1, lag spasial ala STAR): ditambah harga tetangga terbobot dikurangi harga sendiri, perubahan selisih itu 7 hari, momentum tetangga 7/28 hari, dan porsi tetangga yang naik.
  - **GNN** (opsi 2, gaya Graph WaveNet): konvolusi waktu berdilasi 1/2/4/8 atas 32 hari terakhir, 2 lapis konvolusi graf (A jarak jalan + A adaptif), ansambel 3 benih.
  - **GNN-tanpa-graf**: arsitektur sama tanpa graf, sebagai ablasi.

Skrip: `scripts/k3/uji_spasio_temporal.py` (titik) dan `scripts/k3/uji_spasio_peringatan.py` (peringatan). Hasil: `data/satelit/uji_spasio_temporal_ringkas_medium.csv` dan `data/satelit/uji_spasio_peringatan.csv`.

## 1. Akurasi titik (MAPE %, RMSE relatif naif)

| Model | 7 hr | 14 hr | 21 hr | 28 hr | RMSE/naif 28 hr |
|---|---|---|---|---|---|
| NAIF (= K3a kini) | **0,38** | **0,65** | **0,87** | **1,07** | 1,00 |
| RIDGE | 0,63 | 1,01 | 1,29 | 1,53 | 0,99 |
| RIDGE+SP | 0,64 | 1,02 | 1,30 | 1,53 | 0,99 |
| GBM (median) | 0,38 | 0,65 | 0,87 | 1,07 | 0,98 |
| GBM+SP | 0,38 | 0,65 | 0,88 | 1,07 | 0,98 |
| GNN | 0,42 | 0,72 | 0,96 | 1,17 | 0,95 |
| GNN-tanpa-graf | 0,42 | 0,71 | 0,94 | 1,15 | 0,95 |

Sejak HET Rp13.500 (asal mulai 22 Agu 2025), MAPE naif turun menjadi 0,29/0,48/0,65/0,79 dan urutan modelnya tetap sama.

- **MAPE: naif tidak terkalahkan.** Sekitar 65–86% perubahan harga = 0, sehingga setiap model yang "menggeser" prakiraan justru salah pada mayoritas hari datar. GNN kalah dari naif di 71–88% kasus.
- **RMSE: GNN 2–5% lebih kecil.** Artinya GNN sedikit lebih baik saat harga benar-benar bergerak, tetapi selisihnya kecil.
- **Graf tidak membantu.** GNN dengan graf jarak jalan sedikit lebih buruk daripada tanpa graf. Fitur tetangga di ridge/GBM juga netral. Informasi "harga tetangga" tidak memberi tambahan yang belum ada di rata-rata provinsi.

## 2. Deteksi kenaikan >= 2% dalam h hari (skor = prakiraan perubahan)

Prevalensi kejadian: 3,7% (7 hr), 6,7% (14 hr), 9,5% (21 hr), 12,1% (28 hr). K3a sekarang tidak punya skor per kab untuk kejadian ini (AUC 0,5).

| Model | AUC 7 / 28 hr | PR-AUC 7 / 28 hr |
|---|---|---|
| RIDGE | 0,62 / 0,64 | 0,07 / 0,21 |
| RIDGE+SP | 0,63 / 0,64 | 0,07 / 0,21 |
| GNN | 0,62 / 0,65 | 0,06 / 0,21 |
| GNN-tanpa-graf | **0,67 / 0,70** | **0,10 / 0,26** |

Pada tugas ini model jaringan saraf temporal paling berguna, tetapi versi **tanpa graf**. Daya pembedanya pun masih sedang (AUC 0,7).

## 3. Peringatan lewat HET (beras medium, backtest sama dengan operasional sejak 22 Agu 2025)

| Varian | PR-AUC 7 / 14 / 21 / 28 hr | AUC 28 hr | F1 28 hr |
|---|---|---|---|
| Sekarang (EW60 + logit + Bapanas) | 0,165 / 0,250 / 0,258 / 0,282 | 0,871 | 0,34 |
| + fitur spasial | 0,183 / 0,263 / 0,275 / 0,288 | 0,878 | 0,34 |
| + fitur spasial + prakiraan GNN 28 hr | 0,161 / 0,248 / 0,268 / 0,287 | 0,878 | 0,34 |

Fitur spasial yang ditambahkan: porsi tetangga di atas HET, jarak tetangga ke HET, selisih harga dengan tetangga, momentum tetangga, dan porsi pasar tetangga di atas HET.

- Selisih PR-AUC fitur spasial: +0,019/+0,013/+0,017/+0,007. Selang 95% bootstrap blok 14 hari **memuat nol** di semua horizon, misalnya 28 hr: −0,010 s.d. +0,026.
- Hasilnya peka terhadap lebar pita. Dengan 30 km selisihnya +0,011 s.d. +0,020 (batas bawah hampir nol); dengan 120 km hanya +0,006 s.d. +0,011.
- F1 tidak berubah. Menambah prakiraan GNN tidak menolong. Catatan: fitur GNN hanya tersedia sejak 2025, sehingga data latih 2024 terisi 0.

## Rekomendasi

1. **Prakiraan harga titik: tetap naif.** Klaim "AI spasio-temporal" untuk MAPE tidak didukung data. Model ini hanya menang di RMSE dengan selisih tipis.
2. Bila ingin memakai komponen AI, kandidat paling jujur adalah **skor "peluang naik >= 2%"** dari jaringan temporal (tanpa graf), AUC 0,70 untuk 28 hari. Fungsinya sebagai pelengkap panel harga yang sekarang datar, bukan pengganti.
3. **Fitur spasial untuk peringatan HET: opsional.** Arahnya positif di keempat horizon, tetapi belum signifikan. Layak diuji ulang setelah ada data lebih panjang (episode lewat HET masih ±31 per 15 bulan).

Belum dipasang ke pipeline. Menunggu keputusan user.

## Lanjutan: uji skor "kecenderungan naik" sebagai tampilan (27 Nov 2026 malam)

Skrip `scripts/k3/uji_skor_naik.py`. Kategori untuk tiap tanggal ditentukan tanpa melihat label: **tinggi** = 10% skor teratas, **sedang** = 70–90%, **rendah** = sisanya, diukur terhadap skor 180 hari sebelumnya. Asal uji mulai Mar 2025. Model GNN-tanpa-graf, horizon 28 hari, kejadian naik >= 2%:

| Kuartal | Tinggi | Sedang | Rendah | Prevalensi |
|---|---|---|---|---|
| 2025 Q1 | 26% | 12% | 9% | 12% |
| 2025 Q2 | 32% | 35% | 19% | 24% |
| 2025 Q3 | 39% | 38% | 13% | 22% |
| 2025 Q4 | 35% | 10% | 7% | 8% |
| 2026 Q1 | 14% | 15% | 4% | 7% |
| 2026 Q2 | 11% | 10% | 4% | 5% |
| 2026 Q3 | 3% | 5% | 6% | 6% |
| 2026 Q4 | 0% | 6% | 1% | 2% |

- Secara keseluruhan: tinggi 23%, sedang 20%, rendah 8%. Kategori tinggi + sedang menangkap separuh kejadian naik.
- **Sejak 2026 Q3 urutannya rusak**: wilayah berlabel "tinggi" justru paling jarang naik. AUC 2025 0,69, sedangkan 2026 0,59.
- Ridge (model linear sederhana) hampir setara (tinggi 21% / sedang 15% / rendah 9%), jadi keunggulan jaringan saraf kecil.
- **Kesimpulan: belum layak ditampilkan.** Skor ini berguna saat harga sedang dalam tren naik (2025), tetapi tidak andal pada kondisi sekarang yang harganya lengket di bawah HET. Contoh tampilan untuk data terakhir sengaja tidak dibuat, karena justru periode inilah yang gagal.

## Lanjutan 2: prediksi ARAH harga, bukan level (27 Nov 2026 malam)

Alasan: MAPE memberi nilai bagus pada tebakan "harga tetap" karena harga beras lengket, padahal kebutuhan pengguna adalah arah harga. Skrip `scripts/k3/uji_arah_harga.py`. Kelas: naik (> +1%), tetap, turun (< −1%) dalam h hari. Walk-forward bulanan, asal 2025–Nov 2026. Pembanding **KLIM-EW60** adalah peluang historis gabungan, yang setara dengan model sekarang. Fitur: harga sendiri, provinsi, tetangga, jarak ke HET, dan harga penggilingan Bapanas.

Prevalensi naik: 8/13/17/20% (7/14/21/28 hr), 2026 hanya 4/7/9/11%. Prevalensi turun: 6/9/11/12%.

| h | Model | BSS semua | BSS 2025 | BSS 2026 | AUC naik (2026) | AUC turun (2026) | Akurasi seimbang |
|---|---|---|---|---|---|---|---|
| 7 | LOGIT | **+3,2%** | +3,5% | +2,3% | 0,68 (0,62) | **0,76 (0,78)** | 0,46 |
| 14 | LOGIT | **+3,9%** | +4,9% | +1,4% | 0,67 (0,55) | **0,75 (0,76)** | 0,45 |
| 21 | LOGIT | +3,8% | +5,5% | −0,1% | 0,65 (0,52) | 0,74 (0,74) | 0,45 |
| 28 | LOGIT | +3,6% | +5,6% | −0,9% | 0,63 (0,51) | 0,74 (0,73) | 0,44 |
| semua | GBM | −1 s.d. +1% | | | lebih rendah | setara | 0,43–0,46 |
| semua | KLIM per kab | −0,4 s.d. −8% | | | | | 0,32–0,36 |

- Logit multinomial **lebih baik daripada model sekarang** dalam memberi peluang arah (BSS +3–4%). Akurasi seimbangnya 0,44–0,46, sedangkan tebakan acak 0,33. GBM tidak lebih baik daripada logit.
- **Arah TURUN terdeteksi stabil** (AUC 0,73–0,78), termasuk di 2026.
- **Arah NAIK lemah di 2026** (AUC 0,51–0,62), dan hanya berguna untuk 1–2 pekan. Kenaikan di 2026 jarang dan sebagian tertahan HET.
- Untuk horizon 3–4 pekan di 2026, model tidak lebih baik daripada peluang historis.
- Usulan pemakaian (belum dipasang): tampilkan "peluang naik/tetap/turun 1–2 pekan" per kab dari logit. Peringatan kenaikan tetap memakai model WASPADA (lewat HET), yang AUC-nya 0,87–0,90.
