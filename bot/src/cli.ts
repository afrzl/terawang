/** Uji bot dari terminal tanpa WhatsApp: npm run tanya -- "HARGA MALANG" */
import { tanggapi } from "./bot.ts"
import { pool } from "./db.ts"

const teks = process.argv.slice(2).join(" ")
if (!teks) {
  console.error('Pakai: npm run tanya -- "HARGA MALANG"')
  process.exit(1)
}
const r = await tanggapi(process.env.NOMOR_UJI ?? "uji-terminal", "Uji terminal", teks)
console.log(`--- intent=${r.intent} wilayah=${r.wilayahId}\n${r.teks}`)
await pool.end()
