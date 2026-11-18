# Jarak antar kab/kota Jawa Timur

Jarak antara 38 kab/kota, garis lurus dan lewat jalan. Bahan untuk optimasi penyaluran SPHP K3 (mencocokkan wilayah surplus dengan wilayah defisit, dengan biaya sebagai jarak). Status sumber: **model** (dihitung dari batas wilayah dan layanan routing, bukan data survei). Lihat [aturan data](../../../ai-notes/01-aturan-data.md).

## Sumber dan cara membuat

1. **Batas wilayah:** `public/citra/jatim/kab.geojson`, 38 kab/kota dari FAO GAUL 2015 (dibuat oleh `scripts/gee/terawang_jatim.py`). Dari situ dihitung **titik pusat** tiap wilayah.
2. **Jarak garis lurus:** rumus haversine antar titik pusat.
3. **Jarak dan waktu tempuh lewat jalan:** layanan routing terbuka **OSRM demo** (https://router.project-osrm.org, data OpenStreetMap, profil mobil), satu permintaan tabel 38 × 38. Diambil 17 November 2026.

Skrip: [scripts/geo/jarak_kabkota.py](../../../scripts/geo/jarak_kabkota.py) (pustaka standar Python, tanpa kunci API). Menjalankan ulang melakukan satu permintaan ke OSRM.

## Berkas

| Berkas | Isi |
|---|---|
| `titik_pusat_kabkota_jatim.csv` | Titik pusat tiap wilayah (`lon`, `lat`), jumlah bagian poligon, persen luas daratan utama, dan jarak titik itu bergeser ke jalan terdekat (`geser_ke_jalan_m`) |
| `jarak_garis_lurus_km_kabkota.csv` | Matriks 38 × 38, km |
| `jarak_jalan_km_kabkota.csv` | Matriks 38 × 38, km, lewat jalan |
| `waktu_tempuh_jam_kabkota.csv` | Matriks 38 × 38, jam, arus bebas |

Matriks: kolom pertama `dari` (baris), kolom lainnya `ke`. Label memakai **penamaan BPS** (`Kota Batu`, bukan `Batu`), sama dengan `data/bps/`. Kolom `nama_repo` di berkas titik pusat memetakan ke nama di `gee_wilayah.json`.

## Catatan pemakaian

- **Pakai jarak jalan untuk biaya distribusi.** Rasio jalan terhadap garis lurus: min 1,06, median 1,39, maks 4,08. Contoh: Surabaya–Malang 88 km jalan (79 km garis lurus), Surabaya–Banyuwangi 273 km (204 km).
- **Garis lurus menyesatkan untuk pasangan yang dipisah laut.** Situbondo–Sumenep hanya 94 km garis lurus tetapi 382 km lewat jalan, karena Madura terhubung ke daratan Jawa hanya di ujung baratnya. Pasangan Madura dengan wilayah timur (Tapal Kuda) punya rasio tertinggi (3 sampai 4).
- **Matriks jalan tidak persis simetris** (jalan satu arah, tol). Selisih median 0,95 km, maksimum 24,8 km. Untuk optimasi biaya, pakai apa adanya atau rata-ratakan dua arah.
- **Waktu tempuh adalah perkiraan arus bebas mobil**, bukan truk dan bukan kondisi lalu lintas. Jangan dipakai sebagai jadwal; cukup sebagai perbandingan relatif.
- **Jarak antar titik pusat wilayah, bukan antar gudang atau pasar.** Pasangan kota dan kabupaten kembar berjarak dekat (Kota Kediri–Kediri 10 km jalan, Kota Malang–Malang 17 km).
- Titik pusat dipakai dari **bagian terbesar (daratan utama)** supaya pulau terpisah tidak menarik titik ke laut. Persen luas daratan utama: Sumenep 55% (44 bagian, banyak pulau kecil), Gresik 81% (Bawean), Sampang 96%, Jember 98%, lainnya 100%. Pulau-pulau itu tidak diperhitungkan.

## Validasi

1. Matriks 38 × 38 lengkap, tanpa pasangan tanpa rute, diagonal nol.
2. Jarak jalan **tidak pernah** lebih pendek dari garis lurus (rasio minimum 1,06).
3. Titik pusat bergeser ke jalan terdekat rata-rata (median) 50 m, maksimum 1.019 m, jadi tidak ada titik yang jatuh jauh dari jaringan jalan.
4. Pasangan yang saya kenal masuk akal: Surabaya–Malang 88 km, Surabaya–Banyuwangi 273 km, Surabaya–Pacitan 264 km, Lamongan–Surabaya 63 km.

## Belum ada

- Jarak antar gudang Bulog atau pasar induk (butuh daftar lokasi gudang).
- Jarak untuk kendaraan berat dan jadwal penyeberangan.
- Daftar wilayah bertetangga (berbatasan darat). Bisa diturunkan dari batas wilayah kalau dibutuhkan.
