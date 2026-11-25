/** Jawaban baku untuk pertanyaan istilah ("apa itu SPHP?"), tanpa OpenAI. */
import { normal } from "./wilayah.ts"

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
    teks: "Sumber data TERAWANG:\n• Harga harian: Panel Harga Bapanas / SISKAPERBAPO Jatim\n• Produksi dan konsumsi: BPS\n• Stok: Bulog, dilengkapi perkiraan model\n• Citra sawah: satelit Sentinel-1 dan Sentinel-2\n\nPrakiraan harga dan stok adalah hasil model, bukan angka resmi.",
  },
]

const TANYA = /\b(apa|apaan|arti|artinya|maksud|maksudnya|jelaskan|jelasin|pengertian|itu apa|dari mana|darimana)\b/

export function jawabIstilah(teks: string): string | null {
  const n = normal(teks)
  if (n.split(" ").length > 12 || !TANYA.test(n)) return null
  return ISTILAH.find((i) => i.pola.test(n))?.teks ?? null
}
