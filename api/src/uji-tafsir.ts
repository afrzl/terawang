/**
 * Uji interpretasi grafik dengan OpenAI sungguhan, tanpa dasbor.
 *   npx tsx src/uji-tafsir.ts uji/tafsir-contoh.json [indeks...]
 * Berkas berisi array badan permintaan POST /api/tafsir (ditangkap dari dasbor). Key dibaca seperti server (env atau .env bot).
 * Tanpa OPENAI_API_KEY: hanya mencetak ringkasan hitung tiap grafik.
 */
import fs from "node:fs"
process.env.TAFSIR_BATAS_IP_10MENIT ??= "1000"
process.env.TAFSIR_BATAS_IP_HARIAN ??= "1000"
const { periksaMasukan, ringkas, tafsirAktif, tafsirkan } = await import("./tafsir.js")

const [berkas, ...pilih] = process.argv.slice(2)
const semua = JSON.parse(fs.readFileSync(berkas ?? "uji/tafsir-contoh.json", "utf8")) as unknown[]
const idx = pilih.length ? pilih.map(Number) : semua.map((_, i) => i)
for (const i of idx) {
  const m = periksaMasukan(semua[i])
  console.log(`\n=== [${i}] ${m.judul}`)
  if (!tafsirAktif()) {
    console.log(ringkas(m.data).slice(0, 6).join("\n"))
    continue
  }
  try {
    const t0 = Date.now()
    const h = await tafsirkan(semua[i], "uji")
    console.log(h.teks)
    console.log(`(${Date.now() - t0} ms, ${h.angka_diperiksa} angka dicek${h.dibuang.length ? `, ${h.dibuang.length} kalimat dibuang` : ""})`)
  } catch (e) {
    console.log("GALAT:", (e as Error).message)
  }
}
