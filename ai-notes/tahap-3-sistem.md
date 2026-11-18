# Tahap 3 — Jadi sistem (23–25 Nov)

**Tujuan:** dashboard tidak lagi membaca JSON statis hasil sekali jalan. Mengubah data sumber lalu menjalankan pipeline otomatis mengubah dashboard.

## Tugas

1. **Backend tipis (FastAPI).** Endpoint: `/produksi`, `/stok`, `/harga`, `/rekomendasi`, `/wilayah/{id}`, `/status`. Isinya hasil pipeline yang disimpan sebagai file cache.
2. **Pipeline terjadwal.** Satu skrip `scripts/run_pipeline.py`: GEE → K1 → K2 → K3 → SPHP → simpan. Dijalankan lewat cron di VPS (misalnya harian). Sertakan log dan waktu pembaruan terakhir.
3. **Akses GEE tanpa login manual.** Buat service account untuk Earth Engine dan simpan kuncinya di VPS (jangan di repo). Cek kuota.
4. **Dashboard mengambil data dari API**, dengan fallback ke file statis kalau API mati (supaya demo aman).
5. **Tampilkan "Terakhir diperbarui"** dan status pipeline di footer (`AppShell`).
6. **Update deploy.** `deploy/deploy-vps.sh` menjalankan backend dan frontend, mendaftarkan cron, dan tetap tanpa sudo. `deploy/serve.py` bisa meneruskan `/api` ke backend atau diganti.

## Catatan

- Rahasia (kunci GEE, token WhatsApp) disimpan di environment atau berkas di luar repo, dan masuk `.gitignore`.
- Cron sebaiknya idempoten: dijalankan dua kali tidak merusak data.
- Simpan hasil run terakhir yang sukses supaya UI tetap punya data kalau run gagal.

## File yang kemungkinan disentuh

- `api/` atau `server/` (baru, FastAPI)
- `scripts/run_pipeline.py` (baru)
- `deploy/deploy-vps.sh`, `deploy/serve.py`
- `src/lib/*` (klien API), `src/components/layout/AppShell.tsx`

## Selesai kalau

- Endpoint API menjawab dengan data yang sama dengan yang tampil di dashboard.
- Menjalankan `run_pipeline.py` (atau menunggu cron) memperbarui dashboard.
- Matikan API, dashboard tetap tampil lewat fallback.
- Deploy bisa diulang dengan satu perintah.
