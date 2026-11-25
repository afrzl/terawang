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
| C | Konsumsi bulanan | Penduduk proyeksi 2026 × (Susenas Maret 2025 rumah tangga, kg/kapita/minggu × 30/7 + di luar rumah tangga 2,80 kg/kapita/bulan sama untuk semua kab; sejak versi 2026.11b) | **ASLI (BPS)**; suku luar rumah tangga = rata-rata nasional BPS 2025, belum angka Jatim |
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

## Uji 25 Nov 2026: konsumsi total (rumah tangga + di luar rumah tangga)

Susenas hanya mengukur konsumsi rumah tangga. Neraca resmi memakai kebutuhan total: Kementan (Buletin Konsumsi Pangan Smt I 2025) 30,98 juta ton nasional 2025 = RT 22,53 + non-RT 8,45 (Survei Bapok 2017), pengali 1,375; BPS *Konsumsi Bahan Pokok Nonrumah Tangga 2025* (rilis 12 Jun 2026) non-RT 9,57 juta ton (jasa makanan ±6,5, industri ±2,7), pengali 1,425 atau ±2,8 kg/kapita/bulan. Angka Jawa Timur belum dibaca (ada di PDF publikasi). Produksi beras BPS sudah bersih susut, jadi susut tidak ditambahkan lagi.

Uji di luar repo (`hitung()` dengan konsumsi diganti, K1 run 12, hari ini 25 Nov 2026). D/T/C/S = jumlah kab DEFISIT/TIPIS/CUKUP/SURPLUS.

| Varian | Konsumsi Jatim (rb ton/bln) | Neraca 2025 (rb ton) | Nov | Des | Jan 2027 | Cakupan rata-rata Nov / Des / Jan |
|---|---|---|---|---|---|---|
| Sekarang (Susenas RT) | 268 | +2.835 | 1/3/14/20 | 5/4/15/14 | 9/4/18/7 | 1,67 / 1,38 / 1,04 |
| x1,375 (Kementan) | 368 | +1.638 | 1/1/18/18 | 6/3/14/15 | 11/6/16/5 | 1,62 / 1,30 / 0,95 |
| x1,425 (BPS non-RT 2025) | 381 | +1.479 | 1/1/19/17 | 4/6/14/14 | 10/7/16/5 | 1,61 / 1,29 / 0,93 |
| RT + 2,8 kg/kap/bln sama rata | 386 | +1.419 | 1/1/19/17 | 5/5/15/13 | 10/7/16/5 | 1,60 / 1,28 / 0,92 |
| RT + non-RT, kota 2x | 386 | +1.419 | 1/1/19/17 | 6/4/14/14 | 10/5/18/5 | 1,60 / 1,28 / 0,93 |

Temuan:
- Status per kab hampir tidak berubah (daftar DEFISIT/TIPIS Des sama; tambah 1: Bondowoso atau Pamekasan). Sebabnya cakupan diukur dalam bulan konsumsi dan θ (keluar provinsi) dikalibrasi dari neraca 2025 yang sama, sehingga kenaikan konsumsi sebagian besar diserap oleh berkurangnya kiriman keluar provinsi.
- Yang berubah besar: surplus Jatim 2025 turun dari 2,8 menjadi ±1,4-1,6 juta ton (kiriman keluar provinsi), stok dalam ton naik ±40%, dan Jan 2027 lebih ketat (defisit 9 → 10-11, cakupan 1,04 → 0,93).
- Status per kab K2 kokoh terhadap asumsi konsumsi; angka ton dan surplus provinsi tidak.

Diterapkan 25 Nov 2026 (versi `k2-neraca-lp-kalman-2026.11b`, varian "RT + 2,8 kg/kap/bln sama rata"): K2 model_run 15 (Nov 1/1/19/17, Des 5/5/15/13, Jan 10/7/16/5), K3b model_run 16 (47 rute, 136 rb ton, 21 kab penerima, 87 km; kekurangan berbobot turun 30,0%; peluang cakupan < 0,75 dari 31,7% ke 23,8%).
Arus perdagangan di dashboard (`src/lib/arus.ts`) memakai konsumsi K2 lewat API (`data.ts` menimpa `k.C`), jadi ikut berubah; simulasi cadangan tanpa API kini juga 6,39 + 2,80 kg/kapita.

## Uji 25 Nov 2026: harga per kab dan asumsi arus

Skrip di luar repo: `scratchpad/kohort/harga_arus.py`, `uji_arus.py` (K1 run 12, konsumsi 11b).

Harga konsumen beras medium SISKAPERBAPO per kab (2022-2026) tidak membawa sinyal arus lokal: sd harga rata-rata 2025 antar kab Rp 305 (±2,5%); harga bayangan LP vs harga ρ = −0,2; surplus/kapita vs harga ≈ 0; korelasi perubahan harga bulanan antar pasangan (sesudah buang gerak provinsi) ≈ 0 di semua jarak; pola musim lumbung = kab defisit. Pasar Jatim terpadu, jadi harga eceran tidak bisa menyetel β gravitasi atau porsi timbun.

Kepekaan status (D/T/C/S; ubah = kab berubah status vs dasar; ρ = korelasi peringkat cakupan):

| Varian | Nov 2026 | Des 2026 | Jan 2027 |
|---|---|---|---|
| Dasar (LP, kirim saat panen) | 1/1/19/17 | 5/5/15/13 | 10/7/16/5 |
| Kolam provinsi (tanpa jarak) | sama persis | sama persis | sama persis |
| Timbun 30-50%, lepas 2-4 bln | ubah 3-6, ρ 0,78-0,86 | ubah 7-9, ρ 0,88-0,93 | ubah 7-10, ρ 0,92-0,98; defisit 11-13 |
| Masuk kab defisit ikut musim kiriman | ubah 14, ρ 0,47 | ubah 19, ρ 0,66 | ubah 5, ρ 1,00 |

Temuan:
- Pemilihan rute tidak memengaruhi status K2 sama sekali: kab defisit selalu menerima sebesar defisitnya dan kab surplus selalu melepas sebesar surplusnya, siapa pun pasangannya. Rute hanya memengaruhi K3b dan halaman arus (rerata jarak 89 km LP vs 166 km kolam).
- Yang berpengaruh adalah waktu: timbun di lumbung menggeser 3-10 kab, daftar rawan beda 2-5 kab, peringkat tetap kuat (ρ ≥ 0,78; Jan ≥ 0,92).
- Masuk ke kab defisit mengikuti musim panen mengubah Nov-Des besar, tapi kurang realistis: pengecer di kab defisit tidak menyimpan berbulan-bulan, simpanan ada di hulu (penggilingan, pedagang di lumbung). Rentang yang relevan: dasar sampai timbun 50%.
- Belum diterapkan.

## Uji 25 Nov 2026: struktur arus dari neraca 12 bulan terakhir (Des 2025-Nov 2026)

Skrip: `scratchpad/kohort/uji_neraca12.py`. Neraca 12 bulan = Des 2025 (BPS) + Jan-Sep 2026 (K1 diskalakan BPS) + Okt-Nov 2026 (K1); konsumsi 2026.

- Struktur hampir sama dengan 2025: 20 surplus / 18 defisit, tidak ada kab berganti peran, 26 dari 28 pasangan sama, arus antar kab 80,9 vs 81,5 rb ton/bln, perubahan kiriman masuk per kab < 700 ton/bln.
- Tetapi status berubah besar: Nov 15 kab (ρ 0,50), Des 25 kab (ρ 0,12; 1/4/33/0), Jan 2027 19 kab (19 defisit).
- Sebab: kalibrasi arus dan θ pada bulan yang sama dengan lintasan stok membuat neraca tiap kab tertutup sendiri (Σ(P − C + masuk − keluar) ≈ 0 sepanjang jendela). Setiap kab kembali ke stok awal di akhir jendela; sebaran cakupan Nov menyempit (sd 0,53 → 0,33) dan status mendekati jangkar. Selisih antar kab yang tersisa hanya pola musim, bukan surplus/defisit tahun berjalan.
- Kesimpulan: jendela yang tumpang tindih dengan periode stok bersifat melingkar. Tidak diterapkan. Pilihan yang konsisten: struktur dari tahun lengkap sebelumnya (2025 untuk 2026; diganti 2026 saat data BPS 2026 lengkap).

## Tampilan arus per bulan di dasbor (25 Nov 2026)

Halaman Arus beras (`src/lib/arus.ts` `tradeFor`) kini menampilkan kiriman dari panen baru per bulan: alokasi tahunan LP tiap rute × porsi kelebihan panen pemasok (Jan-Des 2026, K1) di bulan itu. Total setahun tiap rute = hasil LP; kiriman Jatim Mar ±285, Jul ±170, Nov ±4 rb ton. KPI "Pasokan ke wilayah defisit" tetap 81,5 rb ton/bulan (asumsi neraca K2) dengan rincian dari panen baru dan dari stok tersimpan (selisih; tidak dimodelkan per kab, belum diukur). Neraca stok K2 tidak berubah. K2 run 17 (Dagster) menyimpan `arus_antar_kab`.
Dibatalkan (25 Nov 2026, keputusan pengguna untuk MVP): tampilan per bulan membuat bulan estimasi/paceklik nyaris tanpa arus (Okt-Jan 3-10 rb ton). Dasbor kembali menampilkan alokasi neraca 2025 ÷ 12, sama tiap bulan (81,5 rb ton/bln).
