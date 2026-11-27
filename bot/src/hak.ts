/**
 * Hak akses bot WhatsApp = hak peran Tamu di matriks admin (halaman Akun & peran).
 * Dibaca dari admin (GET /admin/api/hak/tamu, tanpa login, hanya daftar hak Tamu), disimpan 60 detik.
 * Kalau admin tidak terjangkau, dipakai daftar terakhir yang berhasil dibaca, atau isi awal Tamu.
 *
 *   dasbor_estimasi  prakiraan/prediksi/proyeksi ke depan, peringatan dini, langganan
 *   dasbor_sphp      rekomendasi SPHP / beras murah
 * Harga terkini dan riwayatnya tetap dijawab (fitur utama bot dan pembanding LAPOR warga).
 */
const env = process.env
export const HAK_TAMU_BAWAAN = ["dasbor_ringkasan", "dasbor_produksi", "dasbor_stok", "dasbor_arus", "dasbor_cerita"]
const URL_HAK = env.HAK_URL ?? "https://terawang.tech/admin/api/hak/tamu"
const UMUR = 60_000

let hak = new Set(HAK_TAMU_BAWAAN)
let dibaca = 0

export type Akses = { estimasi: boolean; sphp: boolean }
export const akses = (): Akses => ({ estimasi: hak.has("dasbor_estimasi"), sphp: hak.has("dasbor_sphp") })
/** Untuk uji: atur hak langsung tanpa membaca admin. */
export function aturHak(xs: string[]) {
  hak = new Set(xs)
  dibaca = Date.now() + 365 * 24 * 3600_000
}

/** Segarkan hak bila sudah lewat 60 detik. Tidak pernah melempar galat. */
export async function muatHak(): Promise<Akses> {
  if (Date.now() - dibaca < UMUR || !URL_HAK) return akses()
  dibaca = Date.now()
  try {
    const r = await fetch(URL_HAK, { signal: AbortSignal.timeout(3000) })
    const j = (await r.json()) as { hak?: unknown }
    if (r.ok && Array.isArray(j.hak)) hak = new Set(j.hak.map(String))
  } catch (e) {
    console.warn(`[hak] gagal membaca hak Tamu, pakai yang terakhir: ${(e as Error).message}`)
  }
  return akses()
}

const DASBOR = "Prakiraan lengkap ada di dasbor https://terawang.tech untuk akun yang berhak."
export const TOLAK_PRAKIRAAN =
  `Maaf, prakiraan dan prediksi ke depan belum dibuka untuk umum di bot ini 🙏 Aku bisa bantu data yang sudah terjadi: harga terkini, stok, produksi, dan grafik riwayatnya.\n\n${DASBOR}`
export const TOLAK_SPHP =
  "Maaf, rekomendasi SPHP belum dibuka untuk umum di bot ini 🙏 Kalau mau tahu harga beras terkini, ketik misalnya *HARGA Malang*."

/** Pertanyaan yang meminta prakiraan/prediksi ke depan. */
const POLA_PRAKIRAAN = /\b(prediksi|prakiraan|ramalan|proyeksi|forecast|meramal|diprediksi|diperkirakan)\b|\b(ke ?depan(nya)?|mendatang|bulan depan|pekan depan|minggu depan|tahun depan|besok|lusa)\b|\b\d+\s*(hari|pekan|minggu|bulan|tahun)\s*(lagi|ke ?depan)\b|\b(bakal|akan|bakalan)\s+(naik|turun|defisit|habis|langka|mahal|murah)\b/
export const mintaPrakiraan = (n: string) => POLA_PRAKIRAAN.test(n)

/** Bulan berjalan (WIB) sebagai tahun*12+bulan; tanpa hak estimasi hanya bulan sebelum ini yang dianggap sudah terjadi. */
export function bulanKini(): number {
  const s = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" })
  const [y, m] = s.split("-").map(Number)
  return y * 12 + m
}
