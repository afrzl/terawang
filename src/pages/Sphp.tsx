import { Truck } from "lucide-react"
import { MapLegend } from "@/components/charts/PetaJatim"
import { PetaSphp } from "@/components/charts/PetaSphp"
import { DataTable, type Column } from "@/components/ui/DataTable"
import { KpiStrip } from "@/components/ui/Kpi"
import { Panel, ViewHeader } from "@/components/ui/Panel"
import { WILAYAH, flowsBulan, type Flow } from "@/lib/data"
import { nf, sum } from "@/lib/format"
import { bulanLabel, useFilter, useWilayah } from "@/lib/filter"
import { covBulan } from "@/lib/petaLayers"

const flowColumns: Column<Flow>[] = [
  { head: "Bulan", cell: (f) => bulanLabel(f.bulan), sort: (f) => f.bulan },
  { head: "Tujuan", cell: (f) => <b>{f.to.n}</b>, sort: (f) => f.to.n },
  { head: "Asal (cabang Bulog)", cell: (f) => f.from.n, sort: (f) => f.from.n },
  { head: "Volume", right: true, num: true, cell: (f) => `${nf(f.ton)} ton`, sort: (f) => f.ton },
  { head: "Jarak tempuh", right: true, num: true, cell: (f) => (f.km ? `${nf(f.km)} km` : "lokal"), sort: (f) => f.km },
]

const KET_SPHP =
  "Rekomendasi penyaluran beras SPHP (model K3b) dari cabang Bulog ke kab/kota tujuan; volume dalam ton; km = jarak tempuh, 0 = disalurkan di wilayah cabang sendiri; warna peta = cakupan stok non-Bulog (bulan konsumsi) akhir periode, < 0,75 defisit, 0,75–1 tipis, 1–1,5 cukup, ≥ 1,5 surplus"

/** Data interpretasi peta SPHP: rute persis seperti di peta, total per tujuan, dan cakupan stok wilayah terpilih. */
function dataSphp(flows: Flow[], wil: { n: string }[], akhir: number) {
  const perTujuan = new Map<string, number>()
  for (const f of flows) perTujuan.set(f.to.n, (perTujuan.get(f.to.n) ?? 0) + f.ton)
  return {
    total_ton: Math.round(sum(flows, (f) => f.ton)),
    jumlah_rute: flows.length,
    rute: flows.map((f) => ({ bulan: bulanLabel(f.bulan), tujuan: f.to.n, asal_cabang_bulog: f.from.n, ton: Math.round(f.ton), km: Math.round(f.km) })),
    total_per_tujuan: [...perTujuan].sort((a, b) => b[1] - a[1]).map(([tujuan, ton]) => ({ tujuan, ton: Math.round(ton) })),
    cakupan_stok_bulan: WILAYAH.filter((k) => wil.some((w) => w.n === k.n)).map((k) => ({ wilayah: k.n, cakupan: Math.round(covBulan(k, akhir) * 100) / 100 })),
  }
}

/** Rekomendasi penyaluran beras SPHP (K3b): halaman sub menu "Harga & SPHP", hanya untuk peran berhak dasbor_sphp. */
export default function Sphp() {
  const wil = useWilayah()
  const { mulai, akhir } = useFilter()
  const flows = flowsBulan(mulai, akhir).filter((f) => wil.includes(f.to))
  const periode = mulai === akhir ? bulanLabel(mulai) : `${bulanLabel(mulai)} sampai ${bulanLabel(akhir)}`
  const tujuan = new Set(flows.map((f) => f.to.n)).size
  const asal = new Set(flows.map((f) => f.from.n)).size
  const antar = flows.filter((f) => f.km)
  return (
    <section className="view">
      <ViewHeader icon={Truck} title="Rekomendasi SPHP" />
      <KpiStrip
        items={[
          { k: "Total rekomendasi", v: `${nf(sum(flows, (f) => f.ton))} ton`, t: periode },
          { k: "Rute penyaluran", v: nf(flows.length), t: `${nf(antar.length)} antar kab/kota, ${nf(flows.length - antar.length)} lokal` },
          { k: "Kab/kota tujuan", v: nf(tujuan), t: `dari ${nf(wil.length)} wilayah terpilih` },
          { k: "Cabang Bulog asal", v: nf(asal), t: antar.length ? `rata-rata ${nf(sum(antar, (f) => f.km) / antar.length)} km per rute antar wilayah` : "semua disalurkan lokal" },
        ]}
      />
      <Panel
        title="Peta rekomendasi SPHP"
        note={flows.length ? `${nf(sum(flows, (f) => f.ton))} ton, ${flows.length} rute, ${periode}` : undefined}
        tafsir={KET_SPHP}
        dataTafsir={dataSphp(flows, wil, akhir)}
      >
          <PetaSphp flows={flows} akhir={akhir} wil={wil} />
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
      </Panel>
      <Panel title="Rute rekomendasi SPHP">
          <DataTable rows={flows} columns={flowColumns} rowKey={(f, i) => `${f.bulan}-${f.to.n}-${f.from.n}-${i}`} rowName={(f) => f.to.n} pageSize={10} />
      </Panel>
    </section>
  )
}
