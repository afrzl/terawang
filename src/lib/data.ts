import { JARAK_JALAN_KM, NAMA_JARAK } from "./jarak"
import { API_AKTIF, K2, K3A, K3B } from "./api"
import { K3B_RUTE } from "./k3b"
import geoJson from "./jatim.json"
import geeJson from "./gee_wilayah.json"
import { DAY, NOW, clamp, hash, nf, rng, rp } from "./format"

/* Angka satelit (penduduk, luas sawah, produksi, fase tumbuh, petak tertinggal, proyeksi panen, profil VH)
   berasal dari Google Earth Engine — lihat scripts/gee/terawang_wilayah.py → ./gee_wilayah.json.
   Harga dan stok tidak teramati satelit: modelnya didorong produksi & penduduk GEE, harga dasar masih simulasi. */

export interface GeeWilayah {
  n: string
  pop: number
  ha: number
  ip: number
  prod: number
  ph: number[]
  lag: number
  est: number
  prev: number
  ci: number
  cakupan_s2: number
  vh: (number | null)[]
  vhAvg: (number | null)[]
  pusat: [number, number] | null
}
export const GEE = geeJson as unknown as { dibuat: string; acuan: string; sumber: string; wilayah: GeeWilayah[] }
const geeBy: Record<string, GeeWilayah> = Object.fromEntries(GEE.wilayah.map((w) => [w.n, w]))

export interface GeoShape {
  /** Path SVG batas wilayah (kosong untuk wilayah yang hanya ditandai titik). */
  d: string
  /** Titik pusat [x, y] pada koordinat peta. */
  c: [number, number]
}
export const GEO = geoJson as unknown as Record<string, GeoShape>

/** Harga Eceran Tertinggi beras medium (Rp/kg), berlaku sejak 22 Agu 2025. Sumber: pemberitaan Kepbadan 299/2025, belum diverifikasi ke teks resmi (lihat metodologi K3a). */
export const HET = 13500
/** HET beras premium (Rp/kg), berlaku sejak 22 Agu 2025. */
export const HET_PREMIUM = 14900
/** Pengali HET untuk status Siaga di K3a (P(harga > 1,05·HET)). */
export const SIAGA_KALI = 1.05
/** Harga Siaga: HET × 1,05. */
export const SIAGA = Math.round(HET * SIAGA_KALI)
/** Ambang peluang WASPADA per horizon 7, 14, 21, 28 hari, dikalibrasi pada F1 maksimum di K3a. */
export const AMBANG_WASPADA = { medium: [0.15, 0.2, 0.25, 0.3], premium: [0.1, 0.1, 0.1, 0.25] }

const erfKu = (x: number) => {
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return x >= 0 ? y : -y
}
/** Peluang harga melewati `x` bila prakiraan bermedian `m` dan P90 `hi`. Pendekatan normal dari P10 dan P90; K3a menghitungnya dari sebaran galat empiris. */
export function peluangDi(m: number, hi: number, x: number) {
  const sd = Math.max(1e-6, (hi - m) / 1.2816)
  return 0.5 * (1 - erfKu((x - m) / sd / Math.SQRT2))
}
/** Status harga menurut aturan K3a: SIAGA bila P(> 1,05·HET) ≥ max(ambang, 0,5); WASPADA bila P(> HET) ≥ ambang horizon; selain itu AMAN. `hor` = 1..4 pekan. */
export function statusDari(m: number, hi: number, het: number, hor: number, kom: "medium" | "premium"): "aman" | "waspada" | "siaga" {
  const amb = AMBANG_WASPADA[kom][Math.max(0, Math.min(3, hor - 1))]
  if (peluangDi(m, hi, het * SIAGA_KALI) >= Math.max(amb, 0.5)) return "siaga"
  if (peluangDi(m, hi, het) >= amb) return "waspada"
  return "aman"
}

export type HargaStatus = "aman" | "waspada" | "siaga"
export type StokStatus = "surplus" | "cukup" | "tipis" | "defisit"

export interface Forecast {
  m: number
  lo: number
  hi: number
}

/** Seri harga hasil K3a untuk satu jenis beras (dari API). */
export interface HargaK3a {
  price: number[]
  fc: Forecast[]
  status: HargaStatus[]
}

export interface Wilayah {
  n: string
  /** Penduduk (ribu jiwa). */
  pop: number
  /** Produksi GKG tahunan (ribu ton). */
  prod: number
  /** Harga dasar beras medium (Rp/kg). */
  pb: number
  isKota: boolean
  /** Konsumsi beras (ribu ton/bulan). */
  C: number
  /** Rasio produksi terhadap konsumsi. */
  r: number
  /** Tingkat ketergantungan pada pasokan luar (0–1). */
  df: number
  yoy: number
  /** Proyeksi panen Nov–Jan (ribu ton GKG). */
  est: number
  ci: number
  prev: number
  /** Luas baku sawah (ha). */
  ha: number
  /** Persentase luas per fase tumbuh (5 fase). */
  ph: number[]
  /** Persentase petak tertinggal. */
  lag: number
  /** Cakupan stok kini (bulan konsumsi). */
  cov: number
  covH: number[]
  covP: number[]
  obs: (number | null)[]
  decl: number
  price: number[]
  fc: Forecast[]
  /** Seri K3a medium dan premium; ada bila API tersambung. */
  harga?: Record<"medium" | "premium", HargaK3a>
  prem: number
  pNow: number
  p4: number
  hs: HargaStatus
  ss: StokStatus
  shift: number
  /** Profil Sentinel-1 VH sawah (dB), 15 akuisisi tiap 12 hari mulai 1 Jun 2026; null = belum ada citra. */
  vh: (number | null)[]
  /** Rata-rata profil VH pada tanggal yang sama, 2023–2025. */
  vhAvg: (number | null)[]
  /** Indeks pertanaman (kali tanam per tahun) dari NDVI Sentinel-2. */
  ip: number
  /** Titik pusat hamparan sawah [lon, lat] untuk kotak citra. */
  pusat: [number, number] | null
  R: () => number
}

// nama, penduduk (ribu), produksi GKG tahunan (ribu ton), harga dasar medium (Rp/kg)
// Penduduk & produksi di bawah hanya cadangan; nilai GEE dipakai bila tersedia (lihat simulate).
const BASE: [string, number, number, number][] = [
  ["Pacitan", 600, 92, 13250], ["Ponorogo", 975, 340, 12950], ["Trenggalek", 750, 118, 13150], ["Tulungagung", 1110, 215, 13050], ["Blitar", 1240, 232, 13000],
  ["Kediri", 1660, 295, 13000], ["Malang", 2700, 330, 13150], ["Lumajang", 1140, 300, 12950], ["Jember", 2580, 770, 12850], ["Banyuwangi", 1740, 525, 12900],
  ["Bondowoso", 790, 232, 13000], ["Situbondo", 690, 205, 13050], ["Probolinggo", 1170, 262, 13100], ["Pasuruan", 1640, 345, 13100], ["Sidoarjo", 2010, 118, 13350],
  ["Mojokerto", 1130, 300, 13050], ["Jombang", 1350, 400, 12950], ["Nganjuk", 1120, 425, 12900], ["Madiun", 760, 385, 12850], ["Magetan", 690, 250, 12950],
  ["Ngawi", 880, 805, 12800], ["Bojonegoro", 1320, 720, 12850], ["Tuban", 1220, 480, 12950], ["Lamongan", 1380, 885, 12800], ["Gresik", 1330, 350, 13150],
  ["Bangkalan", 1100, 150, 13550], ["Sampang", 990, 140, 13650], ["Pamekasan", 870, 98, 13700], ["Sumenep", 1140, 162, 13720],
  ["Kota Kediri", 290, 9, 13250], ["Kota Blitar", 160, 6, 13200], ["Kota Malang", 850, 7, 13550], ["Kota Probolinggo", 245, 8, 13300], ["Kota Pasuruan", 210, 5, 13300],
  ["Kota Mojokerto", 135, 3, 13300], ["Kota Madiun", 200, 6, 13200], ["Kota Surabaya", 2890, 4, 13550], ["Batu", 220, 10, 13600],
]

export const HIST = 26
export const histDates = [...Array(HIST)].map((_, i) => new Date(+NOW - (HIST - 1 - i) * 7 * DAY))
export const fcDates = [1, 2, 3, 4].map((h) => new Date(+NOW + h * 7 * DAY))
export const PHASES = ["Bera", "Olah tanah/genangan", "Vegetatif", "Generatif", "Siap panen"]

function simulate([n, pop0, prod0, pb]: [string, number, number, number]): Wilayah {
  const R = rng(hash(n))
  const g = geeBy[n]
  const pop = g ? g.pop : pop0
  const prod = g ? g.prod : prod0
  const isKota = n.startsWith("Kota ") || n === "Batu"
  const C = (pop * 6.39) / 1000 // ribu ton beras / bulan
  const r = (prod * 0.6402) / 12 / C // rasio produksi : konsumsi
  const df = clamp(1 - r / 2, 0, 1)
  // K1 produksi
  let yoy: number, est: number, ci: number, prev: number, ha: number, ph: number[], lag: number
  if (g) {
    est = g.est // ribu ton GKG Nov–Jan, dari fase tumbuh Sentinel-2
    prev = g.prev // periode sama tahun lalu
    yoy = prev > 0 ? est / prev - 1 : 0
    ci = g.ci
    ha = g.ha
    ph = g.ph
    lag = g.lag
  } else {
    yoy = -(0.03 + R() * 0.12) * (r > 1.5 ? 1 : 0.7)
    est = prod * 0.17 * (1 + yoy * 0.2)
    ci = est * (0.06 + R() * 0.06)
    prev = est / (1 + yoy)
    ha = (prod * 1000) / 11.2
    ph = [22 + R() * 24, 14 + R() * 16, 14 + R() * 22, 5 + R() * 12, 2 + R() * 7]
    const sp = ph.reduce((a, b) => a + b)
    ph = ph.map((v) => (v / sp) * 100)
    lag = 2 + R() * 11
  }
  // K2 stok (bulan konsumsi)
  const cov = (isKota ? 0.78 + R() * 0.2 : 0.88 + 0.68 * Math.min(r, 3.6)) * (0.92 + R() * 0.14)
  const decl = cov * (0.018 + R() * 0.012) + df * 0.02
  const covH = histDates.map((_, i) => {
    const back = HIST - 1 - i
    return cov + decl * back * 0.9 + Math.sin(i * 0.9 + R() * 2) * cov * 0.025
  })
  const covP = [...Array(8)].map((_, h) => Math.max(0.15, cov - decl * (h + 1) * (1 + h * 0.04)))
  const obs = histDates.map((_, i) => (i % 4 === hash(n) % 4 ? covH[i] * (1 + (R() - 0.5) * 0.12) : null))
  // K3 harga
  const slope = 15 + 50 * df + R() * 14
  const pNow = pb + 90 * df + (R() - 0.5) * 120
  const price = histDates.map((_, i) => {
    const back = HIST - 1 - i
    const up = Math.min(back, 11)
    return pNow - slope * up - (back > 11 ? Math.sin(back * 0.5) * 25 : 0) + (R() - 0.5) * 50
  })
  price[HIST - 1] = pNow
  const fc = [1, 2, 3, 4].map((h) => {
    const m = pNow + slope * h * 1.08
    return { m, lo: m - (70 + 48 * h), hi: m + (70 + 48 * h) }
  })
  const prem = pNow + 1450 + R() * 250
  const p4 = fc[3].m
  const hs: HargaStatus = statusDari(p4, fc[3].hi, HET, 4, "medium")
  const ss: StokStatus = covP[3] < 0.75 ? "defisit" : covP[3] < 1 ? "tipis" : covP[3] < 1.5 ? "cukup" : "surplus"
  // Profil Sentinel-1 VH: 15 akuisisi tiap 12 hari mulai 1 Jun. shift = geser (akuisisi) titik VH terendah
  // musim ini terhadap rata-rata 2023–25 → positif berarti tanam lebih lambat.
  const vh = g?.vh ?? []
  const vhAvg = g?.vhAvg ?? []
  const argmin = (xs: (number | null)[]) =>
    xs.reduce<number>((b, v, i) => (v != null && (xs[b] == null || v < (xs[b] as number)) ? i : b), 0)
  const shift = vh.length ? Math.max(0, Math.min(6, argmin(vh) - argmin(vhAvg) + 2)) : (r > 1.5 ? 2 : 3) + Math.round(R() * 1.5)
  const ip = g?.ip ?? 2
  const pusat = g?.pusat ?? null
  return { n, pop, prod, pb, isKota, C, r, df, yoy, est, ci, prev, ha, ph, lag, cov, covH, covP, obs, decl, price, fc, prem, pNow, p4, hs, ss, shift, vh, vhAvg, ip, pusat, R }
}

export const WILAYAH: Wilayah[] = BASE.map(simulate)

/** Bila hasil K3a tersedia dari API: harga, prakiraan, dan status (medium dan premium) diambil dari model, bukan simulasi. */
if (K3A) {
  const huruf: Record<string, HargaStatus> = { AMAN: "aman", WASPADA: "waspada", SIAGA: "siaga" }
  const isi = (xs: (number | null)[]) => {
    const out: number[] = []
    let last: number | null = xs.find((v) => v != null) ?? null
    for (const v of xs) {
      if (v != null) last = v
      out.push(last ?? 0)
    }
    return out
  }
  const bentuk = (sr: { price: (number | null)[]; fc: Forecast[]; status: string[] }): HargaK3a => ({ price: isi(sr.price), fc: sr.fc, status: sr.status.map((x) => huruf[x] ?? "aman") })
  for (const k of WILAYAH) {
    const w = K3A.wilayah[k.n]
    if (!w || w.medium.fc.length < 4 || w.premium.fc.length < 4) continue
    const med = bentuk(w.medium)
    const pre = bentuk(w.premium)
    k.harga = { medium: med, premium: pre }
    k.price = med.price
    k.pNow = med.price[med.price.length - 1]
    k.fc = med.fc
    k.p4 = med.fc[3].m
    k.hs = med.status[3]
    k.prem = pre.price[pre.price.length - 1]
  }
}

/** Seri harga mingguan (26 pekan) untuk jenis beras `kom`. Tanpa K3a: premium = medium + selisih tetap (simulasi). */
export const seriHarga = (k: Wilayah, kom: "medium" | "premium"): number[] => (k.harga ? k.harga[kom].price : k.price.map((v) => v + (kom === "premium" ? k.prem - k.pNow : 0)))
/** Prakiraan 7, 14, 21, 28 hari untuk jenis beras `kom`. */
export const fcHarga = (k: Wilayah, kom: "medium" | "premium"): Forecast[] => {
  if (k.harga) return k.harga[kom].fc
  const off = kom === "premium" ? k.prem - k.pNow : 0
  return k.fc.map((f) => ({ m: f.m + off, lo: f.lo + off, hi: f.hi + off }))
}
export const pNowHarga = (k: Wilayah, kom: "medium" | "premium") => (kom === "premium" ? k.prem : k.pNow)
/** Status K3a tersimpan pada horizon `hor` (1–4); null bila tidak ada hasil K3a. */
export const statusK3a = (k: Wilayah, hor: number, kom: "medium" | "premium"): HargaStatus | null => k.harga?.[kom].status[hor - 1] ?? null

/** Bila hasil K2 tersedia dari API: konsumsi, cakupan, dan status stok bulan berjalan (Nov 2026) diambil dari model, bukan simulasi. */
if (K2) {
  const STATUS_STOK: Record<string, StokStatus> = { DEFISIT: "defisit", TIPIS: "tipis", CUKUP: "cukup", SURPLUS: "surplus" }
  for (const k of WILAYAH) {
    const w = K2.wilayah[k.n]
    if (!w) continue
    if (w.konsumsi) k.C = w.konsumsi / 1000
    const c = w.cakupan[10]
    if (c != null) k.cov = c
    const st = w.status[10]
    if (st && STATUS_STOK[st]) k.ss = STATUS_STOK[st]
  }
}
export const byName: Record<string, Wilayah> = Object.fromEntries(WILAYAH.map((k) => [k.n, k]))
export const WILAYAH_SORTED = WILAYAH.map((k) => k.n).sort((a, b) => a.localeCompare(b))

/* ---------- SPHP: pasangkan wilayah rawan dengan gudang surplus terdekat ---------- */
const KM = (111 / 230) * 1.3
const IDX_JARAK = Object.fromEntries(NAMA_JARAK.map((n, i) => [n, i]))
/** Jarak jalan (km) antar dua wilayah: rata-rata dua arah dari matriks OSRM. Bila nama tidak ada di matriks, dipakai perkiraan dari koordinat. */
export function dist(a: string, b: string) {
  const i = IDX_JARAK[a]
  const j = IDX_JARAK[b]
  if (i !== undefined && j !== undefined) return (JARAK_JALAN_KM[i][j] + JARAK_JALAN_KM[j][i]) / 2
  const A = GEO[a].c
  const B = GEO[b].c
  return Math.hypot(A[0] - B[0], A[1] - B[1]) * KM
}

export interface Flow {
  to: Wilayah
  from: Wilayah
  ton: number
  km: number
  /** Indeks bulan (0 = Jan 2026): 10 = Nov 2026, 11 = Des 2026, 12 = Jan 2027. */
  bulan: number
}

/** Rute SPHP dari K3b, semua bulan. Rute dengan asal sama dengan tujuan (0 km) berarti kiriman ke kabupaten lokasi cabang itu sendiri. */
/** Sumber rute: hasil K3b dari API bila pengguna berhak; API aktif tanpa hak (guest) = kosong; API mati = salinan statis lama (K3B_RUTE). */
const SUMBER_RUTE = K3B ? K3B.rute.map((r) => ({ bulan: r.bulan, dari: r.dari, ke: r.ke, ton: r.ton, km: r.km })) : API_AKTIF ? [] : K3B_RUTE
export const FLOWS: Flow[] = SUMBER_RUTE.filter((r) => byName[r.dari] && byName[r.ke])
  .map((r) => ({ from: byName[r.dari], to: byName[r.ke], ton: Math.round(r.ton), km: r.km, bulan: r.bulan }))
  .sort((a, b) => a.bulan - b.bulan || b.ton - a.ton)

/** Rute SPHP pada bulan `a` sampai `b` (termasuk). */
export const flowsBulan = (a: number, b: number) => FLOWS.filter((f) => f.bulan >= Math.min(a, b) && f.bulan <= Math.max(a, b))

/** Gabungkan rute yang pasangan asal-tujuannya sama (antar bulan) dan buang kiriman ke lokasi cabang sendiri. Untuk digambar di peta. */
export function gabungRute(flows: Flow[]): { from: Wilayah; to: Wilayah; ton: number; km: number }[] {
  const m = new Map<string, { from: Wilayah; to: Wilayah; ton: number; km: number }>()
  for (const f of flows) {
    if (f.from === f.to) continue
    const key = f.from.n + "|" + f.to.n
    const cur = m.get(key)
    if (cur) cur.ton += f.ton
    else m.set(key, { from: f.from, to: f.to, ton: f.ton, km: f.km })
  }
  return [...m.values()].sort((a, b) => b.ton - a.ton)
}

/* ---------- status & lapisan peta ---------- */
export const STATUS: Record<HargaStatus, { lab: string; g: string; c: string }> = {
  aman: { lab: "Aman", g: "●", c: "var(--ok)" },
  waspada: { lab: "Waspada", g: "▲", c: "var(--warn)" },
  siaga: { lab: "Siaga", g: "◆", c: "var(--crit)" },
}
export const SSTAT: Record<StokStatus, { lab: string; g: string }> = {
  surplus: { lab: "Surplus", g: "■" },
  cukup: { lab: "Cukup", g: "●" },
  tipis: { lab: "Tipis", g: "▲" },
  defisit: { lab: "Defisit", g: "◆" },
}

export type LayerKey = "fase" | "produksi" | "stok" | "stokK2" | "harga"
type Bin = [number, number, string, string]

export interface Layer {
  title: string
  label: string
  val: (k: Wilayah) => number
  bins: Bin[]
  na?: (k: Wilayah) => boolean
  fmt: (v: number) => string
}

export const LAYERS: Record<LayerKey, Layer> = {
  fase: {
    title: "Tanaman berdiri (vegetatif + generatif), % sawah",
    label: "Tanaman berdiri",
    val: (k) => k.ph[2] + k.ph[3],
    bins: [[0, 20, "--s1", "< 20%"], [20, 30, "--s2", "20–30%"], [30, 40, "--s3", "30–40%"], [40, 50, "--s4", "40–50%"], [50, 999, "--s5", "≥ 50%"]],
    na: (k) => k.ha < 1500,
    fmt: (v) => nf(v, 0) + "%",
  },
  produksi: {
    title: "Proyeksi panen Nov 2026 – Jan 2027, ribu ton GKG",
    label: "Proyeksi panen",
    val: (k) => k.est,
    bins: [[0, 10, "--s1", "< 10"], [10, 30, "--s2", "10–30"], [30, 50, "--s3", "30–50"], [50, 90, "--s4", "50–90"], [90, 1e9, "--s5", "≥ 90"]],
    fmt: (v) => nf(v, 1) + " rb ton",
  },
  stok: {
    title: "Cakupan stok proyeksi 4 pekan, bulan konsumsi",
    label: "Cakupan stok",
    val: (k) => k.covP[3],
    bins: [[0, 0.75, "--d1", "< 0,75 defisit"], [0.75, 1, "--d2", "0,75–1"], [1, 1.5, "--d3", "1–1,5"], [1.5, 2.5, "--d4", "1,5–2,5"], [2.5, 99, "--d5", "≥ 2,5 surplus"]],
    fmt: (v) => nf(v, 2) + " bln",
  },
  /** Cakupan stok non-Bulog menurut ambang status K2 (defisit < 0,75, tipis 0,75–1, cukup 1–1,5, surplus ≥ 1,5). Nilai diberikan lewat `getValue` per bulan. */
  stokK2: {
    title: "Cakupan stok non-Bulog",
    label: "Cakupan stok",
    val: (k) => k.cov,
    bins: [[0, 0.75, "--d1", "< 0,75 defisit"], [0.75, 1, "--d2", "0,75–1 tipis"], [1, 1.5, "--d3", "1–1,5 cukup"], [1.5, 99, "--d5", "≥ 1,5 surplus"]],
    fmt: (v) => nf(v, 2) + " bln",
  },
  harga: {
    title: "Prakiraan harga 4 pekan terhadap HET Rp13.500/kg",
    label: "Harga prakiraan",
    val: (k) => k.p4,
    bins: [[0, HET, "--ok-map", "Di bawah HET"], [HET, SIAGA + 0.0001, "--warn", "HET sampai HET +5%"], [SIAGA + 0.0001, 1e9, "--crit", "Di atas HET +5%"]],
    fmt: (v) => rp(v) + "/kg",
  },
}

export const LAYER_KEYS: LayerKey[] = ["fase", "produksi", "stok", "harga"]

export function binColor(L: LayerKey, v: number) {
  const d = LAYERS[L]
  const b = d.bins.find((b) => v >= b[0] && v < b[1]) ?? d.bins[d.bins.length - 1]
  return `var(${b[2]})`
}

export function colorOf(L: LayerKey, k: Wilayah) {
  const d = LAYERS[L]
  if (d.na?.(k)) return "var(--s0)"
  return binColor(L, d.val(k))
}

/** Skor risiko untuk mengurutkan daftar perhatian. */
export function risk(k: Wilayah) {
  return { siaga: 3, waspada: 1.5, aman: 0 }[k.hs] + { defisit: 3, tipis: 1.2, cukup: 0, surplus: 0 }[k.ss] + (k.p4 - HET) / 1000
}
