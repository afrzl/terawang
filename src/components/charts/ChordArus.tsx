import { useMemo, useState } from "react"
import { chord, ribbon, type Chord } from "d3-chord"
import { arc } from "d3-shape"
import { REGIONS, REGION_MATRIX } from "@/lib/arus"
import { nf } from "@/lib/format"
import { useTooltip } from "@/lib/tooltip"

const S = 520
const R_OUT = 200
const R_IN = 186

/** Diagram chord arus beras antarkawasan; pita melengkung balik = arus di dalam kawasan sendiri. */
export function ChordArus() {
  const { show, hide } = useTooltip()
  const [hover, setHover] = useState<number | null>(null)

  const chords = useMemo(() => chord().padAngle(0.045).sortSubgroups((a, b) => b - a)(REGION_MATRIX), [])
  const groupArc = arc<{ startAngle: number; endAngle: number }>().innerRadius(R_IN).outerRadius(R_OUT).cornerRadius(2)
  const rib = ribbon<Chord, Chord["source"]>().radius(R_IN - 2)
  const lit = (c: Chord) => hover == null || c.source.index === hover || c.target.index === hover

  return (
    <svg viewBox={`${-S / 2} ${-S / 2} ${S} ${S}`} role="img" aria-label="Diagram chord arus beras antarkawasan" className="chord">
      <g>
        {chords.map((c, i) => {
          const a = REGIONS[c.source.index]
          const b = REGIONS[c.target.index]
          const ab = REGION_MATRIX[c.source.index][c.target.index]
          const ba = REGION_MATRIX[c.target.index][c.source.index]
          const self = c.source.index === c.target.index
          return (
            <path
              key={i}
              className="rb"
              d={(rib(c) as unknown as string) ?? ""}
              fill={a.color}
              stroke="var(--panel)"
              strokeWidth={0.6}
              opacity={lit(c) ? 0.72 : 0.08}
              onMouseMove={(e) =>
                show(
                  self ? (
                    <>
                      <b>Di dalam {a.short}</b>
                      <br />
                      <span className="m">{nf(ab)} ton/bln</span>
                    </>
                  ) : (
                    <>
                      <b>
                        {a.short} → {b.short}
                      </b>{" "}
                      <span className="m">{nf(ab)} t</span>
                      <br />
                      <b>
                        {b.short} → {a.short}
                      </b>{" "}
                      <span className="m">{nf(ba)} t</span>
                    </>
                  ),
                  e,
                )
              }
              onMouseLeave={hide}
            />
          )
        })}
      </g>
      {chords.groups.map((g) => {
        const r = REGIONS[g.index]
        const mid = (g.startAngle + g.endAngle) / 2
        const out = REGION_MATRIX[g.index].reduce((a, b) => a + b, 0)
        const inn = REGION_MATRIX.reduce((a, row) => a + row[g.index], 0)
        const lx = Math.sin(mid) * (R_OUT + 16)
        const ly = -Math.cos(mid) * (R_OUT + 16)
        const anchor = Math.abs(lx) < 30 ? "middle" : lx > 0 ? "start" : "end"
        return (
          <g
            key={r.key}
            onMouseEnter={() => setHover(g.index)}
            onMouseLeave={() => {
              setHover(null)
              hide()
            }}
            onMouseMove={(e) =>
              show(
                <>
                  <b>{r.name}</b>
                  <br />
                  Mengirim <span className="m">{nf(out)} t/bln</span>
                  <br />
                  Menerima <span className="m">{nf(inn)} t/bln</span>
                </>,
                e,
              )
            }
            style={{ cursor: "default" }}
          >
            <path d={groupArc(g) ?? ""} fill={r.color} />
            <text x={lx} y={ly} textAnchor={anchor} className="ttl" dy={ly > 0 ? "0.9em" : "0"}>
              {r.short}
            </text>
            <text x={lx} y={ly} textAnchor={anchor} className="sub" dy={ly > 0 ? "2.2em" : "1.25em"}>
              {nf(out / 1000, 1)} rb t keluar
            </text>
          </g>
        )
      })}
    </svg>
  )
}
