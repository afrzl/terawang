import { REGIONS } from "@/lib/arus"
import { WILAYAH, byName } from "@/lib/data"
import { nf, short, sum } from "@/lib/format"
import { useSelection } from "@/lib/selection"
import { useTooltip } from "@/lib/tooltip"
import { squarify } from "@/lib/treemap"

const W = 720
const H = 460
const HEAD = 18

/** Treemap proyeksi panen Nov–Jan per kabupaten/kota, dikelompokkan per kawasan. */
export function ProdTreemap() {
  const { sel, select } = useSelection()
  const { show, hide } = useTooltip()
  const total = sum(WILAYAH, (k) => k.est)
  const groups = REGIONS.map((r) => ({ r, v: sum(r.members, (m) => byName[m].est) }))
  const outer = squarify(groups, (g) => g.v, { x: 0, y: 0, w: W, h: H })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Treemap proyeksi panen per kabupaten/kota" className="tmap">
      {outer.map((o) => {
        const g = o.item
        const inner = squarify(g.r.members, (m) => byName[m].est, { x: o.x + 1.5, y: o.y + HEAD, w: o.w - 3, h: o.h - HEAD - 1.5 })
        const mx = Math.max(...g.r.members.map((m) => byName[m].est))
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
                        Proyeksi panen <span className="m">{nf(k.est, 1)} rb ton GKG</span>
                        <br />
                        Porsi Jatim <span className="m">{nf((k.est / total) * 100, 1)}%</span>
                        <br />
                        vs 2025 <span className="m">{nf(k.yoy * 100, 1)}%</span>
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
                    opacity={0.5 + 0.5 * (k.est / mx)}
                    className={isSel ? "tm-sel" : undefined}
                  />
                  {showN && (
                    <text x={t.x + 6} y={t.y + 15} className="tm-n">
                      {nm}
                    </text>
                  )}
                  {showV && (
                    <text x={t.x + 6} y={t.y + 28} className="tm-v">
                      {nf(k.est, 0)} rb t · {nf(k.yoy * 100, 0)}%
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
