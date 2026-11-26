# K3 · SARIMAX harga GKP petani Jawa Timur (bulanan)

Skrip: `scripts/k3/sarimax_gkp.py` (butuh `statsmodels`). Hasil: `data/satelit/k3_sarimax_gkp_{uji,ringkas,koef,info}.csv`.

## Data

| Variabel | Bentuk | Sumber |
|---|---|---|
| Harga GKP petani Jatim | log, bulan t | BPS 2016–2021, 2023–2024 (`data/bps/harga_gabah/`); 2022 kosong (NaN, ditangani Kalman); Jan 2025–Okt 2026 = rata-rata panel Bapanas 38 kab/kota × rasio BPS/Bapanas 2024 (1,0005; r = 0,96) |
| HPP GKP petani | log HPP resmi yang berlaku tgl 15 bulan t | `data/kebijakan/hpp_gkp_petani.csv` (jenis = hpp) |
| Luas panen provinsi | log, bulan t (uji: angka aktual BPS) | jumlah kab/kota 2019–2025, BRS provinsi 2026 |
| Hujan | anomali log hujan CHIRPS provinsi, jumlah t-6..t-4 | `data/iklim/chirps_jatim_bulanan.csv` |
| ENSO | ONI musim berpusat di t-5 | `data/iklim/noaa_oni_bulanan.csv` |

Sampel bersama Jan 2019–Okt 2026 (dibatasi luas panen). Orde dipilih dengan AIC pada data pra-uji (2019–Jan 2023), tanpa eksogen: **SARIMA(0,1,0)(1,0,0)12**, dipakai sama untuk semua varian.

## Uji mundur

Origin bergulir Jan 2023–Sep 2026 (jendela mengembang), horizon 1–3 bulan, 43–45 prakiraan per horizon.

| Model | MAPE h1 | h2 | h3 | RMSE/naif h1 | h2 | h3 |
|---|---|---|---|---|---|---|
| naif | 3,56 | 5,46 | 6,42 | 1,00 | 1,00 | 1,00 |
| naif musiman | 5,58 | 8,06 | 8,73 | 1,41 | 1,35 | 1,31 |
| SARIMA | 3,58 | 5,33 | 6,19 | 1,00 | 0,96 | 0,93 |
| + HPP | 3,67 | 5,32 | 6,37 | 0,99 | 0,93 | 0,93 |
| **+ HPP + luas panen** | **3,29** | **5,04** | **5,98** | **0,83** | **0,79** | **0,81** |
| + HPP + luas + iklim | 3,44 | 5,29 | 6,31 | 0,86 | 0,84 | 0,88 |
| + HPP + iklim | 3,79 | 5,56 | 6,39 | 1,01 | 0,98 | 1,00 |
| + HPP + luas + ONI | 3,36 | 5,18 | 6,23 | 0,85 | 0,83 | 0,87 |
| + HPP + ONI | 3,76 | 5,45 | 6,39 | 1,01 | 0,97 | 0,98 |
| ONI saja | 3,69 | 5,51 | 6,36 | 1,02 | 0,99 | 0,97 |
| + HPP + luas lag 12 (operasional, tanpa angka aktual) | 3,98 | 6,26 | 7,01 | 1,09 | 1,06 | 0,99 |
| + HPP + luas lag 12 + ONI | 4,05 | 6,22 | 6,99 | 1,12 | 1,11 | 1,04 |

ONI memakai lag 5 (sudah terbit saat prakiraan dibuat). Luas lag 12 = luas panen bulan yang sama tahun lalu, sampel mulai 2020-01.
MAPE per periode (`k3_sarimax_gkp_mape_periode.csv`): 2023–2024 HPP + luas terbaik (4,5 / 7,1 / 8,2 vs naif 5,4 / 8,3 / 9,6); 2025–2026 naif terbaik (1,7 / 2,6 / 3,4).

Koefisien (seluruh sampel, model HPP + luas): elastisitas HPP 0,29 (p = 0,03); luas panen −0,067 (p < 0,001; luas panen naik 10% → harga turun ±0,7%). Hujan (p = 0,58) dan ONI (p = 0,92) tidak nyata dan memperburuk uji.

## Kesimpulan dan catatan

- Pakai **SARIMAX dengan HPP + luas panen** (tiga variabel seperti usulan). Iklim belum layak dimasukkan.
- Keunggulan luas panen memakai **angka aktual BPS** (oracle). Operasional perlu prakiraan luas panen (K1 satelit / angka potensi BPS); galatnya akan mengurangi keunggulan ini.
- Pita P10–P90 mencakup 77–82% (nominal 80%), cukup terkalibrasi.
- 2025–2026 memakai Bapanas, bukan BPS; perlu diganti saat publikasi BPS 2025 terbit. 2022 belum terisi.
- ONI (lag 5) tidak nyata (p = 0,79) dan tidak memperbaiki HPP + luas pada uji Jan 2023–Sep 2026; berbeda dengan uji 2021–2026 di sisi cloud (ERA5, ONI memperbaiki 5–10%). Perbedaan sampel uji (2021–2022 memuat El Niño 2023 sebagai target sesudahnya) dan lag ONI kemungkinan penyebabnya.
- Luas panen lag 12 kalah dari naif: keunggulan HPP + luas sepenuhnya bergantung pada prakiraan luas panen bulan target (angka potensi BPS / K1).
- Iklim diuji dengan satu spesifikasi lag (hujan t-6..t-4, ONI t-5); spesifikasi lain belum dicoba.
