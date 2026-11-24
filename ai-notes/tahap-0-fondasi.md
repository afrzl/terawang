# Tahap 0 — Fondasi (16–17 Nov)

**Tujuan:** satu pintu data, supaya mengganti dummy dengan data asli tidak perlu mengubah UI.

## Tugas

1. **Cek harga Bapanas** (±30 menit). Coba ambil data Panel Harga Pangan (harga beras per kabupaten, mingguan atau harian). Kalau bisa, simpan sebagai CSV di `data/harga/`. Kalau tidak, pakai dummy dan lanjut. Catat hasil cek di `progress.md`.
2. **Rancang skema data** sesuai [01-aturan-data.md](01-aturan-data.md). Satu modul atau satu set file JSON dengan bentuk tetap: `produksi`, `stok`, `harga`, `rekomendasi`. Setiap record punya field `sumber`.
3. **Pindahkan logika simulasi dari `src/lib/data.ts`** ke lapisan data. UI membaca dari satu modul. Simulasi RNG tetap boleh ada, tapi hanya sebagai penghasil record `dummy`.
4. **Tambah badge sumber** (Asli / Model / Dummy) sebagai komponen di `src/components/ui/` (misalnya `SumberBadge.tsx`) dan pasang di setiap `Panel` yang menampilkan angka.
5. **Buat `data/README.md`** yang mencatat asal setiap berkas data.

## File yang kemungkinan disentuh

- `src/lib/data.ts` (dipecah)
- `src/lib/gee_wilayah.json` (tetap, ditandai `asli`)
- `src/components/ui/Panel.tsx`, `Pill.tsx`
- `src/pages/*` (pasang badge)

## Selesai kalau

- Dashboard tampil sama seperti sekarang.
- Datanya lewat skema baru dan setiap angka punya label sumber.
- `npm run build` dan `npm run lint` lolos.
- Hasil cek Bapanas tercatat.
