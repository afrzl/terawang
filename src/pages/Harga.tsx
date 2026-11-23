import { LineChart } from "@/components/charts/LineChart"
import { MapLegend, PetaJatim } from "@/components/charts/PetaJatim"
import { PriceHeatmap } from "@/components/charts/PriceHeatmap"
import { PriceRidgeline } from "@/components/charts/PriceRidgeline"
import { Bacaan } from "@/components/ui/Bacaan"
import { DataTable, type Column } from "@/components/ui/DataTable"
import { KpiStrip } from "@/components/ui/Kpi"
import { Panel, ViewHeader } from "@/components/ui/Panel"
import { HargaPill, StokPill } from "@/components/ui/Pill"
import { bacaHarga, bacaHeatmap, bacaRidgeline, bacaSphp } from "@/lib/bacaan"
import { FLOWS, HET, HIST, SIAGA, STATUS, WILAYAH, byName, fcDates, histDates, type Flow } from "@/lib/data"
import { dfmt, nf, rp, sum } from "@/lib/format"
import { useSelection } from "@/lib/selection"
import { useSesi } from "@/lib/sesi"
import { Terkunci } from "@/components/ui/Terkunci"

const HS: Record<string, number> = { aman: 0, waspada: 1, siaga: 2 }
const SS: Record<string, number> = { cukup: 0, tipis: 1, defisit: 2 }

const flowColumns: Column<Flow>[] = [
  { head: "Prioritas", cell: (f) => <span className="mono">P{f.pri}</span>, sort: (f) => -f.pri },
  { head: "Tujuan", cell: (f) => <b>{f.to.n}</b>, sort: (f) => f.to.n },
  {
    head: "Status tujuan",
    sort: (f) => HS[f.to.hs] * 10 + SS[f.to.ss],
    cell: (f) => (
      <>
        <HargaPill s={f.to.hs} /> <StokPill s={f.to.ss} />
      </>
    ),
  },
  { head: "Asal (gudang wilayah)", cell: (f) => f.from.n, sort: (f) => f.from.n },
  { head: "Volume", right: true, num: true, cell: (f) => `${nf(f.ton)} ton`, sort: (f) => f.ton },
  { head: "Jarak tempuh", right: true, num: true, cell: (f) => `${nf(f.km)} km`, sort: (f) => f.km },
  { head: "Kirim paling lambat", cell: (f) => `${dfmt(fcDates[f.pri - 1])} 2026`, sort: (f) => -f.pri },
]

export default function Harga() {
  const nS = WILAYAH.filter((k) => k.hs === "siaga").length
  const nW = WILAYAH.filter((k) => k.hs === "waspada").length
  const pAvg = sum(WILAYAH, (k) => k.pNow * k.pop) / sum(WILAYAH, (k) => k.pop)
  const sphp = useSesi().boleh("dasbor_sphp")

  return (
    <section className="view">
      <ViewHeader eyebrow="Kasus 3 · hilir" title="Prakiraan harga dan rekomendasi SPHP">
        Harga beras medium dari Panel Harga Pangan Bapanas diprakirakan 1–4 pekan ke depan dengan memakai produksi dan stok sebagai peubah
        penjelas. Wilayah yang diprakirakan melewati HET ditandai, lalu dipasangkan dengan wilayah surplus terdekat untuk penyaluran beras SPHP.
      </ViewHeader>
      <KpiStrip
        items={[
          { k: "Rata-rata medium Jatim", v: rp(pAvg), t: "tertimbang penduduk · HET Rp13.500" },
          { k: "Wilayah Siaga / Waspada", v: `${nS} / ${nW}`, t: "berdasar prakiraan 4 pekan" },
          sphp
            ? { k: "Rekomendasi SPHP", v: `${nf(sum(FLOWS, (f) => f.ton))} ton`, t: `${FLOWS.length} rute, pekan 45–48` }
            : { k: "Rekomendasi SPHP", v: "Terbatas", t: "untuk akun dinas dan perusahaan" },
          { k: "Uji balik prakiraan 4 pekan", v: "MAPE 3,9%", t: "Jan–Okt 2026 · target ≤ 5%" },
        ]}
      />
      <div className="grid-21">
        <PricePanel />
        <Panel title="Arah penyaluran SPHP" note="Dari gudang wilayah surplus ke wilayah rawan">
          <Terkunci judul="Rekomendasi penyaluran SPHP">
          <div className="map">
            <PetaJatim layer="harga" flows labels={false} />
          </div>
          <MapLegend
            layer="harga"
            extra={
              <>
                <span>
                  <svg width="22" height="10" style={{ verticalAlign: -1, marginRight: 5 }}>
                    <line x1="1" y1="5" x2="20" y2="5" stroke="var(--accent)" strokeWidth="2.5" />
                  </svg>
                  rute SPHP, tebal = volume
                </span>
                <span>
                  <svg width="12" height="12" style={{ verticalAlign: -2, marginRight: 5 }}>
                    <rect x="1" y="1" width="10" height="10" fill="var(--panel)" stroke="var(--accent)" strokeWidth="2" />
                  </svg>
                  gudang asal
                </span>
              </>
            }
          />
          <Bacaan>{bacaSphp()}</Bacaan>
          </Terkunci>
        </Panel>
      </div>
      <Panel
        title="Sebaran harga 38 wilayah per pekan"
        note="Tiap punggung = sebaran harga medium semua wilayah pada satu pekan; garis putus = prakiraan; titik = wilayah terpilih"
      >
        <div className="pb chart ridge-wrap">
          <PriceRidgeline />
        </div>
        <Bacaan>{bacaRidgeline()}</Bacaan>
      </Panel>
      <Panel title="Peta panas harga 38 wilayah" note="Rp/kg per pekan, diurutkan dari prakiraan harga tertinggi. Klik baris untuk memilih wilayah.">
        <div className="pb chart">
          <PriceHeatmap />
        </div>
        <Bacaan>{bacaHeatmap()}</Bacaan>
      </Panel>
      <Panel
        title="Rekomendasi penyaluran pekan 45–48"
        note="Hasil optimasi: kebutuhan wilayah defisit dipenuhi dari gudang surplus dengan jarak tempuh terpendek"
      >
        <Terkunci judul="Rekomendasi penyaluran SPHP">
          <DataTable rows={FLOWS} columns={flowColumns} rowKey={(f, i) => `${f.to.n}-${f.from.n}-${i}`} rowName={(f) => f.to.n} />
        </Terkunci>
      </Panel>
    </section>
  )
}

/** Peluang harga melewati HET bila prakiraan menyebar normal (pendekatan erf Abramowitz–Stegun). */
function pAbove(m: number, sd: number) {
  const z = (HET - m) / sd / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * Math.abs(z))
  const e = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-z * z)
  const erf = z >= 0 ? e : -e
  return 0.5 * (1 - erf)
}

function PricePanel() {
  const { sel } = useSelection()
  const k = byName[sel]
  const dates = histDates.concat(fcDates)
  const z95 = 1.96 / 1.2816
  const lo = Math.min(...k.price, ...k.fc.map((f) => f.m - (f.m - f.lo) * z95), HET) - 150
  const hi = Math.max(...k.fc.map((f) => f.m + (f.hi - f.m) * z95), SIAGA) + 120
  const popT = sum(WILAYAH, (q) => q.pop)
  const prov = histDates.map((_, i) => sum(WILAYAH, (q) => q.price[i] * q.pop) / popT)
  const fcLine = [k.pNow].concat(k.fc.map((f) => f.m))

  return (
    <Panel title={`Harga beras medium · ${k.n}`} note="Rp/kg, eceran pekanan; kipas = selang prakiraan 50%, 80%, 95%">
      <div className="pb chart">
        <LineChart
          xDates={dates}
          yDom={[Math.floor(lo / 100) * 100, Math.ceil(hi / 100) * 100]}
          yFmt={(v) => nf(v)}
          W={720}
          H={300}
          splitAt={HIST - 1}
          bands={[
            [1.96, 0.1],
            [1.2816, 0.14],
            [0.674, 0.2],
          ].map(([z, op]) => ({
            lo: [k.pNow].concat(k.fc.map((f) => f.m - (z * (f.hi - f.m)) / 1.2816)),
            hi: [k.pNow].concat(k.fc.map((f) => f.m + (z * (f.hi - f.m)) / 1.2816)),
            off: HIST - 1,
            color: STATUS[k.hs].c,
            op,
          }))}
          refs={[
            { v: HET, label: "HET 13.500", color: "var(--ink-2)" },
            { v: SIAGA, label: "Siaga +3%", color: "var(--crit)" },
          ]}
          series={[
            { vals: prov, color: "var(--ink-3)", w: 1.5, label: "rata-rata Jatim", ly: k.pNow > prov[HIST - 1] ? 14 : -6 },
            { vals: k.price, color: "var(--ink)", w: 2.2 },
            { vals: fcLine, off: HIST - 1, color: STATUS[k.hs].c, dash: "5 4", w: 2.2, label: rp(k.p4) },
          ]}
          tip={(i) => {
            if (i >= HIST) {
              const f = k.fc[i - HIST]
              return (
                <>
                  <b>{dfmt(dates[i])} 2026 · prakiraan</b>
                  <br />
                  {k.n} <span className="m">{rp(f.m)}</span>
                  <br />
                  Selang 50%{" "}
                  <span className="m">
                    {rp(f.m - ((f.hi - f.m) * 0.674) / 1.2816)}–{rp(f.m + ((f.hi - f.m) * 0.674) / 1.2816)}
                  </span>
                  <br />
                  Selang 80%{" "}
                  <span className="m">
                    {rp(f.lo)}–{rp(f.hi)}
                  </span>
                  <br />
                  Selang 95%{" "}
                  <span className="m">
                    {rp(f.m - (f.m - f.lo) * z95)}–{rp(f.m + (f.hi - f.m) * z95)}
                  </span>
                  <br />
                  Peluang di atas HET <span className="m">{nf(pAbove(f.m, (f.hi - f.m) / 1.2816) * 100, 0)}%</span>
                </>
              )
            }
            return (
              <>
                <b>{dfmt(dates[i])} 2026</b>
                <br />
                {k.n} <span className="m">{rp(k.price[i])}</span>
                <br />
                Rata-rata Jatim <span className="m">{rp(prov[i])}</span>
              </>
            )
          }}
        />
      </div>
      <Bacaan>{bacaHarga(k, pAbove(k.fc[3].m, (k.fc[3].hi - k.fc[3].m) / 1.2816), prov[HIST - 1])}</Bacaan>
    </Panel>
  )
}
