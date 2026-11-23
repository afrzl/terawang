import { useId } from "react"
import { HET, HIST, SIAGA, byName, fcDates, histDates } from "@/lib/data"
import { dfmt, nf, rp, scale } from "@/lib/format"
import { useSelection } from "@/lib/selection"
import { useTooltip } from "@/lib/tooltip"
import { useWilayah } from "@/lib/filter"

const NH = 12
const W = 1100
const ML = 84
const MR = 16
const STEP = 19
const RH = 62
const TOP = RH + 28
const BW = 95

/** Ridgeline sebaran harga beras medium 38 wilayah per pekan: 12 pekan terakhir dan 4 pekan prakiraan. */
export function PriceRidgeline() {
  const wil = useWilayah()
  const { sel } = useSelection()
  const { show, hide } = useTooltip()
  const gid = useId().replace(/:/g, "")
  const weeks = [
    ...Array.from({ length: NH }, (_, j) => {
      const i = HIST - NH + j
      return { d: histDates[i], fc: false, vals: wil.map((k) => k.price[i]), mine: byName[sel].price[i] }
    }),
    ...fcDates.map((d, h) => ({ d, fc: true, vals: wil.map((k) => k.fc[h].m), mine: byName[sel].fc[h].m })),
  ]
  const all = weeks.flatMap((w) => w.vals)
  const lo = Math.floor((Math.min(...all) - 250) / 100) * 100
  const hi = Math.ceil((Math.max(...all) + 250) / 100) * 100
  const x = scale(lo, hi, ML, W - MR)
  const H = TOP + (weeks.length - 1) * STEP + 34
  const N = 140
  const grid = Array.from({ length: N + 1 }, (_, i) => lo + ((hi - lo) * i) / N)
  const dens = weeks.map((w) =>
    grid.map((g) => w.vals.reduce((a, v) => a + Math.exp(-0.5 * ((g - v) / BW) ** 2), 0) / (w.vals.length * BW * Math.sqrt(2 * Math.PI))),
  )
  const dmax = Math.max(...dens.flat())
  const ticks = []
  for (let t = Math.ceil(lo / 500) * 500; t <= hi; t += 500) ticks.push(t)
  const pct = (v: number) => `${((x(v) - x(lo)) / (x(hi) - x(lo))) * 100}%`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Sebaran harga beras medium per pekan" className="ridge">
      <defs>
        <linearGradient id={`rg${gid}`} gradientUnits="userSpaceOnUse" x1={x(lo)} x2={x(hi)} y1="0" y2="0">
          <stop offset="0%" stopColor="var(--ok)" />
          <stop offset={pct(HET - 150)} stopColor="var(--ok)" />
          <stop offset={pct(HET)} stopColor="var(--warn)" />
          <stop offset={pct(SIAGA)} stopColor="var(--warn)" />
          <stop offset={pct(SIAGA + 150)} stopColor="var(--crit)" />
          <stop offset="100%" stopColor="var(--crit)" />
        </linearGradient>
      </defs>
      <g className="grid">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={20} y2={H - 22} />
            <text x={x(t)} y={H - 6} textAnchor="middle">
              {nf(t)}
            </text>
          </g>
        ))}
      </g>
      {[
        [HET, "HET"],
        [SIAGA, "Siaga"],
      ].map(([v, l]) => (
        <g key={l}>
          <line x1={x(+v)} x2={x(+v)} y1={20} y2={H - 22} stroke={l === "HET" ? "var(--ink-2)" : "var(--crit)"} strokeDasharray="4 3" />
          <text x={x(+v)} y={14} textAnchor="middle" className="lab-b" style={{ fill: l === "HET" ? "var(--ink-2)" : "var(--crit)" }}>
            {l}
          </text>
        </g>
      ))}
      {weeks.map((w, wi) => {
        const base = TOP + wi * STEP
        const pts = grid.map((g, i) => `${x(g).toFixed(1)},${(base - (dens[wi][i] / dmax) * RH).toFixed(1)}`)
        const d = `M${x(lo)},${base}L${pts.join("L")}L${x(hi)},${base}Z`
        const top = pts.filter((_, i) => dens[wi][i] > dmax * 0.012)
        const above = w.vals.filter((v) => v > HET).length
        const sorted = w.vals.slice().sort((a, b) => a - b)
        const med = (sorted[18] + sorted[19]) / 2
        return (
          <g
            key={wi}
            onMouseMove={(e) =>
              show(
                <>
                  <b>
                    {dfmt(w.d)} 2026{w.fc ? " · prakiraan" : ""}
                  </b>
                  <br />
                  Median 38 wilayah <span className="m">{rp(med)}</span>
                  <br />
                  Rentang{" "}
                  <span className="m">
                    {rp(sorted[0])}–{rp(sorted[37])}
                  </span>
                  <br />
                  Di atas HET <span className="m">{above} wilayah</span>
                  <br />
                  {sel} <span className="m">{rp(w.mine)}</span>
                </>,
                e,
              )
            }
            onMouseLeave={hide}
          >
            <path d={d} fill={`url(#rg${gid})`} fillOpacity={w.fc ? 0.42 : 0.8} />
            <path
              d={`M${top.join("L")}`}
              fill="none"
              stroke={w.fc ? "var(--ink-2)" : "var(--panel)"}
              strokeWidth={w.fc ? 1.1 : 1.4}
              strokeDasharray={w.fc ? "4 3" : undefined}
            />
            <circle cx={x(w.mine)} cy={base} r={2.8} fill="var(--ink)" />
            <text x={ML - 8} y={base} textAnchor="end" className={w.fc ? "lab-b" : "lab"}>
              {w.fc ? `+${wi - NH + 1} pkn` : dfmt(w.d)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
