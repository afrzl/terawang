/** Jawaban baku untuk pertanyaan istilah ("apa itu SPHP?"), tanpa OpenAI. */
import { akses } from "./hak.ts"
import { levenshtein, normal } from "./wilayah.ts"

const ISTILAH: { pola: RegExp; teks: string }[] = [
  {
    pola: /\bsphp\b/,
    teks: "*SPHP* (Stabilisasi Pasokan dan Harga Pangan) adalah beras pemerintah yang disalurkan Bulog supaya harga tetap terjangkau. Harganya Rp12.500/kg dalam kemasan 5 kg, dijual di pasar, Rumah Pangan Kita (RPK), dan Gerakan Pangan Murah.\n\nKetik *SPHP <wilayah>* untuk melihat wilayah terdekat yang lebih murah dan rekomendasi pasokan SPHP.",
  },
  {
    pola: /\b(het|harga eceran tertinggi)\b/,
    teks: "*HET* (Harga Eceran Tertinggi) adalah batas harga jual beras yang ditetapkan Badan Pangan Nasional. Di TERAWANG, harga di bawah atau sama dengan HET berstatus *Aman*, sedikit di atasnya *Waspada*, dan jauh di atasnya *Siaga*.\n\nKetik *HARGA <wilayah>* untuk membandingkan harga wilayahmu dengan HET.",
  },
  {
    pola: /\bterawang\b/,
    teks: "*TERAWANG* memantau beras Jawa Timur dari sawah ke pasar: perkiraan produksi dari citra satelit, perkiraan stok tiap kab/kota, prakiraan harga 2–4 pekan, dan rekomendasi penyaluran beras SPHP. Data harga dari Panel Harga/SISKAPERBAPO, produksi dari BPS, stok dari Bulog.\n\nDasbor: https://terawang.tech\nKetik *BANTUAN* untuk daftar perintah.",
  },
  {
    pola: /\b(status|arti) (aman|waspada|siaga)\b|\b(aman|waspada|siaga) (itu|artinya)\b/,
    teks: "Arti status di TERAWANG:\n🟢 *Aman*: harga di bawah/sama HET, stok cukup\n🟡 *Waspada*: harga mulai di atas HET atau stok menipis\n🔴 *Siaga*: harga jauh di atas HET atau stok diperkirakan defisit\n\nKetik *PERINGATAN* untuk melihat wilayah yang sedang waspada/siaga.",
  },
  {
    pola: /\b(data|sumber)(nya)? (dari|darimana|mana|apa)\b|\bsumber data\b/,
    teks: "Sumber data TERAWANG:\n• Harga harian: Panel Harga Bapanas / SISKAPERBAPO Jatim\n• Produksi dan konsumsi: BPS\n• Stok: Bulog, dilengkapi perkiraan model\n• Citra sawah: satelit Sentinel-1 dan Sentinel-2\n\nPrakiraan harga dan stok dihitung model TERAWANG dari data tersebut.",
  },
]

const TANYA = /\b(apa|apaan|arti|artinya|maksud|maksudnya|jelaskan|jelasin|pengertian|itu apa|dari mana|darimana)\b/

export function jawabIstilah(teks: string): string | null {
  const n = normal(teks)
  if (n.split(" ").length > 12 || !TANYA.test(n)) return null
  const t = ISTILAH.find((i) => i.pola.test(n))?.teks ?? null
  // tanpa hak SPHP: jelaskan istilahnya saja, tanpa mengajak mengetik perintah SPHP
  return t && !akses().sphp ? t.replace(/\n\nKetik \*SPHP <wilayah>\*[^\n]*/, "") : t
}

// ---- salam dan basa-basi: dibalas ramah tanpa OpenAI

// huruf berulang diringkas dulu: "halloo" -> "halo", "haiii" -> "hai", "assalamualaikum" -> "asalamualaikum"
const ringkas = (k: string) => k.replace(/(.)\1+/g, "$1")
const himpun = (xs: string[]) => new Set(xs.map(ringkas))

const KATA_SALAM = himpun([
  "halo", "hallo", "helo", "hello", "hellow", "helow", "hai", "hay", "hi", "hy", "hei", "hey", "heh", "woi", "oi", "hola",
  "pagi", "siang", "sore", "malam", "selamat", "met", "slmt", "pgi",
  "assalamualaikum", "asalamualaikum", "assalammualaikum", "assalamu", "alaikum", "salam", "salamualaikum", "ass", "askum", "aslm",
  "permisi", "misi", "punten", "nuwun", "sewu", "tes", "test", "testing", "ping", "p", "min", "admin", "kak", "ka", "kakak",
  "bang", "mas", "mbak", "mba", "pak", "bu", "bot", "terawang", "wr", "wb", "semua", "gan", "sob", "bro", "sis", "dong", "ya",
])
const KATA_TERIMA_KASIH = himpun([
  "terima", "kasih", "makasih", "makasi", "maksih", "trims", "trimakasih", "terimakasih", "thanks", "thank", "you", "thx", "tq", "ty",
  "tengkyu", "nuwun", "matur", "suwun", "ok", "oke", "okay", "okey", "okei", "sip", "siap", "mantap", "mantab", "baik", "noted",
  "banyak", "bnyk", "byk", "ya", "yaa", "min", "kak", "bot", "deh", "dong", "nih", "👍", "🙏",
])

// cocok longgar untuk ejaan bebas ("asslamualaikum", "helloww", "trimakasi"): selisih 1 huruf (>=5 huruf) atau 2 (>=8 huruf)
function mirip(k: string, himpunan: Set<string>): boolean {
  if (himpunan.has(k)) return true
  if (k.length < 5) return false
  const batas = k.length >= 8 ? 2 : 1
  for (const h of himpunan) if (h.length >= 4 && Math.abs(h.length - k.length) <= batas && levenshtein(k, h) <= batas) return true
  return false
}

export const TERIMA_KASIH = "Sama-sama! Kalau mau cek lagi, ketik saja nama wilayahnya, misalnya *HARGA Kediri*."
export const POLA_TERIMA_KASIH = /(ma?ka?si|trima|terima ?kasi|thx|thank|tq\b|nuwun|suwun|tengkyu)/

export const contoh = () => `Contoh yang bisa kamu tanyakan:\n• *HARGA Malang*\n• *STOK Jember*\n• ${akses().estimasi ? "_beras di Surabaya naik nggak bulan depan?_" : "_harga beras di Surabaya sebulan terakhir gimana?_"}\n\nKetik *BANTUAN* untuk semua perintah.`
const layanan = () => (akses().sphp ? "harga, stok, dan beras murah/SPHP" : "harga, stok, dan produksi")

/** Balasan untuk pesan yang isinya hanya salam ("helo") atau ucapan terima kasih. */
export function jawabBasaBasi(teks: string): string | null {
  const kata = normal(teks).split(" ").filter(Boolean).map(ringkas)
  if (!kata.length || kata.length > 6) return null
  if (kata.every((k) => mirip(k, KATA_SALAM))) {
    if (kata.some((k) => /^(as+a?lam|salam|ass$|askum|aslm)/.test(k))) return `Waalaikumsalam 🙏 Aku bot *TERAWANG*, siap bantu info beras di Jawa Timur: ${layanan()}.\n\n${contoh()}`
    return `Halo! 👋 Aku bot *TERAWANG*, siap bantu info beras di Jawa Timur: ${layanan()}.\n\n${contoh()}`
  }
  if (kata.every((k) => mirip(k, KATA_TERIMA_KASIH))) {
    return TERIMA_KASIH
  }
  return null
}

/** Buang salam di awal kalimat bila masih ada isi lain ("halo, harga jember" -> "harga jember"). */
export function buangSalam(teks: string): string {
  const kata = teks.trim().split(/\s+/)
  let i = 0
  while (i < kata.length - 1 && i < 4 && KATA_SALAM.has(ringkas(normal(kata[i]))) && normal(kata[i]) !== "terawang") i++
  if (i === 0 || i >= kata.length) return teks
  const sisa = kata.slice(i).join(" ").replace(/^[\s,.!-]+/, "")
  return sisa || teks
}
