# Data BPS: penduduk Jawa Timur

Topik: jumlah penduduk per kabupaten/kota. Dipakai untuk konsumsi beras bulanan di neraca stok K2 (penduduk × konsumsi per kapita). Status sumber: **asli** (lihat [aturan data](../../../ai-notes/01-aturan-data.md)).

## Struktur folder

```
data/bps/penduduk/
└── kabkota/
    └── tahunan/
        └── bps_jatim_penduduk_kabkota_tahunan_2020_2026.csv
```

## Sumber

**BPS Provinsi Jawa Timur.** *Provinsi Jawa Timur Dalam Angka 2026.* Tabel 3.1.1 (hlm. 75 buku, hlm. 109 PDF). 38 kabupaten/kota.
https://jatim.bps.go.id/en/publication/2026/02/27/19b010f5faca007f15a32d23/provinsi-jawa-timur-dalam-angka-2026.html

Sumber angka di tabel itu: *Proyeksi Penduduk Indonesia 2020–2050 Hasil Sensus Penduduk 2020* (tengah tahun, Juni).

## Kolom

- `wilayah`: nama menurut BPS (contoh: `Kota Batu`).
- `jenis`: `kabupaten` atau `kota`.
- `nama_repo`: nama di `src/lib/gee_wilayah.json` (`Kota Batu` menjadi `Batu`; selain itu sama).
- `penduduk_2020_jiwa`: hasil Sensus Penduduk 2020 (per 30 September 2020).
- `penduduk_2025_proyeksi_jiwa`, `penduduk_2026_proyeksi_jiwa`: proyeksi tengah tahun (Juni). Kolom bertanda `proyeksi` bukan hasil cacah.

Total provinsi tidak dimasukkan sebagai baris: 2020 = 40.665.696; 2025 = 42.089.271; 2026 = 42.352.024 jiwa.

## Catatan pemakaian

- **Pakai `penduduk_2026_proyeksi_jiwa`** untuk musim berjalan (satelit 30 Okt 2026), dan 2025 untuk pembanding dengan produksi BPS 2025.
- **Menggantikan penduduk WorldPop** di `gee_wilayah.json`. Total WorldPop di repo 34,36 juta jiwa, sedangkan BPS proyeksi 2026 42,35 juta (selisih -18,9%). Misalnya Kota Surabaya: WorldPop 2,37 juta, BPS 2,94 juta.
- Dengan penduduk BPS, konsumsi beras bulanan Jatim menjadi sekitar 263 ribu ton (42,35 juta × 6,22 kg), bukan sekitar 220 ribu ton seperti di repo (+20%).
- Laju pertumbuhan 2020–2025 di publikasi memakai selang **4,75 tahun** (sensus 30 Sep 2020 ke tengah tahun 2025).

## Validasi

1. Jumlah 38 baris cocok dengan baris "Jawa Timur" di publikasi untuk ketiga kolom (selisih 0).
2. Narasi hlm. 72: Surabaya terbanyak 2.940.265 jiwa dan Kota Mojokerto tersedikit 139.817 jiwa pada 2026, sesuai data.
3. Laju pertumbuhan 2020–2025 yang dihitung ulang dari angka ini cocok (selisih < 0,02 poin) dengan kolom laju di publikasi, untuk 7 wilayah contoh.

Berkas diketik dari publikasi, bukan diekspor dari BPS.

## Belum ada

- Penduduk 2021–2024 (tahun antara) dan pemisahan kota/desa per kabupaten.
- Penduduk menurut kelompok umur per kabupaten (Tabel 3.1.2 hanya tingkat provinsi).
