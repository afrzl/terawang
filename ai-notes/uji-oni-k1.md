# Uji ONI sebagai variabel K1 (26 Nov 2026)

**Kesimpulan: ONI tidak memperbaiki K1 secara andal, jadi tidak dipasang.** Pada uji bergulir 2022-2025 (4 tahun, ±1.800 kab-bulan) semua varian ONI yang jujur sama atau lebih buruk daripada model tanpa ONI. Pada uji Jan-Sep 2026 beberapa varian terlihat lebih baik, tetapi perbaikannya tidak muncul di tahun-tahun sebelumnya, jadi kemungkinan besar kebetulan satu tahun (dan hasil terbaik dipilih dari 24 kombinasi per jarak).

Skrip: `scripts/k1/uji_oni.py` (±4 menit, tanpa database). Hasil lengkap: `data/satelit/k1_uji_oni.csv`. Data ONI: `data/iklim/noaa_oni_bulanan.csv` (NOAA CPC, sampai ASO 2026).

## Cara uji

Skema evaluasi sama persis dengan `scripts/k1/uji_k1_ringkas.py` (angka tanpa ONI tereproduksi: 28,8/29,3/31,0% dan 7,6/9,3/8,4%).

Empat cara memasukkan ONI, masing-masing dengan lag 1-6 bulan terhadap bulan target, koefisien dilatih terpisah kota/kab dan hanya dari tahun latih:

| Varian | Bentuk |
|---|---|
| A | gabungan × exp(b · ONI), b dari residual log prediksi leave-one-year-out |
| A3 | seperti A, b terpisah per musim (Jan-Apr, Mei-Agu, Sep-Des) |
| B | komponen keempat di gabungan: rata-rata musiman × ONI |
| B3 | seperti B, terpisah per musim |

**Ketersediaan data.** ONI bulan m adalah rata-rata 3 bulan berpusat di m, baru terbit ±awal bulan m+2. Jadi lag minimum yang jujur adalah 3 bulan (jarak 0), 4 bulan (28 hari) dan 5 bulan (56 hari). Lag lebih kecil memakai informasi yang belum terbit saat prakiraan dibuat; hasilnya hanya dicatat sebagai batas atas, tidak bisa dipakai operasional.

## Hasil (lag jujur terbaik per varian)

Uji bergulir = luas panen bulanan per kab 2022-2025 (WAPE). Uji 2026 = produksi beras Jan-Sep 2026 per kab/kota.

| Jarak | Model | Bergulir WAPE | 2026 WAPE | 2026 MAPE | 2026 MAPE kota |
|---|---|---|---|---|---|
| 0 hari | tanpa ONI | **28,8%** | 7,6% | 13,2% | 27,4% |
| | A lag 3 | 30,0% | 7,6% | 13,1% | 26,8% |
| | A3 lag 3 | 30,9% | 6,3% | 12,8% | 28,6% |
| | B lag 3 | 29,0% | 7,6% | 13,2% | 27,3% |
| | B3 lag 6 | 29,4% | 7,0% | 13,1% | 28,4% |
| 28 hari | tanpa ONI | **29,3%** | 9,3% | 14,3% | 26,8% |
| | A lag 4 | 31,5% | 9,4% | 14,5% | 27,1% |
| | A3 lag 4 | 32,3% | 7,3% | 13,4% | 28,5% |
| | B lag 4-5 | 29,6-29,7% | 8,3-8,5% | 13,9-14,0% | 27,8-28,1% |
| | B3 lag 5 | 29,9% | 7,8% | 13,8% | 29,0% |
| 56 hari | tanpa ONI | **31,0%** | 8,4% | 15,1% | 32,3% |
| | A lag 5 | 35,0% | 9,1% | 15,7% | 33,0% |
| | A3 lag 5 | 34,7% | 7,9% | 15,3% | 34,7% |
| | B lag 5 | 32,2% | 7,9% | 15,0% | 33,7% |
| | B3 lag 5 | 32,3% | 7,6% | 15,0% | 34,4% |

Per tahun uji bergulir (WAPE), termasuk tahun El Niño kuat 2023 dan panen sesudahnya 2024:

| Jarak / model | 2022 | 2023 | 2024 | 2025 |
|---|---|---|---|---|
| 0 hari tanpa ONI | 28,3 | 29,3 | 31,9 | 25,8 |
| 0 hari A3 lag 3 | 28,5 | 31,4 | **38,6** | 25,7 |
| 0 hari B lag 3 | 29,5 | 28,9 | 32,6 | 25,6 |
| 28 hari tanpa ONI | 28,8 | 31,4 | 30,7 | 26,5 |
| 28 hari B lag 4 | 30,0 | 31,1 | 31,1 | 26,6 |
| 28 hari A3 lag 4 | 31,2 | 32,4 | **39,8** | 26,8 |
| 56 hari tanpa ONI | 34,7 | 32,2 | 31,2 | 26,3 |
| 56 hari B3 lag 5 | 39,1 | 32,2 | 32,0 | 26,4 |

## Bacaan

- Varian yang paling "bagus" di 2026 (A3: WAPE 7,6→6,3% dan 9,3→7,3%) justru paling buruk di uji bergulir, terutama 2024 (+7-9 poin). Pola musiman yang dipelajarinya (El Niño menurunkan panen Jan-Apr ±4% per 1°C, menaikkan Sep-Des) tidak stabil antartahun.
- Varian B paling aman (bergulir +0,3 poin di jarak 0-28 hari, +1,2 poin di 56 hari), tetapi perbaikan MAPE 2026-nya kecil (paling banyak 14,3→13,9% pada jarak 28 hari) dan MAPE kota memburuk. Tidak cukup untuk dipasang.
- Lag pendek (1-2 bulan) yang terlihat membantu kota di 2026 tidak tersedia saat prakiraan dibuat.
- Alasan masuk akal kenapa ONI tidak membantu: komponen citra sudah "melihat" dampak iklim (genangan/tanam yang mundur), dan hanya ada 7 tahun latih (2019-2025) dengan 1 episode El Niño kuat, terlalu sedikit untuk mempelajari efek ONI dengan stabil.
- Sejalan dengan K3 (SARIMAX GKP): ONI juga memperburuk di sana.

## Saran

Jangan pasang ONI ke K1 operasional. Ulangi uji ini setelah angka BPS Okt-Des 2026 terbit (±Feb/Mar 2027): periode itu berada di El Niño kuat (ONI ASO 2026 = +2,46), jadi menjadi uji murni yang paling relevan, terutama varian B lag 4-5.
