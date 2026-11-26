import { useRef, useState } from "react"
import { clamp, dfmt, scale, ticks } from "@/lib/format"
import { useTooltip } from "@/lib/tooltip"
import { bul, useDataTafsir } from "@/lib/tafsir"

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
  /** Nama garis untuk data interpretasi (bawaan: label). Garis bernama sama digabung (mis. riwayat + prakiraan). */
  nama?: string
}

export interface Band {
  lo: Val[]
  hi: Val[]
  off: number
  color: string
  op?: number
  /** Nama pita untuk data interpretasi, mis. "Blitar selang 80%". */
  nama?: string
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
  /** Teks pada area setelah splitAt. */
  splitLabel?: string
  W?: number
  H?: number
  tip?: (i: number) => React.ReactNode
  /** Format label sumbu x (bawaan: tanggal + bulan). */
  xFmt?: (d: Date) => string
  /** Jauhkan label ujung garis yang bertumpuk (untuk grafik banyak garis). */
  sebarLabel?: boolean
}

const M = { l: 58, r: 96, t: 14, b: 28 }

export function LineChart({ xDates, yDom, yFmt, series, bands = [], refs = [], points = [], splitAt, splitLabel = "prakiraan", W = 720, H = 280, tip, xFmt = dfmt, sebarLabel = false }: LineChartProps) {
  const { show, hide } = useTooltip()
  useDataTafsir("garis", dataGaris(xDates, series, bands, refs, splitAt, splitLabel, xFmt))
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

  // Posisi label ujung: bila sebarLabel, label diurutkan menurut tinggi lalu didorong supaya berjarak paling sedikit 13 px.
  const lyAuto = new Map<number, number>()
  const dyRef = new Map<number, number>()
  if (sebarLabel) {
    // Label garis (kunci si >= 0) dan label garis acuan (kunci -1 - ri) disebar bersama karena berada di kolom yang sama.
    const lab = [
      ...series
        .map((se, si) => ({ key: si, v: se.vals[se.vals.length - 1] }))
        .filter((l) => series[l.key].label && l.v != null)
        .map((l) => ({ key: l.key, base: y(l.v as number) + 4 })),
      ...refs.map((r, ri) => ({ key: -1 - ri, base: y(r.v) + (r.dy ?? 4) })),
    ].sort((a, b) => a.base - b.base)
    const pos = lab.map((l) => l.base)
    for (let i = 1; i < pos.length; i++) pos[i] = Math.max(pos[i], pos[i - 1] + 13)
    // Geser balik ke atas bila melewati batas bawah.
    const geser = Math.max(0, (pos[pos.length - 1] ?? 0) - (H - M.b + 10))
    lab.forEach((l, i) => {
      const d = pos[i] - geser - l.base
      if (l.key >= 0) lyAuto.set(l.key, d + 4)
      else dyRef.set(-1 - l.key, d + (refs[-1 - l.key].dy ?? 4))
    })
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
            {splitLabel}
          </text>
        </>
      )}
      {xDates.map((d, i) =>
        i % step === 0 || i === n - 1 ? (
          <text key={i} x={x(i)} y={H - M.b + 16} textAnchor="middle">
            {xFmt(d)}
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
      {refs.map((r, ri) => (
        <g key={r.label}>
          <line x1={M.l} x2={W - M.r} y1={y(r.v)} y2={y(r.v)} stroke={r.color} strokeWidth={1.3} strokeDasharray="5 4" />
          <text x={W - M.r + 6} y={y(r.v) + (dyRef.get(ri) ?? r.dy ?? 4)} className="lab" style={{ fill: r.color }}>
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
                <text x={x(li + off) + 8} y={y(last) + (lyAuto.get(si) ?? se.ly ?? 4)} className="lab-b">
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

/** Pembulatan menurut besaran: harga ribuan rupiah tanpa desimal, indeks kecil 2 desimal. */
const bulPas = (v: number) => bul(v, Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 100 ? 1 : 2)

/** Data yang digambar, satu baris per titik sumbu x: nilai tiap garis (nama = label garis), batas pita, dan penanda prakiraan. */
function dataGaris(xDates: Date[], series: Series[], bands: Band[], refs: RefLine[], splitAt: number | undefined, splitLabel: string, xFmt: (d: Date) => string) {
  const nama = series.map((s, i) => s.nama || s.label || `garis ${i + 1}`)
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  const titik = xDates.map((d, i) => {
    const r: Record<string, string | number | null> = { tanggal: ymd(d) }
    const lab = xFmt(d)
    if (lab && !lab.includes(String(d.getDate()))) r.label = lab
    series.forEach((s, si) => {
      const v = s.vals[i - (s.off ?? 0)]
      if (v != null) r[nama[si]] = bulPas(v)
    })
    bands.forEach((b, bi) => {
      const lo = b.lo[i - b.off]
      const hi = b.hi[i - b.off]
      if (lo != null && hi != null) {
        const p = b.nama ?? `pita${bands.length > 1 ? ` ${bi + 1}` : ""}`
        r[`${p} bawah`] = bulPas(lo)
        r[`${p} atas`] = bulPas(hi)
      }
    })
    if (splitAt != null && i >= splitAt) r[splitLabel] = "ya"
    return r
  }).filter((r) => Object.keys(r).length > 1)
  return { garis: [...new Set(nama)], titik, garis_acuan: refs.length ? refs.map((r) => ({ nama: r.label, nilai: bul(r.v) })) : undefined }
}
