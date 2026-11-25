# ai-notes — Rencana MVP TERAWANG

Catatan kerja untuk tim dan AI assistant. Dibuat 17 Nov 2026. Target: **MVP selesai 28 Nov 2026**.

Prinsip: alur ujung ke ujung (satelit → produksi → stok → harga → rekomendasi SPHP → dashboard dan WhatsApp) harus jalan dulu. Data yang sulit didapat diganti **dummy berlabel**, lewat satu pintu data supaya mudah diganti data asli nanti.

## Isi

| File | Isi | Jadwal |
|---|---|---|
| [00-konteks.md](00-konteks.md) | Ringkasan proposal, kondisi repo, target kinerja | — |
| [01-aturan-data.md](01-aturan-data.md) | Mana data asli, model, dummy; skema dan label sumber | — |
| [tahap-0-fondasi.md](tahap-0-fondasi.md) | Satu pintu data, badge sumber | 16–17 Nov |
| [tahap-1-produksi-k1.md](tahap-1-produksi-k1.md) | Estimasi produksi dan validasi vs BPS | 18–20 Nov |
| [tahap-2-stok-harga-k2-k3.md](tahap-2-stok-harga-k2-k3.md) | Neraca stok, prediksi harga, optimasi SPHP | 20–23 Nov |
| [tahap-3-sistem.md](tahap-3-sistem.md) | Backend API dan pipeline terjadwal | 23–25 Nov |
| [tahap-4-whatsapp.md](tahap-4-whatsapp.md) | Kanal warga | 25–26 Nov |
| [tahap-5-validasi-final.md](tahap-5-validasi-final.md) | Uji pengguna, audit label, materi pitching | 26–28 Nov |
| [progress.md](progress.md) | Checklist dan catatan harian | diperbarui terus |

## Kalau waktu mepet

Kerjakan **Tahap 0, 1, 2 (harga), 3** dulu. Empat bagian itu mengubah dashboard dengan data tiruan menjadi sistem dengan hasil terukur. SPHP, WhatsApp sungguhan, dan Fay-Herriot bisa dipangkas jadi versi minimal.

## Ditunda sampai setelah MVP

Fay-Herriot dengan ubinan asli, kalibrasi stok dengan data Bulog, Sentinel-2 untuk deteksi hama lanjutan, multi-provinsi, autentikasi dan peran pengguna, model bisnis berbayar (cukup slide).
