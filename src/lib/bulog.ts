import { BULOG, IDX_AKHIR } from "./api"

/** Stok beras Bulog Jawa Timur per bulan, 2025 (ribu ton). ASLI: BPS, Provinsi Jawa Timur Dalam Angka 2026, Tabel 10.1.3 (sumber asli Kanwil Perum Bulog Jatim). Hanya tingkat provinsi. */
export interface StokBulogBulan {
  bulan: number
  awal: number
  masuk: number
  keluar: number
  akhir: number
}

export const STOK_BULOG_2025: StokBulogBulan[] = [
  { bulan: 1, awal: 250.4, masuk: 88.0, keluar: 16.2, akhir: 322.2 },
  { bulan: 2, awal: 322.2, masuk: 131.9, keluar: 9.9, akhir: 444.2 },
  { bulan: 3, awal: 444.2, masuk: 123.3, keluar: 28.8, akhir: 538.7 },
  { bulan: 4, awal: 538.7, masuk: 257.2, keluar: 57.9, akhir: 738.1 },
  { bulan: 5, awal: 738.1, masuk: 288.0, keluar: 108.8, akhir: 917.4 },
  { bulan: 6, awal: 917.4, masuk: 162.0, keluar: 95.4, akhir: 984.0 },
  { bulan: 7, awal: 984.0, masuk: 167.9, keluar: 189.1, akhir: 962.8 },
  { bulan: 8, awal: 962.8, masuk: 100.8, keluar: 108.0, akhir: 955.6 },
  { bulan: 9, awal: 955.6, masuk: 62.0, keluar: 82.5, akhir: 935.1 },
  { bulan: 10, awal: 935.1, masuk: 30.4, keluar: 58.6, akhir: 907.0 },
  { bulan: 11, awal: 907.0, masuk: 69.2, keluar: 111.4, akhir: 864.8 },
  { bulan: 12, awal: 864.8, masuk: 51.8, keluar: 120.2, akhir: 796.4 },
]

/** Pengadaan beras 2025 per kantor cabang Bulog Jatim (ribu ton). ASLI: BPS, Jawa Timur Dalam Angka 2026, Tabel 10.1.6 (KUD + non-KUD/KTNA + Satgas/UPGB/Draying). */
export const PENGADAAN_CABANG_2025: { cabang: string; ton: number }[] = [
  { cabang: "Surabaya Utara", ton: 42.8 },
  { cabang: "Surabaya Selatan", ton: 60.4 },
  { cabang: "Bojonegoro", ton: 48.7 },
  { cabang: "Madiun", ton: 58.9 },
  { cabang: "Kediri", ton: 50.9 },
  { cabang: "Bondowoso", ton: 43.3 },
  { cabang: "Malang", ton: 61.6 },
  { cabang: "Probolinggo", ton: 78.0 },
  { cabang: "Banyuwangi", ton: 52.2 },
  { cabang: "Tulungagung", ton: 42.4 },
  { cabang: "Jember", ton: 89.1 },
  { cabang: "Madura", ton: 1.2 },
  { cabang: "Ponorogo", ton: 58.9 },
]

/* Data yang dipakai dasbor: dari database (silver.stok_bulog_bulanan, silver.pengadaan_bulog) lewat /api/bulog bila API tersambung,
   selain itu salinan 2025 di atas. Hanya data asli: tidak ada ekstrapolasi tahun berjalan. Stok per kantor cabang tidak dipublikasikan;
   yang ada per cabang hanya pengadaan, ditambah STOK_CABANG_PROKSI (berita + taksiran, berlabel) di bawah. Data tahun baru masuk lewat unggahan manual atau konektor Bulog di panel admin. */

const tahunStok = BULOG?.stok.length ? Math.max(...BULOG.stok.map((r) => r.tahun)) : 2025
/** Tahun terakhir yang punya data stok Bulog bulanan resmi (Jatim Dalam Angka). */
export const TAHUN_STOK_RESMI = tahunStok
/** Stok Bulog Jatim per bulan pada tahun resmi terakhir (ribu ton). */
export const STOK_BULOG_RESMI: StokBulogBulan[] = BULOG?.stok.length
  ? BULOG.stok.filter((r) => r.tahun === tahunStok).map(({ bulan, awal, masuk, keluar, akhir }) => ({ bulan, awal, masuk, keluar, akhir }))
  : STOK_BULOG_2025

const tahunPeng = BULOG?.pengadaan.length ? Math.max(...BULOG.pengadaan.map((r) => r.tahun)) : 2025
/** Tahun terakhir yang punya data pengadaan per cabang. */
export const TAHUN_PENGADAAN = tahunPeng
/** Pengadaan per kantor cabang (ribu ton): tahun terakhir dan tahun sebelumnya (null bila tidak ada). */
export const PENGADAAN_CABANG: { cabang: string; ton: number; tonLalu: number | null }[] = BULOG?.pengadaan.length
  ? BULOG.pengadaan
      .filter((r) => r.tahun === tahunPeng)
      .map((r) => ({ cabang: r.cabang, ton: r.ton, tonLalu: BULOG!.pengadaan.find((x) => x.cabang === r.cabang && x.tahun === tahunPeng - 1)?.ton ?? null }))
  : PENGADAAN_CABANG_2025.map((c) => ({ ...c, tonLalu: null }))

/** Stok beras Bulog per kantor cabang, Nov 2026 (ribu ton). PROKSI, bukan publikasi resmi: Bulog tidak menerbitkan stok per cabang.
 *  "berita" = pernyataan pimpinan cabang di media (tanggal posisi dan tautan disertakan); "taksiran" = porsi pengadaan 2025 x rasio
 *  (jumlah stok berita / porsi pengadaan cabang-cabang itu). Sumber: scripts/bulog/proksi_stok_cabang.py,
 *  data/bulog/stok_beras/kantor_cabang/proksi/bulog_jatim_stok_beras_kantorcabang_proksi_2026.csv. Dipakai juga oleh K3b (SPHP). */
export interface StokCabangProksi {
  cabang: string
  ton: number
  jenis: "berita" | "taksiran"
  tanggal?: string
  url?: string
}
export const STOK_CABANG_PROKSI: StokCabangProksi[] = [
  { cabang: "Surabaya Utara", ton: 63.4, jenis: "taksiran" },
  { cabang: "Surabaya Selatan", ton: 89.6, jenis: "taksiran" },
  { cabang: "Bojonegoro", ton: 72.2, jenis: "taksiran" },
  { cabang: "Madiun", ton: 107.0, jenis: "berita", tanggal: "2026-11-16", url: "https://jatim.antaranews.com/berita/1119935/bulog-madiun-pastikan-stok-107-ribu-ton-beras-aman-hingga-lebaran-2027" },
  { cabang: "Kediri", ton: 75.4, jenis: "taksiran" },
  { cabang: "Bondowoso", ton: 64.2, jenis: "taksiran" },
  { cabang: "Malang", ton: 81.0, jenis: "berita", tanggal: "2026-11-24", url: "https://surabaya.bisnis.com/read/20261124/532/2024068/jelang-nataru-bulog-malang-jamin-stok-beras-aman" },
  { cabang: "Probolinggo", ton: 115.6, jenis: "taksiran" },
  { cabang: "Banyuwangi", ton: 77.3, jenis: "taksiran" },
  { cabang: "Tulungagung", ton: 62.9, jenis: "taksiran" },
  { cabang: "Jember", ton: 132.0, jenis: "taksiran" },
  { cabang: "Madura", ton: 1.7, jenis: "taksiran" },
  { cabang: "Ponorogo", ton: 78.0, jenis: "berita", tanggal: "2026-11-20", url: "https://radarmadiun.jawapos.com/ponorogo/2611200034/stok-beras-bulog-ponorogo-capai-78-ribu-ton-aman-hingga-lebaran-2027" },
]
/** Bulan posisi stok proksi per cabang. */
export const BULAN_STOK_CABANG_PROKSI = "Nov 2026"

/* Deret bulanan 2026 (MODEL): Jatim Dalam Angka 2027 yang memuat stok bulanan 2026 baru terbit sekitar Februari 2027.
   Sampai saat itu deret dibangun dari pola 2025: mulai dari persediaan akhir Desember tahun resmi, pengeluaran mengikuti 2025,
   pemasukan = pola 2025 dikali satu faktor sehingga persediaan akhir November tepat sama dengan jumlah stok 13 kantor cabang
   (STOK_CABANG_PROKSI). Akuntansi awal + masuk - keluar = akhir tetap berlaku. Begitu data resmi 2026 masuk lewat API, deret ini tidak dipakai. */
const BULAN_POSISI_CABANG = 11
/** Deret model mulai Jan 2026 sepanjang `n` bulan; sesudah November pola 2025 diteruskan dengan faktor pemasukan yang sama. */
function deretModel(n: number): StokBulogBulan[] | null {
  if (TAHUN_STOK_RESMI !== 2025 || STOK_BULOG_RESMI.length < 12 || !STOK_CABANG_PROKSI.length) return null
  const pola = STOK_BULOG_RESMI.slice(0, BULAN_POSISI_CABANG)
  const target = STOK_CABANG_PROKSI.reduce((a, c) => a + c.ton, 0)
  const awal0 = STOK_BULOG_RESMI[11].akhir
  const keluar = pola.reduce((a, r) => a + r.keluar, 0)
  const masuk = pola.reduce((a, r) => a + r.masuk, 0)
  const f = (target - awal0 + keluar) / masuk
  if (!(f > 0)) return null
  let awal = awal0
  return [...Array(n)].map((_, i) => {
    const r = STOK_BULOG_RESMI[i % 12]
    const m = Math.round(r.masuk * f * 10) / 10
    const akhir = Math.round((awal + m - r.keluar) * 10) / 10
    const row = { bulan: r.bulan, awal: Math.round(awal * 10) / 10, masuk: m, keluar: r.keluar, akhir }
    awal = akhir
    return row
  })
}
const DERET_2026 = deretModel(BULAN_POSISI_CABANG)
const DERET_PANJANG = deretModel(IDX_AKHIR + 1)

/** Persediaan akhir Bulog Jatim bulan `i` (0 = Jan 2026), ribu ton; null bila tidak ada deret. */
export const persediaanBulog = (i: number): number | null => {
  const resmi = BULOG?.stok.find((r) => r.tahun === 2026 + Math.floor(i / 12) && r.bulan === (i % 12) + 1)
  return resmi ? resmi.akhir : (DERET_PANJANG?.[i]?.akhir ?? null)
}

/** Tahun yang ditampilkan di grafik stok Bulog: 2026 (deret model) bila data resmi baru sampai 2025. */
export const TAHUN_STOK_BULOG = DERET_2026 ? 2026 : TAHUN_STOK_RESMI
/** Stok Bulog Jatim per bulan untuk grafik (ribu ton). */
export const STOK_BULOG: StokBulogBulan[] = DERET_2026 ?? STOK_BULOG_RESMI
/** Deret tahun sebelumnya untuk garis pembanding (null bila grafik sudah menampilkan tahun resmi). */
export const STOK_BULOG_PEMBANDING: { tahun: number; data: StokBulogBulan[] } | null = DERET_2026 ? { tahun: TAHUN_STOK_RESMI, data: STOK_BULOG_RESMI } : null
