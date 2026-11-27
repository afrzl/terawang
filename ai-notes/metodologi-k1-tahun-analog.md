# K1 versi 2026.11d: komponen musiman "tahun analog" (26 Nov 2026)

Disepakati tim 26 Nov 2026 (dokumen "Metodologi K1 TERAWANG"). Kode: `scripts/k1/k1_prakiraan.py` (kelas `Iklim`), data `data/iklim/`,
pembaruan operasional `scripts/iklim/perbarui_iklim.py` (aset Dagster `bronze_iklim`).

## Rumus
Komponen ketiga gabungan ("musiman") yang sebelumnya rata-rata 3 tahun terakhir kini rata-rata berbobot semua tahun final sebelumnya:

    bobot tahun j = exp(-1/2 [(dONI/0,5)^2 + (dHujan/0,4)^2]) x 0,85^(tahun target - j)

- dONI: selisih ONI (NOAA CPC) berpusat 5 bulan sebelum bulan target.
- dHujan: selisih log jumlah hujan CHIRPS kab 4-6 bulan sebelum bulan target (masa tanam; rata-rata piksel lahan pertanian).
  Kota Batu memakai hujan Kab. Malang (tidak ada poligon di GAUL 2015).
- Keduanya sudah terbit saat tanggal potong untuk jarak 0/28/56 hari. Bila belum tersedia, suku itu dilewati dan muncul peringatan.
- Bobot gabungan (NNLS leave-one-year-out, per kota/kab dan musim) tidak berubah.
- Catatan: dokumen metodologi tim memakai hujan ERA5 (Open-Meteo, titik pusat kab); pipeline memakai CHIRPS karena sudah ada di repo dan
  dirata-rata di lahan pertanian. Hasilnya setara.

## Hasil (python scripts/k1/uji_k1_ringkas.py)

| Jarak | Bergulir 2022-25 WAPE bulanan | Uji Jan-Sep 2026 produksi WAPE / MAPE / MAPE kab |
|---|---|---|
| 0 hari | 27,8 → 26,2% | 7,9 → 7,8% / 15,0 → 14,8% / 9,3 → 9,1% |
| 28 hari | 28,3 → 27,0% | 8,6 → 8,2% / 15,9 → 15,4% / 10,1 → 9,4% |
| 56 hari | 29,9 → 28,3% | 7,8 → 7,9% / 16,2 → 16,1% / 9,5 → 9,5% |

Pita galat empiris (`data/satelit/k1_galat_empiris.csv`) dihitung ulang: sd relatif kabupaten 0,46/0,47/0,51 → 0,43/0,45/0,47.
Uji lain (branch model-afrizal, `scripts/k1/uji_tahun_analog.py`): mengganti komponen klimatologi (bukan musiman) dengan tahun analog
pada versi 2026.11b juga membaik (28,6 → 24,9% kab). ONI sebagai pengali/regresor langsung TIDAK membaik (`ai-notes/uji-oni-k1.md`).
