import { HET, HET_PREMIUM, HIST, fcHarga, flowsBulan, statusDari, statusK3a, type HargaStatus, type Wilayah } from "@/lib/data"
import { K1, K2 } from "@/lib/api"
import { nf, rp, sum } from "@/lib/format"

/**
 * Lapisan peta menurut keluaran metodologi K1, K2, K3a, dan K3b.
 * Semua nilai di sini DUMMY: diturunkan dari data simulasi di data.ts.
 * Penyambungan data asli: ganti isi fungsi nilai (produksiBeras, covBulan, hargaAt, dst.) tanpa mengubah antarmukanya.
 */

export type Komoditas = "medium" | "premium"

export type SpecKey = "produksiBeras" | "luasPanen" | "cakupan" | "surplus" | "statusHarga" | "hargaPrakiraan" | "pAtasHet" | "sphp"

export type Bin = [number, number, string, string]

export interface SpecCtx {
  /** Rentang bulan (indeks 0 = Jan 2026). Lapisan bulanan memakai `akhir`, kecuali produksi dan luas panen yang dijumlah. */
  mulai: number
  akhir: number
  /** Horizon prakiraan harga dalam pekan (1–4 = 7–28 hari). */
  hor: number
  kom: Komoditas
}

export interface LayerSpec {
  key: SpecKey
  label: string
  title: string
  /** Waktu yang dipakai lapisan: bulan filter, horizon harga, atau tidak ada. */
  waktu: "bulan" | "horizon" | "none"
  val: (k: Wilayah) => number
  fmt: (v: number) => string
  bins: Bin[]
}

/** Pola bulanan luas panen Jatim (ribu ha), Jan 2026–Jan 2027. DUMMY: Jan–Sep dari taksiran citra, Okt–Jan dari prakiraan K1. */
const POLA = [68, 129, 189, 64, 73, 71, 157, 65, 75, 88, 79, 66, 55]
/** Produktivitas beras (ton/ha), dari dokumen K1. */
const PROD_HA = 3.3
const BERAS_PER_GKG = 0.6402

export const hetOf = (kom: Komoditas) => (kom === "medium" ? HET : HET_PREMIUM)

const bln = (i: number) => Math.min(12, Math.max(0, i))
/** Hasil K1 dari database tersedia (bukan simulasi). */
export const dataK1 = K1 !== null

/** Produksi beras bulan i (ton). Dari K1 (app.prediksi_produksi) bila API tersambung; selain itu simulasi (Nov–Jan dibagi menurut pola). */
export const produksiBeras = (k: Wilayah, i: number) => {
  if (K1) return K1.wilayah[k.n]?.k1[bln(i)] ?? 0
  return (k.est * 1000 * BERAS_PER_GKG * POLA[bln(i)]) / 200
}

/** Produksi beras bulan a sampai b (termasuk), ton. */
export const produksiRentang = (k: Wilayah, a: number, b: number) => {
  let t = 0
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) t += produksiBeras(k, i)
  return t
}

/** Pembanding periode yang sama setahun sebelumnya (ton): BPS 2025 untuk Jan–Des 2026; Jan 2027 dibandingkan dengan Jan 2026. */
export const produksiPrev = (k: Wilayah, i: number) => {
  if (K1) {
    const w = K1.wilayah[k.n]
    return i <= 11 ? (w?.bps2025[bln(i)] ?? 0) : (w?.k1[0] ?? 0)
  }
  return produksiBeras(k, i) / (1 + k.yoy)
}
export const produksiPrevRentang = (k: Wilayah, a: number, b: number) => {
  let t = 0
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) t += produksiPrev(k, i)
  return t
}

/** Perubahan terhadap periode yang sama tahun lalu (pecahan, 0,1 = +10%). */
export const yoyRentang = (k: Wilayah, a: number, b: number) => {
  const p = produksiPrevRentang(k, a, b)
  return p > 0 ? produksiRentang(k, a, b) / p - 1 : 0
}

/** Batas P10 dan P90 produksi bulan a sampai b (ton). Rentang berbulan dijumlah per bulan, jadi sedikit lebih lebar dari kuantil jumlahnya. */
export const produksiBatas = (k: Wilayah, a: number, b: number) => {
  if (K1) {
    const w = K1.wilayah[k.n]
    let lo = 0
    let hi = 0
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
      lo += w?.p10[bln(i)] ?? 0
      hi += w?.p90[bln(i)] ?? 0
    }
    return { lo, hi }
  }
  const tot = produksiRentang(k, a, b)
  const r = k.est > 0 ? k.ci / k.est : 0
  return { lo: tot * (1 - r), hi: tot * (1 + r) }
}

/** Porsi panen Nov–Jan yang jatuh pada bulan a..b (termasuk). Dipakai halaman Produksi untuk menyesuaikan angka dengan filter waktu. */
export const porsiPanen = (a: number, b: number) => {
  let t = 0
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) t += POLA[Math.min(12, Math.max(0, i))]
  return t / 200
}

/** Pengali dari proyeksi Nov–Jan (ribu ton GKG) ke produksi beras pada bulan a..b (ribu ton). */
export const faktorBeras = (a: number, b: number) => porsiPanen(a, b) * BERAS_PER_GKG

/** Produktivitas beras (ton/ha), dari dokumen K1. */
export const PRODUKTIVITAS = PROD_HA

/** Luas panen bulan i (ha). */
export const luasPanen = (k: Wilayah, i: number) => produksiBeras(k, i) / PROD_HA

/** Cakupan stok akhir bulan i (bulan konsumsi). */
export function covBulan(k: Wilayah, i: number) {
  if (K2) return K2.wilayah[k.n]?.cakupan[Math.min(12, Math.max(0, i))] ?? k.cov
  if (i >= 12) return k.covP[7]
  if (i === 11) return k.covP[3]
  if (i === 10) return k.cov
  return k.covH[Math.max(0, HIST - 1 - (10 - i) * 4)]
}

/** Hasil K2 dari database tersedia (bukan simulasi). */
export const dataK2 = K2 !== null

/** Pita P10 dan P90 cakupan stok bulan i (skenario RENDAH dan TINGGI K2); null bila tidak ada. */
export const cakupanBatas = (k: Wilayah, i: number) => {
  if (!K2) return null
  const w = K2.wilayah[k.n]
  const j = Math.min(12, Math.max(0, i))
  return w && w.p10[j] != null && w.p90[j] != null ? { lo: w.p10[j] as number, hi: w.p90[j] as number } : null
}

/** Surplus (+) atau kebutuhan (−) dalam ton beras, terhadap cakupan 1,0 bulan. */
export const surplusTon = (k: Wilayah, i: number) => (covBulan(k, i) - 1) * k.C * 1000

/** Median prakiraan harga (Rp/kg) pada horizon `hor` pekan. Premium: selisih tetap terhadap medium (DUMMY). */
export const hargaAt = (k: Wilayah, hor: number, kom: Komoditas) => fcHarga(k, kom)[hor - 1].m

/** Status harga K3a pada horizon `hor` (1–4 pekan) untuk jenis beras `kom`. Premium: selisih tetap terhadap medium (DUMMY). */
export function statusHargaAt(k: Wilayah, hor: number, kom: Komoditas): HargaStatus {
  // Hasil K3a (status dari model) bila ada; selain itu aturan yang sama dihitung dari prakiraan simulasi.
  const st = statusK3a(k, hor, kom)
  if (st) return st
  const f = fcHarga(k, kom)[hor - 1]
  return statusDari(f.m, f.hi, hetOf(kom), hor, kom)
}

const erf = (x: number) => {
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return x >= 0 ? y : -y
}
/** Peluang harga melewati HET pada horizon `hor` pekan, dari pita P10–P90 (aproksimasi normal; DUMMY). */
export function pAtasHet(k: Wilayah, hor: number, kom: Komoditas) {
  const f = fcHarga(k, kom)[hor - 1]
  const sd = Math.max((f.hi - f.lo) / 2.563, 1)
  const z = (hetOf(kom) - hargaAt(k, hor, kom)) / sd
  return 1 - 0.5 * (1 + erf(z / Math.SQRT2))
}

/** Volume SPHP (ton): positif = penerima, negatif = pemasok. */
export const sphpTon = (k: Wilayah, a: number, b: number) => {
  const fl = flowsBulan(a, b)
  return sum(fl.filter((f) => f.to === k), (f) => f.ton) - sum(fl.filter((f) => f.from === k && f.to !== k), (f) => f.ton)
}

export const SPEC_GROUPS: { grup: string; keys: SpecKey[] }[] = [
  { grup: "K1 · Produksi", keys: ["produksiBeras", "luasPanen"] },
  { grup: "K2 · Stok", keys: ["cakupan", "surplus"] },
  { grup: "K3 · Harga", keys: ["statusHarga", "pAtasHet", "hargaPrakiraan"] },
  { grup: "K3b · SPHP", keys: ["sphp"] },
]

export const SPEC_LABEL: Record<SpecKey, string> = {
  produksiBeras: "Produksi beras",
  luasPanen: "Luas panen",
  cakupan: "Cakupan stok",
  surplus: "Neraca stok",
  statusHarga: "Status harga",
  pAtasHet: "Peluang melewati HET",
  hargaPrakiraan: "Prakiraan harga",
  sphp: "Rekomendasi SPHP",
}

export const isHarga = (k: SpecKey) => k === "statusHarga" || k === "pAtasHet" || k === "hargaPrakiraan"

const ton = (v: number) => nf(v, 0) + " ton"

export function makeSpec(key: SpecKey, c: SpecCtx): LayerSpec {
  const n = c.akhir - c.mulai + 1
  const rentang = n > 1 ? ` · ${n} bulan` : ""
  const hari = c.hor * 7
  const het = hetOf(c.kom)
  const jenis = c.kom === "medium" ? "medium" : "premium"
  const sumBulan = (f: (k: Wilayah, i: number) => number) => (k: Wilayah) => {
    let s = 0
    for (let i = c.mulai; i <= c.akhir; i++) s += f(k, i)
    return s
  }
  const base = { key, label: SPEC_LABEL[key] }

  switch (key) {
    case "produksiBeras":
      return {
        ...base,
        title: `Produksi beras (ton)${rentang}`,
        waktu: "bulan",
        val: sumBulan(produksiBeras),
        fmt: ton,
        bins: [
          [0, 1000 * n, "--s1", `< ${nf(1000 * n, 0)}`],
          [1000 * n, 3000 * n, "--s2", `${nf(1000 * n, 0)}–${nf(3000 * n, 0)}`],
          [3000 * n, 8000 * n, "--s3", `${nf(3000 * n, 0)}–${nf(8000 * n, 0)}`],
          [8000 * n, 15000 * n, "--s4", `${nf(8000 * n, 0)}–${nf(15000 * n, 0)}`],
          [15000 * n, 1e12, "--s5", `≥ ${nf(15000 * n, 0)}`],
        ],
      }
    case "luasPanen":
      return {
        ...base,
        title: `Luas panen (ha)${rentang}`,
        waktu: "bulan",
        val: sumBulan(luasPanen),
        fmt: (v) => nf(v, 0) + " ha",
        bins: [
          [0, 300 * n, "--s1", `< ${nf(300 * n, 0)}`],
          [300 * n, 1000 * n, "--s2", `${nf(300 * n, 0)}–${nf(1000 * n, 0)}`],
          [1000 * n, 2500 * n, "--s3", `${nf(1000 * n, 0)}–${nf(2500 * n, 0)}`],
          [2500 * n, 4500 * n, "--s4", `${nf(2500 * n, 0)}–${nf(4500 * n, 0)}`],
          [4500 * n, 1e12, "--s5", `≥ ${nf(4500 * n, 0)}`],
        ],
      }
    case "cakupan":
      return {
        ...base,
        title: "Cakupan stok (bulan konsumsi)",
        waktu: "bulan",
        val: (k) => covBulan(k, c.akhir),
        fmt: (v) => nf(v, 2) + " bln",
        bins: [[-1e9, 0.75, "--d1", "< 0,75 defisit"], [0.75, 1, "--d2", "0,75–1 tipis"], [1, 1.5, "--d3", "1–1,5 cukup"], [1.5, 2.5, "--d4", "1,5–2,5"], [2.5, 1e9, "--d5", "≥ 2,5 surplus"]],
      }
    case "surplus":
      return {
        ...base,
        title: "Neraca stok (ton)",
        waktu: "bulan",
        val: (k) => surplusTon(k, c.akhir),
        fmt: (v) => (v >= 0 ? "+" : "−") + nf(Math.abs(v), 0) + " ton",
        bins: [[-1e12, -3000, "--d1", "kebutuhan > 3.000"], [-3000, -500, "--d2", "kebutuhan 500–3.000"], [-500, 500, "--d3", "seimbang"], [500, 8000, "--d4", "surplus 500–8.000"], [8000, 1e12, "--d5", "surplus > 8.000"]],
      }
    case "statusHarga":
      return {
        ...base,
        title: `Status harga ${jenis}, +${hari} hari`,
        waktu: "horizon",
        val: (k) => ({ aman: 0, waspada: 1, siaga: 2 })[statusHargaAt(k, c.hor, c.kom)],
        fmt: (v) => (v > 1.5 ? "Siaga" : v > 0.5 ? "Waspada" : "Aman"),
        bins: [[-1, 0.5, "--ok-map", "Aman"], [0.5, 1.5, "--warn", "Waspada"], [1.5, 9, "--crit", "Siaga"]],
      }
    case "hargaPrakiraan":
      return {
        ...base,
        title: `Prakiraan harga ${jenis} (Rp/kg) · +${hari} hari`,
        waktu: "horizon",
        val: (k) => hargaAt(k, c.hor, c.kom),
        fmt: (v) => rp(v) + "/kg",
        bins: [
          [0, het - 700, "--s1", `< ${rp(het - 700)}`],
          [het - 700, het - 400, "--s2", `${rp(het - 700)}–${rp(het - 400)}`],
          [het - 400, het - 200, "--s3", `${rp(het - 400)}–${rp(het - 200)}`],
          [het - 200, het, "--s4", `${rp(het - 200)}–${rp(het)}`],
          [het, 1e9, "--s5", `≥ HET ${rp(het)}`],
        ],
      }
    case "pAtasHet":
      return {
        ...base,
        title: `Peluang harga ${jenis} > HET · +${hari} hari`,
        waktu: "horizon",
        val: (k) => pAtasHet(k, c.hor, c.kom),
        fmt: (v) => nf(v * 100, 0) + "%",
        bins: [[0, 0.1, "--ok-map", "< 10%"], [0.1, 0.3, "--s2", "10–30%"], [0.3, 0.5, "--warn", "30–50%"], [0.5, 1.01, "--crit", "≥ 50%"]],
      }
    case "sphp":
      return {
        ...base,
        title: "Rekomendasi SPHP (ton)",
        waktu: "bulan",
        val: (k) => sphpTon(k, c.mulai, c.akhir),
        fmt: (v) => (v > 0.5 ? "penerima " + ton(v) : v < -0.5 ? "pemasok " + ton(-v) : "tidak ada rute"),
        bins: [[-1e12, -0.5, "--d5", "Pemasok"], [-0.5, 0.5, "--d3", "Tidak ada rute"], [0.5, 1e12, "--d1", "Penerima"]],
      }
  }
}

export function warnaSpec(s: LayerSpec, k: Wilayah) {
  const v = s.val(k)
  const b = s.bins.find((b) => v >= b[0] && v < b[1]) ?? s.bins[s.bins.length - 1]
  return `var(${b[2]})`
}
