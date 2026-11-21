# Bot WhatsApp TERAWANG

Bot warga untuk info beras Jawa Timur. Pesan masuk lewat GoWA (go-whatsapp-web-multidevice), dijawab dari tabel `app.*` dan `silver.*` hasil pipeline Dagster, jadi angkanya sama dengan dasbor.

- **Perintah baku** dijawab langsung dari database, tanpa LLM: `HARGA <wilayah>`, `STOK <wilayah>`, `SPHP <wilayah>` / `BERAS MURAH`, `PERINGATAN`, `LANGGANAN <wilayah>`, `BERHENTI`, `LAPOR`, `BANTUAN`. Pesan berisi nama wilayah saja dianggap `HARGA`.
- **Pesan bebas** diteruskan ke OpenAI (model kelas mini) dengan function calling ke fungsi di `src/data.ts`. LLM tidak boleh mengarang angka. Batas `LLM_BATAS_HARIAN` per nomor. Nomor WA tidak dikirim ke OpenAI.
- **Siaran**: peringatan SIAGA dikirim segera ke pelanggan wilayahnya; WASPADA dirangkum tiap Senin 06.00 WIB. Setiap kiriman dicatat di `app.notifikasi`.

## Berkas

| Berkas | Isi |
|---|---|
| `src/server.ts` | HTTP: `POST /webhook/wa` (GoWA), `POST /api/tanya` (simulator dasbor), `GET /health` |
| `src/bot.ts` | Pengurai perintah dan alur percakapan (pilih wilayah, LAPOR) |
| `src/data.ts` | Semua query angka |
| `src/format.ts` | Templat balasan WhatsApp |
| `src/llm.ts` | Jalur OpenAI + definisi fungsi |
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
