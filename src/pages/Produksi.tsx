import { DERET } from "@/lib/api"
import { useMemo, useState } from "react"
import { Sprout } from "lucide-react"
import { LineChart } from "@/components/charts/LineChart"
import { ProdTreemap } from "@/components/charts/ProdTreemap"
import { SatCompare, useCitraIndeks } from "@/components/charts/SatCompare"
import { KpiStrip } from "@/components/ui/Kpi"
import { Panel, ViewHeader } from "@/components/ui/Panel"
import { PHASES, byName, type Wilayah } from "@/lib/data"
import { dfmt, hash, nf, rng, scale, short, sum, ticks } from "@/lib/format"
import { useSelection } from "@/lib/selection"
import { useTooltip } from "@/lib/tooltip"
import { BULAN_NAMA, N_BULAN, SATUAN, bulanLabel, useFilter, useWilayah } from "@/lib/filter"
import { KpiPerWilayah, LegendaWilayah, usePerWilayah } from "@/lib/perWilayah"
import { bul, useDataTafsir } from "@/lib/tafsir"
import { PRODUKTIVITAS, luasPanen, produksiBatas, produksiPrevRentang, produksiRentang, yoyRentang } from "@/lib/petaLayers"

const STEPS = ["--s1", "--s2", "--s3", "--s4", "--s5"]
const PHASE_COLORS = ["--s0", "--s1", "--s2", "--s4", "--s5"]
const ROW_H = 22
const MT = 8

export default function Produksi() {
  const wil = useWilayah()
  const indeks = useCitraIndeks()
  const [cw, setCw] = useState<string | null>(null)
  // Wilayah panel citra mengikuti filter sidebar. Bila banyak, dipilih yang sudah paling banyak tertanam; pintasan di panel bisa menggantinya.
  const nama = wil.map((k) => k.n)
  const tertanam = (n: string) => indeks.find((m) => m.lokasi === n)?.stat.tertanam_sesudah_pct ?? -1
  const citraWil = cw && nama.includes(cw) ? cw : [...nama].sort((a, b) => tertanam(b) - tertanam(a))[0]
  const { mulai, akhir, satuan } = useFilter()
  const sat = SATUAN[satuan]
  const berasT = sum(wil, (k) => produksiRentang(k, mulai, akhir)) / 1000 // ribu ton beras
  const prodT = berasT * sat.f // ribu ton, satuan terpilih
  const prevT = (sum(wil, (k) => produksiPrevRentang(k, mulai, akhir)) / 1000) * sat.f
  const luasRb = (berasT * 1000) / PRODUKTIVITAS / 1000 // ribu ha
  const turun = wil.filter((k) => yoyRentang(k, mulai, akhir) < 0).length
  const yoy = prevT ? (prodT / prevT - 1) * 100 : 0
  const { pisah, warna, wil: wilP } = usePerWilayah()
  const prodWil = (k: Wilayah) => {
    const v = (produksiRentang(k, mulai, akhir) / 1000) * sat.f
    const y = yoyRentang(k, mulai, akhir) * 100
    return (
      <>
        {v >= 1000 ? `${nf(v / 1000, 2)} jt` : `${nf(v, 0)} rb`} <small className={y < 0 ? "delta-dn" : "delta-up"}>{nf(y, 1)}%</small>
      </>
    )
  }

  return (
    <section className="view">
      <ViewHeader icon={Sprout} title="Produksi" />
      <KpiStrip
        items={[
          pisah
            ? { k: satuan === "gkg" ? "Produksi padi (GKG), ton" : "Produksi beras, ton", v: <KpiPerWilayah wil={wilP} warna={warna} nilai={prodWil} />, t: "per wilayah, % = YoY" }
            : {
            k: satuan === "gkg" ? "Produksi padi (GKG)" : "Produksi beras",
            v: prodT >= 1000 ? `${nf(prodT / 1000, 2)} jt ton` : `${nf(prodT, 0)} rb ton`,
            t: (
              <>
                <span className={yoy < 0 ? "delta-dn" : "delta-up"}>{nf(yoy, 1)}%</span> YoY
              </>
            ),
          },
          { k: "Luas panen", v: luasRb >= 1000 ? `${nf(luasRb / 1000, 2)} jt ha` : `${nf(luasRb, 0)} rb ha`, t: `${nf(PRODUKTIVITAS * sat.f, 1)} ton ${sat.lab}/ha` },
          { k: "Galat prakiraan", v: "±14%", t: "3 bulan ke depan per kabupaten · ±29% per bulan" },
          { k: "Wilayah YoY turun", v: `${turun} dari ${wil.length}`, t: "produksi di bawah periode sama 2025" },
        ]}
      />
      <div className="grid-2">
        <Panel title="Sumbangan tiap wilayah">
          <div className="pb chart">
            <ProdTreemap />
          </div>
        </Panel>
        <Panel title="Produksi per wilayah">
          <div className="pb chart">
            <EstimateBars />
          </div>
        </Panel>
      </div>
      <div className="grid-21">
        <Panel title="Kalender panen">
          <div className="pb chart">
            <HarvestCalendar />
          </div>
        </Panel>
        <Panel title="Fase tumbuh per wilayah">
          <div className="pb chart">
            <PhaseBars />
          </div>
        </Panel>
      </div>
      <h2 className="sub-h">
        Citra pendukung <span>Sentinel-1/2</span>
      </h2>
      <div className="grid-2">
        <SatPanel wilayah={citraWil} onPilih={setCw} kandidat={nama} />
        {pisah ? <ProfilSatelitWil /> : <ProfilSatelit wilayah={citraWil} />}
      </div>
    </section>
  )
}

function SatPanel({ wilayah, onPilih, kandidat }: { wilayah?: string; onPilih: (n: string) => void; kandidat: string[] }) {
  if (!wilayah) return <Panel title="Sebelum dan sesudah tanam"><div className="pb"><div className="method">Tidak ada wilayah dipilih.</div></div></Panel>
  return (
    <Panel title={`Sebelum dan sesudah tanam · ${wilayah}`}>
      <div className="pb">
        <SatCompare wilayah={wilayah} onPilih={onPilih} kandidat={kandidat} />
      </div>
    </Panel>
  )
}

function HarvestCalendar() {
  const { sel, select } = useSelection()
  const { show, hide } = useTooltip()
  const wil = useWilayah()
  const { mulai, akhir } = useFilter()
  const top = wil
    .filter((k) => !k.isKota)
    .sort((a, b) => b.est - a.est)
    .slice(0, 14)
  const bulan = [...Array(N_BULAN)].map((_, i) => i)
  const cal = top.map((k) => bulan.map((i) => luasPanen(k, i) / 1000))
  const W = 720
  const rowH = 21
  const m = { l: 96, t: 22, r: 8 }
  const H = m.t + top.length * rowH + 8
  const cw = (W - m.l - m.r) / N_BULAN
  const mx = Math.max(1e-6, ...cal.flat())
  useDataTafsir("kalender", {
    satuan: "ribu ha luas panen per bulan",
    bulan_disorot: bulan.filter((i) => i >= mulai && i <= akhir).map(bulanLabel),
    wilayah: top.map((k, r) => ({ wilayah: k.n, ...Object.fromEntries(bulan.map((i) => [bulanLabel(i), bul(cal[r][i], 2)])) })),
  })

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Kalender panen per bulan">
        {bulan.map((i) => (
          <text key={i} x={m.l + i * cw + cw / 2} y={14} textAnchor="middle" className={i >= mulai && i <= akhir ? "lab-b" : undefined}>
            {i === 12 ? "Jan 27" : BULAN_NAMA[i % 12]}
          </text>
        ))}
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
                        {bulanLabel(i)}
                        <br />
                        Luas panen <span className="m">{nf(v * 1000)} ha</span>
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
        <rect x={m.l + mulai * cw} y={m.t - 2} width={(akhir - mulai + 1) * cw} height={top.length * rowH + 4} fill="none" stroke="var(--accent)" strokeWidth={1.5} pointerEvents="none" />
      </svg>
      <div className="legend" style={{ padding: "8px 0 0" }}>
        <span className="ttl">Luas panen per bulan</span>
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

type Sinyal = "evi" | "lswi" | "vh"
const SINYAL: [Sinyal, string][] = [
  ["evi", "EVI"],
  ["lswi", "LSWI"],
  ["vh", "VH"],
]
const NPOS = 15
const KET_SINYAL: Record<Sinyal, string> = {
  evi: "EVI = indeks kehijauan tanaman dari Sentinel-2 (tanpa satuan, naik saat padi tumbuh), median titik sawah per akuisisi",
  lswi: "LSWI = indeks kebasahan permukaan dari Sentinel-2 (tanpa satuan, naik saat sawah digenangi untuk tanam)",
  vh: "VH = hamburan balik radar Sentinel-1 dalam dB (rendah saat sawah tergenang, naik saat tanaman tumbuh)",
}

/** Cadangan bila /api/deret tidak ada. DUMMY: deret EVI dan LSWI per 12 hari (Jun–Nov). Bentuknya mengikuti metodologi: LSWI naik saat sawah digenangi, lalu EVI naik setelah tanam. Ganti dengan s2_titik_12harian_kabkota. */
function deretSpektral(k: Wilayah) {
  const R = rng(hash(k.n + "spektral"))
  const berdiri = (k.ph[2] + k.ph[3]) / 100
  const t0 = 9.5 + (1 - berdiri) * 5 + R() * 0.8
  const bentuk = (t0x: number) => {
    const evi: number[] = []
    const lswi: number[] = []
    for (let i = 0; i < NPOS; i++) {
      const naik = 1 / (1 + Math.exp(-(i - t0x - 1.5) / 1.3))
      const air = Math.exp(-Math.pow((i - t0x + 0.5) / 1.4, 2))
      evi.push(0.2 + 0.42 * naik + (R() - 0.5) * 0.02)
      lswi.push(0.08 + 0.3 * air + 0.1 * naik + (R() - 0.5) * 0.02)
    }
    return { evi, lswi }
  }
  return { ini: bentuk(t0), rata: bentuk(t0 - 1 + R() * 0.8) }
}

/** Deret sinyal satu wilayah: dari pipeline bila ada, selain itu VH olahan citra + EVI/LSWI ilustrasi. */
function deretWilayah(k: Wilayah, sin: Sinyal) {
  const dr = DERET?.wilayah[k.n]
  const N = DERET ? DERET.tanggal.length : NPOS
  const trim = (xs: (number | null)[]) => {
    const out = xs.slice(0, N)
    while (out.length && out[out.length - 1] == null) out.pop()
    return out
  }
  if (dr) return { cur: dr[sin] as (number | null)[], avg: dr[`${sin}Avg`] as (number | null)[] }
  const sp = deretSpektral(k)
  const sampai = trim(k.vh).length
  return sin === "vh" ? { cur: trim(k.vh), avg: trim(k.vhAvg) } : { cur: sp.ini[sin].slice(0, sampai), avg: sp.rata[sin].slice(0, sampai) }
}

/** Profil sinyal satelit, satu garis "musim ini" per wilayah terpilih. Rata-rata riwayat (putus-putus) hanya ditampilkan bila paling banyak 3 wilayah. */
function ProfilSatelitWil() {
  const { wil, warna } = usePerWilayah()
  const [sin, setSin] = useState<Sinyal>("evi")
  const N = DERET ? DERET.tanggal.length : NPOS
  const dates = DERET ? DERET.tanggal.map((t) => new Date(t + "T00:00:00")) : [...Array(N)].map((_, i) => new Date(2026, 5, 1 + i * 12))
  const denganRata = wil.length <= 3
  const data = wil.map((k) => ({ k, ...deretWilayah(k, sin) }))
  const vals = data.flatMap((d) => [...d.cur, ...(denganRata ? d.avg : [])]).filter((v): v is number => v != null)
  const desimal = sin === "vh" ? 1 : 2
  const satuan = sin === "vh" ? " dB" : ""
  const lo = sin === "vh" ? Math.floor(Math.min(...vals) - 0.5) : Math.max(0, Math.floor((Math.min(...vals) - 0.03) * 10) / 10)
  const hi = sin === "vh" ? Math.ceil(Math.max(...vals) + 0.5) : Math.ceil((Math.max(...vals) + 0.03) * 10) / 10
  const fmt = (v: number | null | undefined) => (v == null ? "belum ada citra" : `${nf(v, desimal)}${satuan}`)
  return (
    <Panel title="Profil sinyal satelit per wilayah" tafsir={KET_SINYAL[sin]}>
      <div className="pb chart">
        <div className="seg" style={{ marginBottom: 8 }} role="group" aria-label="Jenis sinyal">
          {SINYAL.map(([v, t]) => (
            <button key={v} type="button" aria-pressed={sin === v} onClick={() => setSin(v)}>
              {t}
            </button>
          ))}
        </div>
        {vals.length ? (
          <LineChart
            xDates={dates.slice(0, Math.max(...data.map((d) => Math.max(d.cur.length, denganRata ? d.avg.length : 0)), 1))}
            yDom={[lo, hi]}
            yFmt={(v) => nf(v, sin === "vh" ? (Number.isInteger(v) ? 0 : 1) : 2)}
            W={480}
            H={250}
            sebarLabel
            series={data.flatMap((d) => [
              ...(denganRata ? [{ vals: d.avg, color: warna(d.k), dash: "3 3", w: 1.2, nama: `${d.k.n} rata-rata riwayat` }] : []),
              { vals: d.cur, color: warna(d.k), w: 2.2, label: short(d.k.n), nama: `${d.k.n} musim ini` },
            ])}
            tip={(i) => (
              <>
                <b>
                  {dfmt(dates[i])} {dates[i].getFullYear()}
                </b>
                {data.map((d) => (
                  <span key={d.k.n}>
                    <br />
                    <span className="sw-dot" style={{ background: warna(d.k) }} />
                    {d.k.n} <span className="m">{fmt(d.cur[i])}</span>
                    {denganRata && (
                      <>
                        , rata-rata <span className="m">{fmt(d.avg[i])}</span>
                      </>
                    )}
                  </span>
                ))}
              </>
            )}
          />
        ) : (
          <div className="method">Belum ada deret satelit untuk wilayah ini.</div>
        )}
        <LegendaWilayah wil={wil} warna={warna} extra={<span>{denganRata ? "garis tegas = musim ini, putus-putus = rata-rata riwayat" : "musim ini"}</span>} />
      </div>
    </Panel>
  )
}

function ProfilSatelit({ wilayah }: { wilayah?: string }) {
  if (!wilayah) return <Panel title="Profil sinyal satelit"><div className="pb"><div className="method">Tidak ada wilayah dipilih.</div></div></Panel>
  return <ProfilIsi wilayah={wilayah} />
}

function ProfilIsi({ wilayah }: { wilayah: string }) {
  const k = byName[wilayah]
  const [sin, setSin] = useState<Sinyal>("evi")
  // Deret dari pipeline (median titik sawah, 15 akuisisi terakhir) bila ada; selain itu VH dari olahan citra + EVI/LSWI ilustrasi.
  const dr = DERET?.wilayah[k.n]
  const N = dr ? DERET!.tanggal.length : NPOS
  const dates = dr ? DERET!.tanggal.map((t) => new Date(t + "T00:00:00")) : [...Array(N)].map((_, i) => new Date(2026, 5, 1 + i * 12))
  const trim = (xs: (number | null)[]) => {
    const out = xs.slice(0, N)
    while (out.length && out[out.length - 1] == null) out.pop()
    return out
  }
  const sp = useMemo(() => deretSpektral(k), [k])
  const sampai = trim(k.vh).length
  const cur: (number | null)[] = dr ? dr[sin] : sin === "vh" ? trim(k.vh) : sp.ini[sin].slice(0, sampai)
  const avg: (number | null)[] = dr ? dr[`${sin}Avg`] : sin === "vh" ? trim(k.vhAvg) : sp.rata[sin].slice(0, sampai)
  const vals = [...cur, ...avg].filter((v): v is number => v != null)
  const desimal = sin === "vh" ? 1 : 2
  const lo = sin === "vh" ? Math.floor(Math.min(...vals) - 0.5) : Math.max(0, Math.floor((Math.min(...vals) - 0.03) * 10) / 10)
  const hi = sin === "vh" ? Math.ceil(Math.max(...vals) + 0.5) : Math.ceil((Math.max(...vals) + 0.03) * 10) / 10
  const satuan = sin === "vh" ? " dB" : ""
  const lastCur = cur[cur.length - 1] ?? 0
  const lastAvg = avg[avg.length - 1] ?? 0
  const avgAbove = lastAvg > lastCur
  const fmt = (v: number | null | undefined) => (v == null ? "belum ada citra" : `${nf(v, desimal)}${satuan}`)

  return (
    <Panel title={`Profil sinyal satelit · ${k.n}`} tafsir={KET_SINYAL[sin]}>
      <div className="pb chart">
        <div className="seg" style={{ marginBottom: 8 }} role="group" aria-label="Jenis sinyal">
          {SINYAL.map(([v, t]) => (
            <button key={v} type="button" aria-pressed={sin === v} onClick={() => setSin(v)}>
              {t}
            </button>
          ))}
        </div>
        {vals.length ? (
          <LineChart
            xDates={dates}
            yDom={[lo, hi]}
            yFmt={(v) => nf(v, sin === "vh" ? (Number.isInteger(v) ? 0 : 1) : 2)}
            W={480}
            H={250}
            series={[
              { vals: avg, color: "var(--ink-3)", dash: "4 3", label: "rata-rata riwayat", ly: avgAbove ? -4 : 12 },
              { vals: cur, color: "var(--s4)", w: 2.4, label: "musim ini", ly: avgAbove ? 12 : -4 },
            ]}
            tip={(i) => (
              <>
                <b>{dfmt(dates[i])} {dates[i].getFullYear()}</b>
                <br />
                Musim ini <span className="m">{fmt(cur[i])}</span>
                <br />
                Rata-rata riwayat <span className="m">{fmt(avg[i])}</span>
              </>
            )}
          />
        ) : (
          <div className="method">Belum ada deret satelit untuk wilayah ini.</div>
        )}
      </div>
    </Panel>
  )
}

function EstimateBars() {
  const wil = useWilayah().map((k) => k)
  const { mulai, akhir, satuan } = useFilter()
  const sat = SATUAN[satuan]
  const { sel, select } = useSelection()
  const { show, hide } = useTooltip()
  const f = sat.f / 1000 // ton beras -> ribu ton satuan terpilih
  const est = wil.filter((k) => !k.isKota)
    .map((k) => {
      const b = produksiBatas(k, mulai, akhir)
      return { n: k.n, est: produksiRentang(k, mulai, akhir) * f, lo: b.lo * f, hi: b.hi * f, prev: produksiPrevRentang(k, mulai, akhir) * f }
    })
    .sort((a, b) => b.est - a.est)
    .slice(0, 16)
  useDataTafsir("estimasi", {
    satuan: `ribu ton ${sat.lab}`,
    keterangan: "proyeksi model K1 dengan selang 90%, dibanding periode sama 2025 (BPS)",
    wilayah: est.map((k) => ({ wilayah: k.n, proyeksi: bul(k.est, 1), selang_bawah: bul(k.lo, 1), selang_atas: bul(k.hi, 1), periode_sama_2025: bul(k.prev, 1) })),
  })
  const W = 560
  const ml = 96
  const mr = 46
  const H = MT + est.length * ROW_H + 24
  const xm = Math.max(...est.map((k) => Math.max(k.hi, k.prev))) * 1.05 || 1
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
        const lo = xs(k.lo)
        const hi = xs(k.hi)
        return (
          <g
            key={k.n}
            style={{ cursor: "pointer" }}
            onMouseMove={(e) =>
              show(
                <>
                  <b>{k.n}</b>
                  <br />
                  Proyeksi <span className="m">{nf(k.est, 1)} rb ton {sat.lab}</span>
                  <br />
                  Selang 90%{" "}
                  <span className="m">
                    {nf(k.lo, 1)}–{nf(k.hi, 1)}
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
            <text x={xs(Math.max(k.hi, k.prev)) + 8} y={y + 4}>
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
  useDataTafsir("fase", {
    satuan: "persen luas sawah per fase tumbuh (citra satelit terbaru)",
    wilayah: ps.map((k) => ({ wilayah: k.n, ...Object.fromEntries(PHASES.map((n, j) => [n, bul(k.ph[j], 0)])) })),
  })
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
