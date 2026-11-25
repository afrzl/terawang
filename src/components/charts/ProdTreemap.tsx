import { REGIONS } from "@/lib/arus"
import { WILAYAH, byName, type Wilayah } from "@/lib/data"
import { useFilter } from "@/lib/filter"
import { produksiRentang, yoyRentang } from "@/lib/petaLayers"
import { nf, short, sum } from "@/lib/format"
import { useSelection } from "@/lib/selection"
import { useTooltip } from "@/lib/tooltip"
import { squarify } from "@/lib/treemap"

const W = 720
const H = 460
const HEAD = 18

/** Treemap produksi per periode terpilih per kabupaten/kota, dikelompokkan per kawasan. */
export function ProdTreemap() {
  const { sel, select } = useSelection()
  const { show, hide } = useTooltip()
  const { lolos, mulai, akhir } = useFilter()
  const est = (k: Wilayah) => produksiRentang(k, mulai, akhir) / 1000 // ribu ton beras
  const total = sum(WILAYAH.filter(lolos), (k) => est(k))
  const groups = REGIONS.map((r) => ({ r, v: sum(r.members.filter((m) => lolos(byName[m])), (m) => est(byName[m])) })).filter((g) => g.v > 0)
  const outer = squarify(groups, (g) => g.v, { x: 0, y: 0, w: W, h: H })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Treemap proyeksi panen per kabupaten/kota" className="tmap">
      {outer.map((o) => {
        const g = o.item
        const mem = g.r.members.filter((m) => lolos(byName[m]))
        const inner = squarify(mem, (m) => est(byName[m]), { x: o.x + 1.5, y: o.y + HEAD, w: o.w - 3, h: o.h - HEAD - 1.5 })
        const mx = Math.max(...mem.map((m) => est(byName[m])))
        return (
          <g key={g.r.key}>
            <rect x={o.x} y={o.y} width={o.w} height={o.h} fill={g.r.color} opacity={0.16} />
            <text x={o.x + 6} y={o.y + 13} className="tm-head">
              {g.r.short} · {nf((g.v / total) * 100, 0)}%
            </text>
            {inner.map((t) => {
              const k = byName[t.item]
              const nm = short(k.n)
              const showN = t.h > 20 && t.w > nm.length * 6.7 + 10
              const showV = showN && t.h > 34 && t.w > 96
              const isSel = k.n === sel
              return (
                <g
                  key={k.n}
                  style={{ cursor: "pointer" }}
                  onMouseMove={(e) =>
                    show(
                      <>
                        <b>{k.n}</b> · {g.r.short}
                        <br />
                        Produksi <span className="m">{nf(est(k), 1)} rb ton beras</span>
                        <br />
                        Porsi <span className="m">{nf((est(k) / total) * 100, 1)}%</span>
                        <br />
                        YoY <span className="m">{nf(yoyRentang(k, mulai, akhir) * 100, 1)}%</span>
                      </>,
                      e,
                    )
                  }
                  onMouseLeave={hide}
                  onClick={() => select(k.n)}
                >
                  <rect
                    x={t.x + 0.75}
                    y={t.y + 0.75}
                    width={Math.max(0, t.w - 1.5)}
                    height={Math.max(0, t.h - 1.5)}
                    rx={2}
                    fill={g.r.color}
                    opacity={0.5 + 0.5 * (est(k) / mx)}
                    className={isSel ? "tm-sel" : undefined}
                  />
                  {showN && (
                    <text x={t.x + 6} y={t.y + 15} className="tm-n">
                      {nm}
                    </text>
                  )}
                  {showV && (
                    <text x={t.x + 6} y={t.y + 28} className="tm-v">
                      {nf(est(k), 0)} rb t · {nf(yoyRentang(k, mulai, akhir) * 100, 0)}%
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        )
      })}
    </svg>
  )
}
