# Konteks

## Proposal (ringkas)

**TERAWANG: Pemantauan Beras dari Sawah ke Pasar** — estimasi produksi, stok beredar, dan peringatan dini harga berbasis citra satelit dan AI. Program PLAY IT! PLUS Hackathon Deeptech 2026, tema Digitalisasi AI Bidang Ketahanan Pangan. Tim Makmur Jaya (Politeknik Statistika STIS): Farid Ridho (ketua, mentor), Danang Wisnu Prabowo (bisnis dan hilirisasi), Muh. Nur Afrizal (teknis dan validasi).

Tiga kasus dalam satu alur:
1. **K1 Hulu, produksi pra-panen.** Sentinel-1 (VH) memetakan sawah dan fase tumbuh, Sentinel-2 menambah indeks vegetasi dan menandai petak tertinggal. ML memprediksi produktivitas, dikalibrasi dengan ubinan (Fay-Herriot).
2. **K2 Tengah, stok beras beredar per kabupaten.** Stok_t = stok_{t-1} + produksi − konsumsi ± arus antardaerah. Konsumsi dari Susenas (6,39 kg/kapita/bulan, Sep 2025). Model state-space dengan filter Kalman.
3. **K3 Hilir, peringatan dini harga dan rekomendasi SPHP.** Harga dari Panel Harga Bapanas diprediksi 2–4 minggu ke depan. Wilayah melewati batas ditandai waspada. Optimasi mencocokkan surplus dan defisit. Output: dashboard dan bot WhatsApp.

Pengguna: Dinas Ketahanan Pangan dan TPID (utama), Bulog, Dinas Pertanian, penggilingan dan pedagang besar (pelanggan berbayar), warga (gratis).

## Target kinerja proposal

- MAPE estimasi produksi ≤ 10% terhadap data resmi BPS, tersedia 4 minggu sebelum panen.
- Deteksi daerah berpotensi defisit stok minimal 1 bulan sebelumnya.
- MAPE prediksi harga 4 minggu ke depan ≤ 5%.

## Jadwal TKT di proposal

- 26 Okt–10 Nov: prototipe dengan data musim lalu, satu provinsi (TKT 3–4).
- **16–28 Nov: MVP terintegrasi dengan dasbor dan WhatsApp, uji coba terbatas (TKT 4–5).**
- Des 2026–Feb 2027: uji di musim tanam berjalan (menuju TKT 6).

File proposal: `~/Downloads/Proposal - PLAY IT! PLUS Hackathon Deeptech 2026 (1).pdf`.

## Kondisi repo per 17 Nov 2026

Stack: Vite, React 19, TypeScript, Tailwind v4, React Router, MapLibre, d3. Wilayah: Jawa Timur, 38 kab/kota. Deploy ke VPS lewat `deploy/deploy-vps.sh` (server statis `deploy/serve.py`).

**Sudah ada**
- Halaman: Ringkasan, Produksi, Stok, Harga, WhatsApp, Arus Beras, Cerita.
- Data satelit asli dari Google Earth Engine (luas sawah, fase tumbuh, profil VH, petak tertinggal, proyeksi panen) lewat `scripts/gee/*.py` menjadi `src/lib/gee_wilayah.json`.
- Layer peta di `public/citra/` (S2 Okt 2026, fase, selisih VH) dan galeri citra sebelum/sesudah per wilayah.
- Komponen grafik SVG/d3: peta, line chart, sparkline, sankey, chord, treemap, heatmap, ridgeline.

**Masih simulasi atau belum ada**
- Harga dasar simulasi; stok tiruan yang didorong produksi dan penduduk GEE (`src/lib/data.ts`, RNG deterministik).
- Belum ada model Fay-Herriot, Kalman, prediksi harga ML, dan optimasi SPHP.
- Bot WhatsApp baru animasi (`WaPlayer`, `PhoneMockup`).
- Belum ada backend, pipeline otomatis, atau validasi terhadap BPS.
- Pembacaan data masih statis: `data.ts` menghitung langsung di sisi klien.

## Titik masuk kode penting

- `src/lib/data.ts` — sumber data dan simulasi, titik utama yang diubah di Tahap 0.
- `src/lib/gee_wilayah.json` — keluaran GEE per wilayah (`GeeWilayah`).
- `scripts/gee/terawang_wilayah.py` — pembuat `gee_wilayah.json`.
- `scripts/gee/terawang_jatim.py` — pembuat layer peta provinsi.
- `src/pages/*` — halaman; `src/components/charts/*` — grafik.
