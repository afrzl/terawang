# Metodologi arus perdagangan antarwilayah (estimasi)

Kode: `src/lib/arus.ts` (fungsi `buildTrade`), jarak di `src/lib/jarak.ts` dan `src/lib/data.ts` (`dist`). Tampil di halaman Arus beras dan di Peta Ringkasan (pilihan "Perdagangan antarwilayah").

## Kedudukan

Arus perdagangan **bukan komponen tersendiri** (komponen kita: K1 produksi, K2 stok, K3a peringatan dini harga, K3b SPHP). Ia adalah langkah di dalam K2: suku "masuk dan keluar" pada neraca stok. Seluruh keluarannya berstatus **estimasi model**, bukan data lapangan. Tidak ada data aliran beras per kabupaten yang tersedia untuk menguji atau mengkalibrasinya.

Beda dengan penyaluran SPHP (K3b): SPHP adalah rekomendasi kebijakan dari cabang Bulog ke kabupaten rawan; perdagangan adalah gerak pasar stok non-Bulog.

## Model

Gravitasi berkendala tujuan, per bulan:

```
surplus_i,t  = produksi beras_i,t − konsumsi_i      (i surplus, bulan t)
kebutuhan_j,t = (konsumsi_j − produksi beras_j,t) × 0,92   (j defisit)
bobot_ij   = surplus_i / max(jarak_ij, 12 km)^γ
arus_ij    = kebutuhan_j × bobot_ij / Σ_i bobot_ij
```

- Kebutuhan tiap wilayah defisit dipenuhi penuh oleh wilayah surplus, dibagi menurut surplus asal dan hambatan jarak.
- Pasokan tidak dikunci sebagai kendala. Total surplus (±434 rb ton/bulan di simulasi) jauh melebihi total kebutuhan (±22 rb ton), jadi jarak yang menentukan siapa yang mengirim.
- Jalur di bawah 40 ton dibuang; angka dibulatkan ke 10 ton.
- Jarak = jarak jalan antar titik pusat wilayah (rata-rata dua arah).

## Parameter dan status

| Bahan | Isi | Status |
|---|---|---|
| Produksi beras bulanan | K1 (di dashboard: simulasi, pola bulanan yang sama dengan halaman Stok) | MODEL / dummy sementara |
| Konsumsi bulanan | penduduk × Susenas Maret 2025 | ASLI (BPS) |
| Jarak jalan 38 × 38 | OSRM (OpenStreetMap, profil mobil), diambil 17 Nov 2026; `data/geografi/jarak_kabkota/jarak_jalan_km_kabkota.csv` di branch `danang-dev` | MODEL (layanan routing, titik pusat wilayah, bukan gudang atau pasar) |
| γ (eksponen jarak) = 5,0 | dikalibrasi, lihat bawah | MODEL (satu target) |
| Faktor 0,92 | porsi kebutuhan yang dipenuhi dari luar wilayah; sisanya dianggap tertutup stok sendiri | **DUMMY (asumsi tanpa dasar)** |
| Batas jarak minimum 12 km | mencegah bobot tak terhingga untuk titik yang berdekatan | asumsi teknis |

## Kalibrasi γ

Target: jarak tempuh rata-rata tertimbang volume **46 km**, hasil LP jarak jalan pada neraca K2 v1 (`progress.md`, 19 Nov 2026: arus antar kab 423 rb ton per tahun, pemasok terbesar Gresik 125, Mojokerto 95, Lamongan 69, Blitar 49 rb ton).

Model dihitung per bulan (13 bulan, Jan 2026–Jan 2027) dengan neraca yang sama dengan halaman Stok. γ dipilih agar **rata-rata 13 bulan** jarak tempuh mendekati target, karena target berasal dari neraca tahunan.

| γ | 3,0 | 3,5 | 4,0 | 4,5 | **5,0** | 5,5 | 6,0 | 7,0 |
|---|---|---|---|---|---|---|---|---|
| Rata-rata 13 bulan (km) | 78 | 66 | 57 | 50 | **46** | 43 | 40 | 37 |
| Okt 2026 (km) | 75 | 61 | 52 | 46 | 42 | 39 | 37 | 35 |
| Nov 2026 (km) | 80 | 66 | 56 | 49 | 45 | 41 | 39 | 36 |

Dipilih γ = 5,0 (46 km rata-rata 13 bulan). Pemasok terbesarnya diharapkan Gresik, Lamongan, Mojokerto, mendekati urutan K2 v1.

Catatan kalibrasi:
- Target 46 km adalah keluaran model kita sendiri (LP yang meminimalkan jarak, cenderung pendek), bukan pengamatan.
- Target berasal dari neraca tahunan 2025; model ini memakai produksi satu bulan. Jarak rata-rata tidak terlalu bergantung pada skala, tapi ini tetap pendekatan.
- Kalibrasi bergeser tiap kali masukan berubah: dengan jarak garis lurus dikali 1,3 dan neraca Oktober lama, γ yang cocok 3,4; dengan jarak jalan 3,0; dengan neraca bulanan yang disamakan dengan halaman Stok 5,0. Artinya γ bergantung pada skala simulasi produksi, dan harus dikalibrasi ulang saat data K1 asli masuk.
- Sebelum dikalibrasi, γ = 1,6 tidak punya dasar apa pun (angka bawaan simulasi awal).

## Yang sudah dicoba dan ditolak

**Gravitasi berkendala ganda (IPF).** Kiriman tiap asal dikunci sebesar bagian proporsionalnya dari surplus. Hasilnya jarak rata-rata 126 km dan lintas kawasan 72%, **tidak bergantung pada γ** (γ 1,6 → 2,5 → 3,2: 126 → 123 → 121 km), muncul jalur 272 km (Banyuwangi → Kota Surabaya). Penyebabnya total surplus jauh melebihi total kebutuhan: setiap kabupaten surplus dipaksa mengirim, jarak tak lagi menentukan. Dikembalikan ke kendala tujuan.

## Landasan literatur

- **Gravitasi dan entropi** untuk estimasi aliran antarwilayah tanpa data aliran: estimator berbasis entropi lebih akurat saat total baris atau kolom mengandung galat (Economic Systems Research 2026, vol. 38 no. 2); gravitasi berkendala ganda dengan RAS (Cai 2021, JRC); model radiasi tanpa koefisien regresi (Economic Systems Research 2025, vol. 37 no. 2).
- **Keseimbangan harga spasial** (Samuelson 1952; Takayama dan Judge): perdagangan terjadi selama selisih harga ≥ biaya angkut. Belum dipakai; data harga SISKAPERBAPO per kabupaten tersedia untuk uji arah.
- Pencarian literatur tidak menemukan studi estimasi aliran beras Indonesia per kabupaten.

## Konteks BPS (asli)

*Distribusi Perdagangan Komoditas Beras Indonesia 2025* (BPS, no. publikasi 06100.25053, survei Jan–Jun 2025, 38 provinsi, 390 kabupaten/kota), hlm. 90–92, Provinsi Jawa Timur:

- Distribusi produsen ke konsumen akhir melibatkan 6 jenis pedagang perantara.
- Pola utama: 3 rantai dengan 2 perantara; **MPP total 21,78%** (grosir 8,91%, eceran 11,82%).
- Pola terpanjang (4 perantara) MPPT 35,74%; terpendek (1 perantara, agen) 4,24%.
- Jawa Timur **membeli beras dari 1 provinsi (Jawa Tengah)** dan **menjual ke 23 provinsi lain**.
- Produksi beras Jawa Timur 2025 surplus terhadap konsumsi (sumber Bapanas).

Yang **tidak** ada di publikasi: volume per provinsi tujuan, aliran antar kabupaten, jarak rata-rata pengiriman, biaya angkut terpisah dari margin dagang. Karena itu γ dan faktor 0,92 tidak dapat dikalibrasi dari sumber ini. Edisi 2024 (15,86 MB) belum dibaca.

## Keterbatasan

- Tidak ada pembanding aliran nyata; galat model tidak diketahui. Baca sebagai arah dan perkiraan, bukan realisasi.
- Hanya meminimalkan jarak dan menimbang surplus. Perdagangan nyata mengalir ke pusat konsumsi besar (Surabaya, Malang) lewat pedagang besar, dan sebagian keluar provinsi; keluar provinsi tidak dimodelkan di sini (di K2 diwakili θ).
- Titik pusat wilayah, bukan lokasi gudang atau pasar. Pasangan kota dan kabupaten kembar berjarak dekat.
- Tidak ada hubungan arus ke harga yang dimodelkan. Uji korelasi stok-harga (K2, K3) tidak menemukan sinyal; klaim "ongkos angkut menaikkan harga" tidak boleh dipakai.
- Tidak dibedakan beras medium dan premium: data konsumsi, produksi, dan stok tidak memisahkannya. Pemisahan hanya ada pada harga (K3a).

## Yang dibutuhkan agar operasional

1. Data aliran beras antar kabupaten dan antar provinsi (Bulog, Dinas Pangan, pedagang besar) untuk kalibrasi γ dan pengujian galat.
2. Keluaran K2 operasional yang menyimpan jalur asal–tujuan per bulan (bukan hanya total masuk dan keluar per kabupaten), supaya jalur di dashboard berasal dari K2 sungguhan.
3. Dasar untuk faktor 0,92, atau penghapusannya.
4. Lokasi gudang dan pasar utama sebagai titik asal dan tujuan, bukan titik pusat wilayah.
5. Pembacaan tabel BPS edisi 2024 dan data harga SISKAPERBAPO bila ingin menguji arah aliran dengan keseimbangan harga spasial.
