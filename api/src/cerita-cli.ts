/**
 * Terbitkan edisi Cerita sekarang (API harus sedang jalan, karena fakta dibaca lewat API).
 *   npm run cerita              edisi pekan berjalan bila belum ada
 *   npm run cerita -- --paksa   tulis ulang edisi pekan berjalan
 *   npm run cerita -- --pekan 2026-W48 --paksa
 *   npm run cerita -- --pekan 2026-W45 --mundur --paksa   (data per Senin 06.00 pekan itu)
 */
import "dotenv/config"
import pg from "pg"
import { pakaiPool, saatTerbitPekan, terbitkan } from "./cerita.js"

const arg = process.argv.slice(2)
const pekan = arg.includes("--pekan") ? arg[arg.indexOf("--pekan") + 1] : undefined
const base = process.env.CERITA_API_BASE ?? `http://${process.env.API_HOST ?? "127.0.0.1"}:${process.env.API_PORT ?? 3072}`
if (process.env.DATABASE_URL) {
  const u = new URL(process.env.DATABASE_URL)
  u.searchParams.delete("schema")
  pakaiPool(new pg.Pool({ connectionString: u.toString(), max: 2 }))
}
// --mundur: data sebagaimana ada pada Senin 06.00 WIB pekan itu
const per = arg.includes("--mundur") && pekan ? saatTerbitPekan(pekan) : undefined
const e = await terbitkan({ base, paksa: arg.includes("--paksa"), pekan, per })
console.log(JSON.stringify({ pekan: e.pekan, sumber: e.sumber, judul: e.judul, dek: e.dek, pemeriksaan: e.pemeriksaan }, null, 2))
process.exit(0)
