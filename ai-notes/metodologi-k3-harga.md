# Metodologi K3a: peringatan dini harga beras per kabupaten/kota

Skrip: `scripts/k3/k3_harga_operasional.py`. Hasil: `app.prediksi_harga` (model_run 7, jenis_data MODEL, 304 baris) dan `data/satelit/k3_harga_operasional.csv`. Gambar rumus: `ai-notes/gambar-k3-rumus.png`. Rekomendasi SPHP (K3b): `ai-notes/metodologi-k3b-sphp.md`.

## Model

Naif ditambah sebaran galat empiris (bukan ML). Harga harian per kab, komoditas medium dan premium, horizon 7, 14, 21, 28 hari.

```
p0      = harga harian terakhir
galat_h = log( p_{t+h} / p_t )  pada 365 hari terakhir (hanya galat yang targetnya sudah terjadi)
harga_h = p0 · exp( kuantil(galat_h) )                     # median dan pita P10–P90
P(>HET) = porsi galat_h yang melebihi log(HET / p0)
```

Status:
- **SIAGA**: P(> 1,05·HET) ≥ max(ambang, 0,5)
- **WASPADA**: P(> HET) ≥ ambang per horizon
- **AMAN**: selain itu

Ambang WASPADA dikalibrasi per horizon pada F1 maksimum (backtest rolling-origin sejak 22 Agu 2025, saat HET berlaku):

| Komoditas | 7 hari | 14 hari | 21 hari | 28 hari | F1 |
|---|---|---|---|---|---|
| Medium | 0,15 | 0,20 | 0,25 | 0,30 | 0,14–0,21 |
| Premium | 0,10 | 0,10 | 0,10 | 0,25 | 0,06–0,14 |

## Mengapa naif + sebaran galat

- Harga eceran persisten; pada kebanyakan minggu harga datar, sehingga naif sulit dikalahkan.
- Uji ML (ridge, GBM kuantil mingguan dan harian, fitur harga, selisih premium–medium, jarak ke HET, iklim panen): tidak konsisten mengalahkan naif. Ridge hanya lebih baik pada minggu harga bergerak. GBM harian unggul tipis (Brier +1–3,5%) hanya di 7 hari, dan jauh lebih buruk di 28 hari untuk lintasan HET.
- Jendela 52 minggu lebih terkalibrasi daripada seluruh riwayat.
- Peluang lewat HET dihitung langsung dari sebaran galat, sehingga menjawab pertanyaan kebijakan (apakah harga akan melewati HET), bukan sekadar titik harga.
- Dasar ilmiah: naif/random walk sebagai pembanding standar peramalan; sebaran galat empiris mirip pendekatan conformal/kuantil empiris. Median galat dipakai pada harga titik karena kuat terhadap pencilan, rerata galat log ke arah eksponen condong oleh ekor.

## Variabel dan status data

| Variabel | Sumber | Status |
|---|---|---|
| Harga harian per kab (medium, premium) | Data harga harian sumber kita | **ASLI** |
| HET medium 13.500, premium 14.900 (berlaku 22 Agu 2025) | `app.ambang_harga`, dari pemberitaan Kepbadan 299/2025 | **ASLI, belum diverifikasi ke teks resmi** |
| Prakiraan harga, P(>HET), status | Model di atas | **MODEL** |
| Ambang WASPADA/SIAGA | Kalibrasi F1 pada backtest | **MODEL** (kebijakan ambang dapat diubah pengguna) |

## Hasil uji

- Galat titik harian lebih kecil daripada mingguan karena data awal lebih segar.
- Pita P10–P90 terlalu lebar: cakupan 91–93% terhadap nominal 80%. Jangan dibaca sebagai pita terkalibrasi.
- F1 rendah (0,06–0,21) karena lintasan HET jarang; status adalah peringatan peluang, bukan kepastian.

## Keterbatasan

- Hanya HET berlaku sejak 22 Agu 2025; HET sebelumnya belum dipakai, sehingga jumlah kejadian uji sedikit.
- Tidak memodelkan penyebab (stok, panen, impor); uji korelasi stok–harga tidak menemukan sinyal.
- Naif tidak menangkap titik balik; ML belum terbukti membantu.
- Ambang dikalibrasi pada sampel kecil; dapat bergeser saat data baru masuk.

## Rencana perbaikan

1. Verifikasi HET ke teks resmi Kepbadan 299/2025.
2. Uji Diebold–Mariano dan model lain (LSTM, RF) bila waktu ada.
3. Tambahkan indikator anomali gaya FAO.
4. Isi ulang tiap minggu dengan harga terbaru (model hanya butuh data baru, tanpa pelatihan ulang).
