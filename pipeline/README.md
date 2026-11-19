# Pipeline data TERAWANG (Dagster)

Pipeline ini menjalankan alur **sumber → bronze → silver → model → app** secara berurutan dan terjadwal, dan
menampilkan alurnya sebagai grafik aset di UI Dagster (https://dagster.terawang.tech, publik dan hanya baca).

```
sumber (SISKAPERBAPO, GEE, BPS, Bulog, OSRM)
  └─ bronze_*   berkas mentah di data/ + checksum (data version)
      └─ silver_*   tabel bersih di Postgres, dimuat oleh `npm run ingest <modul>` di api/
          └─ k1_prediksi_produksi → k2_estimasi_stok → k3_rekomendasi_sphp
             k3_prediksi_harga
              └─ status_wilayah → peringatan     (dibaca dasbor dan bot WhatsApp lewat API)
```

## Pembagian

| Bagian | Folder | Pemilik |
|---|---|---|
| Model (fungsi pandas murni) | `models/terawang_models/` | Danang |
| Orkestrasi, konektor sumber, jadwal, deploy | `pipeline/`, `deploy/deploy-pipeline.sh` | Afrizal |
| Skema database dan ingest silver | `api/prisma/`, `api/src/ingest/` | Danang |

Pipeline **tidak berisi logika model**. Aset di `pipeline/terawang_pipeline/assets/model.py` hanya mengambil masukan dari
silver, memanggil fungsi di `terawang_models`, mencatat `app.model_run` (versi, parameter, metrik), dan menyimpan hasil.
Mengganti model = mengganti isi `models/terawang_models/*.py` dengan tanda tangan dan kolom keluaran yang sama.

## Mengganti sumber data

Setiap sumber adalah konektor (resource) di `pipeline/terawang_pipeline/resources.py`, diatur lewat `pipeline/.env`:

| Variabel | Nilai | Arti |
|---|---|---|
| `TERAWANG_SUMBER_HARGA` | `berkas` (default) | pakai CSV di `data/siskaperbapo/` apa adanya |
| | `siskaperbapo` | unduh harga terbaru dari SISKAPERBAPO setiap run |
| `TERAWANG_SUMBER_CITRA` | `berkas` (default) | pakai `src/lib/gee_wilayah.json` |
| | `gee` | jalankan `scripts/gee/terawang_wilayah.py` (butuh `GEE_PROJECT` dan kredensial Earth Engine) |

Sumber baru (mis. Panel Harga Bapanas) cukup menulis berkas dengan kolom yang sama; silver, model, dan dasbor tidak berubah.

## Jadwal

| Nama | Waktu (WIB) | Isi |
|---|---|---|
| `harga_harian_0600_wib` | setiap hari 06.00 | harga → silver harga → K3 → status → peringatan |
| `penuh_senin_0500_wib` | Senin 05.00 | seluruh alur |
| `sensor_berkas_data` | cek tiap 5 menit | seluruh alur kalau berkas BPS/Bulog/jarak/citra berubah (mis. setelah `git pull`) |

## Menjalankan di laptop

```bash
python3 -m venv .venv-pipeline
.venv-pipeline/bin/pip install -e models -e pipeline
cp pipeline/.env.example pipeline/.env     # isi DATABASE_URL (database yang sama dengan api/)
cd api && npm ci && npx prisma migrate deploy && npx prisma generate && cd ..
cd pipeline && ../.venv-pipeline/bin/dagster dev   # buka http://localhost:3000, klik "Materialize all"
```

## Deploy di VPS

```bash
cd ~/terawang && bash deploy/deploy-pipeline.sh
```

Skrip memasang venv, menjalankan migrasi, menyalakan `dagster-webserver` dan `dagster-daemon`, dan mendaftarkan cron penjaga.
Router Traefik: `deploy/traefik-dagster.yml` (disalin ke `/opt/traefik/dynamic/`). UI publik berjalan `--read-only`; menjalankan pipeline manual
dilakukan di VPS: `cd ~/terawang-pipeline/pipeline && set -a && . ./.env && set +a && DAGSTER_HOME=~/dagster_home ../.venv-pipeline/bin/dagster job execute -m terawang_pipeline.definitions -j pipeline_penuh`.

## Catatan hasil run pertama (data per 17 Nov 2026, model baseline)

- K3 naif: MAPE 14 hari 0,33%, 28 hari 0,60% (backtest 365 hari, 38 kab/kota x 2 komoditas). Harga beras sangat lengket,
  jadi model lain harus mengalahkan angka ini, bukan hanya mencapai target proposal 5%.
- K2 tanpa arus antarwilayah membuat semua kota (Surabaya, Malang, dst.) defisit dalam, karena kota tidak memproduksi beras.
  Ini perilaku yang diharapkan dari baseline; perlu arus antarwilayah atau skala provinsi sebelum statusnya dipakai.
- Status harga memakai HET beras medium Rp13.500 cadangan (belum diverifikasi) selama `app.ambang_harga` kosong.
