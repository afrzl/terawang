# Tahap 1 — K1 produksi yang terukur (18–20 Nov)

**Tujuan:** estimasi produksi per kabupaten yang bisa dibandingkan dengan angka resmi BPS, dengan MAPE yang terlihat di dashboard.

## Tugas

1. **Ambil acuan BPS.** Produksi dan luas panen padi per kabupaten/kota Jawa Timur untuk 2024 dan 2025 (publikasi "Luas Panen dan Produksi Padi di Indonesia", angka tetap). Simpan sebagai CSV di `data/bps/produksi_padi/` dan catat sumbernya di README folder itu. **Sudah selesai** (2024–2026s, struktur `kabkota/` dan `provinsi/`).
2. **Pastikan estimasi satelit keluar per kabupaten.** Jalur utamanya sudah ada di `scripts/gee/terawang_wilayah.py`. Cek bahwa `ha` (luas sawah), `ip` (indeks pertanaman), `prod` dan `est` terisi untuk 38 wilayah.
3. **Hitung MAPE dan korelasi** terhadap BPS. Simpan hasil per wilayah dan agregat (MAPE rata-rata, MAPE terbobot, korelasi). Skrip: `scripts/validasi_k1.py`.
4. **Tampilkan kartu "Akurasi vs BPS"** di halaman Produksi: estimasi, angka BPS, selisih, MAPE.
5. **Kalibrasi sederhana kalau MAPE > 10%.** Regresi atau faktor koreksi per kabupaten. Tulis apa adanya sebagai "kalibrasi sederhana". Fay-Herriot penuh dilewati kecuali data ubinan ada.
6. **Alert petak tertinggal** yang bisa diklik, dari field `lag` yang sudah ada. Daftar wilayah dengan petak tertinggal tertinggi, link ke halaman wilayah.

## Catatan metode

- BPS menghitung produksi = luas panen (KSA) × produktivitas (ubinan). Estimasi TERAWANG meniru pola itu: luas dari radar, produktivitas dari model.
- Tahun acuan validasi: pakai 2025 (angka tetap) kalau estimasi satelit tersedia untuk 2025, dan 2024 sebagai cadangan.
- Kalau MAPE jauh di atas 10%, jangan disembunyikan. Tampilkan, jelaskan penyebab (misalnya proksi sawah ESA WorldCover), dan catat langkah perbaikannya.

## File yang kemungkinan disentuh

- `scripts/gee/terawang_wilayah.py`
- `scripts/validasi_k1.py` (baru)
- `data/bps/produksi_padi/**/*.csv` (sudah ada, dikelompokkan per tingkat wilayah dan granularitas waktu)
- `src/pages/Produksi.tsx`
- `src/lib/data.ts` / lapisan data hasil Tahap 0

## Selesai kalau

- Halaman Produksi menampilkan estimasi, angka BPS, dan MAPE per kabupaten dan agregat.
- Skrip validasi bisa dijalankan ulang dan menghasilkan file keluaran yang dibaca UI.
- Catatan hasil dan penyebab selisih tertulis di `progress.md`.
