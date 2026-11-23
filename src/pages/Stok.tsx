import { Warehouse } from "lucide-react"
import { DeficitCountdown } from "@/components/charts/DeficitCountdown"
import { LineChart } from "@/components/charts/LineChart"
import { Bacaan } from "@/components/ui/Bacaan"
import { DataTable, type Column } from "@/components/ui/DataTable"
import { KpiStrip } from "@/components/ui/Kpi"
import { Panel, ViewHeader } from "@/components/ui/Panel"
import { StokPill } from "@/components/ui/Pill"
import { bacaHitungMundur, bacaKalman, bacaNeraca } from "@/lib/bacaan"
import { HIST, binColor, byName, histDates, type Wilayah } from "@/lib/data"
import { DAY, NOW, dfmt, nf, scale, sum, ticks } from "@/lib/format"
import { useSelection } from "@/lib/selection"
import { useWilayah } from "@/lib/filter"

function CountdownBacaan() {
  const { sel } = useSelection()
  return <Bacaan>{bacaHitungMundur(sel)}</Bacaan>
}

const SS: Record<string, number> = { surplus: -1, cukup: 0, tipis: 1, defisit: 2 }

export default function Stok() {
  const wil = useWilayah()
  const stT = sum(wil, (k) => k.cov * k.C)
  const cT = sum(wil, (k) => k.C)
  const rows = wil.slice().sort((a, b) => a.covP[3] - b.covP[3])
  const mxc = Math.max(...wil.map((k) => k.cov))

  const columns: Column<Wilayah>[] = [
    { head: "Wilayah", cell: (k) => <b>{k.n}</b>, sort: (k) => k.n },
    { head: "Konsumsi/bln", right: true, num: true, cell: (k) => `${nf(k.C * 1000)} t`, sort: (k) => k.C },
    { head: "Stok kini", right: true, num: true, cell: (k) => `${nf(k.cov * k.C * 1000)} t`, sort: (k) => k.cov * k.C },
    {
      head: "Cakupan kini",
      right: true,
      sort: (k) => k.cov,
      cell: (k) => (
        <div className="bar-cell">
          <span className="num">{nf(k.cov, 2)}</span>
          <span className="minibar">
            <span style={{ width: `${(k.cov / mxc) * 100}%`, background: binColor("stok", k.cov) }} />
          </span>
        </div>
      ),
    },
    { head: "Proyeksi +4 pkn", right: true, num: true, cell: (k) => nf(k.covP[3], 2), sort: (k) => k.covP[3] },
    { head: "Status", cell: (k) => <StokPill s={k.ss} />, sort: (k) => SS[k.ss] * 100 - k.covP[3] },
    {
      head: "Pekan sampai batas aman",
      right: true,
      num: true,
      sort: (k) => {
        const wk = [k.cov].concat(k.covP).findIndex((v) => v < 1)
        return wk === -1 ? 99 : wk
      },
      cell: (k) => {
        const wk = [k.cov].concat(k.covP).findIndex((v) => v < 1)
        return wk === -1 ? "> 8" : wk === 0 ? "sudah di bawah" : wk
      },
    },
  ]

  return (
    <section className="view">
      <ViewHeader icon={Warehouse} title="Stok beredar" />
      <KpiStrip
        items={[
          { k: "Stok beredar provinsi", v: `${nf(stT, 0)} rb ton`, t: `≈ ${nf(stT / cT, 2)} bulan konsumsi` },
          { k: "Konsumsi bulanan", v: `${nf(cT, 0)} rb ton`, t: `${nf(sum(wil, (k) => k.pop) / 1000, 1)} juta jiwa × 6,39 kg` },
          {
            k: "Proyeksi defisit ≤ 4 pekan",
            v: `${wil.filter((k) => k.ss === "defisit").length} wilayah`,
            t: `${wil.filter((k) => k.ss === "tipis").length} wilayah lain tipis (0,75–1 bln)`,
          },
          { k: "Uji balik deteksi defisit 2025", v: "7 dari 8", t: "terdeteksi ≥ 1 bulan sebelumnya" },
        ]}
      />
      <Panel title="Hitung mundur ke defisit" note="Perkiraan hari sampai stok di bawah 0,75 bulan konsumsi, dari proyeksi filter Kalman. Klik kartu untuk memilih wilayah.">
        <div className="pb">
          <DeficitCountdown />
        </div>
        <CountdownBacaan />
      </Panel>
      <div className="grid-21">
        <KalmanPanel />
        <NeracaPanel />
      </div>
      <Panel title="Cakupan stok seluruh wilayah" note="Kini dan proyeksi 4 pekan; batas aman 1 bulan konsumsi, defisit di bawah 0,75">
        <DataTable rows={rows} columns={columns} rowKey={(k) => k.n} rowName={(k) => k.n} />
      </Panel>
    </section>
  )
}

/** Varians taksiran Kalman: bertambah Q tiap pekan, menyusut tiap kali observasi masuk, lalu melebar di masa proyeksi. */
function kalmanSd(k: Wilayah) {
  const Q = (k.cov * 0.03) ** 2
  const Rv = (k.cov * 0.035) ** 2
  let P = (k.cov * 0.05) ** 2
  const sd: number[] = []
  for (let i = 0; i < HIST; i++) {
    P += Q
    if (k.obs[i] != null) P = (P * Rv) / (P + Rv)
    sd.push(Math.sqrt(P))
  }
  for (let h = 0; h < 8; h++) {
    P += Q * (1.6 + h * 0.5)
    sd.push(Math.sqrt(P))
  }
  return sd
}

function KalmanPanel() {
  const { sel } = useSelection()
  const k = byName[sel]
  const dates = histDates.concat([...Array(8)].map((_, h) => new Date(+NOW + (h + 1) * 7 * DAY)))
  const center = k.covH.slice(0, HIST - 1).concat([k.cov], k.covP)
  const sd = kalmanSd(k)
  const band = (z: number, op: number) => ({
    lo: center.map((v, i) => Math.max(0, v - z * sd[i])),
    hi: center.map((v, i) => v + z * sd[i]),
    off: 0,
    color: "var(--accent)",
    op,
  })
  const hi = Math.max(...center.map((v, i) => v + 1.96 * sd[i])) * 1.06 + 0.05
  const proj = [k.cov].concat(k.covP)
  const w95 = 1.96 * sd[sd.length - 1]

  return (
    <Panel title={`Taksiran stok · ${k.n}`} note="Bulan konsumsi; pita gelap = selang 50%, terang = 95%">
      <div className="pb chart">
        <LineChart
          xDates={dates}
          yDom={[0, Math.max(1.4, hi)]}
          yFmt={(v) => nf(v, 1)}
          W={720}
          H={290}
          splitAt={HIST - 1}
          bands={[band(1.96, 0.12), band(0.674, 0.22)]}
          refs={[
            { v: 1, label: "batas aman", color: "var(--warn)", dy: -3 },
            { v: 0.75, label: "defisit", color: "var(--crit)", dy: 9 },
          ]}
          series={[
            { vals: k.covH.slice(0, HIST - 1).concat([k.cov]), color: "var(--accent)", w: 2.2 },
            { vals: proj, off: HIST - 1, color: "var(--accent)", dash: "5 4", w: 2, label: nf(k.covP[7], 2) + " bln" },
          ]}
          points={[{ vals: k.obs, color: "var(--ink)" }]}
          tip={(i) => {
            const isP = i >= HIST
            const v = center[i]
            const ob = isP ? null : k.obs[i]
            return (
              <>
                <b>{dfmt(dates[i])} 2026</b>
                {isP && " · proyeksi"}
                <br />
                Taksiran <span className="m">{nf(v, 2)} bln</span> ≈ <span className="m">{nf(v * k.C * 1000)} ton</span>
                <br />
                Selang 95%{" "}
                <span className="m">
                  {nf(Math.max(0, v - 1.96 * sd[i]), 2)}–{nf(v + 1.96 * sd[i], 2)}
                </span>
                {ob != null && (
                  <>
                    <br />
                    Observasi stok <span className="m">{nf(ob, 2)} bln</span> · pita menyempit
                  </>
                )}
              </>
            )
          }}
        />
        <div className="legend" style={{ padding: "6px 0 0" }}>
          <span>
            <span className="sw" style={{ background: "var(--accent)" }} />
            taksiran filter Kalman
          </span>
          <span>
            <svg width="14" height="10" style={{ verticalAlign: -1, marginRight: 5 }}>
              <circle cx="7" cy="5" r="3.5" fill="var(--panel)" stroke="var(--ink)" strokeWidth="1.6" />
            </svg>
            observasi stok Bulog / survei
          </span>
          <span>garis putus = proyeksi 8 pekan</span>
        </div>
      </div>
      <Bacaan>{bacaKalman(k, w95)}</Bacaan>
    </Panel>
  )
}

function NeracaPanel() {
  const { sel } = useSelection()
  const k = byName[sel]
  const S1 = k.cov * k.C * 1000
  const S0 = k.covH[HIST - 5] * k.C * 1000
  const P = k.prod * 0.6402 * 0.065 * 1000
  const Kn = k.C * 1000
  const A = S1 - S0 - P + Kn
  const steps: [string, number, "base" | "d"][] = [
    ["Stok 1 Okt", S0, "base"],
    ["Produksi", P, "d"],
    ["Konsumsi", -Kn, "d"],
    ["Arus netto", A, "d"],
    ["Stok 31 Okt", S1, "base"],
  ]
  let acc = 0
  const bars = steps.map(([l, v, t]) => {
    let a: number
    let b: number
    if (t === "base") {
      a = 0
      b = v
      acc = v
    } else {
      a = acc
      b = acc + v
      acc = b
    }
    return { l, v, a, b, t }
  })
  const W = 420
  const H = 250
  const m = { l: 52, r: 10, t: 20, b: 34 }
  const ymax = Math.max(...bars.map((b) => Math.max(b.a, b.b))) * 1.12
  const y = scale(0, ymax, H - m.b, m.t)
  const bw = (W - m.l - m.r) / bars.length

  return (
    <Panel title={`Neraca Oktober 2026 · ${k.n}`} note="Ton beras">
      <div className="pb chart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img">
          <g className="grid">
            {ticks(0, ymax, 4).map((t) => (
              <g key={t}>
                <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} />
                <text x={m.l - 6} y={y(t) + 3.5} textAnchor="end">
                  {t >= 1000 ? nf(t / 1000, 0) + "rb" : nf(t)}
                </text>
              </g>
            ))}
          </g>
          {bars.map((b, i) => {
            const x0 = m.l + i * bw + bw * 0.18
            const w = bw * 0.64
            const top = y(Math.max(b.a, b.b))
            const h = Math.abs(y(b.a) - y(b.b))
            const col = b.t === "base" ? "var(--accent)" : b.v >= 0 ? "var(--d5)" : "var(--d1)"
            return (
              <g key={b.l}>
                <rect x={x0} y={top} width={w} height={Math.max(1, h)} fill={col} rx={2} />
                {i < bars.length - 1 && <line x1={x0 + w} x2={x0 + bw} y1={y(b.b)} y2={y(b.b)} stroke="var(--ink-3)" strokeDasharray="2 2" />}
                <text x={x0 + w / 2} y={top - 5} textAnchor="middle" style={{ fill: "var(--ink)" }}>
                  {b.t === "base" ? "" : b.v >= 0 ? "+" : "−"}
                  {nf(Math.abs(b.v))}
                </text>
                <text x={x0 + w / 2} y={H - m.b + 15} textAnchor="middle" className="lab">
                  {b.l}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
      <div className="pb" style={{ paddingTop: 0 }}>
        <div className="formula">
          S<sub>t</sub> = S<sub>t−1</sub> + P<sub>t</sub> − K<sub>t</sub> ± A<sub>t</sub> + ε<sub>t</sub>
        </div>
        <div className="method" style={{ marginTop: 8 }}>
          <span>
            K = penduduk × 6,39 kg/kapita/bulan (Susenas Sep 2025). P = GKG × 64,02% (konversi ke beras). A = arus netto antarwilayah, ditaksir.
          </span>
        </div>
      </div>
      <Bacaan>{bacaNeraca(k, S0, P, Kn, A, S1)}</Bacaan>
    </Panel>
  )
}
