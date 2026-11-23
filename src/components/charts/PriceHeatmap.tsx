import { HET, HIST, SIAGA, fcDates, histDates } from "@/lib/data"
import { dfmt, nf, rp, short } from "@/lib/format"
import { useSelection } from "@/lib/selection"
import { useTooltip } from "@/lib/tooltip"
import { useWilayah } from "@/lib/filter"

const BINS: [number, string, string][] = [
  [12700, "--d5", "< 12.700"],
  [13100, "--d4", "12.700–13.100"],
  [HET, "--d3", "13.100–13.500"],
  [SIAGA, "--d2", "13.500–13.900 (Waspada)"],
  [Infinity, "--d1", "≥ 13.900 (Siaga)"],
]
const colorFor = (v: number) => `var(${BINS.find((b) => v < b[0])![1]})`

/** Peta panas harga beras medium: 38 wilayah × 26 pekan riwayat + 4 pekan prakiraan. */
export function PriceHeatmap() {
  const wil = useWilayah()
  const { sel, select } = useSelection()
  const { show, hide } = useTooltip()
  const rows = wil.slice().sort((a, b) => b.p4 - a.p4)
  const dates = histDates.concat(fcDates)
  const n = dates.length
  const W = 1100
  const m = { l: 116, r: 8, t: 24, b: 6 }
  const rowH = 15
  const gap = 8 // jarak pemisah riwayat dan prakiraan
  const cw = (W - m.l - m.r - gap) / n
  const H = m.t + rows.length * rowH + m.b
  const cx = (i: number) => m.l + i * cw + (i >= HIST ? gap : 0)

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Peta panas harga beras per wilayah dan pekan" className="heat">
        {dates.map((d, i) =>
          (i < HIST && i % 3 === 0) || i === HIST ? (
            <text key={i} x={cx(i) + cw / 2} y={14} textAnchor="middle" className={i >= HIST ? "lab-b" : undefined}>
              {i === HIST ? "prakiraan →" : dfmt(d)}
            </text>
          ) : null,
        )}
        {rows.map((k, r) => {
          const vals = k.price.concat(k.fc.map((f) => f.m))
          const y = m.t + r * rowH
          return (
            <g key={k.n}>
              <text
                x={m.l - 8}
                y={y + rowH - 4}
                textAnchor="end"
                className={k.n === sel ? "lab-b" : "lab"}
                style={{ cursor: "pointer", fontSize: 10.5 }}
                onClick={() => select(k.n)}
              >
                {short(k.n)}
              </text>
              {vals.map((v, i) => (
                <rect
                  key={i}
                  className="c"
                  x={cx(i)}
                  y={y}
                  width={cw}
                  height={rowH}
                  fill={colorFor(v)}
                  opacity={i >= HIST ? 0.78 : 1}
                  style={{ cursor: "pointer" }}
                  onMouseMove={(e) =>
                    show(
                      <>
                        <b>{k.n}</b>
                        <br />
                        {dfmt(dates[i])} 2026{i >= HIST ? " · prakiraan" : ""}
                        <br />
                        Medium <span className="m">{rp(v)}/kg</span> ({v >= HET ? "+" : "−"}
                        {nf(Math.abs((v / HET - 1) * 100), 1)}% thd HET)
                      </>,
                      e,
                    )
                  }
                  onMouseLeave={hide}
                  onClick={() => select(k.n)}
                />
              ))}
              {k.n === sel && <rect x={m.l - 2} y={y} width={W - m.l - m.r + 4 - (W - m.l - m.r - gap - cw * n)} height={rowH} fill="none" stroke="var(--ink)" strokeWidth={1.6} pointerEvents="none" />}
            </g>
          )
        })}
      </svg>
      <div className="legend" style={{ padding: "8px 0 0" }}>
        <span className="ttl">Rp/kg medium</span>
        {BINS.map((b) => (
          <span key={b[1]}>
            <span className="sw" style={{ background: `var(${b[1]})` }} />
            {b[2]}
          </span>
        ))}
        <span>kolom pudar = prakiraan 4 pekan</span>
      </div>
    </>
  )
}
