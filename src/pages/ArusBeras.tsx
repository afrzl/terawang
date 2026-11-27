import { ArrowLeftRight } from "lucide-react"
import { useState } from "react"
import { ChordArus } from "@/components/charts/ChordArus"
import { MapLegend, PetaJatim } from "@/components/charts/PetaJatim"
import { ChordKab } from "@/components/charts/ChordKab"
import { KeluarProvinsi } from "@/components/charts/KeluarProvinsi"
import { MatriksArus } from "@/components/charts/MatriksArus"
import { SankeyArus } from "@/components/charts/SankeyArus"
import { KpiStrip } from "@/components/ui/Kpi"
import { Panel, ViewHeader } from "@/components/ui/Panel"
import { ARUS_DARI_MODEL, KELUAR_PROV, KELUAR_PROV_2025, REGIONS, regionOf, regionStatsFor, tradeFor, matrixOf, type Trade } from "@/lib/arus"
import { byName, type Wilayah } from "@/lib/data"
import { nf, scale, short } from "@/lib/format"
import { bulanLabel, useFilter } from "@/lib/filter"
import { covBulan } from "@/lib/petaLayers"
import { useSelection } from "@/lib/selection"
import { useTooltip } from "@/lib/tooltip"

export default function ArusBeras() {
  return (
    <section className="view">
      <ViewHeader icon={ArrowLeftRight} title="Pola Pasokan Antarwilayah" />
      <Perdagangan />
    </section>
  )
}

const KET_ARUS = "alokasi pasokan beras antarkabupaten dari optimasi jarak jalan atas neraca produksi dan konsumsi; ton per bulan"
const arusTafsir = (xs: Trade[], n = 30) =>
  xs.slice(0, n).map((t) => ({ dari: t.from.n, ke: t.to.n, ton: Math.round(t.ton), km: Math.round(t.km), lintas_kawasan: regionOf[t.from.n] !== regionOf[t.to.n] ? "ya" : "tidak" }))

function Perdagangan() {
  const { lolos, W, akhir } = useFilter()
  const [mode, setMode] = useState<"sankey" | "matriks" | "chord">("sankey")
  const semua = tradeFor(akhir)
  const trade = semua.filter((t) => lolos(t.from) || lolos(t.to))
  const total = trade.reduce((a, t) => a + t.ton, 0) || 1
  const antar = trade.filter((t) => regionOf[t.from.n] !== regionOf[t.to.n]).reduce((a, t) => a + t.ton, 0)
  const kmAvg = trade.reduce((a, t) => a + t.ton * t.km, 0) / total
  // Pemasok dihitung dari arus yang sama dengan peta, supaya tidak bertentangan dengan arus.
  const nPemasok = new Set(trade.map((t) => t.from.n)).size

  return (
    <>
      <KpiStrip
        items={[
          ARUS_DARI_MODEL
            ? { k: "Pasokan ke wilayah defisit", v: `${nf(total / 1000, 1)} rb ton`, t: "rata-rata per bulan, neraca 2025" }
            : { k: "Kebutuhan pasokan antarwilayah", v: `${nf(total / 1000, 1)} rb ton`, t: "per bulan" },
          { k: "Lintas kawasan", v: `${nf((antar / total) * 100, 0)}%`, t: `${nf(antar / 1000, 1)} rb ton` },
          { k: "Wilayah pemasok", v: `${nPemasok} dari ${W.length}`, t: ARUS_DARI_MODEL ? "surplus setahun, memasok dalam alokasi" : "surplus bulan terpilih" },
          ARUS_DARI_MODEL
            ? { k: "Jarak minimum rata-rata", v: `${nf(kmAvg)} km`, t: "per ton, jarak jalan terpendek" }
            : { k: "Jarak rata-rata", v: `${nf(kmAvg)} km`, t: "per ton beras" },
          ...(KELUAR_PROV && KELUAR_PROV[akhir] !== null
            ? [{ k: "Surplus Jawa Timur", v: `${nf((KELUAR_PROV[akhir] ?? 0) / 1000, 1)} rb ton`, t: bulanLabel(akhir) }]
            : []),
        ]}
      />
      <div className="grid-21">
        <Panel
          title="Peta alokasi pasokan"
          className="panel-flex"
          tafsir={`${KET_ARUS}; warna peta = cakupan stok (bulan konsumsi) akhir ${bulanLabel(akhir)}`}
          dataTafsir={{
            arus_terbesar: arusTafsir(trade, 25),
            cakupan_stok_bulan: W.map((k) => ({ wilayah: k.n, cakupan: Math.round(covBulan(k, akhir) * 100) / 100 })),
          }}
        >
          <div className="map">
            <PetaJatim
              layer="stokK2"
              getValue={(k) => covBulan(k, akhir)}
              valueLabel="Cakupan stok"
              muted
              labels={false}
              arcs={trade.slice(0, 25).map((t) => ({ from: t.from.n, to: t.to.n, ton: t.ton, color: regionOf[t.from.n].color }))}
            />
          </div>
          <MapLegend layer="stokK2" title={`Cakupan stok non-Bulog, akhir ${bulanLabel(akhir)}`} />
          <RegionLegend />
        </Panel>
        <Corridors trade={trade} />
      </div>
      {KELUAR_PROV && <KeluarJatimPanel akhir={akhir} />}
      <Panel
        title="Alokasi pasokan antarkabupaten"
        tafsir={`${KET_ARUS}; daftar arus = 40 arus terbesar, total dan persen terhadap total pakai total_semua_arus_ton`}
        dataTafsir={{ total_semua_arus_ton: Math.round(total), lintas_kawasan_ton: Math.round(antar), wilayah_pemasok: nPemasok, arus_terbesar: arusTafsir(trade, 40) }}
        actions={
          <div className="seg seg-s" role="group" aria-label="Tampilan aliran">
            <button type="button" aria-pressed={mode === "sankey"} onClick={() => setMode("sankey")}>
              Sankey
            </button>
            <button type="button" aria-pressed={mode === "matriks"} onClick={() => setMode("matriks")}>
              Matriks
            </button>
            <button type="button" aria-pressed={mode === "chord"} onClick={() => setMode("chord")}>
              Chord
            </button>
          </div>
        }
      >
        {mode === "sankey" ? (
          <>
            <div className="pb chart">
              <SankeyArus trade={semua} />
            </div>
            <RegionLegend />
          </>
        ) : mode === "matriks" ? (
          <MatriksArus trade={trade} />
        ) : (
          <>
            <div className="pb chart" style={{ maxWidth: 760, margin: "0 auto" }}>
              <ChordKab trade={trade} />
            </div>
            <RegionLegend />
          </>
        )}
      </Panel>
      <div className="grid-2">
        <Panel
          title="Alokasi pasokan antarkawasan"
          tafsir={KET_ARUS}
          dataTafsir={{
            antarkawasan_ton: REGIONS.flatMap((a, i) => REGIONS.map((b, j) => ({ dari: a.name, ke: b.name, ton: i === j ? 0 : Math.round(matrixOf(semua)[i][j]) }))).filter((x) => x.ton > 0),
            dalam_kawasan_sendiri_ton: REGIONS.map((a, i) => ({ kawasan: a.name, ton: Math.round(matrixOf(semua)[i][i]) })),
          }}
        >
          <div className="pb chart" style={{ maxWidth: 680, margin: "0 auto" }}>
            <ChordArus matrix={matrixOf(semua)} />
          </div>
        </Panel>
        <Panel
          title={`Neraca kawasan ${bulanLabel(akhir)}`}
          tafsir="produksi dikurangi konsumsi per kawasan, ton per bulan; positif = surplus"
          dataTafsir={regionStatsFor(akhir, semua).map((s) => ({ kawasan: s.r.name, produksi: Math.round(s.prod), konsumsi: Math.round(s.kons), surplus: Math.round(s.prod - s.kons), keluar_kawasan: Math.round(s.keluar), masuk_kawasan: Math.round(s.masuk) }))}
        >
          <div className="pb chart">
            <RegionBalance bulan={akhir} trade={semua} />
          </div>
        </Panel>
      </div>
    </>
  )
}

function KeluarJatimPanel({ akhir }: { akhir: number }) {
  const kp = KELUAR_PROV ?? []
  const tahun26 = kp.slice(0, 12)
  const total26 = tahun26.every((v) => v !== null) ? tahun26.reduce<number>((a, v) => a + (v ?? 0), 0) : null
  const total25 = KELUAR_PROV_2025?.reduce((a, v) => a + v, 0) ?? null
  return (
    <Panel
      title="Surplus beras Jawa Timur"
      note="per bulan"
      tafsir="surplus beras Jawa Timur per bulan sesudah kebutuhan kab/kota defisit di Jatim terpenuhi, ribu ton; batang = 2026 sampai Jan 2027 (Des–Jan prakiraan), garis = 2025"
      dataTafsir={{
        bulanan_ton: kp.map((v, i) => ({ bulan: bulanLabel(i), ton: v })),
        pola_2025_ton: KELUAR_PROV_2025,
        total_2025_ton: total25,
        total_2026_ton: total26,
      }}
    >
      <div className="pb chart">
        <KeluarProvinsi terpilih={akhir} />
        <div className="legend" style={{ padding: "8px 0 0" }}>
          {total25 !== null && (
            <span>
              2025: <b>{nf(total25 / 1e6, 2)} juta ton</b>
            </span>
          )}
          {total26 !== null && (
            <span>
              Jan–Des 2026: <b>{nf(total26 / 1e6, 2)} juta ton</b>
            </span>
          )}
        </div>
      </div>
    </Panel>
  )
}

function Insight({ k, trade, out, inn }: { k: Wilayah; trade: Trade[]; out: number; inn: number }) {
  const peran = out > 0 ? "Pengirim" : inn > 0 ? "Penerima" : "Seimbang"
  const rute = out > 0 ? trade.filter((t) => t.from === k) : trade.filter((t) => t.to === k)
  const utama = rute.slice().sort((a, b) => b.ton - a.ton)[0]
  return (
    <div className="ins">
      <div className="ins-h">
        <b>{k.n}</b>
        <span className={`ins-tag ${peran.toLowerCase()}`}>{peran === "Seimbang" ? "Tanpa kiriman" : peran}</span>
      </div>
      {peran === "Seimbang" ? (
        <p className="ins-t">Tidak memasok atau menerima beras dalam alokasi antarkabupaten.</p>
      ) : (
        <>
          <div className="ins-v">
            {nf(peran === "Pengirim" ? out : inn)} <small>ton per bulan</small>
          </div>
          <p className="ins-t">
            {peran === "Pengirim" ? `Dikirim ke ${rute.length} wilayah` : `Diterima dari ${rute.length} wilayah surplus`}
            {utama && (
              <>
                , terbesar {peran === "Pengirim" ? "ke" : "dari"} <b>{peran === "Pengirim" ? utama.to.n : utama.from.n}</b> ({nf(utama.ton)} ton)
              </>
            )}
          </p>
        </>
      )}
    </div>
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

function RegionBalance({ bulan, trade }: { bulan: number; trade: Trade[] }) {
  const { show, hide } = useTooltip()
  const st = regionStatsFor(bulan, trade)
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

function Corridors({ trade }: { trade: Trade[] }) {
  const { sel, select } = useSelection()
  const k = byName[sel]
  const top = trade.slice(0, 10)
  const mx = top[0]?.ton ?? 1
  const out = trade.filter((t) => t.from.n === k.n).reduce((a, t) => a + t.ton, 0)
  const inn = trade.filter((t) => t.to.n === k.n).reduce((a, t) => a + t.ton, 0)
  return (
    <Panel title="Pasangan pemasok–penerima terbesar" tafsir={KET_ARUS} dataTafsir={{ pasangan: arusTafsir(top, 10) }}>
      <div className="corr">
        {top.map((t) => (
          <div key={t.from.n + t.to.n} className="corr-row" onClick={() => select(t.to.n)}>
            <div>
              <div className="nm">
                <span className="rt">
                  <b>{short(t.from.n)}</b>
                  <em>ke</em>
                  <b>{short(t.to.n)}</b>
                </span>
                <small>{nf(t.km)} km</small>
              </div>
              <div className="bar" style={{ width: `${(t.ton / mx) * 100}%`, background: regionOf[t.from.n].color }} />
            </div>
            <div className="v">{nf(t.ton)} ton</div>
          </div>
        ))}
      </div>
      <Insight k={k} trade={trade} out={out} inn={inn} />
    </Panel>
  )
}
