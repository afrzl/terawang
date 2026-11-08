import { useMemo, useState } from "react"
import { sankey, sankeyLinkHorizontal, type SankeyLink, type SankeyNode } from "d3-sankey"
import { REGIONS, TRADE, regionOf } from "@/lib/arus"
import { nf, short } from "@/lib/format"
import { useSelection } from "@/lib/selection"
import { useTooltip } from "@/lib/tooltip"

interface NodeDatum {
  id: string
  label: string
  color: string
  col: 0 | 1 | 2
  /** Nama wilayah yang dipilih saat node diklik (bukan untuk kawasan/lainnya). */
  wilayah?: string
}
interface LinkDatum {
  source: string
  target: string
  value: number
}
type N = SankeyNode<NodeDatum, LinkDatum>
type L = SankeyLink<NodeDatum, LinkDatum>

const W = 940
const H = 520
const TOP_SRC = 9
const TOP_DST = 11

/** Tiga kolom: kabupaten asal → kawasan tujuan → kabupaten/kota tujuan. */
function buildGraph() {
  const outBy = new Map<string, number>()
  const inBy = new Map<string, number>()
  for (const t of TRADE) {
    outBy.set(t.from.n, (outBy.get(t.from.n) ?? 0) + t.ton)
    inBy.set(t.to.n, (inBy.get(t.to.n) ?? 0) + t.ton)
  }
  const topSrc = new Set([...outBy].sort((a, b) => b[1] - a[1]).slice(0, TOP_SRC).map((d) => d[0]))
  const topDst = new Set([...inBy].sort((a, b) => b[1] - a[1]).slice(0, TOP_DST).map((d) => d[0]))
  const srcId = (n: string) => (topSrc.has(n) ? "s:" + n : "s:lain")
  const dstId = (n: string) => (topDst.has(n) ? "d:" + n : "d:lain")

  const nodes = new Map<string, NodeDatum>()
  const add = (d: NodeDatum) => nodes.has(d.id) || nodes.set(d.id, d)
  const agg = new Map<string, number>()
  const bump = (k: string, v: number) => agg.set(k, (agg.get(k) ?? 0) + v)

  for (const t of TRADE) {
    const s = srcId(t.from.n)
    const r = "r:" + regionOf[t.to.n].key
    const d = dstId(t.to.n)
    add(s === "s:lain" ? { id: s, label: "Lainnya (surplus)", color: "var(--ink-3)", col: 0 } : { id: s, label: t.from.n, color: regionOf[t.from.n].color, col: 0, wilayah: t.from.n })
    add({ id: r, label: regionOf[t.to.n].short, color: regionOf[t.to.n].color, col: 1 })
    add(d === "d:lain" ? { id: d, label: "Lainnya", color: "var(--ink-3)", col: 2 } : { id: d, label: t.to.n, color: regionOf[t.to.n].color, col: 2, wilayah: t.to.n })
    bump(s + "|" + r, t.ton)
    bump(r + "|" + d, t.ton)
  }
  const links: LinkDatum[] = [...agg].map(([k, value]) => {
    const [source, target] = k.split("|")
    return { source, target, value }
  })
  // Urutkan node kawasan sesuai urutan REGIONS agar konsisten dengan diagram chord.
  const order = (id: string) => (id.startsWith("r:") ? REGIONS.findIndex((r) => "r:" + r.key === id) : 0)
  return { nodes: [...nodes.values()], links, order }
}

export function SankeyArus() {
  const { sel, select } = useSelection()
  const { show, hide } = useTooltip()
  const [hover, setHover] = useState<string | null>(null)

  const graph = useMemo(() => {
    const { nodes, links, order } = buildGraph()
    const layout = sankey<NodeDatum, LinkDatum>()
      .nodeId((d) => d.id)
      .nodeWidth(12)
      .nodePadding(9)
      .nodeSort((a, b) => {
        if (a.col === 1 && b.col === 1) return order(a.id) - order(b.id)
        if (a.id.endsWith(":lain")) return 1
        if (b.id.endsWith(":lain")) return -1
        return (b.value ?? 0) - (a.value ?? 0)
      })
      .extent([
        [150, 10],
        [W - 160, H - 10],
      ])
    return layout({ nodes: nodes.map((d) => ({ ...d })), links: links.map((d) => ({ ...d })) })
  }, [])

  const linkPath = sankeyLinkHorizontal<NodeDatum, LinkDatum>()
  const isLit = (l: L) => {
    if (!hover) return true
    const s = l.source as N
    const t = l.target as N
    return s.id === hover || t.id === hover
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Diagram Sankey arus beras antarwilayah" className="sankey">
      <g fill="none">
        {graph.links.map((l, i) => {
          const s = l.source as N
          const t = l.target as N
          return (
            <path
              key={i}
              className="lnk"
              d={linkPath(l) ?? ""}
              stroke={s.col === 0 ? s.color : t.color}
              strokeWidth={Math.max(1, l.width ?? 1)}
              opacity={isLit(l) ? 0.42 : 0.06}
              onMouseMove={(e) =>
                show(
                  <>
                    <b>
                      {s.label} → {t.label}
                    </b>
                    <br />
                    <span className="m">{nf(l.value)} ton/bln</span>
                  </>,
                  e,
                )
              }
              onMouseLeave={hide}
            />
          )
        })}
      </g>
      {graph.nodes.map((n) => {
        const x0 = n.x0 ?? 0
        const x1 = n.x1 ?? 0
        const y0 = n.y0 ?? 0
        const y1 = n.y1 ?? 0
        const left = n.col === 0
        const mid = n.col === 1
        const tx = left ? x0 - 8 : mid ? x1 + 8 : x1 + 8
        const anchor = left ? "end" : "start"
        const isSel = n.wilayah === sel
        return (
          <g
            key={n.id}
            className="nd"
            onMouseEnter={() => setHover(n.id)}
            onMouseLeave={() => {
              setHover(null)
              hide()
            }}
            onMouseMove={(e) =>
              show(
                <>
                  <b>{n.label}</b>
                  <br />
                  {left ? "Mengirim" : n.col === 2 ? "Menerima" : "Masuk ke kawasan"} <span className="m">{nf(n.value ?? 0)} ton/bln</span>
                </>,
                e,
              )
            }
            onClick={() => n.wilayah && select(n.wilayah)}
          >
            <rect x={x0} y={y0} width={x1 - x0} height={Math.max(1, y1 - y0)} fill={n.color} rx={2} stroke={isSel ? "var(--ink)" : "none"} strokeWidth={2} />
            <text x={tx} y={(y0 + y1) / 2} dy="0.35em" textAnchor={anchor} className={mid ? "mid" : undefined} style={{ fontWeight: isSel || mid ? 650 : 400 }}>
              {mid ? n.label : short(n.label)}
              <tspan className="v" dx={6}>
                {nf((n.value ?? 0) / 1000, 1)} rb t
              </tspan>
            </text>
          </g>
        )
      })}
    </svg>
  )
}
