# TERAWANG API dan basis data

Express 5 + Prisma 7 + PostgreSQL. Dashboard (Vite) tetap di folder induk.

## Basis data

Satu database `terawang`, tiga schema Postgres:

| Schema | Isi | Tabel |
|---|---|---|
| `ref` | Dimensi bersama: `wilayah`, `komoditas`, `sumber` | 3 |
| `silver` | Data sumber yang sudah dibersihkan (BPS, Bulog, SISKAPERBAPO, satelit, jarak) | 18 |
| `app` | Sistem TERAWANG: status, peringatan, keluaran model, pengguna, WhatsApp, pengaturan | 18 |

Bronze (berkas mentah) belum ada, nanti diisi pipeline Airflow. Skema: `prisma/schema/` (`ref.prisma`, `silver.prisma`, `app.prisma`).
Aturan: setiap baris fakta membawa `jenis_data` (ASLI, MODEL, DUMMY) dan `sumber_id` (publikasi asal, tabel `ref.sumber`).

## Menjalankan

```bash
cd api
cp .env.example .env              # sesuaikan DATABASE_URL
createdb terawang
npm install
npx prisma migrate deploy         # membuat schema dan tabel
npx prisma generate
npm run ingest                    # memuat semua data (ref, lalu silver). Aman diulang.
npm run ingest produksi harga     # atau modul tertentu: ref penduduk konsumsi produksi satelit bulog harga jarak
npm run typecheck
```

## Pemuatan data (`src/ingest/`)

Satu modul per domain. Setiap modul membaca CSV di `data/` dan JSON di `src/lib/`, memuat ke `silver`, lalu **memeriksa hasilnya terhadap total di sumber** (jumlah baris, total tahunan, identitas akuntansi). Pemuatan berhenti dengan galat kalau ada pemeriksaan yang gagal.

Isi setelah `npm run ingest`: 77 wilayah, 834 baris produksi padi, 114 penduduk, 154 konsumsi, 38 satelit, data Bulog, 121 pasar, 431.970 harga per pasar per hari (medium dan premium), 135.660 harga per kab/kota per hari, 1.444 pasangan jarak. Total database sekitar 82 MB.

## Belum diisi

- Semua tabel `app` (diisi oleh model dan sistem).
- `ref`/`silver`: `ambang_harga` (menunggu verifikasi HET), `cakupan_cabang_bulog` (menunggu data Bulog), `ingest_run` (dipakai pipeline Airflow nanti).
