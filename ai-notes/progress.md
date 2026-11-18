# Progress

Perbarui file ini setiap selesai satu tugas. Format catatan: tanggal, apa yang dikerjakan, hasil atau keputusan, kendala.

## Checklist

### Tahap 0 — Fondasi (16–17 Nov)
- [x] Cek akses harga Bapanas (hasil: Panel Harga Bapanas publik hanya harga produsen; harga konsumen per kab/kota diambil dari SISKAPERBAPO Jatim, lihat `data/siskaperbapo/harga_beras/`)
- [ ] Skema data dan field `sumber`
- [ ] Pindahkan simulasi `data.ts` ke lapisan data
- [ ] Komponen badge sumber terpasang di semua panel
- [ ] `data/README.md`

### Tahap 1 — K1 produksi (18–20 Nov)
- [ ] Data BPS 2024–2025 per kabupaten
- [ ] Estimasi satelit per kabupaten lengkap (38 wilayah)
- [ ] `scripts/validasi_k1.py`, MAPE dan korelasi
- [ ] Kartu "Akurasi vs BPS" di halaman Produksi
- [ ] Kalibrasi sederhana (kalau MAPE > 10%)
- [ ] Alert petak tertinggal

### Tahap 2 — K2 dan K3 (20–23 Nov)
- [ ] Neraca stok bulanan
- [ ] Filter Kalman
- [ ] Status stok dan bulan defisit
- [ ] Data harga (asli atau dummy berlabel)
- [ ] Model harga dan backtest (MAPE 4 minggu)
- [ ] Optimasi SPHP

### Tahap 3 — Sistem (23–25 Nov)
- [ ] Backend FastAPI
- [ ] `run_pipeline.py` dan cron
- [ ] Service account GEE
- [ ] Dashboard dari API dengan fallback
- [ ] Footer "Terakhir diperbarui"
- [ ] Deploy diperbarui

### Tahap 4 — WhatsApp (25–26 Nov)
- [ ] Cek pendaftaran WhatsApp Cloud API
- [ ] Bot (WhatsApp atau cadangan Telegram / simulator)
- [ ] Empat perintah dari API

### Tahap 5 — Final (26–28 Nov)
- [ ] Wawancara pengguna
- [ ] Halaman "Tentang data dan metode"
- [ ] Audit label dan uji akhir
- [ ] Materi pitching

## Risiko yang perlu dicek

1. Akses harga Bapanas (menentukan harga asli atau dummy).
2. Kuota GEE dan service account untuk pipeline terjadwal.
3. Pendaftaran WhatsApp Cloud API (kalau butuh verifikasi bisnis, langsung pakai jalur cadangan).
4. Kualitas MAPE K1 (kalau jelek, tetap tampilkan dan jelaskan).

## Catatan harian

- 2026-11-17: folder `ai-notes` dibuat, rencana MVP per tahap ditulis.
- 2026-11-17: data utama terkumpul (BPS, Bulog, SISKAPERBAPO, jarak). `01-aturan-data.md` diperbarui.
- 2026-11-17: `api/` dibuat (Express 5 + Prisma 7 + PostgreSQL). Database `terawang` dengan 3 schema (`ref`, `silver`, `app`), 39 tabel. Semua data yang terkumpul sudah dimuat ke `silver` dan diperiksa terhadap sumber (`npm run ingest`). Tabel `app` masih kosong. Lihat `api/README.md`.
- 2026-11-17: K1 langkah 1 selesai: `scripts/k1/baseline_bps.py` (baseline BPS tanpa citra). Hasil terbobot (WAPE), Jan-Sep 2026 diprediksi dari 2025: 4,5% (kab 4,4%, kota 9,0%); tahunan 2025 dari 2024: 12,3%. Luas panen sebenarnya x produktivitas tahun lalu: 1,7% (jan-sep) dan 2,7% (tahunan). Artinya produksi praktis = luas panen x ±3,3 ton beras/ha (korelasi luas-produksi 0,994, produktivitas per kab stabil), jadi tugas citra adalah luas panen. Kendala: BPS bulanan per kab hanya 2025, jadi backtest bulanan belum bisa.
- 2026-11-17: K1 langkah 2 disiapkan, belum dijalankan: `scripts/gee/vh_panen_kabkota.py` (VH Sentinel-1 per kab per bulan, luas piksel yang VH-nya turun = proksi panen). Butuh `earthengine authenticate` dan project GEE; belum ada kredensial di mesin ini. Belum diuji.
