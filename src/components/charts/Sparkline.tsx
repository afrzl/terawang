import { scale } from "@/lib/format"

/** Grafik garis mini: riwayat (garis penuh) dan prakiraan (garis putus). */
export function Sparkline({ vals, color, fc }: { vals: number[]; color: string; fc?: number[] }) {
  const all = vals.concat(fc ?? [])
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  const W = 118
  const H = 36
  const n = all.length
  const x = scale(0, n - 1, 2, W - 4)
  const y = scale(lo, hi, H - 4, 4)
  const p = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("")
  const q = fc
    ? [vals[vals.length - 1]]
        .concat(fc)
        .map((v, i) => `${i ? "L" : "M"}${x(vals.length - 1 + i).toFixed(1)},${y(v).toFixed(1)}`)
        .join("")
    : null
  return (
    <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <path d={`${p}L${x(vals.length - 1)},${H}L${x(0)},${H}Z`} fill={color} opacity={0.12} />
      <path d={p} fill="none" stroke={color} strokeWidth={1.6} />
      {q && <path d={q} fill="none" stroke={color} strokeWidth={1.6} strokeDasharray="3 2" />}
      <circle cx={x(n - 1)} cy={y(all[n - 1])} r={2.6} fill={color} />
    </svg>
  )
}
