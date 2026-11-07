import { LineChart } from "@/components/charts/LineChart"
import { MapLegend, PetaJatim } from "@/components/charts/PetaJatim"
import { DataTable, type Column } from "@/components/ui/DataTable"
import { KpiStrip } from "@/components/ui/Kpi"
import { Panel, ViewHeader } from "@/components/ui/Panel"
import { HargaPill, StokPill } from "@/components/ui/Pill"
import { FLOWS, HET, HIST, SIAGA, STATUS, WILAYAH, byName, fcDates, histDates, type Flow } from "@/lib/data"
import { dfmt, nf, rp, sum } from "@/lib/format"
import { useSelection } from "@/lib/selection"

const flowColumns: Column<Flow>[] = [
  { head: "Prioritas", cell: (f) => <span className="mono">P{f.pri}</span> },
  { head: "Tujuan", cell: (f) => <b>{f.to.n}</b> },
  {
    head: "Status tujuan",
    cell: (f) => (
      <>
        <HargaPill s={f.to.hs} /> <StokPill s={f.to.ss} />
      </>
    ),
  },
  { head: "Asal (gudang wilayah)", cell: (f) => f.from.n },
  { head: "Volume", right: true, num: true, cell: (f) => `${nf(f.ton)} ton` },
  { head: "Jarak tempuh", right: true, num: true, cell: (f) => `${nf(f.km)} km` },
  { head: "Kirim paling lambat", cell: (f) => `${dfmt(fcDates[f.pri - 1])} 2026` },
]

export default function Harga() {
  const nS = WILAYAH.filter((k) => k.hs === "siaga").length
  const nW = WILAYAH.filter((k) => k.hs === "waspada").length
  const pAvg = sum(WILAYAH, (k) => k.pNow * k.pop) / sum(WILAYAH, (k) => k.pop)

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
          { k: "Rekomendasi SPHP", v: `${nf(sum(FLOWS, (f) => f.ton))} ton`, t: `${FLOWS.length} rute, pekan 45–48` },
          { k: "Uji balik prakiraan 4 pekan", v: "MAPE 3,9%", t: "Jan–Okt 2026 · target ≤ 5%" },
        ]}
      />
      <div className="grid-21">
        <PricePanel />
        <Panel title="Arah penyaluran SPHP" note="Dari gudang wilayah surplus ke wilayah rawan">
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
        </Panel>
      </div>
      <Panel
        title="Rekomendasi penyaluran pekan 45–48"
        note="Hasil optimasi: kebutuhan wilayah defisit dipenuhi dari gudang surplus dengan jarak tempuh terpendek"
      >
        <DataTable rows={FLOWS} columns={flowColumns} rowKey={(f, i) => `${f.to.n}-${f.from.n}-${i}`} rowName={(f) => f.to.n} />
      </Panel>
    </section>
  )
}

function PricePanel() {
  const { sel } = useSelection()
  const k = byName[sel]
  const dates = histDates.concat(fcDates)
  const lo = Math.min(...k.price, ...k.fc.map((f) => f.lo), HET) - 150
  const hi = Math.max(...k.fc.map((f) => f.hi), SIAGA) + 120
  const popT = sum(WILAYAH, (q) => q.pop)
  const prov = histDates.map((_, i) => sum(WILAYAH, (q) => q.price[i] * q.pop) / popT)
  const fcLine = [k.pNow].concat(k.fc.map((f) => f.m))

  return (
    <Panel title={`Harga beras medium · ${k.n}`} note="Rp/kg, eceran pekanan; pita = selang prakiraan 80%">
      <div className="pb chart">
        <LineChart
          xDates={dates}
          yDom={[Math.floor(lo / 100) * 100, Math.ceil(hi / 100) * 100]}
          yFmt={(v) => nf(v)}
          W={720}
          H={300}
          splitAt={HIST - 1}
          bands={[
            {
              lo: [k.pNow].concat(k.fc.map((f) => f.lo)),
              hi: [k.pNow].concat(k.fc.map((f) => f.hi)),
              off: HIST - 1,
              color: STATUS[k.hs].c,
              op: 0.18,
            },
          ]}
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
                  Selang 80%{" "}
                  <span className="m">
                    {rp(f.lo)}–{rp(f.hi)}
                  </span>
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
    </Panel>
  )
}
