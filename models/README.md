# terawang_models

Kode model TERAWANG. **Pemilik: Danang.** Pipeline Dagster (`../pipeline/`) hanya memanggil fungsi di sini; tidak ada logika model di pipeline.

## Kontrak

Setiap model adalah fungsi pandas murni: DataFrame masuk, DataFrame keluar, tanpa akses database, tanpa berkas, tanpa Dagster.
Jadi model bisa diuji di notebook atau skrip biasa, dan pipeline tidak perlu diubah selama nama kolom keluaran tetap.

| Modul | Fungsi | Masukan | Keluaran (ditulis pipeline ke) |
|---|---|---|---|
| `k1_produksi.py` | `prediksi_produksi` | produksi beras bulanan per kab | `app.prediksi_produksi` |
| `k2_stok.py` | `estimasi_stok` | produksi bulanan, penduduk, konsumsi per kapita | `app.estimasi_stok` |
| `k3_harga.py` | `prediksi_harga`, `backtest_naif` | harga harian per kab per komoditas | `app.prediksi_harga`, metrik di `app.model_run` |
| `sphp.py` | `rekomendasi_sphp` | saldo stok per kab, matriks jarak jalan | `app.rekomendasi_sphp` |

Setiap modul punya konstanta `VERSI` (disimpan di `app.model_run.nama_versi`) dan `JENIS_DATA` (`MODEL` atau `DUMMY`).
Naikkan `VERSI` setiap kali metode berubah supaya riwayat run bisa dibandingkan.

## Status sekarang

Semua isi saat ini adalah **baseline sederhana** supaya alur ujung ke ujung sudah jalan. Ganti isinya dengan model sungguhan
(Kalman, SARIMA/LightGBM, LP) tanpa mengubah tanda tangan fungsi dan nama kolom keluaran.

- K1: musiman naif (bulan yang sama pada tahun terakhir yang tersedia), interval ±10%.
- K2: neraca `stok = stok lalu + produksi - konsumsi` tanpa arus antarwilayah; stok awal 1/2/3 bulan konsumsi (**dummy**).
- K3: naif (harga terakhir), interval dari kuantil perubahan historis; backtest rolling 365 hari.
- SPHP: alokasi rakus ke wilayah surplus terdekat (jarak jalan), bukan LP.

## Uji cepat

```bash
pip install -e models
python -c "import terawang_models.k3_harga as m; print(m.VERSI)"
```
