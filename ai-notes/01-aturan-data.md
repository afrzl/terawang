# Aturan data MVP

Diperbarui 17 Nov 2026. Detail tiap data ada di `README.md` foldernya (`data/…`). Tautan sudah diuji terbuka.

**Otomatis?** Ya = skrip ada di repo. Sebagian = bisa, tapi ada kendala (PDF, halaman JavaScript, terbit tahunan), saat ini manual + validasi. Tidak = data tidak publik.

## 1. Sudah terkumpul

| Data | Sumber | Otomatis? | Catatan |
|---|---|---|---|
| Citra satelit: luas sawah (proksi), indeks tanam, fase, VH | GEE: [Sentinel-1](https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S1_GRD), [Sentinel-2](https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S2_SR_HARMONIZED), [WorldCover](https://developers.google.com/earth-engine/datasets/catalog/ESA_WorldCover_v200) | Ya | `scripts/gee/terawang_wilayah.py`. **Produktivitas konstan 5,6 t/ha** (placeholder, bukan model). |
| Batas 38 kab/kota | [FAO GAUL 2015](https://developers.google.com/earth-engine/datasets/catalog/FAO_GAUL_2015_level2) | Ya | `public/citra/jatim/kab.geojson` |
| Luas panen dan produksi padi per kab (tahunan, periode, **bulanan 2025**) | BPS Jatim: [BRS 2 Nov 2026](https://jatim.bps.go.id/id/pressrelease/2026/11/02/168587/luas-panen-padi-mencapai-1-85-juta-hektare-dengan-produksi--padi-sebanyak-10-61-juta-ton-gabah-kering-giling--gkg--di-2026.html), [BRS 2 Feb 2026](https://jatim.bps.go.id/en/pressrelease/2026/02/02/1549/pada-2025--luas-panen-padi-mencapai-1-84-juta-hektare-dengan-produksi--padi-sebanyak-10-44-juta-ton-gabah-kering-giling--gkg-.html); tabel bulanan: [luas panen](https://jatim.bps.go.id/en/statistics-table/2/NTc4IzI=/luas-panen-padi-menurut-kabupaten-kota.html), [produksi beras](https://jatim.bps.go.id/en/statistics-table/2/NTgwIzI=/rice-production-by-regency-municipality.html) | Sebagian | `data/bps/produksi_padi/`. 2026 masih sementara. Bulanan baru 2025 (2019–2024 menyusul). 5 salah ketik sumber dikoreksi. |
| Penduduk per kab/kota | BPS Jatim: [*Jawa Timur Dalam Angka 2026*](https://jatim.bps.go.id/en/publication/2026/02/27/19b010f5faca007f15a32d23/provinsi-jawa-timur-dalam-angka-2026.html), Tabel 3.1.1 | Sebagian | `data/bps/penduduk/`. Menggantikan WorldPop di repo (kurang 19%). |
| Konsumsi beras per kab/kota | BPS: [tabel 2094](https://www.bps.go.id/id/statistics-table/2/MjA5NCMy/rata-rata-konsumsi-perkapita-seminggu-menurut-kelompok-padi-padian-per-kabupaten-kota.html) (Susenas Maret 2025) | Sebagian | `data/bps/konsumsi_beras/kabkota/`. Kg per minggu, ×30/7 untuk bulan. Halaman JavaScript, dibaca lewat browser. |
| Konsumsi beras per provinsi | BPS: [*Pengeluaran untuk Konsumsi Penduduk Indonesia Sep 2025*](https://www.bps.go.id/id/publication/2026/05/29/057b21b35bc236c5ede9d160/pengeluaran-untuk-konsumsi-penduduk-indonesia-september-2025.html) | Sebagian | Angka 6,39 kg di repo adalah **nasional**. Jatim 6,22 kg. |
| Stok Bulog Jatim bulanan 2025, pengadaan, harga penggilingan, HPP | BPS Jatim: *Jawa Timur Dalam Angka 2026* (di atas), Tabel 10.1.3–10.1.7 (sumber asli: Bulog Kanwil Jatim) | Sebagian | `data/bulog/`. **Hanya stok Bulog**, tingkat provinsi. Harga penggilingan 2025 = 2024 × 1,02, bukan pengamatan. |
| Harga beras konsumen (medium, premium), harian per pasar, 38 kab/kota | [SISKAPERBAPO Jatim](https://siskaperbapo.jatimprov.go.id/harga-komoditas), [panduan](https://siskaperbapo.jatimprov.go.id/panduan_manual_SISKAPERBAPO.pdf) | Ya | `scripts/siskaperbapo/ambil_harga.py`, `data/siskaperbapo/`. Dari Des 2021. Belum dijadwalkan. |
| Jarak antar kab/kota (garis lurus, jalan, waktu) | `kab.geojson` + [OSRM demo](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server) | Ya | `scripts/geo/jarak_kabkota.py`, `data/geografi/`. Status **model**, antar titik pusat wilayah. |

## 2. Dummy, tidak tersedia, atau belum diverifikasi

| Data | Sumber | Otomatis? | Catatan |
|---|---|---|---|
| Stok per kab, pedagang, penggilingan, rumah tangga | Tidak dipublikasikan. Hanya survei nasional: [Survei Cadangan Beras Nasional Juni 2022](https://www.antaranews.com/berita/3045529/cadangan-beras-nasional-juni-2022-971-juta-ton) (rumah tangga 68%, Bulog 11%, pedagang 11%, penggilingan 7%) | Tidak | **Dummy berlabel**, lihat bagian 3. |
| Ubinan per kab | Data mikro BPS lewat PST | Tidak | Dummy atau dilewati. |
| Arus beras antarwilayah | Tidak ada | Tidak | Dummy berlabel. |
| Luas baku sawah per kab | ATR/BPN (total Jatim 1.206.475 ha, [ANTARA](https://jatim.antaranews.com/berita/1066985/atr-bpn-perbarui-data-sawah-di-jatim-dukung-swasembada-pangan)) | ? | Per kab belum ditemukan. |
| **HET/HAP resmi beras** | Peraturan Bapanas (tautan belum ditemukan) | ? | Repo memakai Rp13.500 / Rp13.900, **belum diverifikasi**. Menentukan label waspada/siaga. |
| Pemetaan cabang Bulog ke kab; realisasi SPHP | Perum Bulog | Tidak | Tanpa ini data Bulog tidak bisa dipecah ke kab. |
| Stok Bulog 2024 | BPS: [*Jatim Dalam Angka 2025*](https://jatim.bps.go.id/en/publication/2025/02/28/5ae8b994b1bebd8cbc2e0781/provinsi-jawa-timur-dalam-angka-2025.html) | Sebagian | Belum dicek. |
| Curah hujan | [CHIRPS](https://developers.google.com/earth-engine/datasets/catalog/UCSB-CHG_CHIRPS_DAILY) lewat GEE | Ya | Opsional. |
| Harga produsen Bapanas | [Panel Harga](https://panelharga.badanpangan.go.id) | Tidak | Tidak dipakai: antarmuka publik hanya produsen, harga konsumen butuh kunci API. |

## 3. Stok (K2): cara menggantikan data yang tidak ada

- **Rumus per kab per bulan:** stok = stok lalu + produksi − konsumsi.
- **Produksi:** beras bulanan per kab (BPS, 2025 langsung tersedia). **Konsumsi:** penduduk × konsumsi per kapita kab.
- **Jangkar:** stok Bulog Jatim bulanan, untuk mencocokkan pola dan skala (Bulog hanya sebagian stok).
- **Stok awal (satu-satunya tebakan):** rasio stok terhadap konsumsi bulanan dari survei nasional Juni 2022 × konsumsi tiap kab. Ditampilkan sebagai rentang rendah/tengah/tinggi, label `dummy`.

## 4. Label sumber (wajib di setiap angka)

- `asli`: langsung dari sumber resmi atau satelit.
- `model`: dihitung dari data asli (termasuk jarak dan konsumsi turunan).
- `dummy`: dibangkitkan, **tidak boleh disajikan sebagai data nyata**.

UI menampilkan badge sumber di setiap panel.

```ts
type Sumber = "asli" | "model" | "dummy"
interface Produksi    { wilayah: string; periode: string; est: number; bps?: number; mape?: number; sumber: Sumber }
interface Stok        { wilayah: string; bulan: string; stok: number; status: "cukup"|"tipis"|"defisit"; sumber: Sumber }
interface Harga       { wilayah: string; tanggal: string; harga: number; prediksi?: {m:number;lo:number;hi:number}; status: "aman"|"waspada"|"siaga"; sumber: Sumber }
interface Rekomendasi { dari: string; ke: string; volumeTon: number; sumber: Sumber }
```

## 5. Prinsip

1. Mengganti dummy dengan data asli tidak boleh mengubah UI.
2. MAPE selalu ditampilkan apa adanya, termasuk kalau jelek.
3. Data disimpan di `data/<sumber>/<topik>/` dengan `README.md` (sumber, kolom, validasi).
4. Nama wilayah mengikuti BPS (`Kota Batu`, `Pacitan`). SISKAPERBAPO beda, cara menyamakannya ada di README-nya.
5. Sumber baru wajib dicatat di tabel dengan tautan yang sudah diuji.
