/**
 * Proses anak penyusun edisi Cerita: memuat modul dasbor (src/lib/ceritaFakta.ts) di Node, dengan fetch diarahkan ke API ini sendiri,
 * lalu mencetak FaktaPekan sebagai JSON ke stdout. Dipanggil oleh cerita.ts; tidak untuk dijalankan langsung.
 * Env: CERITA_API_BASE (mis. http://127.0.0.1:3072), CERITA_TOKEN (token internal supaya /api/sphp ikut terbaca).
 */
const BASE = process.env.CERITA_API_BASE ?? "http://127.0.0.1:3072"
const TOKEN = process.env.CERITA_TOKEN ?? ""
/** CERITA_PER (ISO): susun fakta sebagaimana data ada pada waktu itu (edisi pekan lalu). Jam proses digeser ke waktu itu supaya
 *  "bulan kini" dasbor ikut, dan setiap permintaan API membawa ?per= supaya run model dan riwayat harga dipotong di sana. */
const PER = process.env.CERITA_PER
if (PER) {
  const t0 = Date.parse(PER)
  const D = Date
  class DiPer extends D {
    constructor(...a: ConstructorParameters<typeof Date> | []) {
      if (a.length === 0) super(t0)
      else super(...(a as ConstructorParameters<typeof Date>))
    }
    static now() {
      return t0
    }
  }
  globalThis.Date = DiPer as DateConstructor
}
const asli = globalThis.fetch
globalThis.fetch = ((u: string | URL | Request, init?: RequestInit) => {
  const url = typeof u === "string" && u.startsWith("/") ? new URL(u, BASE) : u
  if (PER && url instanceof URL) url.searchParams.set("per", PER)
  const headers = new Headers(init?.headers)
  if (TOKEN) headers.set("x-terawang-internal", TOKEN)
  // batas waktu bawaan dasbor (2,5 detik) terlalu ketat untuk satu proses yang memuat semuanya sekaligus
  return asli(url as string, { ...init, headers, signal: AbortSignal.timeout(20_000) })
}) as typeof fetch

// jalur lewat variabel: modul dasbor di luar rootDir api, cukup dijalankan tsx (tsconfig.app.json untuk alias @/)
const MODUL = "../../src/lib/ceritaFakta.ts"
const { angkaKunci, susunFakta } = (await import(MODUL)) as { susunFakta: () => unknown; angkaKunci: (f: unknown) => unknown }
const fakta = susunFakta()
process.stdout.write(JSON.stringify({ fakta, kunci: angkaKunci(fakta) }))
