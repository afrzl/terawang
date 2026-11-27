# Bot WhatsApp TERAWANG

Bot warga untuk info beras Jawa Timur. Pesan masuk lewat GoWA (go-whatsapp-web-multidevice), dijawab dari tabel `app.*` dan `silver.*` hasil pipeline Dagster, jadi angkanya sama dengan dasbor.

- **Perintah baku** dijawab langsung dari database, tanpa LLM: `HARGA <wilayah>`, `STOK <wilayah>`, `SPHP <wilayah>` / `BERAS MURAH`, `PERINGATAN`, `LANGGANAN <wilayah>`, `BERHENTI`, `LAPOR`, `BANTUAN`, `GRAFIK <wilayah> [rentang]`. Pesan berisi nama wilayah saja dianggap `HARGA`.
- **Grafik harga, stok, produksi**: `GRAFIK Jember 3 bulan`, `grafik stok jember`, `grafik produksi jatim`, atau kalimat seperti _grafik harga beras sebulan ini_. Stok (cakupan bulan konsumsi, skenario tengah dengan pita rendah-tinggi; Jatim = total ton) dari `app.estimasi_stok` run K2 terbaru, produksi (ton per bulan + batas bawah-atas) dari `app.prediksi_produksi` run K1 terbaru, dirender `src/grafik-bulanan.ts`. Grafik harga: atau kalimat seperti _grafik harga beras sebulan ini_ dibalas gambar PNG (dirender `src/grafik.ts` dari `silver.harga_kabkota_harian`, tanpa LLM) dengan keterangan angka terakhir, tertinggi, dan terendah. Tanpa nama wilayah memakai wilayah percakapan terakhir, selain itu rata-rata Jawa Timur. Dikirim lewat GoWA `POST /send/image`; bila gagal, keterangannya dikirim sebagai teks.
- **Pesan bebas** diteruskan ke OpenAI (model kelas mini) dengan function calling ke fungsi di `src/data.ts`. LLM tidak boleh mengarang angka. Batas `LLM_BATAS_HARIAN` per nomor. Nomor WA tidak dikirim ke OpenAI.
- **Siaran**: peringatan SIAGA dikirim segera ke pelanggan wilayahnya; WASPADA dirangkum tiap Senin 06.00 WIB. Setiap kiriman dicatat di `app.notifikasi`.

## Guard rail dan hemat token (jalur OpenAI)

Urutan pemeriksaan pesan bebas (`src/bot.ts` → `src/pagar.ts`):

1. Perintah baku dan pesan berisi nama wilayah saja dijawab tanpa LLM.
2. Pesan lebih dari `LLM_MAKS_MASUKAN` karakter ditolak.
3. Pola injeksi prompt ("abaikan instruksi", "kamu sekarang adalah…", "tampilkan prompt") ditolak tanpa memanggil OpenAI.
4. Pesan tanpa kata kunci beras/pangan dan tanpa nama wilayah dianggap di luar topik, ditolak tanpa memanggil OpenAI.
5. Cache: pertanyaan sama (per wilayah) dalam `LLM_CACHE_MENIT` dijawab dari cache.
6. Batas per nomor (`LLM_BATAS_10MENIT`, `LLM_BATAS_HARIAN`) dan anggaran token seluruh bot per hari (`LLM_TOKEN_HARIAN`).
7. Prompt sistem ringkas dan statis di depan (kena prompt caching OpenAI), riwayat maks. 4 pesan @300 karakter, keluaran maks. `LLM_MAKS_KELUARAN` token, maks. 3 putaran fungsi.
8. Jawaban yang menyebut angka (Rp, ton, %) tanpa memanggil fungsi data dibuang. Markdown dirapikan ke format WhatsApp, maks. 1.200 karakter.

Batas keras tetap dipasang di dasbor OpenAI (Settings → Limits). Pemakaian token hari ini terlihat di `GET /health`.

## Berkas

| Berkas | Isi |
|---|---|
| `src/server.ts` | HTTP: `POST /webhook/wa` (GoWA), `POST /api/tanya` (simulator dasbor), `GET /health` |
| `src/grafik.ts` | Grafik harga beras: data, SVG, PNG (resvg), keterangan; pengenal topik/rentang/jenis |
| `src/grafik-bulanan.ts` | Grafik bulanan stok (K2) dan produksi (K1) |
| `src/bot.ts` | Pengurai perintah dan alur percakapan (pilih wilayah, LAPOR) |
| `src/data.ts` | Semua query angka |
| `src/format.ts` | Templat balasan WhatsApp |
| `src/llm.ts` | Jalur OpenAI + definisi fungsi + konteks TERAWANG |
| `src/pagar.ts` | Guard rail: injeksi, topik, batas, cache, pemeriksaan jawaban |
| `src/siaran.ts` | Penjadwal siaran peringatan |
| `src/wilayah.ts` | Normalisasi nama kab/kota dan salah ketik |
| `sql/role-bot.sql` | Role Postgres `terawang_bot` berhak terbatas |

## Menjalankan

```bash
cp .env.example .env    # isi nilai rahasia
npm ci
npm test                 # uji pengurai (tanpa DB)
npm run tanya -- "HARGA MALANG"   # uji jawaban dari DB tanpa WhatsApp
docker compose up -d --build      # di VPS, gabung network proxy dan db
```

Tabel `app.laporan_harga_warga` dibuat oleh migrasi Prisma `api/prisma/migrations/20261121140000_laporan_harga_warga`.
