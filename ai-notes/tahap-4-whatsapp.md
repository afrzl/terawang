# Tahap 4 — Kanal WhatsApp (25–26 Nov)

**Tujuan:** ada satu kanal sungguhan (atau simulator terhubung API) yang menjawab dari data model.

## Tugas

1. **Jalur utama: WhatsApp Cloud API (Meta)** atau gateway sederhana. Pendaftaran bisnis bisa lama, jadi **cek lebih awal** (idealnya sejak Tahap 2) apakah verifikasi bisa dilewati untuk nomor uji.
2. **Jalur cadangan:** bot Telegram, atau simulator web (halaman `/whatsapp`) yang memanggil API sama. Demo tetap menunjukkan logika bot nyata.
3. **Perintah minimal:**
   - `harga <kabupaten>` — harga terkini dan prediksi 4 minggu
   - `stok <kabupaten>` — status stok dan perkiraan bulan defisit
   - `beras murah <kabupaten>` — lokasi atau rute SPHP terdekat dari rekomendasi
   - `peringatan` — wilayah waspada dan siaga terkini
4. **Bot memanggil endpoint yang sama** dengan dashboard (`/harga`, `/stok`, `/rekomendasi`), tidak punya logika data sendiri.
5. **Normalisasi nama wilayah** (huruf besar-kecil, "Kab." / "Kota", salah ketik ringan).
6. **Siaran peringatan** (opsional MVP): kirim ringkasan ke daftar nomor uji saat ada wilayah siaga.

## File yang kemungkinan disentuh

- `api/bot/` atau `server/bot/` (baru)
- `src/pages/Whatsapp.tsx`, `src/components/ui/WaPlayer.tsx`, `PhoneMockup.tsx` (hubungkan simulator ke API)

## Selesai kalau

- Setidaknya satu kanal nyata (WhatsApp atau Telegram), atau simulator web terhubung API, menjawab empat perintah dari data model.
- Jawaban bot sama dengan angka di dashboard.
- Rekaman layar atau tangkapan percakapan tersedia untuk materi pitching.
