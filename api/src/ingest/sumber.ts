/** Daftar asal-usul data. Setiap baris fakta merujuk ke salah satu kode di sini. Tanggal ambil: 17 Nov 2026. */
export interface DefSumber {
  kode: string
  nama: string
  penerbit: string
  nomor_rilis?: string
  url?: string
  tanggal_terbit?: string
  tanggal_ambil: string
  catatan?: string
}

const AMBIL = "2026-11-17"
const BPS_JATIM = "BPS Provinsi Jawa Timur"
const JDA_2026 = "https://jatim.bps.go.id/en/publication/2026/02/27/19b010f5faca007f15a32d23/provinsi-jawa-timur-dalam-angka-2026.html"

export const SUMBER: DefSumber[] = [
  {
    kode: "bps_brs_71_11_35_2026",
    nama: "Luas Panen dan Produksi Padi di Provinsi Jawa Timur 2026 (Angka Sementara, Hasil KSA Amatan September 2026)",
    penerbit: BPS_JATIM,
    nomor_rilis: "BRS No. 71/11/35/Th. XXIV",
    url: "https://jatim.bps.go.id/id/pressrelease/2026/11/02/168587/luas-panen-padi-mencapai-1-85-juta-hektare-dengan-produksi--padi-sebanyak-10-61-juta-ton-gabah-kering-giling--gkg--di-2026.html",
    tanggal_terbit: "2026-11-02",
    tanggal_ambil: AMBIL,
    catatan: "2025 angka tetap; 2026 Jan-Agu tetap, Sep sementara, Okt-Des potensi.",
  },
  {
    kode: "bps_brs_11_02_35_2026",
    nama: "Luas Panen dan Produksi Padi di Provinsi Jawa Timur 2025 (Angka Tetap)",
    penerbit: BPS_JATIM,
    nomor_rilis: "BRS No. 11/02/35/Th. XXIV",
    url: "https://jatim.bps.go.id/en/pressrelease/2026/02/02/1549/pada-2025--luas-panen-padi-mencapai-1-84-juta-hektare-dengan-produksi--padi-sebanyak-10-44-juta-ton-gabah-kering-giling--gkg-.html",
    tanggal_terbit: "2026-02-02",
    tanggal_ambil: AMBIL,
  },
  {
    kode: "bps_tabel_luas_panen_produksi_kabkota_bulanan",
    nama: "Rice Harvest Area by Regency/Municipality (Hectare) dan Rice Production by Regency/Municipality (Tons), 2025",
    penerbit: BPS_JATIM,
    nomor_rilis: "Tabel dinamis 578 dan 580",
    url: "https://jatim.bps.go.id/en/statistics-table/2/NTc4IzI=/luas-panen-padi-menurut-kabupaten-kota.html",
    tanggal_terbit: "2026-03-06",
    tanggal_ambil: AMBIL,
    catatan: "Dari Survei KSA. Produksi dalam beras (ton). Lima salah ketik di sumber dikoreksi (lihat kolom koreksi).",
  },
  {
    kode: "bps_jda_2026_penduduk",
    nama: "Provinsi Jawa Timur Dalam Angka 2026, Tabel 3.1.1 (Jumlah Penduduk menurut Kabupaten/Kota)",
    penerbit: BPS_JATIM,
    url: JDA_2026,
    tanggal_terbit: "2026-02-27",
    tanggal_ambil: AMBIL,
    catatan: "Angka asli: Proyeksi Penduduk Indonesia 2020-2050 hasil SP2020 (tengah tahun).",
  },
  {
    kode: "bps_jda_2026_bulog",
    nama: "Provinsi Jawa Timur Dalam Angka 2026, Tabel 10.1.3 sampai 10.1.7 (Bulog)",
    penerbit: BPS_JATIM,
    url: JDA_2026,
    tanggal_terbit: "2026-02-27",
    tanggal_ambil: AMBIL,
    catatan: "Sumber asli: Kantor Wilayah Perum Bulog Provinsi Jawa Timur.",
  },
  {
    kode: "bps_susenas_maret_2025_tabel_2094",
    nama: "Rata-rata Konsumsi Perkapita Seminggu Menurut Kelompok Padi-Padian per Kabupaten/Kota (Satuan Komoditas), 2025",
    penerbit: "BPS",
    nomor_rilis: "Tabel dinamis 2094",
    url: "https://www.bps.go.id/id/statistics-table/2/MjA5NCMy/rata-rata-konsumsi-perkapita-seminggu-menurut-kelompok-padi-padian-per-kabupaten-kota.html",
    tanggal_terbit: "2026-01-05",
    tanggal_ambil: AMBIL,
    catatan: "Susenas Maret 2025. Kg per kapita per minggu.",
  },
  {
    kode: "bps_susenas_sep_2025_konsumsi",
    nama: "Pengeluaran untuk Konsumsi Penduduk Indonesia September 2025",
    penerbit: "BPS",
    nomor_rilis: "Katalog 3201004",
    url: "https://www.bps.go.id/id/publication/2026/05/29/057b21b35bc236c5ede9d160/pengeluaran-untuk-konsumsi-penduduk-indonesia-september-2025.html",
    tanggal_terbit: "2026-05-29",
    tanggal_ambil: AMBIL,
    catatan: "Tabel 7.1-7.38. Kg per kapita per bulan.",
  },
  {
    kode: "siskaperbapo_harga_komoditas",
    nama: "SISKAPERBAPO: Harga Konsumen (per Komoditas)",
    penerbit: "Pemprov Jawa Timur",
    url: "https://siskaperbapo.jatimprov.go.id/harga-komoditas",
    tanggal_ambil: AMBIL,
    catatan: "Harga eceran harian per pasar. Skrip: scripts/siskaperbapo/ambil_harga.py.",
  },
  {
    kode: "gee_terawang_wilayah",
    nama: "Hasil olahan citra satelit per kab/kota (Sentinel-1, Sentinel-2, ESA WorldCover) lewat Google Earth Engine",
    penerbit: "TERAWANG (olahan GEE)",
    url: "https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S2_SR_HARMONIZED",
    tanggal_ambil: "2026-11-09",
    catatan: "Aturan ambang belum divalidasi lapangan. Produktivitas konstan 5,6 t/ha. Skrip: scripts/gee/terawang_wilayah.py.",
  },
  {
    kode: "fao_gaul_2015",
    nama: "FAO GAUL 2015 level 2 (batas administrasi)",
    penerbit: "FAO",
    url: "https://developers.google.com/earth-engine/datasets/catalog/FAO_GAUL_2015_level2",
    tanggal_ambil: "2026-11-09",
    catatan: "Dipakai untuk batas dan titik pusat kab/kota. Berkas: public/citra/jatim/kab.geojson.",
  },
  {
    kode: "terawang_jarak_osrm",
    nama: "Jarak antar kab/kota: garis lurus dari batas wilayah, jalan dan waktu dari OSRM demo publik",
    penerbit: "TERAWANG (olahan OSRM, data OpenStreetMap)",
    url: "https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server",
    tanggal_ambil: AMBIL,
    catatan: "Antar titik pusat wilayah. Skrip: scripts/geo/jarak_kabkota.py.",
  },
]
