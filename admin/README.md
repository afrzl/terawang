# Halaman admin TERAWANG

`https://terawang.tech/admin` — wajib login. Tiga bagian:

1. **Pipeline**: status tiap aset Dagster (hasil langkahnya di run terakhir), run terakhir, dan log per run. Aset/run gagal
   disorot merah, galat dan penyebabnya ditampilkan di atas. Bisa memasukkan job (`pipeline_penuh`, `pipeline_harga_harian`,
   `pipeline_citra`) ke antrean; daemon yang menjalankannya. Data dibaca dari GraphQL Dagster (webserver read-only tetap melayani query).
2. **Unggah manual**: fallback saat konektor otomatis gagal. Berkas disimpan di `TERAWANG_MANUAL_DIR/<sumber>/`
   (`~/.local/share/terawang/manual`, sumber = `bps`, `bulog`, `harga`, `jarak`). Nama berkas harus sama persis dengan berkas acuan di
   `data/` repo dan baris header harus sama; format `.csv`/`.csv.gz` UTF-8. Versi lama dipindah ke `_arsip/<waktu>/`, setiap unggahan
   dicatat di `_log.jsonl`. Aset bronze memakai unggahan bila sumber otomatis gagal atau mode sumber = `manual`.
3. **Konfigurasi & secret**: mengubah `pipeline/.env` dan `~/terawang-bot/bot/.env`. Secret tidak pernah dikirim utuh ke peramban
   (hanya 4 karakter terakhir), key BPS dan OpenAI bisa diuji. Cadangan 5 versi terakhir (`.env.bak-*`). Tombol muat ulang Dagster /
   nyalakan ulang bot supaya nilai baru terbaca (muat ulang Dagster ditolak bila ada run berjalan).

Semua tindakan dicatat di `~/.local/share/terawang/admin/jejak.jsonl` (tab Jejak), tanpa nilai secret.

## Keamanan
- Satu akun admin, sandi di-hash scrypt di `~/.config/terawang/admin.json` (mode 600). Ganti sandi = semua sesi lama keluar.
- Sesi: cookie `HttpOnly; Secure; SameSite=Strict; Path=/admin`, 12 jam. Permintaan yang mengubah sesuatu wajib header `X-Terawang-Admin`.
- 5 kali salah sandi dalam 15 menit per IP = dikunci sementara.
- Layanan hanya mendengar di IP bridge Docker; satu-satunya jalan masuk lewat Traefik (HTTPS).

## Pasang / perbarui (VPS)
```bash
cd ~/terawang-pipeline && git pull
ADMIN_HOST=172.19.0.1 DAGSTER_HOST=172.19.0.1 bash deploy/deploy-admin.sh
.venv-pipeline/bin/python -m terawang_admin.sandi admin     # sekali, atau untuk ganti sandi
```
Sekali sebagai root: salin `deploy/traefik-admin.yml` ke `/opt/traefik/dynamic/terawang-admin.yml` dan izinkan bridge Docker ke port 3071 di ufw.

## Uji lokal
```bash
cd admin && TERAWANG_ADMIN_COOKIE_SECURE=0 DAGSTER_GRAPHQL=http://127.0.0.1:3070/graphql \
  TERAWANG_ADMIN_AKUN=/tmp/admin.json uvicorn terawang_admin.app:app --port 3071
```
