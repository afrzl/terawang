import { FLOWS, GEO, LAYERS, WILAYAH, binColor, byName, type LayerKey, type Wilayah } from "@/lib/data"
import { clamp, nf, rp, short } from "@/lib/format"
import { useFilter } from "@/lib/filter"
import { useSelection } from "@/lib/selection"
import { useTooltip } from "@/lib/tooltip"

const LABELS = ["Kota Surabaya", "Lamongan", "Ngawi", "Jember", "Banyuwangi", "Sumenep", "Malang", "Bojonegoro", "Pacitan", "Sampang"]

export interface MapArc {
  from: string
  to: string
  ton: number
  color: string
}

interface PetaJatimProps {
  layer: LayerKey
  flows?: boolean
  labels?: boolean
  /** Arus beranimasi (mis. arus dagang antarwilayah). */
  arcs?: MapArc[]
  /** Redupkan isian wilayah agar arus lebih menonjol. */
  muted?: boolean
  /** Ganti nilai lapisan (mis. nilai pada pekan tertentu). */
  getValue?: (k: Wilayah) => number
  /** Label nilai di tooltip bila `getValue` dipakai. */
  valueLabel?: string
}

/** Peta choropleth 38 kabupaten/kota Jawa Timur, opsional dengan rute penyaluran SPHP. */
export function PetaJatim({ layer, flows = false, labels = true, arcs, muted = false, getValue, valueLabel }: PetaJatimProps) {
  const { sel, select } = useSelection()
  const { lolos } = useFilter()
  const { show, hide } = useTooltip()
  const d = LAYERS[layer]
  const val = getValue ?? d.val
  const fillOf = (k: Wilayah) => (!lolos(k) ? "var(--rule)" : d.na?.(k) ? "var(--s0)" : binColor(layer, val(k)))

  const tipFor = (n: string) => {
    const k = byName[n]
    return (
      <>
        <b>{n}</b>
        <br />
        {valueLabel ?? d.title.split(",")[0]}: <span className="m">{d.na?.(k) ? "sawah < 1.500 ha" : d.fmt(val(k))}</span>
        <br />
        Harga kini <span className="m">{rp(k.pNow)}</span> · stok <span className="m">{nf(k.cov, 2)}</span> bln
      </>
    )
  }
  const handlers = (n: string) => ({
    onMouseMove: (e: React.MouseEvent) => show(tipFor(n), e),
    onMouseLeave: hide,
    onClick: () => {
      hide()
      select(n)
    },
  })

  const sg = GEO[sel]
  const bl = GEO["Kota Blitar"].c
  const shownLabels = new Set([...LABELS, sel])
  const sourceNames = [...new Set(FLOWS.map((f) => f.from.n))]

  return (
    <svg viewBox="0 0 1165 490" role="img" aria-label="Peta Jawa Timur">
      <text className="sea" x="380" y="60">L A U T &#160; J A W A</text>
      <text className="sea" x="430" y="470">S A M U D R A &#160; H I N D I A</text>
      <text className="sea" x="1040" y="250">SELAT BALI</text>
      {WILAYAH.filter((k) => GEO[k.n].d).map((k) => (
        <path key={k.n} className="kab" d={GEO[k.n].d} fill={fillOf(k)} opacity={muted ? 0.55 : 1} {...handlers(k.n)} />
      ))}
      <circle
        className="kab"
        cx={bl[0]}
        cy={bl[1]}
        r={6}
        fill={fillOf(byName["Kota Blitar"])}
        stroke="var(--panel)"
        strokeWidth={1.5}
        style={{ cursor: "pointer" }}
        {...handlers("Kota Blitar")}
      />
      {flows && (
        <>
          <defs>
            <marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0L10,5L0,10z" fill="var(--accent)" />
            </marker>
          </defs>
          {FLOWS.map((f, i) => {
            const a = GEO[f.from.n].c
            const b = GEO[f.to.n].c
            const mx = (a[0] + b[0]) / 2
            const my = (a[1] + b[1]) / 2 - Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.22
            return (
              <path
                key={i}
                d={`M${a[0]},${a[1]}Q${mx},${my} ${b[0]},${b[1]}`}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={clamp(f.ton / 220, 1.2, 5)}
                strokeLinecap="round"
                markerEnd="url(#ah)"
                opacity={0.85}
                style={{ pointerEvents: "none" }}
              />
            )
          })}
          {sourceNames.map((n) => {
            const c = GEO[n].c
            return (
              <rect key={n} x={c[0] - 5} y={c[1] - 5} width={10} height={10} fill="var(--panel)" stroke="var(--accent)" strokeWidth={2} style={{ pointerEvents: "none" }} />
            )
          })}
        </>
      )}
      {arcs && (
        <g style={{ pointerEvents: "none" }}>
          {arcs.map((f, i) => {
            const a = GEO[f.from].c
            const b = GEO[f.to].c
            const mx = (a[0] + b[0]) / 2
            const my = (a[1] + b[1]) / 2 - Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.25
            const d = `M${a[0]},${a[1]}Q${mx},${my} ${b[0]},${b[1]}`
            const w = clamp(Math.sqrt(f.ton) / 9, 1, 6)
            return (
              <g key={i}>
                <path d={d} fill="none" stroke={f.color} strokeWidth={w + 2.5} strokeLinecap="round" opacity={0.18} />
                <path d={d} fill="none" stroke={f.color} strokeWidth={w} strokeLinecap="round" className="flow-anim" style={{ animationDuration: `${1.6 - Math.min(f.ton, 4000) / 5000}s` }} />
              </g>
            )
          })}
          {[...new Set(arcs.map((f) => f.from))].map((n) => {
            const c = GEO[n].c
            return <circle key={n} cx={c[0]} cy={c[1]} r={4.5} fill="var(--panel)" stroke="var(--ink)" strokeWidth={1.6} />
          })}
        </g>
      )}
      {sg.d ? <path className="sel-ring" d={sg.d} /> : <circle className="sel-ring" cx={sg.c[0]} cy={sg.c[1]} r={9} />}
      {labels &&
        [...shownLabels].map((n) => {
          const c = GEO[n].c
          return (
            <text key={n} className="lbl" x={c[0]} y={c[1] + 4} textAnchor="middle">
              {short(n)}
            </text>
          )
        })}
    </svg>
  )
}

export function MapLegend({ layer, extra, title }: { layer: LayerKey; extra?: React.ReactNode; title?: string }) {
  const d = LAYERS[layer]
  return (
    <div className="legend">
      <span className="ttl">{title ?? d.title}</span>
      {d.bins.map((b) => (
        <span key={b[3]}>
          <span className="sw" style={{ background: `var(${b[2]})` }} />
          {b[3]}
        </span>
      ))}
      {d.na && (
        <span>
          <span className="sw" style={{ background: "var(--s0)" }} />
          sawah &lt; 1.500 ha
        </span>
      )}
      {extra}
    </div>
  )
}
