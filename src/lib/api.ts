/** Penyambung ke API baca-saja TERAWANG (api/src/server.ts). Bila API tidak terjangkau, dasbor memakai data simulasi. */

export interface K1Wilayah {
  /** Produksi beras bulanan (ton), indeks 0 = Jan 2026 sampai 12 = Jan 2027. */
  k1: (number | null)[]
  p10: (number | null)[]
  p90: (number | null)[]
  /** Produksi beras BPS 2025 per bulan (ton), Jan sampai Des. */
  bps2025: (number | null)[]
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
  /** Cakupan stok non-Bulog (bulan konsumsi), skenario TENGAH; indeks 0 = Jan 2026 sampai 12 = Jan 2027. */
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
  meta: { model_run_id: number; versi: string; dibuat: string; jenis_data: string; jangkar_bulan_konsumsi: number | null; hari_ke_defisit: Record<string, number>; sudah_defisit: string[] }
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
  meta: { model_run_id: number; versi: string; dibuat: string; tanggal_acuan: string; jenis_data: string; het: Record<string, number> | null }
  wilayah: Record<string, { medium: K3aSeri; premium: K3aSeri }>
}

/** Hasil K1 (produksi), K2 (stok), K3a (harga), K3b (SPHP) dan olahan citra GEE dari backend; null bila API mati. Dimuat sekali sebelum aplikasi tampil. */
const [k1, k2, k3a, k3b, citra] = await Promise.all([
  muat<K1Data>("/api/produksi"),
  muat<K2Data>("/api/stok"),
  muat<K3aData>("/api/harga"),
  muat<K3bData>("/api/sphp"),
  muat<unknown>("/api/citra", 4000),
])
/** Isi gee_wilayah.json terbaru keluaran pipeline (aset bronze_citra); null = pakai salinan di bundle (src/lib/gee_wilayah.json). */
export const CITRA_API: unknown = citra
export const K1: K1Data | null = k1
export const K2: K2Data | null = k2
export const K3A: K3aData | null = k3a
/** K3b hanya dikirim API untuk akun yang berhak. */
export const K3B: K3bData | null = k3b
/** API tersambung (K1 atau K2 terbaca). Bila ya dan K3B kosong, pengguna tidak berhak, jadi rute statis lama tidak dipakai. */
export const API_AKTIF: boolean = k1 !== null || k2 !== null || k3a !== null
