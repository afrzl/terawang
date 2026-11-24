# Halaman admin TERAWANG

`https://terawang.tech/admin` — wajib login. Tata letak panel dengan menu samping (laci di HP); bagian yang tampil tergantung peran (lihat tabel Peran):

1. **Ringkasan pipeline**: status tiap aset Dagster (hasil langkahnya di run terakhir), run terakhir, dan log per run. Aset/run gagal
   disorot merah, galat dan penyebabnya ditampilkan di atas. Bisa memasukkan job (`pipeline_penuh`, `pipeline_harga_harian`,
   `pipeline_citra`) ke antrean; daemon yang menjalankannya. Data dibaca dari GraphQL Dagster (webserver read-only tetap melayani query).
2. **Sumber data** (satu halaman per sumber: BPS, Bulog, Harga beras, Jarak, Citra satelit): status aset sumber itu, riwayat
   pembaruannya (`GET /admin/api/riwayat?sumber=<id>`), dan unggah manual. Unggah manual adalah fallback saat konektor otomatis gagal. Berkas disimpan di `TERAWANG_MANUAL_DIR/<sumber>/`
   (`~/.local/share/terawang/manual`, sumber = `bps`, `bulog`, `harga`, `jarak`). Nama berkas harus sama persis dengan berkas acuan di
   `data/` repo dan baris header harus sama; format `.csv`/`.csv.gz` UTF-8. Versi lama dipindah ke `_arsip/<waktu>/`, setiap unggahan
   dicatat di `_log.jsonl`. Aset bronze memakai unggahan bila sumber otomatis gagal atau mode sumber = `manual`.
3. **Konfigurasi & secret**: mengubah `pipeline/.env` dan `~/terawang-bot/bot/.env`. Secret tidak pernah dikirim utuh ke peramban
   (hanya 4 karakter terakhir), key BPS dan OpenAI bisa diuji. Cadangan 5 versi terakhir (`.env.bak-*`). Tombol muat ulang Dagster /
   nyalakan ulang bot supaya nilai baru terbaca (muat ulang Dagster ditolak bila ada run berjalan).

Semua tindakan dicatat di `~/.local/share/terawang/admin/jejak.jsonl` (halaman Jejak admin), tanpa nilai secret.

## Peran
| Peran | Dasbor | SPHP | Pipeline, unggah manual, jalankan job | Konfigurasi/secret, akun, jejak |
|---|---|---|---|---|
| guest (tanpa login) | ya | tidak | tidak | tidak |
| perusahaan (hilirisasi) | ya | ya | tidak | tidak |
| dinas | ya | ya | ya | tidak |
| superadmin | ya | ya | ya | ya |

Hak per peran ada di `akun.HAK`. Dasbor membaca peran lewat `GET /admin/api/saya` (tanpa login = guest).
Akun dikelola superadmin di halaman **Akun & peran**; akun pertama dibuat di server: `.venv-pipeline/bin/python -m terawang_admin.sandi NAMA superadmin`.

## Keamanan
- Sandi di-hash scrypt di `~/.config/terawang/admin.json` (mode 600). Ganti sandi/peran atau nonaktifkan akun = sesi lama akun itu keluar.
  Selalu harus ada minimal satu superadmin aktif.
- Sesi: cookie `tw_sesi` `HttpOnly; Secure; SameSite=Strict; Path=/` (supaya dasbor tahu peran), 12 jam. Permintaan yang mengubah sesuatu wajib header `X-Terawang-Admin`.
- 5 kali salah sandi dalam 15 menit per IP = dikunci sementara.
- Layanan hanya mendengar di IP bridge Docker; satu-satunya jalan masuk lewat Traefik (HTTPS).

## Pasang / perbarui (VPS)
```bash
cd ~/terawang-pipeline && git pull
ADMIN_HOST=172.19.0.1 DAGSTER_HOST=172.19.0.1 bash deploy/deploy-admin.sh
.venv-pipeline/bin/python -m terawang_admin.sandi admin superadmin   # akun pertama, atau atur ulang sandi
```
Sekali sebagai root: salin `deploy/traefik-admin.yml` ke `/opt/traefik/dynamic/terawang-admin.yml` dan izinkan bridge Docker ke port 3071 di ufw.

## Uji lokal
```bash
cd admin && TERAWANG_ADMIN_COOKIE_SECURE=0 DAGSTER_GRAPHQL=http://127.0.0.1:3070/graphql \
  TERAWANG_ADMIN_AKUN=/tmp/admin.json uvicorn terawang_admin.app:app --port 3071
```
