# Pipeline data TERAWANG (Dagster)

Pipeline ini menjalankan alur **sumber → bronze → silver → model → app** secara berurutan dan terjadwal, dan
menampilkan alurnya sebagai grafik aset di UI Dagster (https://dagster.terawang.tech, publik dan hanya baca).

```
sumber (SISKAPERBAPO, GEE, BPS, Bulog, OSRM)
  └─ bronze_*   berkas mentah di data/ + checksum (data version)
      └─ silver_*   tabel bersih di Postgres, dimuat oleh `npm run ingest <modul>` di api/
  bronze_titik_satelit (deret 12-harian di 15.200 titik sawah)
      └─ k1_nowcast_citra (scripts/k1/nowcast_est2.py, jarak 0/28/56 hari)
          └─ k1_prediksi_produksi → k2_estimasi_stok → k3_rekomendasi_sphp     (model asli Danang, scripts/k1 dan scripts/k2)
             k3_prediksi_harga
              └─ status_wilayah → peringatan     (dibaca dasbor dan bot WhatsApp lewat API)
```

## Pembagian

| Bagian | Folder | Pemilik |
|---|---|---|
| Model K1, K2 (skrip asli) | `scripts/k1/`, `scripts/k2/` | Danang |
| Jembatan model, K3 dan SPHP baseline | `models/terawang_models/` | Danang |
| Orkestrasi, konektor sumber, jadwal, deploy | `pipeline/`, `deploy/deploy-pipeline.sh` | Afrizal |
| Skema database dan ingest silver | `api/prisma/`, `api/src/ingest/` | Danang |

Pipeline **tidak berisi logika model**. Aset di `pipeline/terawang_pipeline/assets/model.py` hanya memanggil model,
mencatat `app.model_run` (versi, parameter, metrik), dan menyimpan hasil. K1 dan K2 memanggil skrip Danang di `scripts/k1`
dan `scripts/k2` lewat `models/terawang_models/danang.py` (cwd akar repo, `DATABASE_URL`); memperbaiki model cukup di skrip itu.
Taksiran citra bulan operasional ditulis ke `TERAWANG_K1_DIR` (default `~/.local/share/terawang/k1`, di luar repo); run pertama
menyalin `data/satelit/est_nowcast2_lead*_2026.csv` sebagai awal.

## Mengganti sumber data

Setiap sumber adalah konektor (resource) di `pipeline/terawang_pipeline/resources.py`, diatur lewat `pipeline/.env`:

| Variabel | Nilai | Arti |
|---|---|---|
| `TERAWANG_SUMBER_HARGA` | `berkas` (default) | pakai CSV di `data/siskaperbapo/` apa adanya |
| | `siskaperbapo` | unduh harga terbaru dari SISKAPERBAPO setiap run, ke `TERAWANG_HARGA_DIR` (default `~/.local/share/terawang/harga_beras`, di luar repo); data yang belum terbit hari itu otomatis memakai tanggal terakhir |
| | `manual` | CSV repo ditimpa unggahan di `TERAWANG_MANUAL_DIR/harga/`, disusun di `TERAWANG_HARGA_DIR` |
| `TERAWANG_SUMBER_BPS` | `berkas` (default) | pakai CSV di `data/bps/` |
| | `webapi` | `scripts/bps/ambil_webapi.py` mengambil luas panen dan produksi beras bulanan per kab/kota (var 578, 580) dan konsumsi beras per kapita (var 2094) dari WebAPI BPS ke lapisan `TERAWANG_DATA_DIR/bps/`. Butuh `BPS_WEBAPI_KEY`. Penduduk dan angka sementara/potensi tidak ada di WebAPI, tetap dari CSV repo atau unggahan |
| | `manual` | CSV repo ditimpa unggahan di `TERAWANG_MANUAL_DIR/bps/` |
| `TERAWANG_SUMBER_BULOG` | `berkas` (default) | pakai CSV di `data/bulog/` |
| | `jda` | `scripts/bulog/ambil_jda.py` mencari edisi terbaru "Provinsi Jawa Timur Dalam Angka" lewat WebAPI BPS, mengunduh PDF-nya (hanya kalau ada edisi atau revisi baru), membuang watermark, mengekstrak Tabel 10.1.3-10.1.7, dan memeriksa akuntansinya. Butuh `BPS_WEBAPI_KEY`. Bulog tidak punya API; data ini terbit setahun sekali |
| | `manual` | CSV repo ditimpa unggahan di `TERAWANG_MANUAL_DIR/bulog/` |
| `TERAWANG_SUMBER_CITRA` | `berkas` (default) | pakai `src/lib/gee_wilayah.json` |
| | `gee` | jalankan `scripts/gee/terawang_wilayah.py` dengan `--acuan` = tanggal Sentinel-1 terbaru, keluaran ke `TERAWANG_GEE_JSON` (default `~/.local/share/terawang/gee_wilayah.json`, di luar repo). Butuh `pip install -e "pipeline[gee]"`, `GEE_PROJECT`, dan kredensial (`earthengine authenticate --auth_mode=notebook` sekali di server, atau `GOOGLE_APPLICATION_CREDENTIALS` ke kunci service account) |

Mode `gee` juga memperpanjang deret titik sawah K1 (`scripts/gee/perpanjang_titik.py`: VH, VV, LSWI/EVI di titik yang sama,
dua jendela terakhir diambil ulang) ke `TERAWANG_TITIK_DIR` (default `~/.local/share/terawang/titik`). Mode `berkas` memakai
`data/satelit/*_titik_12harian_kabkota.csv.gz` di repo.

**Lapisan data dan unggahan manual.** Hasil konektor BPS dan Bulog ditulis ke `TERAWANG_DATA_DIR` (default
`~/.local/share/terawang/data`) dengan struktur yang sama dengan `data/`. Ingest (`api/src/ingest/util.ts`, `lokasi()`) dan
skrip model Danang (`data_bps()`) membaca berkas `data/...` dari lapisan bila ada di sana, selain itu dari repo.
Unggahan manual (halaman admin) disimpan di `TERAWANG_MANUAL_DIR/<bps|bulog|harga|jarak>/` (default
`~/.local/share/terawang/manual`). Nama berkas harus sama dengan berkas repo dan header-nya sama persis; selain itu dilewati
dengan peringatan. Urutan pakai tiap berkas: hasil otomatis run ini, lalu unggahan manual (dipakai kalau konektor gagal, tidak
menulis ulang berkas itu, atau mode `manual`), lalu CSV repo. Konektor yang gagal tidak menggagalkan aset: asset check
`otomatis_berhasil` menjadi peringatan dan galatnya ada di metadata. `sensor_berkas_data` juga menjalankan alur penuh setelah ada
unggahan baru. Key BPS hanya dibaca skrip dari env `BPS_WEBAPI_KEY`, tidak lewat argumen atau konfigurasi resource yang tampil
di UI.

Batas saat ini: ingest masih menyebut nama berkas bertahun (mis. `..._2025.csv`), jadi data tahun baru dari WebAPI atau edisi
Jatim Dalam Angka berikutnya sudah tertulis di lapisan tetapi baru dipakai setelah ingest dan model disesuaikan. Revisi BPS
untuk tahun yang sama langsung terpakai.

Sumber baru (mis. Panel Harga Bapanas) cukup menulis berkas dengan kolom yang sama; silver, model, dan dasbor tidak berubah.

## Jadwal

| Nama | Waktu (WIB) | Isi |
|---|---|---|
| `harga_0600_1400_wib` | setiap hari 06.00 dan 14.00 | harga → silver harga → K3 → status → peringatan |
| `penuh_senin_0500_wib` | Senin 05.00 | seluruh alur |
| `sensor_citra_baru` | cek GEE tiap 6 jam | `pipeline_citra` kalau ada akuisisi Sentinel-1 baru di Jawa Timur (mode `gee`): citra wilayah, deret titik, K1 nowcast, K1, K2, SPHP, status, peringatan |
| `sensor_berkas_data` | cek tiap 5 menit | seluruh alur kalau berkas BPS/Bulog/jarak/citra di repo berubah (mis. setelah `git pull`) atau ada unggahan manual baru |

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
