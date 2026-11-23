import { ArrowLeftRight } from "lucide-react"
import { ChordArus } from "@/components/charts/ChordArus"
import { MapLegend, PetaJatim } from "@/components/charts/PetaJatim"
import { SankeyArus } from "@/components/charts/SankeyArus"
import { Bacaan } from "@/components/ui/Bacaan"
import { KpiStrip } from "@/components/ui/Kpi"
import { Panel, ViewHeader } from "@/components/ui/Panel"
import { REGIONS, TRADE, inflow, neraca, outflow, regionOf, regionStats } from "@/lib/arus"
import { bacaChord, bacaNeracaKawasan, bacaPetaArus, bacaSankey } from "@/lib/bacaan"
import { byName } from "@/lib/data"
import { nf, scale, short } from "@/lib/format"
import { useFilter } from "@/lib/filter"
import { useSelection } from "@/lib/selection"
import { useTooltip } from "@/lib/tooltip"

export default function ArusBeras() {
  const { lolos, W } = useFilter()
  const trade = TRADE.filter((t) => lolos(t.from) || lolos(t.to))
  const total = trade.reduce((a, t) => a + t.ton, 0) || 1
  const antar = trade.filter((t) => regionOf[t.from.n] !== regionOf[t.to.n]).reduce((a, t) => a + t.ton, 0)
  const kmAvg = trade.reduce((a, t) => a + t.ton * t.km, 0) / total
  const nSur = W.filter((k) => neraca(k) > 0).length

  return (
    <section className="view">
      <ViewHeader icon={ArrowLeftRight} title="Arus beras" />
      <KpiStrip
        items={[
          { k: "Arus beras antarwilayah", v: `${nf(total / 1000, 1)} rb ton`, t: "per bulan, taksiran Okt 2026" },
          { k: "Lintas kawasan", v: `${nf((antar / total) * 100, 0)}%`, t: `${nf(antar / 1000, 1)} rb ton keluar dari kawasan asal` },
          { k: "Wilayah surplus", v: `${nSur} dari 38`, t: "produksi Okt > konsumsi" },
          { k: "Jarak tempuh rata-rata", v: `${nf(kmAvg)} km`, t: "tertimbang volume" },
        ]}
      />
      <div className="grid-21">
        <Panel title="Peta arus utama" note="25 jalur terbesar; garis bergerak dari asal ke tujuan, warna = kawasan asal">
          <div className="map">
            <PetaJatim
              layer="stok"
              muted
              labels={false}
              arcs={trade.slice(0, 25).map((t) => ({ from: t.from.n, to: t.to.n, ton: t.ton, color: regionOf[t.from.n].color }))}
            />
          </div>
          <MapLegend layer="stok" />
          <RegionLegend />
          <Bacaan>{bacaPetaArus()}</Bacaan>
        </Panel>
        <Corridors />
      </div>
      <Panel title="Dari lumbung ke meja makan" note="Kabupaten asal → kawasan tujuan → kabupaten/kota tujuan, ton beras per bulan. Arahkan kursor untuk menyorot jalur.">
        <div className="pb chart">
          <SankeyArus />
        </div>
        <RegionLegend />
        <Bacaan>{bacaSankey()}</Bacaan>
      </Panel>
      <div className="grid-2">
        <Panel title="Saling pasok antarkawasan" note="Lebar pita = volume; pita yang kembali ke kawasan sendiri = arus di dalam kawasan">
          <div className="pb chart" style={{ maxWidth: 560, margin: "0 auto" }}>
            <ChordArus />
          </div>
          <Bacaan>{bacaChord()}</Bacaan>
        </Panel>
        <Panel title="Neraca kawasan" note="Produksi beras Oktober dikurangi konsumsi, ribu ton">
          <div className="pb chart">
            <RegionBalance />
          </div>
          <Bacaan>{bacaNeracaKawasan()}</Bacaan>
        </Panel>
      </div>
    </section>
  )
}

function RegionLegend() {
  return (
    <div className="region-legend">
      {REGIONS.map((r) => (
        <span key={r.key}>
          <span className="sw" style={{ background: r.color }} />
          {r.name}
        </span>
      ))}
    </div>
  )
}

function RegionBalance() {
  const { show, hide } = useTooltip()
  const st = regionStats()
    .map((s) => ({ ...s, net: s.prod - s.kons }))
    .sort((a, b) => b.net - a.net)
  const W = 520
  const rowH = 46
  const m = { l: 110, r: 70, t: 10, b: 24 }
  const H = m.t + st.length * rowH + m.b
  const mx = Math.max(...st.map((s) => Math.abs(s.net))) * 1.1
  const x = scale(-mx, mx, m.l, W - m.r)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Neraca produksi dan konsumsi per kawasan">
      <line x1={x(0)} x2={x(0)} y1={m.t - 4} y2={H - m.b + 4} stroke="var(--ink-3)" />
      {[-mx * 0.66, -mx * 0.33, mx * 0.33, mx * 0.66].map((t) => (
        <g key={t} className="grid">
          <line x1={x(t)} x2={x(t)} y1={m.t} y2={H - m.b} />
          <text x={x(t)} y={H - 6} textAnchor="middle">
            {t > 0 ? "+" : "−"}
            {nf(Math.abs(t) / 1000, 0)}
          </text>
        </g>
      ))}
      {st.map((s, i) => {
        const y = m.t + i * rowH + rowH / 2
        const pos = s.net >= 0
        const x0 = Math.min(x(0), x(s.net))
        const w = Math.abs(x(s.net) - x(0))
        return (
          <g
            key={s.r.key}
            onMouseMove={(e) =>
              show(
                <>
                  <b>{s.r.name}</b>
                  <br />
                  Produksi <span className="m">{nf(s.prod)} t</span>
                  <br />
                  Konsumsi <span className="m">{nf(s.kons)} t</span>
                  <br />
                  Keluar kawasan <span className="m">{nf(s.keluar)} t</span> · masuk <span className="m">{nf(s.masuk)} t</span>
                </>,
                e,
              )
            }
            onMouseLeave={hide}
          >
            <rect x={0} y={y - rowH / 2} width={W} height={rowH} fill="transparent" />
            <circle cx={12} cy={y} r={5} fill={s.r.color} />
            <text x={22} y={y + 4} className="lab-b">
              {s.r.short}
            </text>
            <rect x={x0} y={y - 9} width={w} height={18} rx={2} fill={pos ? "var(--d5)" : "var(--d1)"} opacity={0.88} />
            <text x={pos ? x(s.net) + 6 : x(s.net) - 6} y={y + 4} textAnchor={pos ? "start" : "end"} style={{ fill: "var(--ink)" }}>
              {pos ? "+" : "−"}
              {nf(Math.abs(s.net) / 1000, 1)} rb
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function Corridors() {
  const { sel, select } = useSelection()
  const { lolos } = useFilter()
  const k = byName[sel]
  const top = TRADE.filter((t) => lolos(t.from) || lolos(t.to)).slice(0, 10)
  const mx = top[0]?.ton ?? 1
  const out = outflow(k.n)
  const inn = inflow(k.n)
  return (
    <Panel title="Koridor terbesar" note="Ton beras per bulan">
      <div className="corr">
        {top.map((t) => (
          <div key={t.from.n + t.to.n} className="corr-row" onClick={() => select(t.to.n)}>
            <div>
              <div className="nm">
                {short(t.from.n)} → {short(t.to.n)}
                <small>{nf(t.km)} km</small>
              </div>
              <div className="bar" style={{ width: `${(t.ton / mx) * 100}%`, background: regionOf[t.from.n].color }} />
            </div>
            <div className="v">{nf(t.ton)} t</div>
          </div>
        ))}
      </div>
      <div className="rec">
        <b>{k.n}:</b>{" "}
        {out > 0
          ? `mengirim sekitar ${nf(out)} ton beras per bulan ke ${TRADE.filter((t) => t.from === k).length} wilayah.`
          : inn > 0
            ? `menerima sekitar ${nf(inn)} ton beras per bulan dari ${TRADE.filter((t) => t.to === k).length} wilayah surplus, terbesar dari ${TRADE.find((t) => t.to === k)?.from.n}.`
            : "arus keluar-masuk kecil; produksi dan konsumsi hampir seimbang."}
      </div>
    </Panel>
  )
}
