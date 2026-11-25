# Draf buku pedoman panel admin TERAWANG

Teks penjelasan yang dipindah dari panel admin (25 Nov 2026) supaya halaman ringkas. Dipakai sebagai bahan buku pedoman.

## Halaman

- **Konfigurasi & secret**: Secret tidak pernah ditampilkan utuh, hanya 4 karakter terakhir. Mengisi kolom secret berarti mengganti nilainya. Setelah menyimpan, muat ulang layanan supaya nilai baru dipakai. Lima cadangan terakhir disimpan, setiap perubahan tercatat di jejak.
- **Akun & peran**: Guest tidak perlu akun. Mengubah peran, mengatur ulang sandi, atau menonaktifkan akun langsung mengeluarkan sesi akun itu.
- **Jejak admin**: Login, perubahan konfigurasi, unggahan, dan job yang dijalankan dari halaman ini. Nilai secret tidak dicatat.
- **Sumber data · Data terkini**: Berkas yang dibaca pipeline pada pembaruan terakhir, dengan asalnya: otomatis (hasil API/konektor), manual (unggahan), atau repo (CSV bawaan). Konektor menimpa berkas di tempat, jadi yang bisa dilihat hanya versi terakhir.
- **Sumber data · Unggah manual**: Dipakai kalau pengambilan otomatis gagal. Nama berkas dan baris kolom harus sama persis dengan berkas acuan. Seret berkas ke barisnya atau tekan Unggah.
- **Bot WhatsApp**: Satu nomor WhatsApp untuk bot TERAWANG. Pesan warga masuk ke GoWA, diteruskan ke bot lewat webhook, dijawab dari database (perintah baku) atau OpenAI (pesan bebas), lalu dikirim balik lewat GoWA. Hanya satu device GoWA yang dipakai bot; device lain bisa dilepas.

## Variabel konfigurasi

### pipeline

- `BPS_WEBAPI_KEY` (Key WebAPI BPS): Dipakai aset bronze_bps (WebAPI) dan bronze_bulog (mencari PDF Jatim Dalam Angka). Ambil di webapi.bps.go.id.
- `TERAWANG_SUMBER_BPS` (Sumber data BPS), pilihan: berkas, webapi, manual: webapi = ambil otomatis; manual = pakai unggahan di tab Unggah manual; berkas = CSV di repo.
- `TERAWANG_SUMBER_BULOG` (Sumber data Bulog), pilihan: berkas, jda, manual: jda = ambil dari PDF Jatim Dalam Angka; manual = pakai unggahan.
- `TERAWANG_SUMBER_HARGA` (Sumber harga beras), pilihan: berkas, siskaperbapo, manual: siskaperbapo = unduh harga harian otomatis.
- `TERAWANG_SUMBER_CITRA` (Sumber citra satelit), pilihan: berkas, gee: gee = hitung ulang di Google Earth Engine (butuh GEE_PROJECT).
- `GEE_PROJECT` (Project Google Earth Engine): ID project Cloud yang terdaftar di Earth Engine (noncommercial).
- `DATABASE_URL` (URL database terawang): Salah isi = seluruh pipeline gagal. Ubah hanya kalau sandi/role DB diganti.
- `DAGSTER_PG_URL` (URL database riwayat Dagster): Penyimpanan riwayat run Dagster. Salah isi = Dagster tidak bisa jalan.

### bot

- `OPENAI_API_KEY` (API key OpenAI): Untuk menjawab pesan bebas di bot WhatsApp. Kosong = bot hanya melayani perintah baku.
- `OPENAI_MODEL` (Model OpenAI), pilihan: gpt-5-nano, gpt-6-luna, gpt-4o-mini, gpt-5.4-nano, gpt-5.6-luna, gpt-5-mini, gpt-4.1-mini, gpt-5.4-mini: Perkiraan biaya per pesan bebas (±2.500 token masuk, ±250 keluar; harga OpenAI Nov 2026) dan jumlah pesan per $5: gpt-5-nano ±$0,0002 (±22 rb) · gpt-6-luna ±$0,0004 (±13 rb) · gpt-4o-mini ±$0,0005 (±9 rb) · gpt-5.4-nano / gpt-5.6-luna ±$0,0008 (±6 rb) · gpt-5-mini ±$0,0011 (±4,5 rb, disarankan) · gpt-4.1-mini ±$0,0014 (±3,5 rb) · gpt-5.4-mini ±$0,003 (±1,6 rb). Perintah baku tidak memakai token.
- `OPENAI_REASONING_EFFORT` (Tingkat penalaran), pilihan: none, minimal, low, medium: Hanya untuk model gpt-5/gpt-6. Makin tinggi makin mahal dan lambat. Kosongkan untuk gpt-4o/4.1.
- `LLM_BATAS_HARIAN` (Batas pesan LLM per nomor per hari)
- `LLM_BATAS_10MENIT` (Batas pesan LLM per nomor per 10 menit): Anti-spam. Lewat batas, bot hanya melayani perintah baku.
- `LLM_TOKEN_HARIAN` (Anggaran token seluruh bot per hari): Lewat dari ini pesan bebas ditolak sampai besok. Batas keras tetap pasang di dasbor OpenAI (Settings > Limits).
- `LLM_MAKS_KELUARAN` (Token keluaran maks. per panggilan)
- `LLM_MAKS_MASUKAN` (Panjang pesan maks. ke LLM (karakter))
- `LLM_CACHE_MENIT` (Cache jawaban LLM (menit)): Pertanyaan sama dijawab dari cache. 0 = mati.
- `ADMIN_WA` (Nomor WA admin): Format 628xx, pisahkan dengan koma.
- `SIARAN_AKTIF` (Siaran peringatan aktif), pilihan: 1, 0
- `SIARAN_INTERVAL_MENIT` (Interval cek siaran (menit))
- `HET_MEDIUM` (HET beras medium cadangan (Rp/kg))
- `BOT_API_TOKEN` (Token API simulator dasbor)
- `WHATSAPP_WEBHOOK_SECRET` (Secret webhook GoWA): Harus sama dengan ~/terawang-wa/.env, kalau tidak webhook ditolak.
- `GOWA_BASIC_AUTH` (Basic auth GoWA)
- `GOWA_URL` (URL GoWA)
- `DATABASE_URL` (URL database (role bot))

## Guard rail bot

Lihat `bot/README.md` di branch bot-whatsapp (urutan pemeriksaan pesan bebas, batas per nomor, anggaran token harian, cache).

## Aset dan job pipeline (Dagster)

- `bronze_harga`: Harga konsumen beras harian per pasar, 38 kab/kota (SISKAPERBAPO; cadangan: unggahan manual/harga).
- `bronze_citra`: Olahan citra Sentinel-1/2 per wilayah dari Google Earth Engine (gee_wilayah.json).
- `bronze_titik_satelit`: Deret 12-harian VH, VV (Sentinel-1) dan LSWI, EVI (Sentinel-2) di 15.200 titik sawah, bahan K1. Mode gee: diperpanjang dari GEE sampai hari ini.
- `bronze_bps`: BPS: luas panen dan produksi beras bulanan per kab/kota, konsumsi beras (WebAPI BPS); penduduk dan angka sementara/potensi dari CSV repo atau unggahan manual (tidak tersedia di WebAPI).
- `bronze_bulog`: Bulog Kanwil Jatim: stok bulanan, stok per kanwil, pengadaan, harga penggilingan, HPP. Diekstrak dari PDF Provinsi Jawa Timur Dalam Angka edisi terbaru (terbit tiap Februari); cadangan: unggahan manual/bulog.
- `bronze_jarak`: Matriks jarak dan waktu tempuh antar kab/kota (OSRM). Pembaruan: unggahan manual/jarak.
- `k1_nowcast_citra`: K1 (Danang): taksiran luas panen dari citra, jarak 0/28/56 hari (scripts/k1/nowcast_est2.py), Okt 2026 sampai bulan ini + 2.
- `k1_prediksi_produksi`: K1 (Danang): produksi beras per kab/kota per bulan, model gabungan citra + klimatologi + musiman -> app.prediksi_produksi.
- `k2_estimasi_stok`: K2 (Danang): neraca stok per kab/kota, arus antar kab (LP jarak jalan), pita ketidakpastian, 3 skenario P10/P50/P90 -> app.estimasi_stok.
- `k3_prediksi_harga`: K3a (Danang): prakiraan harga harian 7/14/21/28 hari, P10-P90 dari galat empiris 365 hari, status terhadap HET (scripts/k3/k3_harga_operasional.py) -> app.prediksi_harga.
- `k3_rekomendasi_sphp`: K3b (Danang): rencana penyaluran SPHP dari cabang Bulog ke kab/kota, bulan berjalan sampai +2, LP stokastik dari stok K2 dan peluang harga > HET K3a (scripts/k3/k3b_sphp.py) -> app.rekomendasi_sphp.
- `deret_satelit_wilayah`: Deret 12-harian EVI, LSWI (Sentinel-2) dan VH (Sentinel-1) per kab/kota: median titik sawah, 15 akuisisi terakhir + rata-rata tanggal yang sama tahun-tahun sebelumnya -> deret_satelit.json (grafik profil sinyal di halaman Produksi).
- `status_wilayah`: Status gabungan per kab/kota hari ini -> app.status_wilayah.
- `peringatan`: Peringatan aktif (stok dan harga) untuk dasbor dan siaran bot -> app.peringatan.
- job `pipeline_penuh`: Semua sumber -> silver -> K1, K2, K3, SPHP -> status dan peringatan.
- job `pipeline_harga_harian`: Ambil harga terbaru -> silver harga -> K3 -> status dan peringatan.
- job `pipeline_citra`: Citra Sentinel terbaru dari GEE -> silver satelit dan deret titik sawah -> K1 (nowcast citra, produksi), K2, SPHP -> status dan peringatan.
