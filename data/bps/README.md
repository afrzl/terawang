# Data BPS

Data resmi Badan Pusat Statistik, dikelompokkan **per topik**. Satu topik satu folder, dengan README sendiri yang mencatat sumber, kolom, dan validasi. Semua berstatus **asli** (lihat [aturan data](../../ai-notes/01-aturan-data.md)).

## Topik

| Folder | Isi | Dipakai untuk | Status |
|---|---|---|---|
| [produksi_padi/](produksi_padi/README.md) | Luas panen dan produksi padi (GKP, GKG, beras) Jawa Timur, kab/kota dan provinsi, 2024–2026 | Validasi K1, neraca stok K2 | Ada |
| [konsumsi_beras/](konsumsi_beras/README.md) | Konsumsi beras per kapita: **38 kab/kota Jatim** (kg/minggu, Susenas Maret 2025) dan Indonesia + 38 provinsi (kg/bulan, Susenas Sep 2025) | Neraca stok K2 | Ada |
| [penduduk/](penduduk/README.md) | Penduduk per kab/kota Jatim, 2020 (SP2020) dan proyeksi 2025–2026 | Neraca stok K2 | Ada |
| `harga_gabah/` | Harga gabah dan beras tingkat produsen | K3 | Belum ada |

## Aturan penamaan

- **Folder topik:** huruf kecil, underscore, nama topik (contoh: `produksi_padi`).
- **Di dalam topik:** pisahkan per tingkat wilayah (`kabkota`, `provinsi`), lalu per granularitas waktu (`tahunan`, `periode`, `bulanan`).
- **Berkas:** `bps_<provinsi>_<komoditas>_<tingkat>_<periode>_<tahun>.csv`. Akhiran pada tahun: `s` = angka sementara, `p` = angka potensi, tanpa akhiran = angka tetap.
- **Nama kolom:** satuan di akhir (`_ha`, `_ton`, `_jiwa`, `_kg_kapita_bulan`). Angka proyeksi memakai kata `proyeksi` di nama kolom.
- Setiap topik wajib punya `README.md` berisi sumber (nomor BRS atau tabel), arti kolom, dan hasil validasi.

## Pembaruan otomatis

Pipeline Dagster (mode `TERAWANG_SUMBER_BPS=webapi`) mengambil luas panen dan produksi beras bulanan per kab/kota serta konsumsi beras per kapita lewat WebAPI BPS (`scripts/bps/ambil_webapi.py`, var 578, 580, 2094), dengan koreksi salah ketik yang sama seperti berkas manual. Penduduk dan angka sementara/potensi tidak tersedia di WebAPI dan tetap dari folder ini atau unggahan manual. Berkas di folder ini menjadi cadangan.
