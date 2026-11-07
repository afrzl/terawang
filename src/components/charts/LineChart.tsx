import { useRef, useState } from "react"
import { clamp, dfmt, scale, ticks } from "@/lib/format"
import { useTooltip } from "@/lib/tooltip"

type Val = number | null

export interface Series {
  vals: Val[]
  color: string
  off?: number
  w?: number
  dash?: string
  label?: string
  /** Geser vertikal label ujung garis. */
  ly?: number
}

export interface Band {
  lo: Val[]
  hi: Val[]
  off: number
  color: string
  op?: number
}

export interface RefLine {
  v: number
  label: string
  color: string
  dy?: number
}

interface LineChartProps {
  xDates: Date[]
  yDom: [number, number]
  yFmt: (v: number) => string
  series: Series[]
  bands?: Band[]
  refs?: RefLine[]
  points?: { vals: Val[]; color: string }[]
  /** Indeks awal area prakiraan (diberi latar). */
  splitAt?: number
  W?: number
  H?: number
  tip?: (i: number) => React.ReactNode
}

const M = { l: 58, r: 96, t: 14, b: 28 }

export function LineChart({ xDates, yDom, yFmt, series, bands = [], refs = [], points = [], splitAt, W = 720, H = 280, tip }: LineChartProps) {
  const { show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const n = xDates.length
  const x = scale(0, n - 1, M.l, W - M.r)
  const y = scale(yDom[0], yDom[1], H - M.b, M.t)
  const step = Math.ceil(n / 7)

  const onMove = (e: React.MouseEvent) => {
    const svg = svgRef.current
    if (!svg || !tip) return
    const r = svg.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    const i = clamp(Math.round(x.inv(px)), 0, n - 1)
    setHover(i)
    show(tip(i), e)
  }
  const onLeave = () => {
    setHover(null)
    hide()
  }

  const toPts = (vals: Val[], off: number) => vals.map((v, i) => (v == null ? null : ([x(i + off), y(v)] as const))).filter((p) => p !== null)

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img">
      <g className="grid">
        {ticks(yDom[0], yDom[1], 5).map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} />
            <text x={M.l - 8} y={y(t) + 3.5} textAnchor="end">
              {yFmt(t)}
            </text>
          </g>
        ))}
      </g>
      {splitAt != null && (
        <>
          <rect x={x(splitAt)} y={M.t} width={x(n - 1) - x(splitAt)} height={H - M.b - M.t} fill="var(--panel-2)" />
          <text x={x(splitAt) + 6} y={M.t + 12} className="lab">
            prakiraan
          </text>
        </>
      )}
      {xDates.map((d, i) =>
        i % step === 0 || i === n - 1 ? (
          <text key={i} x={x(i)} y={H - M.b + 16} textAnchor="middle">
            {dfmt(d)}
          </text>
        ) : null,
      )}
      <line className="axis" x1={M.l} x2={W - M.r} y1={H - M.b} y2={H - M.b} stroke="var(--rule)" />
      {bands.map((b, bi) => {
        const lo = toPts(b.lo, b.off)
        const hi = toPts(b.hi, b.off).reverse()
        const d = `M${lo.map((p) => p.join(",")).join("L")}L${hi.map((p) => p.join(",")).join("L")}Z`
        return <path key={bi} d={d} fill={b.color} opacity={b.op ?? 0.16} />
      })}
      {refs.map((r) => (
        <g key={r.label}>
          <line x1={M.l} x2={W - M.r} y1={y(r.v)} y2={y(r.v)} stroke={r.color} strokeWidth={1.3} strokeDasharray="5 4" />
          <text x={W - M.r + 6} y={y(r.v) + (r.dy ?? 4)} className="lab" style={{ fill: r.color }}>
            {r.label}
          </text>
        </g>
      ))}
      {series.map((se, si) => {
        const off = se.off ?? 0
        let d = ""
        let pen = false
        se.vals.forEach((v, i) => {
          if (v == null) {
            pen = false
            return
          }
          d += (pen ? "L" : "M") + `${x(i + off).toFixed(1)},${y(v).toFixed(1)}`
          pen = true
        })
        const li = se.vals.length - 1
        const last = se.vals[li]
        return (
          <g key={si}>
            <path d={d} fill="none" stroke={se.color} strokeWidth={se.w ?? 2} strokeDasharray={se.dash} strokeLinejoin="round" />
            {se.label && last != null && (
              <>
                <circle cx={x(li + off)} cy={y(last)} r={3.5} fill={se.color} stroke="var(--panel)" strokeWidth={2} />
                <text x={x(li + off) + 8} y={y(last) + (se.ly ?? 4)} className="lab-b">
                  {se.label}
                </text>
              </>
            )}
          </g>
        )
      })}
      {points.map((p, pi) =>
        p.vals.map((v, i) => (v == null ? null : <circle key={`${pi}-${i}`} cx={x(i)} cy={y(v)} r={4.5} fill="var(--panel)" stroke={p.color} strokeWidth={2} />)),
      )}
      <line x1={hover == null ? 0 : x(hover)} x2={hover == null ? 0 : x(hover)} y1={M.t} y2={H - M.b} stroke="var(--ink-3)" strokeWidth={1} opacity={hover == null ? 0 : 0.6} />
      <rect x={M.l} y={M.t} width={W - M.l - M.r} height={H - M.t - M.b} fill="transparent" onMouseMove={onMove} onMouseLeave={onLeave} />
    </svg>
  )
}
