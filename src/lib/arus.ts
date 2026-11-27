import { IDX_AKHIR, K2 } from "./api"
import { WILAYAH, byName, dist, type Wilayah } from "./data"
import { produksiBeras } from "./petaLayers"

/* Arus beras antarwilayah. Bila API tersambung: arus LP dari model K2 (lihat ARUS_K2). Tanpa API: model gravitasi (simulasi) di bawah.
 * Surplus = produksi beras Oktober (musim paceklik, ±6,5% produksi tahunan) − konsumsi; defisit sebaliknya.
 * Aliran diestimasi dengan gravitasi berkendala tujuan (lihat buildTrade). Semua angka dalam ton beras per bulan. */

export type RegionKey = "arek" | "mataraman" | "tapalkuda" | "madura"

export interface Region {
  key: RegionKey
  name: string
  short: string
  color: string
  members: string[]
}

/* Pembagian kultural-ekonomi Jawa Timur (empat kawasan klasik). Pengelompokan analitik tim, bukan batas administratif.
 * Kabupaten/kota yang berada di perbatasan ditempatkan secara pertimbangan: Pasuruan, Jombang, Lamongan (Arek); Tuban, Bojonegoro (Mataraman). */
export const REGIONS: Region[] = [
  {
    key: "arek",
    name: "Arek",
    short: "Arek",
    color: "var(--r3)",
    members: [
      "Kota Surabaya", "Sidoarjo", "Gresik", "Lamongan", "Mojokerto", "Kota Mojokerto", "Jombang",
      "Malang", "Kota Malang", "Batu", "Pasuruan", "Kota Pasuruan",
    ],
  },
  {
    key: "mataraman",
    name: "Mataraman",
    short: "Mataraman",
    color: "var(--r1)",
    members: [
      "Pacitan", "Ponorogo", "Trenggalek", "Tulungagung", "Blitar", "Kediri", "Nganjuk", "Madiun", "Magetan", "Ngawi",
      "Bojonegoro", "Tuban", "Kota Kediri", "Kota Blitar", "Kota Madiun",
    ],
  },
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

/** Konsumsi bulanan (ton). */
export const konsumsi = (k: Wilayah) => k.C * 1000
/** Surplus (+) atau kebutuhan (−) beras bulan `i` (0 = Jan 2026), ton: produksi K1 dikurangi konsumsi. Sama dengan neraca di halaman Stok. */
export const neracaBulan = (k: Wilayah, i: number) => produksiBeras(k, i) - konsumsi(k)
/** Bulan bawaan model arus: Oktober 2026. */
export const BULAN_ARUS = 9
export const prodBeras = (k: Wilayah) => produksiBeras(k, BULAN_ARUS)
export const neraca = (k: Wilayah) => neracaBulan(k, BULAN_ARUS)

export interface Trade {
  from: Wilayah
  to: Wilayah
  ton: number
  km: number
}

/** Eksponen hambatan jarak, dikalibrasi agar jarak tempuh rata-rata tertimbang volume, dirata-ratakan pada 13 bulan model (Jan 2026–Jan 2027), mendekati 46 km: hasil LP jarak jalan pada neraca K2 v1 (progress.md, 19 Nov 2026), yang berbasis neraca tahunan. Jarak memakai matriks jalan OSRM; neraca bulanan sama dengan halaman Stok (produksi K1 dikurangi konsumsi). Pencarian (rata-rata 13 bulan): γ 3,0 → 78 km, 4,0 → 57, 4,5 → 50, 5,0 → 46, 5,5 → 43, 6,0 → 40. Satu-satunya target kalibrasi; belum divalidasi terhadap aliran nyata. */
const GAMMA = 5.0

/** Gravitasi berkendala tujuan: kebutuhan tiap wilayah defisit dibagi ke wilayah surplus menurut bobot surplus asal / jarak^γ.
 *  Pasokan tidak dikunci sebagai kendala (total surplus jauh melebihi total kebutuhan), jadi jarak yang menentukan siapa yang mengirim. */
function buildTrade(bulan: number): Trade[] {
  const sur = WILAYAH.filter((k) => neracaBulan(k, bulan) > 0)
  const def = WILAYAH.filter((k) => neracaBulan(k, bulan) < 0)
  const out: Trade[] = []
  for (const d of def) {
    const need = -neracaBulan(d, bulan) * 0.92 // sisanya ditutup stok sendiri
    const w = sur.map((s) => neracaBulan(s, bulan) / Math.pow(Math.max(dist(s.n, d.n), 12), GAMMA))
    const tw = w.reduce((a, b) => a + b, 0)
    sur.forEach((s, i) => {
      const ton = (need * w[i]) / tw
      if (ton >= 40) out.push({ from: s, to: d, ton: Math.round(ton / 10) * 10, km: dist(s.n, d.n) })
    })
  }
  return out.sort((a, b) => b.ton - a.ton)
}

/** Alokasi tahunan K2 (LP jarak jalan atas neraca 2025): ton per tahun per rute. Kosong bila API mati atau run K2 lama;
 *  saat itu dipakai model gravitasi buildTrade (simulasi). */
const ALOKASI_K2 = (K2?.meta.arus ?? [])
  .filter((a) => byName[a.dari] && byName[a.ke] && a.ton_bulan >= 1)
  .map((a) => ({ from: byName[a.dari], to: byName[a.ke], tonTahun: a.ton_bulan * 12, km: dist(a.dari, a.ke) }))
/** Arus beras berasal dari hasil pemodelan K2 (bukan simulasi). */
export const ARUS_DARI_MODEL = ALOKASI_K2.length > 0

/** Alokasi bulanan K2: alokasi tahunan ÷ 12, sama untuk semua bulan (pasokan yang diterima wilayah defisit di neraca K2).
 *  Uji 25 Nov 2026: menskalakan rute dengan pola panen pemasok membuat bulan paceklik/estimasi nyaris tanpa arus; untuk MVP dipakai rata. */
const ARUS_K2: Trade[] = ALOKASI_K2.map((a) => ({ from: a.from, to: a.to, ton: Math.round(a.tonTahun / 12 / 10) * 10, km: a.km }))
  .filter((x) => x.ton >= 10)
  .sort((x, y) => y.ton - x.ton)

const CACHE = new Map<number, Trade[]>()
/** Arus beras bulan `i` (0 = Jan 2026), ton/bulan. Dengan K2: alokasi tahunan neraca 2025 ÷ 12 (sama tiap bulan).
 *  Tanpa K2: estimasi gravitasi atas neraca bulan itu (simulasi). */
export function tradeFor(i: number): Trade[] {
  if (ARUS_DARI_MODEL) return ARUS_K2
  const b = Math.max(0, Math.min(IDX_AKHIR, Math.round(i)))
  let t = CACHE.get(b)
  if (!t) {
    t = buildTrade(b)
    CACHE.set(b, t)
  }
  return t
}

export const TRADE = tradeFor(BULAN_ARUS)
export const TRADE_TOTAL = TRADE.reduce((a, t) => a + t.ton, 0)

/** Matriks arus antarkawasan [asal][tujuan], urutan sama dengan REGIONS. */
export function matrixOf(trade: Trade[]): number[][] {
  const idx = Object.fromEntries(REGIONS.map((r, i) => [r.key, i]))
  const m = REGIONS.map(() => REGIONS.map(() => 0))
  for (const t of trade) m[idx[regionOf[t.from.n].key]][idx[regionOf[t.to.n].key]] += t.ton
  return m
}
export const REGION_MATRIX: number[][] = matrixOf(TRADE)

export const outflow = (n: string) => TRADE.filter((t) => t.from.n === n).reduce((a, t) => a + t.ton, 0)
export const inflow = (n: string) => TRADE.filter((t) => t.to.n === n).reduce((a, t) => a + t.ton, 0)

/** Kenaikan biaya angkut kasar: Rp per kg per 100 km (simulasi). */
export const ONGKOS_PER_100KM = 95

export function regionStatsFor(bulan: number, trade: Trade[]) {
  const M = matrixOf(trade)
  return REGIONS.map((r, i) => {
    const ks = r.members.map((m) => byName[m])
    const prod = ks.reduce((a, k) => a + produksiBeras(k, bulan), 0)
    const kons = ks.reduce((a, k) => a + konsumsi(k), 0)
    const keluar = M[i].reduce((a, v, j) => a + (j === i ? 0 : v), 0)
    const masuk = M.reduce((a, row, j) => a + (j === i ? 0 : row[i]), 0)
    return { r, prod, kons, keluar, masuk, internal: M[i][i] }
  })
}

export const regionStats = () => regionStatsFor(BULAN_ARUS, TRADE)

/* Beras keluar Jawa Timur (ton per bulan), dari model K2: bagian surplus kab yang tidak teralokasi ke kab lain di neraca 2025,
 * dilepas pada bulan kelebihan panen. Null bila run K2 belum menyimpannya. */
const KP = K2?.meta.keluar_provinsi ?? null
/** Keluar provinsi bulan `i` (0 = Jan 2026), ton; null bila tidak ada. */
export const KELUAR_PROV: (number | null)[] | null = KP?.bulanan.length
  ? [...Array(IDX_AKHIR + 1)].map((_, i) => KP.bulanan.find((r) => (r.tahun - 2026) * 12 + r.bulan - 1 === i)?.ton ?? null)
  : null
/** Keluar provinsi per bulan 2025 (Jan..Des), ton. */
export const KELUAR_PROV_2025: number[] | null = KP?.pola_2025.length === 12 ? KP.pola_2025 : null
/** Jumlah surplus kab surplus 2025 (ton), penyebut porsi keluar provinsi. */
export const SURPLUS_KAB_2025: number | null = KP?.surplus_kab_2025 ?? null
