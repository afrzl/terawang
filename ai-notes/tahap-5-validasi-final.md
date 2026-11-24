# Tahap 5 — Validasi pengguna dan finalisasi (26–28 Nov)

**Tujuan:** MVP siap dipresentasikan, jujur soal batasan data, dan ada bukti masukan pengguna.

## Tugas

1. **Wawancara pengguna** (2–3 pihak kalau bisa: dinas ketahanan pangan, Bulog, penggilingan). Lima pertanyaan tetap, catat jawaban, ambil satu kutipan untuk materi. Simpan catatan di `ai-notes/wawancara.md`.
   - Contoh pertanyaan: keputusan apa yang bergantung pada data stok dan harga? Data apa yang dipakai sekarang dan kapan tersedia? Seberapa awal peringatan harga berguna? Siapa yang akan memakai dashboard? Apa yang paling kurang dari tampilan ini?
2. **Audit label.** Semua angka punya badge Asli / Model / Dummy. Tambah halaman "Tentang data dan metode": sumber, metode, MAPE, dan batasan (stok dan ubinan dummy).
3. **Uji akhir.** Build, lint, uji di HP (layar kecil), uji di VPS, uji bot, uji fallback.
4. **Materi pitching:**
   - Ringkasan metrik: MAPE K1, MAPE K3, jumlah wilayah, jumlah layanan.
   - Skrip demo 5 menit (urutan: peta → produksi → stok → harga → rekomendasi → WhatsApp).
   - Perbarui video di `video-terawang` bila perlu.
5. **Rencana setelah MVP:** kerja sama data (ubinan, stok Bulog), uji musim berjalan Des 2026–Feb 2027.

## Selesai kalau

- Catatan wawancara dan satu kutipan tersedia.
- Tidak ada angka dummy yang tampil tanpa label.
- Skrip demo berjalan mulus dari awal sampai akhir.
- Materi pitching siap.
