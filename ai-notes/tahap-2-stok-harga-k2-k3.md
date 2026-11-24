# Tahap 2 — K2 stok dan K3 harga (20–23 Nov)

**Tujuan:** tiga halaman (Produksi, Stok, Harga) menampilkan hasil model sungguhan, bukan angka acak berbasis hash.

## K2 — Stok beredar

1. **Neraca bulanan:** `stok_t = stok_{t-1} + produksi_bulanan − konsumsi ± arus`.
   - Produksi bulanan diturunkan dari kalender panen K1 (proyeksi panen, fase tumbuh).
   - Konsumsi = penduduk × 6,39 kg/bulan (Susenas Sep 2025). Untuk kota bisa dibedakan kalau datanya ada.
   - Arus antardaerah: awalnya aproksimasi sederhana (sudah ada logika di `src/lib/arus.ts`).
2. **Filter Kalman** satu state per kabupaten (`statsmodels` atau `filterpy`). Stok awal dan pengamatan stok memakai **dummy berlabel**. Tulis jelas bahwa stok tidak dikalibrasi dengan data Bulog.
3. **Status per kabupaten:** cukup, tipis, defisit. Hitung juga perkiraan bulan defisit pertama (dipakai `DeficitCountdown`).
4. Skrip: `scripts/model_stok.py`. Keluaran JSON dengan `sumber: "model"` (stok awal `dummy`).

## K3 — Harga dan SPHP

5. **Data harga:** pakai data asli Bapanas kalau Tahap 0 berhasil. Kalau tidak, dummy yang realistis (tren musiman, lonjakan, korelasi antarwilayah). Label sesuai.
6. **Model harga:** baseline dulu (naive atau ARIMA), lalu gradient boosting dengan fitur harga lampau, stok, dan produksi. Prediksi 2 dan 4 minggu ke depan dengan interval.
7. **Backtest rolling** dan simpan MAPE per wilayah dan agregat. Tampilkan di halaman Harga. Target proposal: MAPE 4 minggu ≤ 5%.
8. **Status harga:** aman, waspada (mendekati HET), siaga (HET + 3% = Rp13.900), dengan prediksi.
9. **Optimasi SPHP:** linear programming sederhana (`scipy.optimize.linprog` atau `PuLP`). Surplus dan defisit dari K2, biaya = jarak antar kabupaten (centroid dari peta). Keluaran tabel rute dan volume ton. Menggantikan rute yang sekarang di-hardcode.
10. Skrip: `scripts/model_harga.py`, `scripts/optimasi_sphp.py`.

## File yang kemungkinan disentuh

- `scripts/model_stok.py`, `scripts/model_harga.py`, `scripts/optimasi_sphp.py` (baru)
- `src/pages/Stok.tsx`, `src/pages/Harga.tsx`
- `src/lib/arus.ts`, `src/lib/data.ts`
- `src/components/charts/DeficitCountdown.tsx`, `PriceHeatmap.tsx`, `PriceRidgeline.tsx`

## Selesai kalau

- Halaman Stok menampilkan keluaran neraca dan Kalman, dengan label `model` / `dummy`.
- Halaman Harga menampilkan prediksi, interval, dan MAPE hasil backtest.
- Tabel rekomendasi SPHP berasal dari optimasi, bukan data tetap.
- Semua skrip bisa dijalankan ulang dari awal sampai akhir.
