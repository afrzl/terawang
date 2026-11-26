import { FLOWS, GEO, LAYERS, WILAYAH, binColor, byName, gabungRute, type Flow, type LayerKey, type Wilayah } from "@/lib/data"
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
  /** Rute SPHP yang digambar bila `flows` aktif. Bawaan: seluruh rute K3b. */
  flowList?: Flow[]
  labels?: boolean
  /** Arus beranimasi (mis. arus dagang antarwilayah). */
  arcs?: MapArc[]
  /** Redupkan isian wilayah agar arus lebih menonjol. */
  muted?: boolean
  /** Ganti nilai lapisan (mis. nilai pada pekan tertentu). */
  getValue?: (k: Wilayah) => number
  /** Label nilai di tooltip bila `getValue` dipakai. */
  valueLabel?: string
  /** Jumlah rute SPHP terbesar yang digambar (bawaan 7). */
  maksRute?: number
}

/** Peta choropleth 38 kabupaten/kota Jawa Timur, opsional dengan rute penyaluran SPHP. */
export function PetaJatim({ layer, flows = false, flowList, labels = true, arcs, muted = false, getValue, valueLabel, maksRute = 7 }: PetaJatimProps) {
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
  const semuaRute = flowList ?? FLOWS
  const rute = gabungRute(semuaRute)
  // Kiriman lokal (asal sama dengan tujuan): total ton per kabupaten, digambar sebagai lingkaran di lokasi cabang.
  const lokal = new Map<string, number>()
  for (const f of semuaRute) if (f.from === f.to) lokal.set(f.from.n, (lokal.get(f.from.n) ?? 0) + f.ton)
  const ruteTampil = rute.slice(0, maksRute)
  const tonMaks = Math.max(1, ...ruteTampil.map((f) => f.ton))
  const lokalMaks = Math.max(1, ...lokal.values())

  return (
    <svg viewBox="0 0 1165 490" role="img" aria-label="Peta Jawa Timur">
      <text className="sea" x="380" y="60">L A U T &#160; J A W A</text>
      <text className="sea" x="430" y="470">S A M U D R A &#160; H I N D I A</text>
      <text className="sea" x="1040" y="250">SELAT BALI</text>
      {WILAYAH.filter((k) => GEO[k.n].d).map((k) => (
        <path key={k.n} className="kab" d={GEO[k.n].d} fill={fillOf(k)} opacity={muted || flows ? 0.55 : 1} {...handlers(k.n)} />
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
            <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto">
              <path d="M0,1L10,5L0,9z" fill="var(--accent)" />
            </marker>
          </defs>
          {/* Hanya rute terbesar yang digambar; sisanya ada di teks/tabel. Garis tipis, tebal sesuai volume. */}
          {ruteTampil.map((f, i) => {
            const a = GEO[f.from.n].c
            const b = GEO[f.to.n].c
            const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
            // ujung garis berhenti sedikit sebelum pusat tujuan supaya mata panah tidak menutup titik
            const bx = b[0] - ((b[0] - a[0]) / len) * 9
            const by = b[1] - ((b[1] - a[1]) / len) * 9
            const mx = (a[0] + b[0]) / 2 + ((b[1] - a[1]) / len) * len * 0.18
            const my = (a[1] + b[1]) / 2 - ((b[0] - a[0]) / len) * len * 0.18
            const dd = `M${a[0]},${a[1]}Q${mx},${my} ${bx},${by}`
            const w = 1.4 + 3.4 * Math.sqrt(f.ton / tonMaks)
            return (
              <g key={i} style={{ pointerEvents: "none" }}>
                <path d={dd} fill="none" stroke="var(--panel)" strokeWidth={w + 2.5} strokeLinecap="round" opacity={0.85} />
                <path d={dd} fill="none" stroke="var(--accent)" strokeWidth={w} strokeLinecap="round" markerEnd="url(#ah)" />
              </g>
            )
          })}
          {[...lokal].map(([n, ton]) => {
            const c = GEO[n].c
            return (
              <circle key={`l${n}`} cx={c[0]} cy={c[1]} r={4 + 14 * Math.sqrt(ton / lokalMaks)} fill="var(--accent)" fillOpacity={0.22} stroke="var(--accent)" strokeWidth={1.4} style={{ pointerEvents: "none" }} />
            )
          })}
          {[...new Set(ruteTampil.map((f) => f.from.n))].map((n) => {
            const c = GEO[n].c
            return <circle key={`s${n}`} cx={c[0]} cy={c[1]} r={4.5} fill="var(--accent)" stroke="var(--panel)" strokeWidth={1.8} style={{ pointerEvents: "none" }} />
          })}
          {(() => {
            // Label hanya untuk wilayah tujuan rute yang digambar; yang berdekatan digeser agar tidak bertumpuk.
            const FS = 17
            const items = [...new Set(ruteTampil.map((f) => f.to.n))]
              .map((n) => ({ n, x: GEO[n].c[0], y: GEO[n].c[1] - 12 }))
              .sort((p, q) => p.y - q.y)
            for (let i = 0; i < items.length; i++)
              for (let j = 0; j < i; j++) if (Math.abs(items[i].x - items[j].x) < 120 && Math.abs(items[i].y - items[j].y) < FS + 2) items[i].y = items[j].y + FS + 2
            return items.map((it) => (
              <text
                key={`t${it.n}`}
                x={it.x}
                y={it.y}
                textAnchor="middle"
                style={{ fontSize: FS, fontWeight: 650, fill: "var(--ink)", stroke: "var(--panel)", strokeWidth: 4.5, paintOrder: "stroke", pointerEvents: "none" }}
              >
                {short(it.n)}
              </text>
            ))
          })()}
          {rute.length > 0 && (
            <text x={18} y={26} style={{ fontSize: 14, fill: "var(--ink-2)", pointerEvents: "none" }}>
              {ruteTampil.length < rute.length ? `${ruteTampil.length} rute terbesar dari ${rute.length}` : `${rute.length} rute`}
              {lokal.size > 0 ? " · lingkaran = disalurkan di wilayah cabang sendiri" : ""}
            </text>
          )}
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
                <ArrowHead x={b[0]} y={b[1]} fromX={mx} fromY={my} size={11 + w * 2} color={f.color} />
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

/** Kepala panah di ujung tujuan, searah garis. */
function ArrowHead({ x, y, fromX, fromY, size, color }: { x: number; y: number; fromX: number; fromY: number; size: number; color: string }) {
  const sd = (Math.atan2(y - fromY, x - fromX) * 180) / Math.PI
  return (
    <path d={`M0,0 L${-size},${-size * 0.62} L${-size * 0.7},0 L${-size},${size * 0.62}Z`} transform={`translate(${x},${y}) rotate(${sd})`} fill={color} stroke="var(--panel)" strokeWidth={1} />
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
