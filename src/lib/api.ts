/** Penyambung ke API baca-saja TERAWANG (api/src/server.ts). Bila API tidak terjangkau, dasbor memakai data simulasi. */

/** Indeks bulan dihitung dari Jan 2026 (0 = Jan 2026). Bulan kini = bulan kalender hari ini; jendela dasbor = Jan 2026 sampai bulan kini + 2
 *  (sama dengan horizon K2: bulan berjalan = taksiran, +1 dan +2 = prakiraan). */
export const BULAN_AWAL = { tahun: 2026, bulan: 1 }
const hariIni = new Date()
export const BULAN_KINI = Math.max(0, (hariIni.getFullYear() - BULAN_AWAL.tahun) * 12 + hariIni.getMonth())
export const N_BULAN = BULAN_KINI + 3
/** Indeks bulan terakhir dalam jendela. */
export const IDX_AKHIR = N_BULAN - 1

export interface K1Wilayah {
  /** Produksi beras bulanan (ton), indeks 0 = Jan 2026 sampai N_BULAN - 1. */
  k1: (number | null)[]
  p10: (number | null)[]
  p90: (number | null)[]
  /** Produksi beras BPS 2025 per bulan (ton), Jan sampai Des. */
  bps2025: (number | null)[]
  /** Luas panen K1 (ha), indeks sama dengan k1. Tidak ada pada API lama. */
  luas?: (number | null)[]
  /** Luas panen BPS 2025 per bulan (ha), Jan sampai Des (Survei KSA). */
  luas2025?: (number | null)[]
}

export interface K1Data {
  meta: { model_run_id: number; versi: string; dibuat: string; jenis_data: string; awal: string; bulan: number; satuan: string }
  wilayah: Record<string, K1Wilayah>
}

async function muat<T>(url: string, batasMs = 2500): Promise<T | null> {
  const kendali = new AbortController()
  const waktu = setTimeout(() => kendali.abort(), batasMs)
  try {
    const r = await fetch(url, { signal: kendali.signal, headers: { Accept: "application/json" } })
    return r.ok && (r.headers.get("content-type") ?? "").includes("json") ? ((await r.json()) as T) : null
  } catch {
    return null
  } finally {
    clearTimeout(waktu)
  }
}

export interface K2Wilayah {
  /** Cakupan stok non-Bulog (bulan konsumsi), skenario TENGAH; indeks 0 = Jan 2026 sampai N_BULAN - 1. */
  cakupan: (number | null)[]
  /** Pita skenario RENDAH dan TINGGI (cakupan). */
  p10: (number | null)[]
  p90: (number | null)[]
  stok: (number | null)[]
  status: (string | null)[]
  /** Konsumsi beras per bulan yang dipakai K2 (ton). */
  konsumsi: number | null
}

export interface K2Data {
  meta: {
    model_run_id: number
    versi: string
    dibuat: string
    jenis_data: string
    jangkar_bulan_konsumsi: number | null
    hari_ke_defisit: Record<string, number>
    sudah_defisit: string[]
    /** Arus antar kab (LP jarak jalan) yang dipakai neraca K2, ton per bulan. Kosong pada run lama. */
    arus?: { dari: string; ke: string; ton_bulan: number }[]
  }
  wilayah: Record<string, K2Wilayah>
}

export interface K3bData {
  meta: { model_run_id: number; versi: string; dibuat: string; jenis_data: string }
  rute: { bulan: number; dari: string; ke: string; ton: number; km: number }[]
}

export interface K3aSeri {
  /** Harga mingguan (Rp/kg), 26 pekan sampai tanggal acuan. */
  price: (number | null)[]
  /** Prakiraan 7, 14, 21, 28 hari: median, P10, P90. */
  fc: { m: number; lo: number; hi: number }[]
  /** Status K3a (AMAN, WASPADA, SIAGA) pada tiap horizon. */
  status: string[]
}

export interface K3aData {
  meta: {
    model_run_id: number
    versi: string
    dibuat: string
    tanggal_acuan: string
    jenis_data: string
    het: Record<string, number> | null
    /** Kalibrasi ambang WASPADA per jenis beras ("medium", "premium") dan horizon hari ("7".."28"): F1, AUC, kejadian. */
    kalibrasi?: Record<string, Record<string, { ambang: number; f1: number; auc?: number | null; terdeteksi: number; kejadian: number; alarm_palsu: number }>> | null
    /** Peluang melewati HET per jenis beras -> horizon (hari) -> kab, dari pipeline K3a. */
    peluang_het?: Record<string, Record<string, Record<string, number>>> | null
  }
  wilayah: Record<string, { medium: K3aSeri; premium: K3aSeri }>
}

/** Hasil K1 (produksi), K2 (stok), K3a (harga), K3b (SPHP) dan olahan citra GEE dari backend; null bila API mati. Dimuat sekali sebelum aplikasi tampil. */
export interface BulogData {
  /** Stok Bulog Jatim per bulan (ribu ton), semua tahun yang ada di database. */
  stok: { tahun: number; bulan: number; awal: number; masuk: number; keluar: number; akhir: number; jenis_data: string }[]
  /** Pengadaan per kantor cabang per tahun (ribu ton). */
  pengadaan: { cabang: string; tahun: number; ton: number }[]
}

export interface DeretData {
  dibuat: string
  /** Tanggal akuisisi 12-harian (ISO), 15 terakhir. */
  tanggal: string[]
  wilayah: Record<string, Record<"evi" | "lswi" | "vh" | "eviAvg" | "lswiAvg" | "vhAvg", (number | null)[]>>
}

/** Harga GKP petani Jatim bulanan (BPS disambung Bapanas) + prakiraan 1-3 bulan, keluaran aset k3_prakiraan_gkp. */
export interface GkpData {
  versi: string
  dibuat: string
  bulan_acuan: string
  harga_bulan_acuan: number
  hpp_sekarang: number
  riwayat: { bulan: string; harga: number; sumber: string }[]
  prakiraan: { bulan_target: string; horizon_bulan: number; harga_prediksi: number; p10: number; p90: number; luas_panen_ha: number; sumber_luas: string; hpp: number }[]
  uji_mundur: Record<string, { n: number; mape: number | null }>
  /** Per kab/kota (Bapanas); belum ada pada berkas versi 0.1. */
  kabupaten?: GkpKab[]
  uji_mundur_kab?: Record<string, { n: number; mape: number | null; mape_naif?: number | null }>
}

export interface GkpKab {
  nama: string
  /** null = Bapanas belum pernah mencatat GKP kab ini. */
  bulan_data_terakhir: string | null
  /** gabungan = rata-rata naif kab dan provinsi x rasio; rasio_provinsi = kab tanpa data bulan acuan;
   * taksiran_rasio_terakhir / taksiran_median_kab = data taksiran (provinsi x rasio terakhir, atau median rasio semua kab). */
  metode: string
  /** true = angka taksiran, bukan pengamatan (sejak versi 0.3). */
  taksiran?: boolean
  rasio_jatim?: number
  /** sumber "Bapanas" (pengamatan) atau "taksiran"; tidak ada pada berkas sebelum versi 0.3. */
  riwayat: { bulan: string; harga: number; sumber?: string }[]
  prakiraan: { bulan_target: string; horizon_bulan: number; harga_prediksi: number; p10: number; p90: number }[]
}

/** Fase tumbuh per wilayah per bulan (keluaran aset fase_tumbuh_bulanan, scripts/k1/fase_bulanan.py). */
export interface FaseData {
  dibuat: string
  fase: string[]
  /** Akuisisi Sentinel-2 terakhir (ISO). */
  tanggal_terakhir: string
  titik_per_wilayah?: number
  sumber: string
  /** Kunci "YYYY-MM": tanggal akuisisi dalam bulan itu dan persen luas per fase (urutan `fase`) per wilayah. */
  bulan: Record<string, { tanggal: string[]; wilayah: Record<string, number[]> }>
}

const [k1, k2, k3a, k3b, citra, bulog, deret, gkp, fase] = await Promise.all([
  muat<K1Data>("/api/produksi"),
  muat<K2Data>("/api/stok"),
  muat<K3aData>("/api/harga"),
  muat<K3bData>("/api/sphp"),
  muat<unknown>("/api/citra", 4000),
  muat<BulogData>("/api/bulog"),
  muat<DeretData>("/api/deret", 4000),
  muat<GkpData>("/api/gkp", 4000),
  muat<FaseData>("/api/fase", 4000),
])
/** Fase tumbuh bulanan dari pipeline; null = pakai salinan di bundle (src/lib/fase_bulanan.json). */
export const FASE_API: FaseData | null = fase
/** Prakiraan harga GKP; null = belum ada (panel GKP disembunyikan). */
export const GKP: GkpData | null = gkp
/** Stok dan pengadaan Bulog dari database; null = salinan di bundle (src/lib/bulog.ts). */
export const BULOG: BulogData | null = bulog
/** Deret EVI/LSWI/VH per wilayah dari pipeline; null = tidak ada. */
export const DERET: DeretData | null = deret
/** Isi gee_wilayah.json terbaru keluaran pipeline (aset bronze_citra); null = pakai salinan di bundle (src/lib/gee_wilayah.json). */
export const CITRA_API: unknown = citra
export const K1: K1Data | null = k1
export const K2: K2Data | null = k2
export const K3A: K3aData | null = k3a
/** K3b hanya dikirim API untuk akun yang berhak. */
export const K3B: K3bData | null = k3b
/** API tersambung (K1 atau K2 terbaca). Bila ya dan K3B kosong, pengguna tidak berhak, jadi rute statis lama tidak dipakai. */
export const API_AKTIF: boolean = k1 !== null || k2 !== null || k3a !== null
