/**
 * Guard rail jalur OpenAI. Semua pemeriksaan di sini berjalan SEBELUM memanggil OpenAI,
 * jadi pesan yang ditolak tidak memakan token sama sekali.
 */
import { config } from "./config.ts"
import { normal } from "./wilayah.ts"

export type Tolak = { alasan: "terlalu_panjang" | "injeksi" | "di_luar_topik" | "batas_nomor" | "batas_global"; teks: string }

const POLA_INJEKSI = [
  /\b(abaikan|lupakan|acuhkan|langgar)\b.{0,30}\b(instruksi|perintah|aturan|prompt|arahan)/i,
  /\bignore\b.{0,30}\b(instruction|previous|above|rules|prompt)/i,
  /\b(system|sistem)\s*prompt\b|\bprompt\s*sistem\b/i,
  /\b(you are now|act as|pretend to be|roleplay)\b/i,
  /\b(kamu|anda)\s+(sekarang|mulai sekarang)\s+(adalah|jadi|menjadi)\b/i,
  /\b(berperan|berpura[- ]pura)\s+(sebagai|jadi)\b/i,
  /\b(jailbreak|dan mode|developer mode|mode pengembang)\b/i,
  /\b(tampilkan|bocorkan|tunjukkan|ulangi)\b.{0,30}\b(instruksi|prompt|aturan)\b/i,
  /<\/?(system|assistant|user)>|\[\/?inst\]/i,
]

// Kata yang menandakan pertanyaan masih seputar TERAWANG. Nama wilayah dicek terpisah oleh pemanggil.
const KATA_TOPIK = [
  "beras", "padi", "gabah", "nasi", "pangan", "harga", "mahal", "murah", "naik", "turun", "stok", "persediaan", "pasokan",
  "sphp", "bulog", "rpk", "operasi pasar", "pasar", "het", "hap", "panen", "tanam", "sawah", "petani", "penggilingan",
  "defisit", "surplus", "langka", "kurang", "cukup", "aman", "waspada", "siaga", "peringatan", "prediksi", "prakiraan",
  "ramalan", "minggu depan", "bulan depan", "pekan", "medium", "premium", "kg", "kilo", "satelit", "citra", "produksi",
  "inflasi", "terawang", "jatim", "jawa timur", "kabupaten", "kota", "wilayah", "lapor", "langganan", "data", "sumber",
]

export function cekMasukan(teks: string, sebutWilayah: boolean): Tolak | null {
  if (teks.length > config.openai.maksMasukan) {
    return { alasan: "terlalu_panjang", teks: `Pesannya terlalu panjang. Tulis pertanyaan singkat (maks. ${config.openai.maksMasukan} karakter), misalnya _harga beras di Jember naik nggak?_` }
  }
  if (POLA_INJEKSI.some((p) => p.test(teks))) {
    return { alasan: "injeksi", teks: "Maaf, aku hanya bisa membantu soal harga, stok, dan peringatan beras di Jawa Timur. Ketik *BANTUAN* untuk daftar perintah." }
  }
  const n = ` ${normal(teks)} `
  if (!sebutWilayah && !KATA_TOPIK.some((k) => n.includes(` ${k}`))) {
    return {
      alasan: "di_luar_topik",
      teks: "Maaf, TERAWANG hanya menjawab seputar beras di Jawa Timur: harga, stok, beras murah/SPHP, dan peringatan. Ketik *BANTUAN* untuk contoh pertanyaan.",
    }
  }
  return null
}

// ---- batas pemakaian (di memori; reset saat bot dimulai ulang, batas keras tetap di dasbor OpenAI)

const jejak = new Map<number, number[]>() // kontak -> waktu panggilan LLM
let hariToken = ""
let tokenTerpakai = 0

const hariWib = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" })

export function cekBatas(kontakId: number, jumlahHariIni: number): Tolak | null {
  if (hariToken !== hariWib()) {
    hariToken = hariWib()
    tokenTerpakai = 0
  }
  if (tokenTerpakai >= config.openai.tokenHarian) {
    return { alasan: "batas_global", teks: "Layanan tanya-jawab bebas sedang istirahat sampai besok. Perintah baku tetap bisa dipakai:" }
  }
  if (jumlahHariIni >= config.openai.batasHarianPerNomor) {
    return { alasan: "batas_nomor", teks: "Batas pertanyaan bebas hari ini sudah tercapai. Perintah baku tetap bisa dipakai:" }
  }
  const kini = Date.now()
  const xs = (jejak.get(kontakId) ?? []).filter((t) => kini - t < 10 * 60_000)
  if (xs.length >= config.openai.batasPer10Menit) {
    jejak.set(kontakId, xs)
    return { alasan: "batas_nomor", teks: "Pertanyaanmu banyak sekali dalam waktu singkat. Coba lagi beberapa menit lagi, atau pakai perintah baku:" }
  }
  xs.push(kini)
  jejak.set(kontakId, xs)
  return null
}

export function catatToken(n: number) {
  if (hariToken !== hariWib()) {
    hariToken = hariWib()
    tokenTerpakai = 0
  }
  tokenTerpakai += n
}

/**
 * Penghitung token disimpan di memori. Saat bot dinyalakan ulang, pemakaian hari ini diperkirakan dari jumlah
 * jawaban LLM hari ini di app.percakapan_bot (±2.000 token per jawaban), supaya anggaran harian tidak kembali ke nol.
 */
export async function muatTokenHariIni() {
  const { q } = await import("./db.ts")
  const r = await q<{ n: number }>(
    `select count(*)::int as n from app.percakapan_bot
      where arah = 'KELUAR' and intent = 'llm'
        and dibuat_pada >= date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta'`,
  )
  hariToken = hariWib()
  tokenTerpakai = (r[0]?.n ?? 0) * 2000
}

export const pemakaianHariIni = () => ({ hari: hariToken || hariWib(), token: tokenTerpakai, batas: config.openai.tokenHarian })

// ---- cache jawaban

const cache = new Map<string, { jawaban: string; wilayahId?: number; sampai: number }>()

export function kunciCache(teks: string, wilayahIngat: number | null) {
  return `${wilayahIngat ?? "-"}|${normal(teks)}`
}

export function ambilCache(kunci: string) {
  const c = cache.get(kunci)
  if (!c) return undefined
  if (c.sampai < Date.now()) {
    cache.delete(kunci)
    return undefined
  }
  return c
}

export function simpanCache(kunci: string, jawaban: string, wilayahId?: number) {
  if (!config.openai.cacheMenit) return
  if (cache.size > 2000) cache.clear()
  cache.set(kunci, { jawaban, wilayahId, sampai: Date.now() + config.openai.cacheMenit * 60_000 })
}

// ---- pemeriksaan jawaban

/** Rapikan jawaban LLM untuk WhatsApp dan potong bila kepanjangan. */
export function rapikanJawaban(s: string): string {
  let t = s
    .replace(/\*\*(.+?)\*\*/g, "*$1*") // markdown tebal -> WhatsApp
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\[(.+?)\]\((https?:[^)]+)\)/g, "$1 ($2)")
    // nama fungsi internal tidak boleh bocor ke pengguna
    .replace(/\s*(atau\s+)?\*?`?\b(harga_wilayah|stok_wilayah|beras_murah|daftar_peringatan|tentang_terawang|ringkasan_jatim|peringkat_wilayah|bandingkan_wilayah|riwayat_harga|produksi_wilayah|\w+_gagal)\b`?\*?/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  if (t.length > 1200) t = t.slice(0, 1150).replace(/\s+\S*$/, "") + "…"
  return t
}

/** Jawaban yang menyebut angka rupiah/ton tanpa memanggil fungsi data dianggap mengarang. */
export function angkaTanpaData(jawaban: string, pakaiAlat: boolean): boolean {
  return !pakaiAlat && /(rp\s?\d|\d[\d.,]*\s?(ton|\/kg|persen|%))/i.test(jawaban)
}
