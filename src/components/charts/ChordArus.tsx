import { useMemo, useState } from "react"
import { chord, ribbon, type Chord } from "d3-chord"
import { arc } from "d3-shape"
import { REGIONS, REGION_MATRIX } from "@/lib/arus"
import { nf } from "@/lib/format"
import { useTooltip } from "@/lib/tooltip"

const S = 520
/** Lebar kanvas lebih besar dari tingginya agar label di sisi kiri dan kanan tidak terpotong. */
const LEBAR = 760
const R_OUT = 200
const R_IN = 186

export interface ChordNode {
  key: string
  name: string
  short: string
  color: string
}

const NODE_KAWASAN: ChordNode[] = REGIONS.map((r) => ({ key: r.key, name: r.name, short: r.short, color: r.color }))

/** Diagram chord arus beras; pita melengkung balik = arus di dalam simpul yang sama. Bawaan: antarkawasan. */
export function ChordArus({ matrix = REGION_MATRIX, nodes = NODE_KAWASAN }: { matrix?: number[][]; nodes?: ChordNode[] } = {}) {
  const kompak = nodes.length > 6
  const { show, hide } = useTooltip()
  const [hover, setHover] = useState<number | null>(null)

  const chords = useMemo(() => chord().padAngle(0.045).sortSubgroups((a, b) => b - a)(matrix), [matrix])
  const groupArc = arc<{ startAngle: number; endAngle: number }>().innerRadius(R_IN).outerRadius(R_OUT).cornerRadius(2)
  const rib = ribbon<Chord, Chord["source"]>().radius(R_IN - 2)
  const lit = (c: Chord) => hover == null || c.source.index === hover || c.target.index === hover

  // Posisi label di luar lingkaran. Pada mode kompak, label di sisi yang sama digeser vertikal agar tidak bertumpuk.
  const label = chords.groups.map((g) => {
    const mid = (g.startAngle + g.endAngle) / 2
    return { lx: Math.sin(mid) * (R_OUT + 16), ly: -Math.cos(mid) * (R_OUT + 16) }
  })
  {
    const GAP = kompak ? 17 : 44
    for (const sisi of [-1, 1]) {
      const idx = label.map((_, i) => i).filter((i) => (label[i].lx >= 0 ? 1 : -1) === sisi).sort((a, b) => label[a].ly - label[b].ly)
      for (let k = 1; k < idx.length; k++) {
        const prev = label[idx[k - 1]]
        if (label[idx[k]].ly - prev.ly < GAP) label[idx[k]].ly = prev.ly + GAP
      }
    }
  }

  return (
    <svg viewBox={`${-LEBAR / 2} ${-S / 2} ${LEBAR} ${S}`} role="img" aria-label="Diagram chord arus beras antarkawasan" className="chord">
      <g>
        {chords.map((c, i) => {
          const a = nodes[c.source.index]
          const b = nodes[c.target.index]
          const ab = matrix[c.source.index][c.target.index]
          const ba = matrix[c.target.index][c.source.index]
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
                        {a.short} ke {b.short}
                      </b>{" "}
                      <span className="m">{nf(ab)} ton</span>
                      <br />
                      <b>
                        {b.short} ke {a.short}
                      </b>{" "}
                      <span className="m">{nf(ba)} ton</span>
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
        const r = nodes[g.index]
        const dalam = matrix[g.index][g.index]
        const out = matrix[g.index].reduce((a, b) => a + b, 0) - dalam
        const inn = matrix.reduce((a, row) => a + row[g.index], 0) - dalam
        const { lx, ly } = label[g.index]
        // Rata menurut sisi (bukan tengah) agar dua label berdekatan di puncak lingkaran tidak saling menimpa.
        const anchor = lx > 0 ? "start" : "end"
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
                  Di dalam sendiri <span className="m">{nf(dalam)} ton/bln</span>
                  <br />
                  Keluar <span className="m">{nf(out)} ton/bln</span>
                  <br />
                  Masuk dari luar <span className="m">{nf(inn)} ton/bln</span>
                </>,
                e,
              )
            }
            style={{ cursor: "default" }}
          >
            <path d={groupArc(g) ?? ""} fill={r.color} />
            <text x={lx} y={ly} textAnchor={anchor} className="ttl" dy={ly > 0 ? "0.9em" : "0"} style={kompak ? { fontSize: 13 } : undefined}>
              {r.short}
            </text>
            {!kompak && (
              <text x={lx} y={ly} textAnchor={anchor} className="sub" dy={ly > 0 ? "2.2em" : "1.25em"}>
                keluar {nf(out / 1000, 1)} rb ton
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
