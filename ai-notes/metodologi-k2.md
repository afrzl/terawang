# Metodologi K2: stok beredar per kabupaten/kota

Skrip: `scripts/k2/k2_operasional.py`. Hasil: `app.estimasi_stok` (jenis_data MODEL) dan `data/satelit/k2_operasional_2026.csv`.

## Model

Neraca stok (kerangka supply-utilization FAO) per kab per bulan, dengan ketidakpastian ala state-space/Kalman.

```
x_t = a·C + Σ_{s≤t} ( P_s − C + masuk − keluar − X_s )
X_t = θ · max(P_t − C, 0)                       (keluar provinsi hanya dari kelebihan panen)
var(x_t) = (0,4·C)² + Σ_{s≤t} [ (0,20·X_s)² + (0,05·C)² + (sd_P·P_s)² ]
```

- Stok non-Bulog. Satuan akhir: cakupan = x_t / C (bulan konsumsi).
- Satu jangkar `a` (bulan konsumsi) dipilih agar cakupan terendah seluruh Jatim (Jan–Nov 2026) = 1,0.
- Tidak ada pengamatan stok acak. Filter Kalman tanpa pengamatan sama dengan neraca deterministik ditambah pita ketidakpastian.
- Status (peluang ≥ 50%): DEFISIT < 0,75 | TIPIS 0,75–1,0 | CUKUP 1,0–1,5 | SURPLUS ≥ 1,5 bulan konsumsi.
- `surplus_ton` = max(cakupan − 1,0, 0)·C; `kebutuhan_ton` = max(1,0 − cakupan, 0)·C.
- Hitung mundur = hari dari 19 Nov 2026 sampai rerata cakupan melewati 0,75 (interpolasi antar akhir bulan).

## Variabel dan status data

| Variabel | Isi | Sumber | Status |
|---|---|---|---|
| P_t Jan–Sep 2026 | Beras bulanan | Pola bulanan K1 diskalakan ke total luas panen BPS Jan–Sep 2026 per kab, × produktivitas BPS | **ASLI (BPS) + MODEL (K1)** |
| P_t Okt–Nov 2026 | Beras bulanan | K1 bulan berjalan × produktivitas BPS Okt–Des 2025 | **MODEL (K1)** |
| P_t Des 2026, Jan 2027 | Beras bulanan | Prakiraan K1 (jarak 4 dan 8 minggu), galat ±30% | **MODEL (prakiraan K1)** |
| C | Konsumsi bulanan | Penduduk proyeksi 2026 × Susenas Maret 2025 (kg/kapita/minggu × 30/7) | **ASLI (BPS)** |
| masuk, keluar | Arus antar kab | Optimasi linear (surplus → defisit, jarak jalan minimum), struktur neraca 2025 | **MODEL** (jarak asli, arus bukan data lapangan) |
| θ | Porsi kelebihan panen yang keluar provinsi | Sisa surplus 2025 setelah arus antar kab ÷ Σ kelebihan bulanan 2025 | **MODEL** (belum ada data arus antar provinsi) |
| a (jangkar) | Stok awal Jan 2026 = a·C; cakupan terendah Jatim = 1,0 bulan | Mengacu survei Cadangan Beras Nasional Juni 2022 (nasional, non-Bulog ±1,0 bulan) | **DUMMY (asumsi)** |
| sd jangkar 0,4; sd keluar 0,20; sd konsumsi 0,05; sd produksi 0,15 / 0,30 | Lebar pita ketidakpastian | Penetapan sendiri; 0,15 dan 0,30 mengacu galat K1 | **DUMMY (asumsi)** |
| Stok Bulog | Penyangga | BPS 2025 hanya tingkat provinsi, **tidak dimasukkan** ke stok per kab | ASLI tapi belum dipakai |

Penanda DB: seluruh keluaran K2 berlabel `MODEL`. Kuantitas yang bersifat asumsi ditandai di tabel ini.

## Yang ASLI dan yang tidak, ringkas

- **Dapat dipercaya:** urutan dan arah antar kab (siapa defisit atau surplus pada neraca), pola musim, dan kebutuhan atau kelebihan relatif.
- **Belum dapat dipercaya:** level absolut stok per kab. Data stok per kab tidak tersedia publik; level hanya bergantung pada satu jangkar nasional 2022.

## Keterbatasan

- Kab yang selalu surplus tiap bulan punya θ = 1, sehingga seluruh kelebihannya dianggap keluar dan stoknya datar di angka jangkar (contoh Tuban, Ngawi, Bondowoso). Perlu data arus nyata untuk membedakan.
- Pita ketidakpastian lebar (sd cakupan rata-rata ±1,6 bulan) karena tanpa pengamatan stok; status per kab adalah peluang, bukan kepastian.
- Model linear-Gaussian. Stok tidak dibatasi negatif (6 dari 494 kab-bulan bernilai negatif, dibaca sebagai kebutuhan pasokan).
- Hubungan stok–harga (nonlinear) belum dimodelkan; uji korelasi harga kita tidak menemukan sinyal.

## Data yang dibutuhkan agar operasional (mengganti DUMMY)

1. Survei stok SCBN tingkat provinsi/kabupaten (mengganti jangkar `a` dengan pengamatan Kalman nyata).
2. Stok Bulog per cabang bulanan beserta pemetaan cabang → kab.
3. Data arus beras antar provinsi dan antar kab (mengganti θ dan hasil optimasi).
4. Realisasi penyaluran (SPHP, bansos) per kab.
5. Keputusan ambang status oleh pengguna (1,0 / 0,75 / 1,5).

Rincian lengkap: `ai-notes/k2-kebutuhan-data.md`.
