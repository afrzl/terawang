import { K3A } from "@/lib/api"
import { TrendingUp } from "lucide-react"
import { useState } from "react"
import { LineChart } from "@/components/charts/LineChart"
import { MapLegend, PetaJatim } from "@/components/charts/PetaJatim"
import { PriceHeatmap } from "@/components/charts/PriceHeatmap"
import { PriceRidgeline } from "@/components/charts/PriceRidgeline"
import { DataTable, type Column } from "@/components/ui/DataTable"
import { KpiStrip } from "@/components/ui/Kpi"
import { Panel, ViewHeader } from "@/components/ui/Panel"
import { HET, HET_PREMIUM, HIST, SIAGA_KALI, STATUS, WILAYAH, fcDates, fcHarga, flowsBulan, histDates, pNowHarga, peluangDi, seriHarga, statusDari, type Flow } from "@/lib/data"
import { dfmt, nf, rp, sum } from "@/lib/format"
import { bulanLabel, useFilter, useWilayah } from "@/lib/filter"
import { covBulan, statusHargaAt, type Komoditas } from "@/lib/petaLayers"
import { useSesi } from "@/lib/sesi"
import { Terkunci } from "@/components/ui/Terkunci"


const flowColumns: Column<Flow>[] = [
  { head: "Bulan", cell: (f) => bulanLabel(f.bulan), sort: (f) => f.bulan },
  { head: "Tujuan", cell: (f) => <b>{f.to.n}</b>, sort: (f) => f.to.n },
  { head: "Asal (cabang Bulog)", cell: (f) => f.from.n, sort: (f) => f.from.n },
  { head: "Volume", right: true, num: true, cell: (f) => `${nf(f.ton)} ton`, sort: (f) => f.ton },
  { head: "Jarak tempuh", right: true, num: true, cell: (f) => (f.km ? `${nf(f.km)} km` : "lokal"), sort: (f) => f.km },
]

/** Kartu hasil uji K3a: AUC peluang melewati HET pada backtest (kab yang saat itu masih di bawah HET), beras medium 28 hari; dari parameter model_run. */
function ujiHet() {
  const kal = K3A?.meta.kalibrasi?.medium
  const auc = (h: number) => kal?.[String(h)]?.auc
  const a28 = auc(28)
  if (a28 == null) return { k: "Uji peluang melewati HET", v: "–", t: "hasil uji K3a belum tersedia" }
  const lain = [7, 14, 21].map(auc).filter((v): v is number => v != null)
  const k28 = kal?.["28"]
  return {
    k: "Uji peluang melewati HET",
    v: `AUC ${nf(a28, 2)}`,
    t: `medium 28 hari${lain.length ? ` (7–21 hari ${nf(Math.min(...lain), 2)}–${nf(Math.max(...lain), 2)})` : ""}${k28 ? `, terdeteksi ${k28.terdeteksi}/${k28.kejadian}` : ""}`,
  }
}

export default function Harga() {
  const wil = useWilayah()
  const { mulai, akhir, jenisHarga } = useFilter()
  const flows = flowsBulan(mulai, akhir).filter((f) => wil.includes(f.to))
  const jenis = jenisHarga
  const sphp = useSesi().boleh("dasbor_sphp")
  const ganda = jenis.length > 1
  const popT = sum(wil, (k) => k.pop) || 1
  const ringkas = (kom: Komoditas) => ({
    kom,
    rata: sum(wil, (k) => pNowHarga(k, kom) * k.pop) / popT,
    nS: wil.filter((k) => statusHargaAt(k, 4, kom) === "siaga").length,
    nW: wil.filter((k) => statusHargaAt(k, 4, kom) === "waspada").length,
  })
  const rk = jenis.map(ringkas)
  const periode = mulai === akhir ? bulanLabel(mulai) : `${bulanLabel(mulai)} sampai ${bulanLabel(akhir)}`
  // Satu jenis: dua kotak biasa. Dua jenis: tiap kotak menumpuk nilai medium dan premium, supaya kotak tidak berulang.
  const baris = (f: (r: (typeof rk)[number]) => React.ReactNode) => (
    <div className="kv2">
      {rk.map((r) => (
        <div key={r.kom}>
          <span className="kv2-n">
            <i style={{ background: WARNA_JENIS[r.kom] }} />
            {r.kom}
          </span>
          <b>{f(r)}</b>
        </div>
      ))}
    </div>
  )
  const kpiHarga = ganda
    ? [
        { k: "Harga rata-rata Jatim", v: baris((r) => rp(r.rata)), t: "menurut jumlah penduduk" },
        { k: "Wilayah Siaga / Waspada", v: baris((r) => `${r.nS} / ${r.nW}`), t: "estimasi 4 pekan" },
      ]
    : [
        { k: `Rata-rata ${rk[0].kom} Jatim`, v: rp(rk[0].rata), t: "menurut jumlah penduduk" },
        { k: "Wilayah Siaga / Waspada", v: `${rk[0].nS} / ${rk[0].nW}`, t: "estimasi 4 pekan" },
      ]

  return (
    <section className="view">
      <ViewHeader icon={TrendingUp} title="Harga & SPHP" />
      <KpiStrip
        items={[
          ...kpiHarga,
          sphp
            ? { k: "Rekomendasi SPHP", v: `${nf(sum(flows, (f) => f.ton))} ton`, t: `${flows.length} rute, ${periode}` }
            : { k: "Rekomendasi SPHP", v: "Terbatas", t: "untuk akun dinas dan perusahaan" },
          ujiHet(),
        ]}
      />
      <div className="grid-2">
        <PricePanel jenis={jenis} />
        <Panel title="Sebaran harga 38 wilayah per pekan">
          <div className="pb chart ridge-wrap">
            <PriceRidgeline jenis={jenis} />
          </div>
          {ganda && <LegendaJenis />}
        </Panel>
      </div>
      <div className="grid-2">
        <Panel title="Peta rekomendasi SPHP">
          <Terkunci judul="Rekomendasi penyaluran SPHP">
          <div className="map">
            <PetaJatim layer="stokK2" getValue={(k) => covBulan(k, akhir)} valueLabel="Cakupan stok" flows flowList={flows} muted labels={false} />
          </div>
          <MapLegend
            layer="stokK2"
            title={`Cakupan stok non-Bulog, akhir ${bulanLabel(akhir)}`}
            extra={
              <>
                <span>
                  <svg width="22" height="10" style={{ verticalAlign: -1, marginRight: 5 }}>
                    <line x1="1" y1="5" x2="20" y2="5" stroke="var(--accent)" strokeWidth="2.5" />
                  </svg>
                  rute antar kabupaten, tebal = volume
                </span>
                <span>
                  <svg width="16" height="16" style={{ verticalAlign: -4, marginRight: 5 }}>
                    <circle cx="8" cy="8" r="6.5" fill="var(--panel)" fillOpacity="0.5" stroke="var(--accent)" strokeWidth="2.6" />
                  </svg>
                  kiriman ke wilayah sendiri (cabang di wilayah itu), besar = volume
                </span>
                <span>
                  <svg width="18" height="18" viewBox="0 0 18 18" style={{ verticalAlign: -5, marginRight: 5 }}>
                    <circle cx="9" cy="9" r="8" fill="var(--accent)" stroke="#fff" strokeWidth="1" />
                    <g transform="translate(4.5,4.5) scale(0.375)" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z" />
                      <path d="M6 18h12" />
                      <path d="M6 14h12" />
                      <rect width="12" height="12" x="6" y="10" />
                    </g>
                  </svg>
                  cabang Bulog
                </span>
              </>
            }
          />
          </Terkunci>
        </Panel>
        <Panel title="Rute rekomendasi SPHP">
          <Terkunci judul="Rute rekomendasi SPHP">
          <DataTable rows={flows} columns={flowColumns} rowKey={(f, i) => `${f.bulan}-${f.to.n}-${f.from.n}-${i}`} rowName={(f) => f.to.n} pageSize={10} />
          </Terkunci>
        </Panel>
      </div>
      <PanelPeta jenis={jenis} />
    </section>
  )
}

const WARNA_JENIS: Record<Komoditas, string> = { medium: "var(--accent)", premium: "var(--warn)" }

function LegendaJenis() {
  return (
    <div className="legend" style={{ padding: "0 16px 12px" }}>
      {(["medium", "premium"] as const).map((j) => (
        <span key={j} style={{ textTransform: "capitalize" }}>
          <span className="sw" style={{ background: WARNA_JENIS[j] }} />
          {j}
        </span>
      ))}
    </div>
  )
}

/** Peta panas harga: satu jenis langsung ditampilkan; bila dua jenis dipilih, pilihan jenis ada di panel. */
function PanelPeta({ jenis }: { jenis: Komoditas[] }) {
  const [pilih, setPilih] = useState<Komoditas>("medium")
  const aktif = jenis.length > 1 ? (jenis.includes(pilih) ? pilih : jenis[0]) : jenis[0]
  return (
    <Panel
      title="Peta panas harga 38 wilayah"
      actions={
        jenis.length > 1 ? (
          <div className="seg seg-s" role="group" aria-label="Jenis beras pada peta panas">
            {jenis.map((j) => (
              <button key={j} type="button" aria-pressed={aktif === j} onClick={() => setPilih(j)} style={{ textTransform: "capitalize" }}>
                {j}
              </button>
            ))}
          </div>
        ) : undefined
      }
    >
      <div className="pb chart">
        <PriceHeatmap kom={aktif} />
      </div>
    </Panel>
  )
}

function PricePanel({ jenis }: { jenis: Komoditas[] }) {
  const wil = useWilayah()
  const ganda = jenis.length > 1
  const dates = histDates.concat(fcDates)
  // Seri harga mengikuti filter wilayah di sidebar: rata-rata menurut jumlah penduduk wilayah yang dipilih.
  // Premium: selisih terhadap medium dianggap tetap (data simulasi belum punya seri premium).
  const popT = sum(wil, (q) => q.pop) || 1
  const rata = (f: (q: (typeof wil)[number]) => number) => sum(wil, (q) => f(q) * q.pop) / popT
  const popAll = sum(WILAYAH, (q) => q.pop)
  const sebagian = wil.length < WILAYAH.length
  const data = jenis.map((kom) => {
    const het = kom === "premium" ? HET_PREMIUM : HET
    const harga = histDates.map((_, i) => rata((q) => seriHarga(q, kom)[i]))
    const fcM = fcDates.map((_, h) => rata((q) => fcHarga(q, kom)[h].m))
    const fcLo = fcDates.map((_, h) => rata((q) => fcHarga(q, kom)[h].lo))
    const fcHi = fcDates.map((_, h) => rata((q) => fcHarga(q, kom)[h].hi))
    const prov = histDates.map((_, i) => sum(WILAYAH, (q) => seriHarga(q, kom)[i] * q.pop) / popAll)
    const status = statusDari(fcM[3], fcHi[3], het, 4, kom)
    return { kom, het, siaga: Math.round(het * SIAGA_KALI), harga, fcM, fcLo, fcHi, prov, status, pNow: harga[HIST - 1] }
  })
  const lo = Math.min(...data.flatMap((d) => [...d.harga, ...d.fcLo, d.het])) - 150
  const hi = Math.max(...data.flatMap((d) => [...d.fcHi, ...(ganda ? [d.het] : [d.siaga])])) + 120
  // Label ujung garis dan label HET dijauhkan satu sama lain bila nilainya berdekatan.
  const dekat = (d: (typeof data)[number], v: number) => Math.abs(d.fcM[3] - v) < 120
  const warna = (d: (typeof data)[number]) => (ganda ? WARNA_JENIS[d.kom] : STATUS[d.status].c)
  const garisHarga = (d: (typeof data)[number]) => (ganda ? WARNA_JENIS[d.kom] : "var(--ink)")
  const d0 = data[0]

  return (
    <Panel title={ganda ? "Harga beras" : `Harga beras ${d0.kom}`}>
      <div className="pb chart">
        <LineChart
          xDates={dates}
          yDom={[Math.floor(lo / 100) * 100, Math.ceil(hi / 100) * 100]}
          yFmt={(v) => nf(v)}
          W={760}
          H={420}
          splitAt={HIST - 1}
          bands={data.map((d) => ({
            lo: [d.pNow].concat(d.fcLo),
            hi: [d.pNow].concat(d.fcHi),
            off: HIST - 1,
            color: warna(d),
            op: ganda ? 0.12 : 0.16,
          }))}
          refs={data.flatMap((d) => [
            { v: d.het, label: `HET ${nf(d.het)}`, color: ganda ? WARNA_JENIS[d.kom] : "var(--ink-2)", dy: dekat(d, d.het) ? (d.fcM[3] >= d.het ? 16 : -7) : 4 },
            ...(ganda ? [] : [{ v: d.siaga, label: "HET +5%", color: "var(--crit)", dy: dekat(d, d.siaga) ? (d.fcM[3] >= d.siaga ? 16 : -7) : 4 }]),
          ])}
          series={data.flatMap((d) => [
            ...(sebagian && !ganda ? [{ vals: d.prov, color: "var(--ink-3)", w: 1.5, label: "rata-rata Jatim", ly: d.pNow > d.prov[HIST - 1] ? 14 : -6 }] : []),
            { vals: d.harga, color: garisHarga(d), w: 2.2 },
            {
              vals: [d.pNow].concat(d.fcM),
              off: HIST - 1,
              color: warna(d),
              dash: "5 4",
              w: 2.2,
              label: rp(d.fcM[3]),
              ly: dekat(d, d.het) ? (d.fcM[3] >= d.het ? -9 : 20) : !ganda && dekat(d, d.siaga) ? (d.fcM[3] >= d.siaga ? -9 : 20) : 4,
            },
          ])}
          tip={(i) => (
            <>
              <b>
                {dfmt(dates[i])} {dates[i].getFullYear()}{i >= HIST ? ", prakiraan" : ""}
              </b>
              {data.map((d) => (
                <span key={d.kom}>
                  <br />
                  {ganda && <b style={{ textTransform: "capitalize" }}>{d.kom}: </b>}
                  {i >= HIST ? (
                    <>
                      <span className="m">{rp(d.fcM[i - HIST])}</span>, P10 sampai P90{" "}
                      <span className="m">
                        {rp(d.fcLo[i - HIST])}–{rp(d.fcHi[i - HIST])}
                      </span>
                      , peluang di atas HET <span className="m">{nf(peluangDi(d.fcM[i - HIST], d.fcHi[i - HIST], d.het) * 100, 0)}%</span>
                    </>
                  ) : (
                    <>
                      <span className="m">{rp(d.harga[i])}</span>
                      {sebagian && !ganda && (
                        <>
                          , rata-rata Jatim <span className="m">{rp(d.prov[i])}</span>
                        </>
                      )}
                    </>
                  )}
                </span>
              ))}
            </>
          )}
        />
      </div>
      {ganda && <LegendaJenis />}
    </Panel>
  )
}
