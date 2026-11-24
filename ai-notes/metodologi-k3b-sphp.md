# Metodologi K3b: rekomendasi penyaluran SPHP

Skrip: `scripts/k3/k3b_sphp.py` (produksi), `scripts/k3/uji_k3b_strategi.py` (perbandingan). Hasil: `app.rekomendasi_sphp` (model_run 8), `data/satelit/k3b_rekomendasi_sphp.csv`.

## Model
Program linear dua tahap berbasis skenario (stochastic LP, HiGHS). Keputusan: x[i,j,t] ton dari cabang Bulog i ke kab j pada bulan t (Nov 2026, Des 2026, Jan 2027).

```
stok[j,t,s] = A[j,t] + derau[j,t,s] + Σ_{τ≤t} Σ_i x[i,j,τ]          s = 150 skenario
minimalkan  rata-rata_s Σ w[j,t]·kurang + h·lebih  +  λ·ton-km  +  biaya simpan
kurang = max(target − stok, 0);  lebih = max(stok − batas, 0)
target[j,t] = (1 + 0,25·P_HET[j,t]) × konsumsi bulanan;  batas = (1,5 + 0,25·P_HET) × konsumsi;  w = 1 + P_HET
```
- A, derau: rerata dan sd cakupan K2 (faktor bersama 0,4 bulan + derau khas kab, jadi skenario provinsi ikut naik-turun).
- P_HET: peluang harga medium > HET (K3a; Nov = 7 hari, Des-Jan = 28 hari).
- Batas: anggaran rilis total 15% stok Bulog, bulanan 10% (Nov 30% karena sisa 9 hari), per cabang menurut porsi pengadaan 2025.
- Parameter: h = 0,3; λ = 1/2000 per km; biaya simpan 0,02 per ton-bulan.

## Data: asli dan dummy
| Masukan | Status |
|---|---|
| Stok dan sd K2 per kab | MODEL (turunan K2, termasuk jangkar asumsi) |
| Peluang harga > HET (K3a) | MODEL dari harga ASLI |
| Jarak jalan antar kab | MODEL (OSRM publik) |
| Porsi pengadaan cabang Bulog 2025 | ASLI (BPS) |
| Stok Bulog Jatim 2026 | **DUMMY**: proksi akhir Okt 2025 (907 rb ton, ASLI 2025) |
| Anggaran rilis SPHP (15% stok, batas bulanan) | **DUMMY**: asumsi |
| Lokasi cabang → kab; pemetaan kab ke cabang | **DUMMY**: asumsi (tabel `cakupan_cabang_bulog` kosong) |
| Bobot harga (β, γ), h, λ | **DUMMY**: asumsi kebijakan |
Karena itu `rekomendasi_sphp.jenis_data = DUMMY`.

## Hasil uji (skenario simulasi dari K2, 500 skenario uji terpisah)
| Strategi | Ton (rb) | Kekurangan berbobot turun |
|---|---|---|
| Terdekat, kekurangan rerata (greedy) | 72 | 12,3% |
| LP deterministik (rerata) | 72 | 12,3% |
| Rata per konsumsi (tidak ditarget) | 136 | 22,8% |
| **LP stokastik, tonase sama (72)** | 72 | **20,7%** |
| **LP stokastik** | 136 | **30,8-33%** |
- Rencana stabil terhadap benih skenario (korelasi ton per kab 0,91).
- Sensitivitas anggaran (LP stokastik): 3% stok → turun 10%; 15% → 35%; 30% → 57%; 60% → 71% (data `k3b_perbandingan_strategi.csv`).
- Sumber tambahan kab surplus hanya menambah +0,3 poin; tidak dipakai.
- Hasil produksi: 136 rb ton, 46 rute, 23 kab penerima, jarak rata-rata 94 km; Nov 27, Des 91, Jan 18 rb ton. Peluang cakupan < 0,75 bulan turun 29% → 21,5%.

## Keterbatasan
- **Evaluasi melingkar:** skenario uji dibangkitkan dari model K2 yang sama dengan masukan rencana. Ini membuktikan optimasi baik di bawah ketidakpastian K2, bukan bahwa kondisi nyata terbantu. Tidak ada data realisasi SPHP per kab untuk uji luar.
- Tonase dan waktu rilis bergantung anggaran dan stok Bulog yang diasumsikan.
- Ketidakpastian K2 besar (sd ±1,6 bulan), sehingga LP menyebar kiriman ke banyak kab; "ketepatan" (kiriman menutup kekurangan awal) hanya sekitar 54%.
- Rekomendasi tidak memuat kapasitas truk, gudang, atau mekanisme operasi pasar; harga eceran dianggap berubah hanya lewat bobot.
- Tidak ada hubungan kausal stok-harga yang dimodelkan (uji sebelumnya tak menemukan sinyal).
