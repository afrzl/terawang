import { Sprout } from "lucide-react"
import { LineChart } from "@/components/charts/LineChart"
import { ProdTreemap } from "@/components/charts/ProdTreemap"
import { SatCompare } from "@/components/charts/SatCompare"
import { Bacaan } from "@/components/ui/Bacaan"
import { KpiStrip } from "@/components/ui/Kpi"
import { Panel, ViewHeader } from "@/components/ui/Panel"
import { bacaFase, bacaKalender, bacaProyeksi, bacaRadar, bacaTreemap, kalenderPanen } from "@/lib/bacaan"
import { PHASES, byName } from "@/lib/data"
import { dfmt, nf, scale, short, sum, ticks } from "@/lib/format"
import { useSelection } from "@/lib/selection"
import { useTooltip } from "@/lib/tooltip"
import { useWilayah } from "@/lib/filter"

const STEPS = ["--s1", "--s2", "--s3", "--s4", "--s5"]
const PHASE_COLORS = ["--s0", "--s1", "--s2", "--s4", "--s5"]
const ROW_H = 22
const MT = 8

export default function Produksi() {
  const wil = useWilayah()
  const estT = sum(wil, (k) => k.est)
  const prevT = sum(wil, (k) => k.prev)
  const lagHa = sum(wil, (k) => (k.ha * k.lag) / 100)

  return (
    <section className="view">
      <ViewHeader icon={Sprout} title="Produksi pra-panen" />
      <KpiStrip
        items={[
          {
            k: "Proyeksi panen Nov–Jan",
            v: `${nf(estT / 1000, 2)} jt ton`,
            t: (
              <>
                GKG · <span className="delta-dn">{nf((estT / prevT - 1) * 100, 1)}%</span> vs 2025
              </>
            ),
          },
          { k: "Sawah terpetakan", v: `${nf(sum(wil, (k) => k.ha) / 1e6, 2)} jt ha`, t: "Sentinel-1 VH, akurasi peta 91,4%" },
          { k: "Petak tertinggal", v: `${nf(lagHa / 1000, 1)} rb ha`, t: "peringatan dini hama/kekeringan" },
          { k: "Uji balik MT I 2025", v: "MAPE 8,7%", t: "terhadap angka BPS · target ≤ 10%" },
        ]}
      />
      <div className="grid-2">
        <SatPanel />
        <Panel title="Sumbangan tiap wilayah pada panen Nov–Jan" note="Luas kotak = proyeksi ribu ton GKG; dikelompokkan per kawasan; klik untuk memilih">
          <div className="pb chart">
            <ProdTreemap />
          </div>
          <Bacaan>{bacaTreemap()}</Bacaan>
        </Panel>
      </div>
      <div className="grid-21">
        <Panel title="Kalender panen 12 pekan ke depan" note="Perkiraan luas panen per pekan, ribu ha">
          <div className="pb chart">
            <HarvestCalendar />
          </div>
          <Bacaan>{bacaKalender()}</Bacaan>
        </Panel>
        <RadarProfile />
      </div>
      <div className="grid-2">
        <Panel title="Proyeksi panen Nov 2026 – Jan 2027" note="Ribu ton GKG, garis = selang 90%, titik = periode sama 2025">
          <div className="pb chart">
            <EstimateBars />
          </div>
          <Bacaan>{bacaProyeksi()}</Bacaan>
        </Panel>
        <Panel title="Fase tumbuh per wilayah" note="% luas sawah, citra 30 Okt 2026">
          <div className="pb chart">
            <PhaseBars />
          </div>
          <Bacaan>{bacaFase()}</Bacaan>
        </Panel>
      </div>
    </section>
  )
}

function SatPanel() {
  const { sel } = useSelection()
  return (
    <Panel title={`Sebelum dan sesudah tanam · ${sel}`} note="Geser garis putih untuk membandingkan">
      <div className="pb">
        <SatCompare />
      </div>
    </Panel>
  )
}

function HarvestCalendar() {
  const { sel, select } = useSelection()
  const { show, hide } = useTooltip()
  const { top, weeks, cal } = kalenderPanen()
  const W = 720
  const rowH = 21
  const m = { l: 96, t: 22, r: 8 }
  const H = m.t + top.length * rowH + 8
  const cw = (W - m.l - m.r) / 12
  const mx = Math.max(...cal.flat())

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Kalender panen">
        {weeks.map((d, i) =>
          i % 2 === 0 ? (
            <text key={i} x={m.l + i * cw + cw / 2} y={14} textAnchor="middle">
              {dfmt(d)}
            </text>
          ) : null,
        )}
        {top.map((k, r) => (
          <g key={k.n}>
            <text x={m.l - 8} y={m.t + r * rowH + 14} textAnchor="end" className={k.n === sel ? "lab-b" : "lab"}>
              {short(k.n)}
            </text>
            {cal[r].map((v, i) => {
              const b = Math.min(4, Math.floor((v / mx) * 5))
              return (
                <rect
                  key={i}
                  x={m.l + i * cw + 1}
                  y={m.t + r * rowH + 1}
                  width={cw - 2}
                  height={rowH - 2}
                  rx={2}
                  fill={v < mx * 0.04 ? "var(--s0)" : `var(${STEPS[b]})`}
                  style={{ cursor: "pointer" }}
                  onMouseMove={(e) =>
                    show(
                      <>
                        <b>{k.n}</b>
                        <br />
                        Pekan {dfmt(weeks[i])}
                        <br />
                        Perkiraan luas panen <span className="m">{nf(v * 1000)} ha</span>
                      </>,
                      e,
                    )
                  }
                  onMouseLeave={hide}
                  onClick={() => select(k.n)}
                />
              )
            })}
          </g>
        ))}
      </svg>
      <div className="legend" style={{ padding: "8px 0 0" }}>
        <span className="ttl">Luas panen per pekan</span>
        {STEPS.map((c, i) => (
          <span key={c}>
            <span className="sw" style={{ background: `var(${c})` }} />
            {nf((mx * i) / 5, 1)}–{nf((mx * (i + 1)) / 5, 1)} rb ha
          </span>
        ))}
      </div>
    </>
  )
}

function RadarProfile() {
  const { sel } = useSelection()
  const k = byName[sel]
  const N = 15
  const dates = [...Array(N)].map((_, i) => new Date(2026, 5, 1 + i * 12))
  // Buang null di ujung agar label garis menempel pada akuisisi terakhir yang ada.
  const trim = (xs: (number | null)[]) => {
    const out = xs.slice(0, N)
    while (out.length && out[out.length - 1] == null) out.pop()
    return out
  }
  const cur = trim(k.vh)
  const avg = trim(k.vhAvg)
  const vals = [...cur, ...avg].filter((v): v is number => v != null)
  const lo = vals.length ? Math.floor(Math.min(...vals) - 0.5) : -24
  const hi = vals.length ? Math.ceil(Math.max(...vals) + 0.5) : -12
  const lastCur = cur[cur.length - 1] ?? 0
  const lastAvg = avg[avg.length - 1] ?? 0
  const avgAbove = lastAvg > lastCur
  const fmt = (v: number | null | undefined) => (v == null ? "belum ada citra" : `${nf(v, 1)} dB`)

  return (
    <Panel title={`Profil radar VH · ${k.n}`} note="Rata-rata piksel sawah, dB · Sentinel-1 via Google Earth Engine">
      <div className="pb chart">
        {vals.length ? (
          <LineChart
            xDates={dates}
            yDom={[lo, hi]}
            yFmt={(v) => nf(v, Number.isInteger(v) ? 0 : 1)}
            W={480}
            H={250}
            series={[
              { vals: avg, color: "var(--ink-3)", dash: "4 3", label: "rata-rata 2023–25", ly: avgAbove ? -4 : 12 },
              { vals: cur, color: "var(--s4)", w: 2.4, label: "musim ini", ly: avgAbove ? 12 : -4 },
            ]}
            tip={(i) => (
              <>
                <b>{dfmt(dates[i])} 2026</b>
                <br />
                Musim ini <span className="m">{fmt(cur[i])}</span>
                <br />
                Rata-rata 2023–25 <span className="m">{fmt(avg[i])}</span>
              </>
            )}
          />
        ) : (
          <div className="method">Belum ada profil Sentinel-1 untuk wilayah ini.</div>
        )}
      </div>
      <Bacaan>{bacaRadar(k)}</Bacaan>
    </Panel>
  )
}

function EstimateBars() {
  const wil = useWilayah()
  const { sel, select } = useSelection()
  const { show, hide } = useTooltip()
  const est = wil.filter((k) => !k.isKota)
    .sort((a, b) => b.est - a.est)
    .slice(0, 16)
  const W = 560
  const ml = 96
  const mr = 46
  const H = MT + est.length * ROW_H + 24
  const xm = Math.max(...est.map((k) => k.est + k.ci)) * 1.05
  const xs = scale(0, xm, ml, W - mr)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img">
      <g className="grid">
        {ticks(0, xm, 5).map((t) => (
          <g key={t}>
            <line x1={xs(t)} x2={xs(t)} y1={MT} y2={H - 22} />
            <text x={xs(t)} y={H - 8} textAnchor="middle">
              {nf(t)}
            </text>
          </g>
        ))}
      </g>
      {est.map((k, i) => {
        const y = MT + i * ROW_H + ROW_H / 2
        const isSel = k.n === sel
        const lo = xs(k.est - k.ci)
        const hi = xs(k.est + k.ci)
        return (
          <g
            key={k.n}
            style={{ cursor: "pointer" }}
            onMouseMove={(e) =>
              show(
                <>
                  <b>{k.n}</b>
                  <br />
                  Proyeksi <span className="m">{nf(k.est, 1)} rb ton</span>
                  <br />
                  Selang 90%{" "}
                  <span className="m">
                    {nf(k.est - k.ci, 1)}–{nf(k.est + k.ci, 1)}
                  </span>
                  <br />
                  Periode sama 2025 <span className="m">{nf(k.prev, 1)}</span>
                </>,
                e,
              )
            }
            onMouseLeave={hide}
            onClick={() => select(k.n)}
          >
            <rect x={0} y={y - ROW_H / 2} width={W} height={ROW_H} fill="transparent" />
            <text x={ml - 8} y={y + 4} textAnchor="end" className={isSel ? "lab-b" : "lab"}>
              {short(k.n)}
            </text>
            <rect x={ml} y={y - 5} width={xs(k.est) - ml} height={10} fill={isSel ? "var(--accent)" : "var(--s3)"} />
            <line x1={lo} x2={hi} y1={y} y2={y} stroke="var(--ink)" strokeWidth={1.4} />
            <line x1={lo} x2={lo} y1={y - 4} y2={y + 4} stroke="var(--ink)" strokeWidth={1.4} />
            <line x1={hi} x2={hi} y1={y - 4} y2={y + 4} stroke="var(--ink)" strokeWidth={1.4} />
            <circle cx={xs(k.prev)} cy={y} r={3.6} fill="var(--panel)" stroke="var(--ink-2)" strokeWidth={1.6} />
            <text x={xs(Math.max(k.est + k.ci, k.prev)) + 8} y={y + 4}>
              {nf(k.est, 0)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function PhaseBars() {
  const wil = useWilayah()
  const { sel, select } = useSelection()
  const { show, hide } = useTooltip()
  const ps = wil.filter((k) => !k.isKota)
    .sort((a, b) => b.ph[2] + b.ph[3] - (a.ph[2] + a.ph[3]))
    .slice(0, 16)
  const W = 560
  const ml = 96
  const H = MT + ps.length * ROW_H + 40
  const x = scale(0, 100, ml, W - 10)

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} role="img">
        {ps.map((k, i) => {
          const y = MT + i * ROW_H + ROW_H / 2
          let acc = 0
          return (
            <g key={k.n}>
              <text x={ml - 8} y={y + 4} textAnchor="end" className={k.n === sel ? "lab-b" : "lab"}>
                {short(k.n)}
              </text>
              {k.ph.map((v, j) => {
                const x0 = x(acc) + (j ? 1 : 0)
                const w = Math.max(0, x(acc + v) - x(acc) - (j ? 1 : 0))
                acc += v
                return (
                  <rect
                    key={j}
                    x={x0}
                    y={y - 6}
                    width={w}
                    height={12}
                    fill={`var(${PHASE_COLORS[j]})`}
                    style={{ cursor: "pointer" }}
                    onMouseMove={(e) =>
                      show(
                        <>
                          <b>{k.n}</b>
                          {PHASES.map((n, pj) => (
                            <span key={n}>
                              <br />
                              {n} <span className="m">{nf(k.ph[pj], 0)}%</span>
                            </span>
                          ))}
                        </>,
                        e,
                      )
                    }
                    onMouseLeave={hide}
                    onClick={() => select(k.n)}
                  />
                )
              })}
            </g>
          )
        })}
        {[0, 25, 50, 75, 100].map((t) => (
          <text key={t} x={x(t)} y={H - 24} textAnchor="middle">
            {t}%
          </text>
        ))}
      </svg>
      <div className="legend" style={{ padding: "4px 0 0" }}>
        {PHASES.map((n, j) => (
          <span key={n}>
            <span className="sw" style={{ background: `var(${PHASE_COLORS[j]})`, outline: "1px solid var(--rule)" }} />
            {n}
          </span>
        ))}
      </div>
    </>
  )
}
