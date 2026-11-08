import { WILAYAH, byName, dist, type Wilayah } from "./data"

/* Model arus beras antarwilayah (simulasi).
 * Surplus = produksi beras Oktober (musim paceklik, ±6,5% produksi tahunan) − konsumsi; defisit sebaliknya.
 * Kebutuhan tiap wilayah defisit dibagi ke wilayah surplus dengan model gravitasi:
 * bobot = surplus asal / jarak^1,6. Semua angka dalam ton beras per bulan. */

export type RegionKey = "mataraman" | "pantura" | "surabaya" | "malang" | "tapalkuda" | "madura"

export interface Region {
  key: RegionKey
  name: string
  short: string
  color: string
  members: string[]
}

export const REGIONS: Region[] = [
  {
    key: "mataraman",
    name: "Mataraman",
    short: "Mataraman",
    color: "var(--r1)",
    members: ["Pacitan", "Ponorogo", "Trenggalek", "Tulungagung", "Blitar", "Kediri", "Nganjuk", "Madiun", "Magetan", "Ngawi", "Kota Kediri", "Kota Blitar", "Kota Madiun"],
  },
  { key: "pantura", name: "Pantura (Bojonegoro–Tuban–Lamongan)", short: "Pantura", color: "var(--r2)", members: ["Bojonegoro", "Tuban", "Lamongan"] },
  {
    key: "surabaya",
    name: "Surabaya Raya",
    short: "Surabaya Raya",
    color: "var(--r3)",
    members: ["Kota Surabaya", "Gresik", "Sidoarjo", "Mojokerto", "Kota Mojokerto", "Jombang"],
  },
  { key: "malang", name: "Malang Raya & Pasuruan", short: "Malang Raya", color: "var(--r4)", members: ["Malang", "Kota Malang", "Batu", "Pasuruan", "Kota Pasuruan"] },
  {
    key: "tapalkuda",
    name: "Tapal Kuda",
    short: "Tapal Kuda",
    color: "var(--r5)",
    members: ["Probolinggo", "Kota Probolinggo", "Lumajang", "Jember", "Bondowoso", "Situbondo", "Banyuwangi"],
  },
  { key: "madura", name: "Madura", short: "Madura", color: "var(--r6)", members: ["Bangkalan", "Sampang", "Pamekasan", "Sumenep"] },
]

export const regionOf: Record<string, Region> = Object.fromEntries(REGIONS.flatMap((r) => r.members.map((m) => [m, r])))

/** Porsi produksi tahunan yang dipanen pada Oktober (sama dengan neraca di halaman Stok). */
const PORSI_OKT = 0.065
/** Produksi beras Oktober (ton). */
export const prodBeras = (k: Wilayah) => k.prod * 0.6402 * PORSI_OKT * 1000
/** Konsumsi bulanan (ton). */
export const konsumsi = (k: Wilayah) => k.C * 1000
export const neraca = (k: Wilayah) => prodBeras(k) - konsumsi(k)

export interface Trade {
  from: Wilayah
  to: Wilayah
  ton: number
  km: number
}

function buildTrade(): Trade[] {
  const sur = WILAYAH.filter((k) => neraca(k) > 0)
  const def = WILAYAH.filter((k) => neraca(k) < 0)
  const out: Trade[] = []
  for (const d of def) {
    const need = -neraca(d) * 0.92 // sisanya ditutup stok sendiri
    const w = sur.map((s) => neraca(s) / Math.pow(Math.max(dist(s.n, d.n), 12), 1.6))
    const tw = w.reduce((a, b) => a + b, 0)
    sur.forEach((s, i) => {
      const ton = (need * w[i]) / tw
      if (ton >= 40) out.push({ from: s, to: d, ton: Math.round(ton / 10) * 10, km: dist(s.n, d.n) })
    })
  }
  return out.sort((a, b) => b.ton - a.ton)
}

export const TRADE = buildTrade()
export const TRADE_TOTAL = TRADE.reduce((a, t) => a + t.ton, 0)

/** Matriks arus antarkawasan [asal][tujuan], urutan sama dengan REGIONS. */
export const REGION_MATRIX: number[][] = (() => {
  const idx = Object.fromEntries(REGIONS.map((r, i) => [r.key, i]))
  const m = REGIONS.map(() => REGIONS.map(() => 0))
  for (const t of TRADE) m[idx[regionOf[t.from.n].key]][idx[regionOf[t.to.n].key]] += t.ton
  return m
})()

export const outflow = (n: string) => TRADE.filter((t) => t.from.n === n).reduce((a, t) => a + t.ton, 0)
export const inflow = (n: string) => TRADE.filter((t) => t.to.n === n).reduce((a, t) => a + t.ton, 0)

/** Kenaikan biaya angkut kasar: Rp per kg per 100 km (simulasi). */
export const ONGKOS_PER_100KM = 95

export function regionStats() {
  return REGIONS.map((r, i) => {
    const ks = r.members.map((m) => byName[m])
    const prod = ks.reduce((a, k) => a + prodBeras(k), 0)
    const kons = ks.reduce((a, k) => a + konsumsi(k), 0)
    const keluar = REGION_MATRIX[i].reduce((a, v, j) => a + (j === i ? 0 : v), 0)
    const masuk = REGION_MATRIX.reduce((a, row, j) => a + (j === i ? 0 : row[i]), 0)
    return { r, prod, kons, keluar, masuk, internal: REGION_MATRIX[i][i] }
  })
}
