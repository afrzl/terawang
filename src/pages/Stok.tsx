import { Warehouse } from "lucide-react"
import { BulogCabang } from "@/components/charts/BulogCabang"
import { BulogStok } from "@/components/charts/BulogStok"
import { DeficitCountdown } from "@/components/charts/DeficitCountdown"
import { LineChart } from "@/components/charts/LineChart"
import { DataTable, type Column } from "@/components/ui/DataTable"
import { KpiStrip } from "@/components/ui/Kpi"
import { Panel, ViewHeader } from "@/components/ui/Panel"
import { StokPill } from "@/components/ui/Pill"
import { binColor, type StokStatus, type Wilayah } from "@/lib/data"
import { nf, scale, sum, ticks } from "@/lib/format"
import { BULAN_KINI, N_BULAN, bulanLabel, useFilter, useWilayah } from "@/lib/filter"
import { covBulan, produksiBeras, surplusTon } from "@/lib/petaLayers"

const SS: Record<string, number> = { surplus: -1, cukup: 0, tipis: 1, defisit: 2 }
/** Ambang status K2 (bulan konsumsi). */
const statusOf = (c: number): StokStatus => (c < 0.75 ? "defisit" : c < 1 ? "tipis" : c < 1.5 ? "cukup" : "surplus")
const akhirBulan = (i: number) => new Date(2026, i + 1, 0)

export default function Stok() {
  const wil = useWilayah()
  const { akhir } = useFilter()
  const cT = sum(wil, (k) => k.C)
  const covRata = cT ? sum(wil, (k) => covBulan(k, akhir) * k.C) / cT : 0
  const nDef = wil.filter((k) => statusOf(covBulan(k, akhir)) === "defisit").length
  const nTip = wil.filter((k) => statusOf(covBulan(k, akhir)) === "tipis").length
  const stT = sum(wil, (k) => covBulan(k, akhir) * k.C * 1000)
  const rows = wil.slice().sort((a, b) => covBulan(a, akhir) - covBulan(b, akhir))
  const mxc = Math.max(1e-6, ...wil.map((k) => covBulan(k, akhir)))
  // Bulan pertama setelah bulan terpilih yang cakupannya di bawah ambang defisit.
  const mulaiDefisit = (k: Wilayah) => {
    for (let i = akhir + 1; i < N_BULAN; i++) if (covBulan(k, i) < 0.75) return i
    return -1
  }

  const columns: Column<Wilayah>[] = [
    { head: "Wilayah", cell: (k) => <b>{k.n}</b>, sort: (k) => k.n },
    {
      head: `Stok ${bulanLabel(akhir)}`,
      right: true,
      num: true,
      cell: (k) => `${nf(covBulan(k, akhir) * k.C * 1000)} ton`,
      sort: (k) => covBulan(k, akhir) * k.C,
    },
    { head: "Konsumsi/bln", right: true, num: true, cell: (k) => `${nf(k.C * 1000)} ton`, sort: (k) => k.C },
    {
      head: `Cakupan ${bulanLabel(akhir)}`,
      right: true,
      sort: (k) => covBulan(k, akhir),
      cell: (k) => (
        <div className="bar-cell">
          <span className="num">{nf(covBulan(k, akhir), 2)}</span>
          <span className="minibar">
            <span style={{ width: `${(covBulan(k, akhir) / mxc) * 100}%`, background: binColor("stok", covBulan(k, akhir)) }} />
          </span>
        </div>
      ),
    },
    { head: "Des 2026", right: true, num: true, cell: (k) => nf(covBulan(k, 11), 2), sort: (k) => covBulan(k, 11) },
    { head: "Jan 2027", right: true, num: true, cell: (k) => nf(covBulan(k, 12), 2), sort: (k) => covBulan(k, 12) },
    { head: "Status", cell: (k) => <StokPill s={statusOf(covBulan(k, akhir))} />, sort: (k) => SS[statusOf(covBulan(k, akhir))] * 100 - covBulan(k, akhir) },
    {
      head: `Neraca ${bulanLabel(akhir)}`,
      right: true,
      num: true,
      cell: (k) => `${surplusTon(k, akhir) >= 0 ? "+" : "−"}${nf(Math.abs(surplusTon(k, akhir)))}`,
      sort: (k) => surplusTon(k, akhir),
    },
    {
      head: "Defisit",
      right: true,
      sort: (k) => (mulaiDefisit(k) === -1 ? 99 : mulaiDefisit(k)),
      cell: (k) => (mulaiDefisit(k) === -1 ? "—" : bulanLabel(mulaiDefisit(k))),
    },
  ]

  return (
    <section className="view">
      <ViewHeader icon={Warehouse} title="Stok" />
      <KpiStrip
        items={[
          { k: "Stok non-Bulog", v: `${nf(stT / 1000, 1)} rb ton`, t: `akhir ${bulanLabel(akhir)}` },
          { k: "Cakupan stok", v: `${nf(covRata, 2)} bulan`, t: "bulan konsumsi" },
          { k: "Konsumsi bulanan", v: `${nf(cT, 0)} rb ton`, t: `${nf(sum(wil, (k) => k.pop) / 1000, 1)} juta jiwa` },
          { k: "Wilayah defisit", v: `${nDef} dari ${wil.length}`, t: `${nTip} tipis` },
        ]}
      />
      <div className="grid-21">
        <KalmanPanel wil={wil} />
        <NeracaPanel wil={wil} />
      </div>
      <Panel title="Stok dan Konsumsi per Wilayah">
        <DataTable rows={rows} columns={columns} rowKey={(k) => k.n} rowName={(k) => k.n} pageSize={10} />
      </Panel>
      <Panel title="Estimasi Waktu Menuju Defisit">
        <div className="pb">
          <DeficitCountdown />
        </div>
      </Panel>
      <div className="grid-21">
        <Panel title="Stok Bulog Jawa Timur" note="Tingkat provinsi, 2026">
          <div className="pb chart">
            <BulogStok />
          </div>
        </Panel>
        <Panel title="Stok per Kantor Cabang Bulog">
          <BulogCabang bulan={akhir} />
        </Panel>
      </div>
    </section>
  )
}

/** Simpangan cakupan per bulan (bulan konsumsi) mengikuti ragam K2: (0,4·C)² + Σ[(0,20·X)² + (0,05·C)² + (sdP·P)²], sdP 0,15 untuk riwayat dan 0,30 untuk estimasi ke depan. */
function simpangan(k: Wilayah) {
  let v = 0.4 ** 2
  const sd: number[] = []
  for (let i = 0; i < N_BULAN; i++) {
    const r = produksiBeras(k, i) / (k.C * 1000)
    const sdP = i <= BULAN_KINI ? 0.15 : 0.3
    v += (0.2 * Math.max(0, r - 1)) ** 2 + 0.05 ** 2 + (sdP * r) ** 2
    // Dibatasi pada rata-rata K2 (±1,6 bulan) karena produksi dummy bulan panen membuat ragam melebar tidak wajar.
    sd.push(Math.min(1.6, Math.sqrt(v)))
  }
  return sd
}

function KalmanPanel({ wil }: { wil: Wilayah[] }) {
  const dates = [...Array(N_BULAN)].map((_, i) => akhirBulan(i))
  const cT = sum(wil, (k) => k.C)
  if (!wil.length || !cT) {
    return (
      <Panel title="Estimasi stok non-Bulog">
        <div className="pb">
          <div className="method">Tidak ada wilayah dipilih.</div>
        </div>
      </Panel>
    )
  }
  // Cakupan gabungan = rata-rata tertimbang konsumsi. Simpangan dirata-ratakan dengan bobot sama (galat jangkar dianggap searah, jadi tidak mengecil).
  const sds = wil.map((k) => ({ sd: simpangan(k), C: k.C }))
  const center = dates.map((_, i) => sum(wil, (k) => covBulan(k, i) * k.C) / cT)
  const sd = dates.map((_, i) => sds.reduce((a, x) => a + x.sd[i] * x.C, 0) / cT)
  const top = Math.max(1.6, Math.max(...center) * 1.25)
  const band = (z: number, op: number) => ({
    lo: center.map((v, i) => Math.max(0, v - z * sd[i])),
    hi: center.map((v, i) => Math.min(top, v + z * sd[i])),
    off: 0,
    color: "var(--accent)",
    op,
  })

  return (
    <Panel title="Estimasi stok non-Bulog">
      <div className="pb chart">
        <LineChart
          xDates={dates}
          yDom={[0, top]}
          yFmt={(v) => nf(v, 1)}
          W={720}
          H={290}
          splitAt={BULAN_KINI}
          splitLabel="Des–Jan"
          bands={[band(0.674, 0.22)]}
          refs={[
            { v: 1, label: "batas aman", color: "var(--warn)", dy: -3 },
            { v: 0.75, label: "defisit", color: "var(--crit)", dy: 9 },
          ]}
          series={[
            { vals: center.slice(0, BULAN_KINI + 1), color: "var(--accent)", w: 2.2 },
            { vals: center.slice(BULAN_KINI), off: BULAN_KINI, color: "var(--accent)", dash: "5 4", w: 2, label: nf(center[N_BULAN - 1], 2) + " bln" },
          ]}
          tip={(i) => (
            <>
              <b>{bulanLabel(i)}</b>
              <br />
              Cakupan <span className="m">{nf(center[i], 2)} bln</span>
              <br />
              Selang 95%{" "}
              <span className="m">
                {nf(Math.max(0, center[i] - 1.96 * sd[i]), 2)}–{nf(center[i] + 1.96 * sd[i], 2)}
              </span>
            </>
          )}
        />
        <div className="legend" style={{ padding: "6px 0 0" }}>
          <span>
            <span className="sw" style={{ background: "var(--accent)" }} />
            estimasi stok
          </span>
        </div>
      </div>
    </Panel>
  )
}

function NeracaPanel({ wil }: { wil: Wilayah[] }) {
  const { akhir } = useFilter()
  if (!wil.length) {
    return (
      <Panel title="Neraca">
        <div className="pb">
          <div className="method">Tidak ada wilayah dipilih.</div>
        </div>
      </Panel>
    )
  }
  const S1 = sum(wil, (k) => covBulan(k, akhir) * k.C * 1000)
  const S0 = sum(wil, (k) => covBulan(k, akhir - 1) * k.C * 1000)
  const P = sum(wil, (k) => produksiBeras(k, akhir))
  const Kn = sum(wil, (k) => k.C * 1000)
  const A = S1 - S0 - P + Kn
  // Sumber tiap batang. estimasi = keluaran model kita (K1, optimasi arus); BPS = data asli. Stok awal dan akhir tidak diberi tanda
  // (levelnya bertumpu pada jangkar asumsi K2).
  const sumber = ["", akhir <= 8 ? "BPS + K1" : "estimasi", "BPS", "estimasi", ""]
  const warnaSumber = (t: string) => (t === "estimasi" ? "var(--warn)" : "var(--ink-3)")
  const steps: [string, number, "base" | "d"][] = [
    ["Stok awal", S0, "base"],
    ["Produksi", P, "d"],
    ["Konsumsi", -Kn, "d"],
    ["Arus netto", A, "d"],
    ["Stok akhir", S1, "base"],
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
  const H = 266
  const m = { l: 52, r: 10, t: 20, b: 50 }
  const ymax = Math.max(...bars.map((b) => Math.max(b.a, b.b))) * 1.12
  const y = scale(0, ymax, H - m.b, m.t)
  const bw = (W - m.l - m.r) / bars.length

  return (
    <Panel title={`Neraca ${bulanLabel(akhir)}`}>
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
                {sumber[i] && (
                  <text x={x0 + w / 2} y={H - m.b + 30} textAnchor="middle" style={{ fontSize: 10.5, fontWeight: 600, fill: warnaSumber(sumber[i]) }}>
                    {sumber[i]}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
    </Panel>
  )
}
