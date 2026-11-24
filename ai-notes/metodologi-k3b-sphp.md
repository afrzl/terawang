# Metodologi rekomendasi penyaluran SPHP (K3b)

Kode yang memakai hasilnya: `src/lib/k3b.ts` (tabel rute), `src/lib/data.ts` (`FLOWS`), kartu "Rekomendasi SPHP" di `src/pages/Ringkasan.tsx`.

## Status dokumen

Ini **rancangan metodologi**. Tabel `K3B_RUTE` yang ada sekarang berasal dari LP sebelumnya yang skripnya tidak ada di repo ini, dan masih berstatus DUMMY (stok Bulog 2026 dan pemetaan cabang ke kabupaten adalah asumsi). Metodologi di bawah menggantikannya. Belum ada kode yang mengimplementasikannya.

## Masalah pada tabel sekarang

Kebutuhan dan pemasok tidak terhubung dengan status stok K2. Contoh Nov–Des 2026: Kota Malang berstatus harga Siaga dan stok Tipis di dashboard, tetapi tabel K3b menjadikannya pemasok (194,8 ton ke Batu, lalu 7.500 ton ke Mojokerto pada Des). Penyebabnya kebutuhan penerima tidak diambil dari kekurangan cakupan stok, dan cabang tidak diwajibkan mengamankan wilayahnya sendiri lebih dulu.

## Kedudukan

K3b adalah rekomendasi kebijakan: cabang Bulog mana mengirim beras SPHP ke kabupaten mana, berapa ton, pada bulan apa. Beda dengan arus perdagangan (`metodologi-arus-perdagangan.md`), yaitu gerak pasar stok non-Bulog. Keluaran berstatus **rekomendasi model**, bukan keputusan operasional.

## Himpunan dan data

| Simbol | Arti | Sumber | Status |
|---|---|---|---|
| i | cabang Bulog (12 lokasi di tabel lama: Banyuwangi, Bojonegoro, Bondowoso, Jember, Kota Kediri, Kota Madiun, Kota Malang, Kota Probolinggo, Kota Surabaya, Pamekasan, Ponorogo, Tulungagung) | pemetaan cabang ke kabupaten | **DUMMY (asumsi)** |
| j | 38 kabupaten/kota penerima | BPS | asli |
| t | bulan, Nov 2026 sampai Jan 2027 | | |
| C_j | konsumsi beras bulanan (ton) = penduduk × 6,39 kg | Susenas Maret 2025 × penduduk | asli |
| cov_j,t | cakupan stok awal bulan (bulan konsumsi) | K2 | MODEL / simulasi sementara |
| S_i,t | stok Bulog cabang i yang boleh disalurkan | belum ada data | **DUMMY** |
| c_ij | jarak jalan i ke j (km), rata-rata dua arah | OSRM, `jarak_jalan_km_kabkota.csv` | MODEL |

## Kebutuhan

Kabupaten butuh SPHP bila cakupan stoknya di bawah target κ = 1,05 bulan konsumsi (sedikit di atas batas "tipis" 1,0, sebagai ruang aman):

```
d_j,t = max(0, κ − cov_j,t) × C_j
```

Wilayah berstatus harga Siaga mendapat tambahan kebutuhan intervensi pasar (operasi pasar) sebesar 12% konsumsi bulanan:

```
d_j,t = max(d_j,t, 0,12 × C_j)   bila status harga = Siaga
```

Angka κ = 1,05 dan 12% dipakai di versi awal dashboard (`src/lib/data.ts`, bagian SPHP lama); keduanya **asumsi tanpa dasar**, perlu divalidasi dengan Bapanas atau Bulog.

## Model

Pemrograman linear, diselesaikan per bulan berurutan.

Variabel keputusan:
- `x_ij,t ≥ 0`: ton SPHP dari cabang i ke kabupaten j pada bulan t (`x_ii,t` = penyaluran ke kabupaten lokasi cabang sendiri).
- `u_j,t ≥ 0`: kebutuhan yang tidak terpenuhi.

Fungsi tujuan:

```
min  Σ_t Σ_i Σ_j  c_ij · x_ij,t   +   Σ_t Σ_j  π_j · u_j,t
```

Suku pertama meminimalkan ton-kilometer. Suku kedua adalah penalti kekurangan. Bobot `π_j = π₀ · (1 + b_j)` dengan `π₀` lebih besar dari jarak terjauh (supaya kebutuhan selalu dipenuhi selama stok ada, bukan dibiarkan demi menghemat jarak) dan `b_j` lebih besar untuk wilayah defisit atau Siaga (misalnya b = 1 untuk defisit, 0,5 untuk Siaga, 0 selain itu).

Batasan:

```
Σ_j x_ij,t ≤ S_i,t                         stok cabang (i = 1..12)
Σ_i x_ij,t + u_j,t ≥ d_j,t                 kebutuhan terpenuhi atau tercatat sebagai kekurangan
x_ii,t ≥ min(d_i,t , S_i,t)                kabupaten lokasi cabang diamankan lebih dulu
S_i,t+1 = S_i,t − Σ_j x_ij,t               stok bulan berikutnya
x, u ≥ 0
```

Batasan ketiga ini yang mencegah kasus Kota Malang: cabang tidak boleh mengirim keluar sebelum kebutuhan wilayahnya sendiri aman. Konsekuensinya, wilayah rawan yang punya cabang tetap boleh menerima dari cabang lain bila stok lokalnya kurang.

Rute di bawah 20 ton dibuang dan angka dibulatkan ke 10 ton, supaya tabel terbaca.

## Ketidakpastian (stokastik)

Versi awal deterministik di atas. Perluasan stokastik: kebutuhan `d_j,t` dibuat sebagai N skenario (misalnya N = 200) dengan mengacak laju penurunan stok dan prakiraan produksi sesuai selang kepercayaan K1 dan K2. Keputusan `x` dipilih sama untuk semua skenario, sedangkan kekurangan `u^s_j,t` dihitung per skenario, dan tujuannya meminimalkan jarak ditambah rata-rata penalti kekurangan lintas skenario. Dengan begitu rute yang dipilih tetap masuk akal bila stok wilayah ternyata turun lebih cepat dari prakiraan.

## Keluaran dan uji

Keluaran: tabel `bulan, dari, ke, ton, km` (format sama dengan `K3B_RUTE`).

Uji yang harus lolos sebelum tabel dipakai:
1. Tidak ada cabang yang mengirim keluar pada bulan ketika kabupatennya sendiri berstatus defisit atau Siaga dengan kebutuhan belum terpenuhi.
2. Total keluar per cabang tidak melebihi `S_i,t`.
3. Kekurangan `u` dilaporkan terpisah. Bila ada, tampilkan sebagai "kebutuhan melebihi stok cabang" di kartu rekomendasi, bukan disembunyikan.
4. Kartu rekomendasi menampilkan kondisi wilayah (harga dan stok) berdampingan dengan rute, supaya rekomendasi dan statusnya bisa dibaca bersama.

## Parameter dan status

| Bahan | Isi | Status |
|---|---|---|
| Konsumsi per kapita 6,39 kg/bulan | Susenas Maret 2025 | ASLI (BPS) |
| Cakupan stok awal | K2 | MODEL / simulasi |
| Jarak jalan 38 × 38 | OSRM | MODEL |
| Stok Bulog per cabang | belum ada | **DUMMY** |
| Pemetaan cabang ke kabupaten | 12 lokasi | **DUMMY** |
| κ = 1,05 | target cakupan | **asumsi tanpa dasar** |
| 12% konsumsi untuk Siaga | intervensi pasar | **asumsi tanpa dasar** |
| Bobot penalti π₀, b_j | pembobotan prioritas | asumsi teknis |

## Yang dibutuhkan agar tidak dummy

- Stok Bulog aktual per gudang/cabang dan jadwal pengadaan (dari Bulog Divre Jatim).
- Daftar cabang dan wilayah layanannya.
- Kapasitas dan biaya angkut riil, bila jarak saja dianggap kurang.
- Validasi κ dan ambang cakupan 0,75/1/1,5 dengan Bapanas atau Bulog.
