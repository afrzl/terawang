export const DAY = 864e5
/** Tanggal acuan laporan: Minggu, 1 November 2026 (pekan 44). */
import { K3A } from "./api"

/** Tanggal acuan data: tanggal harga terakhir pada hasil K3a bila API tersambung; selain itu 1 Nov 2026 (simulasi). */
export const NOW = (() => {
  const m = K3A?.meta.tanggal_acuan.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(2026, 10, 1)
})()

const BLN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

export const nf = (v: number, d = 0) =>
  v.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d })

export const rp = (v: number) => "Rp" + nf(Math.round(v / 10) * 10)

export const dfmt = (d: Date) => d.getDate() + " " + BLN[d.getMonth()]

export const short = (n: string) => n.replace("Kota ", "Kt. ")

export const sum = <T,>(a: T[], f: (x: T) => number) => a.reduce((s, x) => s + f(x), 0)

/** Pembangkit bilangan acak deterministik (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Hash FNV-1a untuk benih acak per wilayah. */
export function hash(s: string) {
  let h = 2166136261
  for (const c of s) {
    h ^= c.charCodeAt(0)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export type Scale = ((v: number) => number) & { inv: (p: number) => number }

export function scale(d0: number, d1: number, r0: number, r1: number): Scale {
  const f = ((v: number) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0)) as Scale
  f.inv = (p: number) => d0 + ((p - r0) / (r1 - r0)) * (d1 - d0)
  return f
}

export function ticks(lo: number, hi: number, n = 5) {
  const span = hi - lo
  const step0 = span / n
  const mag = Math.pow(10, Math.floor(Math.log10(step0)))
  const err = step0 / mag
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag
  const t: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) t.push(+v.toFixed(6))
  return t
}
