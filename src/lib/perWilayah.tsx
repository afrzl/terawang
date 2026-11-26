import type { Wilayah } from "@/lib/data"
import { short } from "@/lib/format"
import { useWilayah } from "@/lib/filter"

/** Batas jumlah wilayah yang ditampilkan satu per satu. Di atas ini garis tidak terbaca, jadi grafik kembali ke gabungan. */
export const MAKS_PISAH = 6

/** Warna per wilayah, urut menurut pilihan. Tidak memakai warna status (merah/hijau) supaya tidak terbaca sebagai status. */
const WARNA = ["var(--r3)", "var(--r5)", "var(--r2)", "var(--r4)", "var(--r6)", "var(--r1)"]

export interface PerWilayah {
  /** true bila 2 sampai MAKS_PISAH wilayah terpilih: grafik dan KPI dipecah per wilayah. */
  pisah: boolean
  /** Wilayah yang lolos filter. */
  wil: Wilayah[]
  warna: (k: Wilayah) => string
}

export function usePerWilayah(): PerWilayah {
  const wil = [...useWilayah()].sort((a, b) => a.n.localeCompare(b.n))
  const pisah = wil.length >= 2 && wil.length <= MAKS_PISAH
  return { pisah, wil, warna: (k) => WARNA[Math.max(0, wil.indexOf(k)) % WARNA.length] }
}

/** Legenda warna wilayah di bawah grafik. */
export function LegendaWilayah({ wil, warna, extra }: { wil: Wilayah[]; warna: (k: Wilayah) => string; extra?: React.ReactNode }) {
  return (
    <div className="legend" style={{ padding: "6px 0 0" }}>
      {wil.map((k) => (
        <span key={k.n}>
          <span className="sw" style={{ background: warna(k) }} />
          {k.n}
        </span>
      ))}
      {extra}
    </div>
  )
}

/** Catatan kecil saat filter memuat terlalu banyak wilayah untuk dipecah. */
export function CatatanGabungan({ n, total }: { n: number; total: number }) {
  if (n <= MAKS_PISAH) return null
  return (
    <p className="catatan-gab">
      {n === total ? "Gabungan seluruh Jawa Timur." : `Gabungan ${n} wilayah terpilih.`} Pilih 2–{MAKS_PISAH} wilayah di filter untuk melihat garis per wilayah.
    </p>
  )
}

/** Baris nilai per wilayah di dalam kotak KPI (gaya sama dengan medium/premium). */
export function KpiPerWilayah({ wil, warna, nilai }: { wil: Wilayah[]; warna: (k: Wilayah) => string; nilai: (k: Wilayah) => React.ReactNode }) {
  return (
    <div className="kv2 kv2-wil">
      {wil.map((k) => (
        <div key={k.n}>
          <span className="kv2-n">
            <i style={{ background: warna(k) }} />
            {short(k.n)}
          </span>
          <b>{nilai(k)}</b>
        </div>
      ))}
    </div>
  )
}
