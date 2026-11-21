# terawang_models

Kode model TERAWANG. **Pemilik: Danang.** Pipeline Dagster (`../pipeline/`) hanya memanggil fungsi di sini; tidak ada logika model di pipeline.

## Kontrak

K1 dan K2 adalah **skrip asli Danang** di `scripts/k1/` dan `scripts/k2/`. Modul di sini hanya jembatan (`danang.py`): menyiapkan
cwd = akar repo, `sys.path`, dan `DATABASE_URL`, lalu memanggil fungsi skrip itu. Mengubah model = mengubah skrip Danang seperti
biasa; selama fungsi `k2_operasional.produksi()`, `hitung()`, `skenario()` dan `nowcast_est2.py --lead/--mulai/--akhir/--sufiks`
tetap ada, pipeline tidak perlu diubah. Skrip tetap bisa dijalankan manual (`python scripts/k2/k2_operasional.py [--simpan]`).

K3 dan SPHP masih fungsi pandas murni (DataFrame masuk, DataFrame keluar).

| Modul | Fungsi | Memanggil | Keluaran (ditulis pipeline ke) |
|---|---|---|---|
| `k1_produksi.py` | `perintah_nowcast`, `prediksi_produksi` | `scripts/k1/nowcast_est2.py`, `k2_operasional.produksi()` (`k1_prakiraan.prakiraan`) | `app.prediksi_produksi` |
| `k2_stok.py` | `estimasi_stok` | `scripts/k2/k2_operasional.hitung()`, `skenario()` | `app.estimasi_stok` |
| `k3_harga.py` | `prediksi_harga`, `backtest_naif` | harga harian per kab per komoditas | `app.prediksi_harga`, metrik di `app.model_run` |
| `sphp.py` | `rekomendasi_sphp` | saldo stok per kab, matriks jarak jalan | `app.rekomendasi_sphp` |

Setiap modul punya konstanta `VERSI` (disimpan di `app.model_run.nama_versi`) dan `JENIS_DATA` (`MODEL` atau `DUMMY`).
Naikkan `VERSI` setiap kali metode berubah supaya riwayat run bisa dibandingkan.

## Status sekarang

- K1 (Danang): gabungan citra per kab + klimatologi + musiman, taksiran citra nowcast v2 jarak 0/28/56 hari
  (aturan banjir optik + fusi S1). Pita P10-P90 dari galat relatif 0,15 (bulan berjalan) dan 0,30 (prakiraan).
- K2 (Danang): neraca stok + arus antar kab (LP jarak jalan) + pita ketidakpastian ala Kalman; jangkar stok awal asumsi
  (`ai-notes/metodologi-k2.md`). Horizon Jan 2026 sampai bulan berjalan + 2.
- K3: naif (harga terakhir), interval dari kuantil perubahan historis; backtest rolling 365 hari.
- SPHP: alokasi rakus ke wilayah surplus terdekat (jarak jalan), bukan LP.

## Uji cepat

```bash
pip install -e models
python -c "import terawang_models.k3_harga as m; print(m.VERSI)"
```
