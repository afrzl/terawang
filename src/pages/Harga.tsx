import { GKP, K3A } from "@/lib/api"
import { TrendingUp } from "lucide-react"
import { useState } from "react"
import { LineChart } from "@/components/charts/LineChart"
import { PriceHeatmap } from "@/components/charts/PriceHeatmap"
import { PriceRidgeline } from "@/components/charts/PriceRidgeline"
import { DataTable, type Column } from "@/components/ui/DataTable"
import { KpiStrip } from "@/components/ui/Kpi"
import { Panel, ViewHeader } from "@/components/ui/Panel"
import { HET, HET_PREMIUM, HIST, SIAGA_KALI, STATUS, WILAYAH, fcDates, fcHarga, histDates, pNowHarga, peluangHet, seriHarga, statusDari } from "@/lib/data"
import { dfmt, nf, rp, sum } from "@/lib/format"
import { useFilter, useWilayah } from "@/lib/filter"
import { statusHargaAt, type Komoditas } from "@/lib/petaLayers"
import { CatatanGabungan, KpiPerWilayah, LegendaWilayah, MAKS_PISAH, usePerWilayah } from "@/lib/perWilayah"
import { short } from "@/lib/format"


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
  const { jenisHarga } = useFilter()
  const jenis = jenisHarga
  const ganda = jenis.length > 1
  const popT = sum(wil, (k) => k.pop) || 1
  const ringkas = (kom: Komoditas) => ({
    kom,
    rata: sum(wil, (k) => pNowHarga(k, kom) * k.pop) / popT,
    nS: wil.filter((k) => statusHargaAt(k, 4, kom) === "siaga").length,
    nW: wil.filter((k) => statusHargaAt(k, 4, kom) === "waspada").length,
  })
  const rk = jenis.map(ringkas)
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
  const { pisah, warna, wil: wilP } = usePerWilayah()
  const kpiHarga = pisah
    ? [
        {
          k: ganda ? "Harga per wilayah (medium / premium)" : `Harga ${jenis[0]} per wilayah`,
          v: <KpiPerWilayah wil={wilP} warna={warna} nilai={(k) => jenis.map((j) => rp(pNowHarga(k, j))).join(" / ")} />,
          t: "pekan terakhir",
        },
        {
          k: "Status 4 pekan",
          v: <KpiPerWilayah wil={wilP} warna={warna} nilai={(k) => jenis.map((j) => STATUS[statusHargaAt(k, 4, j)].lab).join(" / ")} />,
          t: ganda ? "medium / premium" : "estimasi 4 pekan",
        },
      ]
    : ganda
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
      <ViewHeader icon={TrendingUp} title="Harga" />
      <KpiStrip items={[...kpiHarga, ujiHet()]} />
      <div className="grid-2">
        <PricePanel jenis={jenis} />
        <Panel title="Sebaran harga 38 wilayah per pekan">
          <div className="pb chart ridge-wrap">
            <PriceRidgeline jenis={jenis} />
          </div>
          {ganda && <LegendaJenis />}
        </Panel>
      </div>
      {GKP && <PanelGkp />}
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

/** Heatmap harga: satu jenis langsung ditampilkan; bila dua jenis dipilih, pilihan jenis ada di panel. */
function PanelPeta({ jenis }: { jenis: Komoditas[] }) {
  const [pilih, setPilih] = useState<Komoditas>("medium")
  const aktif = jenis.length > 1 ? (jenis.includes(pilih) ? pilih : jenis[0]) : jenis[0]
  const nWil = useWilayah().length
  return (
    <Panel
      title={`Heatmap harga ${nWil} wilayah, 26 pekan terakhir`}
      actions={
        jenis.length > 1 ? (
          <div className="seg seg-s" role="group" aria-label="Jenis beras pada heatmap">
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

/** Rata-rata Jawa Timur (bobot penduduk seluruh kab/kota): riwayat pekanan dan prakiraan 4 pekan, untuk garis pembanding. */
function seriJatim(kom: Komoditas) {
  const popAll = sum(WILAYAH, (q) => q.pop) || 1
  const rata = (f: (q: (typeof WILAYAH)[number]) => number) => sum(WILAYAH, (q) => f(q) * q.pop) / popAll
  const harga = histDates.map((_, i) => rata((q) => seriHarga(q, kom)[i]))
  const fcM = fcDates.map((_, h) => rata((q) => fcHarga(q, kom)[h].m))
  return { harga, fcM }
}

function PricePanel({ jenis }: { jenis: Komoditas[] }) {
  const { pisah } = usePerWilayah()
  return pisah ? <PricePanelWil jenis={jenis} /> : <PricePanelGab jenis={jenis} />
}

/** Satu garis per wilayah terpilih (2 sampai 6 wilayah). Bila dua jenis dipilih, jenis ditukar dengan tombol di panel supaya warna hanya berarti wilayah. */
function PricePanelWil({ jenis }: { jenis: Komoditas[] }) {
  const { wil, warna } = usePerWilayah()
  const [pilih, setPilih] = useState<Komoditas>("medium")
  const kom = jenis.length > 1 ? (jenis.includes(pilih) ? pilih : jenis[0]) : jenis[0]
  const het = kom === "premium" ? HET_PREMIUM : HET
  const dates = histDates.concat(fcDates)
  const data = wil.map((k) => {
    const harga = seriHarga(k, kom)
    const fc = fcHarga(k, kom)
    return { k, harga, fcM: fc.map((f) => f.m), fcLo: fc.map((f) => f.lo), fcHi: fc.map((f) => f.hi), pNow: harga[HIST - 1] }
  })
  const jt = seriJatim(kom)
  const lo = Math.min(het, ...jt.harga, ...data.flatMap((d) => [...d.harga, ...d.fcLo])) - 150
  const hi = Math.max(het, ...jt.fcM, ...data.flatMap((d) => d.fcHi)) + 120
  return (
    <Panel
      title={`Harga beras ${kom} per wilayah`}
      tafsir="Rupiah per kg, rata-rata pekanan; titik berlabel prakiraan = prakiraan model K3a; HET = harga eceran tertinggi"
      actions={
        jenis.length > 1 ? (
          <div className="seg seg-s" role="group" aria-label="Jenis beras pada grafik">
            {jenis.map((j) => (
              <button key={j} type="button" aria-pressed={kom === j} onClick={() => setPilih(j)} style={{ textTransform: "capitalize" }}>
                {j}
              </button>
            ))}
          </div>
        ) : undefined
      }
    >
      <div className="pb chart">
        <LineChart
          xDates={dates}
          yDom={[Math.floor(lo / 100) * 100, Math.ceil(hi / 100) * 100]}
          yFmt={(v) => nf(v)}
          W={760}
          H={420}
          splitAt={HIST - 1}
          sebarLabel
          bands={data.map((d) => ({ lo: [d.pNow].concat(d.fcLo), hi: [d.pNow].concat(d.fcHi), off: HIST - 1, color: warna(d.k), op: 0.08, nama: `${d.k.n} P10–P90` }))}
          refs={[{ v: het, label: `HET ${nf(het)}`, color: "var(--ink-2)" }]}
          series={[
            { vals: jt.harga, color: "var(--ink-3)", w: 1.4, nama: "Jawa Timur" },
            { vals: [jt.harga[HIST - 1]].concat(jt.fcM), off: HIST - 1, color: "var(--ink-3)", dash: "3 4", w: 1.4, label: "Jatim", nama: "Jawa Timur" },
            ...data.flatMap((d) => [
              { vals: d.harga, color: warna(d.k), w: 2, nama: d.k.n },
              { vals: [d.pNow].concat(d.fcM), off: HIST - 1, color: warna(d.k), dash: "5 4", w: 2, label: short(d.k.n), nama: d.k.n },
            ]),
          ]}
          tip={(i) => (
            <>
              <b>
                {dfmt(dates[i])} {dates[i].getFullYear()}
                {i >= HIST ? ", prakiraan" : ""}
              </b>
              {[...data]
                .sort((a, b) => (i >= HIST ? b.fcM[i - HIST] - a.fcM[i - HIST] : b.harga[i] - a.harga[i]))
                .map((d) => (
                  <span key={d.k.n}>
                    <br />
                    <span className="sw-dot" style={{ background: warna(d.k) }} />
                    {d.k.n} <span className="m">{rp(i >= HIST ? d.fcM[i - HIST] : d.harga[i])}</span>
                    {i >= HIST && (
                      <>
                        {" "}
                        (P10–P90 <span className="m">{rp(d.fcLo[i - HIST])}–{rp(d.fcHi[i - HIST])}</span>)
                      </>
                    )}
                  </span>
                ))}
              <br />
              <span className="sw-dot" style={{ background: "var(--ink-3)" }} />
              Jawa Timur <span className="m">{rp(i >= HIST ? jt.fcM[i - HIST] : jt.harga[i])}</span>
            </>
          )}
        />
        <LegendaWilayah
          wil={wil}
          warna={warna}
          extra={
            <span>
              <span className="sw" style={{ background: "var(--ink-3)" }} />
              Jawa Timur · garis putus = prakiraan 4 pekan, pita = P10–P90
            </span>
          }
        />
      </div>
    </Panel>
  )
}

/** Satu garis gabungan (rata-rata menurut jumlah penduduk): untuk satu wilayah, atau lebih dari 6 wilayah. */
function PricePanelGab({ jenis }: { jenis: Komoditas[] }) {
  const wil = useWilayah()
  const ganda = jenis.length > 1
  const dates = histDates.concat(fcDates)
  // Seri harga mengikuti filter wilayah di sidebar: rata-rata menurut jumlah penduduk wilayah yang dipilih.
  // Premium: seri K3a premium dari API; hanya bila API mati selisih terhadap medium dianggap tetap (simulasi).
  const popT = sum(wil, (q) => q.pop) || 1
  const rata = (f: (q: (typeof wil)[number]) => number) => sum(wil, (q) => f(q) * q.pop) / popT
  const sebagian = wil.length < WILAYAH.length
  const data = jenis.map((kom) => {
    const het = kom === "premium" ? HET_PREMIUM : HET
    const harga = histDates.map((_, i) => rata((q) => seriHarga(q, kom)[i]))
    const fcM = fcDates.map((_, h) => rata((q) => fcHarga(q, kom)[h].m))
    const fcLo = fcDates.map((_, h) => rata((q) => fcHarga(q, kom)[h].lo))
    const fcHi = fcDates.map((_, h) => rata((q) => fcHarga(q, kom)[h].hi))
    const jt = seriJatim(kom)
    const prov = jt.harga
    const provFc = jt.fcM
    const status = statusDari(fcM[3], fcHi[3], het, 4, kom)
    // peluang melewati HET: rata-rata (menurut penduduk) peluang per kab dari K3a
    const peluang = fcDates.map((_, h) => rata((q) => { const f = fcHarga(q, kom)[h]; return peluangHet(q.n, kom, h + 1, f.m, f.hi, het) }))
    return { kom, het, siaga: Math.round(het * SIAGA_KALI), harga, fcM, fcLo, fcHi, prov, provFc, status, peluang, pNow: harga[HIST - 1] }
  })
  const pembanding = (d: (typeof data)[number]) => (sebagian ? [...d.prov, ...d.provFc] : [])
  const lo = Math.min(...data.flatMap((d) => [...d.harga, ...d.fcLo, d.het, ...pembanding(d)])) - 150
  const hi = Math.max(...data.flatMap((d) => [...d.fcHi, ...(ganda ? [d.het] : [d.siaga]), ...pembanding(d)])) + 120
  // Label ujung garis dan label HET dijauhkan satu sama lain bila nilainya berdekatan.
  const dekat = (d: (typeof data)[number], v: number) => Math.abs(d.fcM[3] - v) < 120
  const warna = (d: (typeof data)[number]) => (ganda ? WARNA_JENIS[d.kom] : STATUS[d.status].c)
  const garisHarga = (d: (typeof data)[number]) => (ganda ? WARNA_JENIS[d.kom] : "var(--ink)")
  const d0 = data[0]

  return (
    <Panel
      title={ganda ? "Harga beras" : `Harga beras ${d0.kom}`}
      tafsir={`Rupiah per kg, rata-rata pekanan ${wil.length === WILAYAH.length ? "Jawa Timur" : wil.length === 1 ? wil[0].n : `${wil.length} wilayah`} (bobot penduduk); titik berlabel prakiraan = prakiraan model K3a`}
    >
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
            nama: `${d.kom} P10–P90`,
          }))}
          refs={data.flatMap((d) => [
            { v: d.het, label: `HET ${nf(d.het)}`, color: ganda ? WARNA_JENIS[d.kom] : "var(--ink-2)", dy: dekat(d, d.het) ? (d.fcM[3] >= d.het ? 16 : -7) : 4 },
            ...(ganda ? [] : [{ v: d.siaga, label: "HET +5%", color: "var(--crit)", dy: dekat(d, d.siaga) ? (d.fcM[3] >= d.siaga ? 16 : -7) : 4 }]),
          ])}
          series={data.flatMap((d) => [
            ...(sebagian
              ? [
                  { vals: d.prov, color: "var(--ink-3)", w: 1.4, nama: `Jawa Timur ${d.kom}` },
                  {
                    vals: [d.prov[HIST - 1]].concat(d.provFc),
                    off: HIST - 1,
                    color: "var(--ink-3)",
                    dash: "3 4",
                    w: 1.4,
                    label: ganda ? `Jatim ${d.kom}` : "Jatim",
                    nama: `Jawa Timur ${d.kom}`,
                    ly: d.fcM[3] > d.provFc[3] ? 14 : -6,
                  },
                ]
              : []),
            { vals: d.harga, color: garisHarga(d), w: 2.2, nama: `harga ${d.kom}` },
            {
              vals: [d.pNow].concat(d.fcM),
              off: HIST - 1,
              color: warna(d),
              dash: "5 4",
              w: 2.2,
              label: rp(d.fcM[3]),
              nama: `harga ${d.kom}`,
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
                      , peluang lewat HET <span className="m">{nf(d.peluang[i - HIST] * 100, 0)}%</span>
                      {sebagian && (
                        <>
                          , Jatim <span className="m">{rp(d.provFc[i - HIST])}</span>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="m">{rp(d.harga[i])}</span>
                      {sebagian && (
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
      <div style={{ padding: "0 16px 12px" }}>
        <CatatanGabungan n={wil.length} total={WILAYAH.length} />
      </div>
    </Panel>
  )
}

const BLN_GKP = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
const tglBulan = (b: string) => new Date(Number(b.slice(0, 4)), Number(b.slice(5, 7)) - 1, 1)
const labelBulan = (d: Date) => `${BLN_GKP[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`
const SUMBER_LUAS: Record<string, string> = {
  bps_potensi_terbaru: "potensi BPS",
  bps_potensi: "potensi BPS",
  taksiran_musiman: "rata-rata musiman 3 tahun",
}

type BarisGkp = { bulan_target: string; harga_prediksi: number; p10: number; p90: number; luas_panen_ha?: number; sumber_luas?: string }

/** Panel GKP mengikuti filter wilayah: 2-6 wilayah = satu garis per kab/kota yang punya data GKP Bapanas;
 * satu wilayah = kab itu; selain itu (atau tak ada kab berdata) = Jawa Timur. */
function PanelGkp() {
  const g = GKP!
  const { pisah, wil } = usePerWilayah()
  const ada = wil.filter((k) => g.kabupaten?.some((x) => x.nama === k.n))
  if (pisah && ada.length) return <PanelGkpWil />
  return <PanelGkpSatu />
}

/** Kab/kota terpilih yang tidak punya prakiraan GKP (tidak ada atau terlalu lama tidak ada data Bapanas). */
const tanpaGkp = (nama: string[]) =>
  nama.length ? ` Bapanas belum punya harga GKP petani yang cukup baru untuk ${nama.join(", ")}.` : ""

type BarisGkpWil = BarisGkp & { wilayah: string; warna: string }

/** Satu garis GKP per kab/kota terpilih (2-6 wilayah), dengan Jawa Timur sebagai garis pembanding. */
function PanelGkpWil() {
  const g = GKP!
  const { wil, warna } = usePerWilayah()
  const kabs = wil.flatMap((k) => {
    const x = g.kabupaten?.find((y) => y.nama === k.n)
    return x ? [{ k, x }] : []
  })
  const tanpa = wil.filter((k) => !kabs.some((d) => d.k === k)).map((k) => k.n)
  const bulan = g.riwayat.map((r) => r.bulan)
  const n = bulan.length
  const target = g.prakiraan.map((f) => f.bulan_target)
  const dates = bulan.concat(target).map(tglBulan)
  const data = kabs.map(({ k, x }) => {
    const peta = new Map(x.riwayat.map((r) => [r.bulan, r.harga]))
    const harga = bulan.map((b) => peta.get(b) ?? null)
    return { k, x, harga, pNow: harga[n - 1], fc: x.prakiraan }
  })
  const semua = [
    ...data.flatMap((d) => [...(d.harga.filter((v) => v != null) as number[]), ...d.fc.map((f) => f.p10), ...d.fc.map((f) => f.p90)]),
    ...g.riwayat.slice(-24).map((r) => r.harga),
    g.hpp_sekarang,
  ]
  const lo = Math.min(...semua) - 150
  const hi = Math.max(...semua) + 150
  // Grafik dimulai 24 bulan sebelum acuan (riwayat kab dari Bapanas sejak 2024).
  const awal = Math.max(0, n - 24)
  const potong = <T,>(a: T[]) => a.slice(awal)
  const nn = n - awal
  const mape = (h: number) => g.uji_mundur_kab?.[`h${h}`]?.mape
  const baris: BarisGkpWil[] = data.flatMap((d) => d.fc.map((f) => ({ ...f, wilayah: d.k.n, warna: warna(d.k) })))
  const kolom: Column<BarisGkpWil>[] = [
    {
      head: "Wilayah",
      cell: (f) => (
        <span>
          <span className="sw-dot" style={{ background: f.warna }} /> <b>{f.wilayah}</b>
        </span>
      ),
    },
    { head: "Bulan", cell: (f) => labelBulan(tglBulan(f.bulan_target)) },
    { head: "Prakiraan", right: true, num: true, cell: (f) => rp(f.harga_prediksi) },
    { head: "P10–P90", right: true, num: true, cell: (f) => `${rp(f.p10)}–${rp(f.p90)}` },
  ]
  const ujungJatim = g.prakiraan[g.prakiraan.length - 1]
  return (
    <div className="grid-2">
      <Panel title="Harga GKP petani per wilayah, bulanan" tafsir="Rupiah per kg gabah kering panen di tingkat petani, per kab/kota terpilih dan Jawa Timur; titik berlabel prakiraan = prakiraan 1–3 bulan; HPP = harga pembelian pemerintah">
        <div className="pb chart">
          <LineChart
            xDates={potong(dates.slice(0, n)).concat(dates.slice(n))}
            xFmt={labelBulan}
            yDom={[Math.floor(lo / 100) * 100, Math.ceil(hi / 100) * 100]}
            yFmt={(v) => nf(v)}
            W={760}
            H={420}
            splitAt={nn - 1}
            sebarLabel
            bands={data.map((d) => ({ lo: [d.pNow, ...d.fc.map((f) => f.p10)], hi: [d.pNow, ...d.fc.map((f) => f.p90)], off: nn - 1, color: warna(d.k), op: 0.08, nama: `${d.k.n} P10–P90` }))}
            refs={[{ v: g.hpp_sekarang, label: `HPP ${nf(g.hpp_sekarang)}`, color: "var(--ink-2)", dy: 4 }]}
            series={[
              { vals: potong(g.riwayat.map((r) => r.harga)), color: "var(--ink-3)", w: 1.4, nama: "Jawa Timur" },
              { vals: [g.riwayat[n - 1].harga, ...g.prakiraan.map((f) => f.harga_prediksi)], off: nn - 1, color: "var(--ink-3)", dash: "3 4", w: 1.4, label: `Jatim ${rp(ujungJatim.harga_prediksi)}`, nama: "Jawa Timur" },
              ...data.flatMap((d) => [
                { vals: potong(d.harga), color: warna(d.k), w: 2, nama: d.k.n },
                { vals: [d.pNow, ...d.fc.map((f) => f.harga_prediksi)], off: nn - 1, color: warna(d.k), dash: "5 4", w: 2, label: short(d.k.n), nama: d.k.n },
              ]),
            ]}
            tip={(i) => {
              const j = i + awal
              const fcI = j - n
              const nilai = (d: (typeof data)[number]) => (fcI >= 0 ? d.fc[fcI]?.harga_prediksi : d.harga[j]) ?? null
              const jatim = fcI >= 0 ? g.prakiraan[fcI]?.harga_prediksi : g.riwayat[j]?.harga
              return (
                <>
                  <b>
                    {labelBulan(dates[j])}
                    {fcI >= 0 ? ", prakiraan" : ""}
                  </b>
                  {[...data]
                    .sort((a, b) => (nilai(b) ?? 0) - (nilai(a) ?? 0))
                    .map((d) => (
                      <span key={d.k.n}>
                        <br />
                        <span className="sw-dot" style={{ background: warna(d.k) }} />
                        {d.k.n} <span className="m">{nilai(d) == null ? "tidak ada data" : rp(nilai(d)!)}</span>
                      </span>
                    ))}
                  {jatim != null && (
                    <span>
                      <br />
                      <span className="sw-dot" style={{ background: "var(--ink-3)" }} />
                      Jawa Timur <span className="m">{rp(jatim)}</span>
                    </span>
                  )}
                </>
              )
            }}
          />
          <LegendaWilayah
            wil={data.map((d) => d.k)}
            warna={warna}
            extra={
              <span>
                <span className="sw" style={{ background: "var(--ink-3)" }} />
                Jawa Timur · garis putus = prakiraan 1–3 bulan, pita = P10–P90
              </span>
            }
          />
        </div>
      </Panel>
      <Panel title="Prakiraan harga GKP per wilayah 1–3 bulan">
        <DataTable rows={baris} columns={kolom} rowKey={(f) => `${f.wilayah}-${f.bulan_target}`} rowName={(f) => `${f.wilayah} ${f.bulan_target}`} pageSize={9} />
        <p style={{ padding: "12px 16px", margin: 0, fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
          Per kab/kota: rata-rata harga bulan terakhir dan prakiraan Jawa Timur yang disesuaikan dengan selisih harga kab terhadap rata-rata
          provinsi 3 bulan terakhir. Harga panel Bapanas.{tanpaGkp(tanpa)} MAPE uji mundur seluruh kab/kota:{" "}
          {[1, 2, 3].map((h) => `${h} bln ${mape(h) != null ? nf(mape(h)!, 1) : "–"}%`).join(", ")}.
        </p>
      </Panel>
    </div>
  )
}

/** Satu deret GKP: kab/kota bila tepat satu wilayah berdata dipilih, selain itu Jawa Timur. */
function PanelGkpSatu() {
  const g = GKP!
  const wil = useWilayah()
  const satu = wil.length === 1 ? wil[0].n : null
  const sebagian = wil.length < WILAYAH.length
  const kab = satu ? g.kabupaten?.find((k) => k.nama === satu) : undefined
  const rw = kab?.riwayat.length ? kab.riwayat.map((r) => ({ ...r, sumber: r.sumber ?? "Bapanas" })) : g.riwayat
  const fc: BarisGkp[] = kab ? kab.prakiraan : g.prakiraan
  const n = rw.length
  const dates = rw.map((r) => tglBulan(r.bulan)).concat(fc.map((f) => tglBulan(f.bulan_target)))
  const pNow = rw[n - 1].harga
  const lo = Math.min(...rw.map((r) => r.harga), ...fc.map((f) => f.p10), g.hpp_sekarang) - 150
  const hi = Math.max(...rw.map((r) => r.harga), ...fc.map((f) => f.p90)) + 150
  const ujung = fc[fc.length - 1]
  const uji = kab ? g.uji_mundur_kab : g.uji_mundur
  const mape = (h: number) => uji?.[`h${h}`]?.mape
  // Riwayat kab bisa bolong (bulan tanpa data Bapanas): garis disambung antar bulan yang ada.
  const bulanAcuan = kab ? rw[n - 1].bulan : g.bulan_acuan
  const kolom: Column<BarisGkp>[] = [
    { head: "Bulan", cell: (f) => <b>{labelBulan(tglBulan(f.bulan_target))}</b> },
    { head: "Prakiraan", right: true, num: true, cell: (f) => rp(f.harga_prediksi) },
    { head: "P10–P90", right: true, num: true, cell: (f) => `${rp(f.p10)}–${rp(f.p90)}` },
    ...(kab
      ? []
      : [
          { head: "Luas panen", right: true, num: true, cell: (f: BarisGkp) => `${nf((f.luas_panen_ha ?? 0) / 1000)} rb ha` },
          { head: "Sumber luas", cell: (f: BarisGkp) => SUMBER_LUAS[f.sumber_luas ?? ""] ?? f.sumber_luas },
        ]),
  ]
  const wilayahLabel = kab ? kab.nama : "Jawa Timur"
  return (
    <div className="grid-2">
      <Panel title={`Harga GKP petani ${wilayahLabel}, bulanan`} tafsir="Rupiah per kg gabah kering panen di tingkat petani; titik berlabel prakiraan = prakiraan 1–3 bulan; HPP = harga pembelian pemerintah">
        <div className="pb chart">
          <LineChart
            xDates={dates}
            xFmt={labelBulan}
            yDom={[Math.floor(lo / 100) * 100, Math.ceil(hi / 100) * 100]}
            yFmt={(v) => nf(v)}
            W={760}
            H={420}
            splitAt={n - 1}
            bands={[{ lo: [pNow, ...fc.map((f) => f.p10)], hi: [pNow, ...fc.map((f) => f.p90)], off: n - 1, color: "var(--accent)", op: 0.16, nama: "P10–P90" }]}
            refs={[{ v: g.hpp_sekarang, label: `HPP ${nf(g.hpp_sekarang)}`, color: "var(--ink-2)", dy: 4 }]}
            series={[
              { vals: rw.map((r) => r.harga), color: "var(--ink)", w: 2.2, nama: "harga GKP" },
              { vals: [pNow, ...fc.map((f) => f.harga_prediksi)], off: n - 1, color: "var(--accent)", dash: "5 4", w: 2.2, label: rp(ujung.harga_prediksi), nama: "harga GKP" },
            ]}
            tip={(i) => {
              if (i < n) {
                const r = rw[i]
                return (
                  <>
                    <b>{labelBulan(dates[i])}</b>
                    <br />
                    <span className="m">{rp(r.harga)}</span> per kg{r.sumber === "taksiran" ? "" : `, sumber ${r.sumber}`}
                  </>
                )
              }
              const f = fc[i - n]
              return (
                <>
                  <b>{labelBulan(dates[i])}, prakiraan</b>
                  <br />
                  <span className="m">{rp(f.harga_prediksi)}</span>, P10 sampai P90{" "}
                  <span className="m">
                    {rp(f.p10)}–{rp(f.p90)}
                  </span>
                </>
              )
            }}
          />
        </div>
      </Panel>
      <Panel title={`Prakiraan harga GKP ${wilayahLabel} 1–3 bulan`}>
        <DataTable rows={fc} columns={kolom} rowKey={(f) => f.bulan_target} rowName={(f) => f.bulan_target} pageSize={3} />
        <p style={{ padding: "12px 16px", margin: 0, fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
          {kab?.taksiran ? (
            <>
              Prakiraan Jawa Timur yang disesuaikan dengan selisih harga {kab.nama} terhadap rata-rata provinsi. MAPE uji mundur seluruh
              kab/kota:{" "}
            </>
          ) : kab ? (
            <>
              Rata-rata harga {kab.nama} bulan terakhir dan prakiraan Jawa Timur yang disesuaikan dengan selisih harga {kab.nama} terhadap
              rata-rata provinsi 3 bulan terakhir
              {kab.metode === "rasio_provinsi" && kab.bulan_data_terakhir ? ` (data ${kab.nama} terakhir ${labelBulan(tglBulan(kab.bulan_data_terakhir))}, jadi hanya bagian provinsi)` : ""}.
              Harga panel Bapanas, data sampai {labelBulan(tglBulan(bulanAcuan))}. MAPE uji mundur seluruh kab/kota:{" "}
            </>
          ) : (
            <>
              Gabungan rata-rata model naif (harga bulan terakhir) dan SARIMAX dengan HPP gabah dan luas panen padi Jatim. Harga sampai{" "}
              {labelBulan(tglBulan(g.bulan_acuan))}: BPS sampai Des 2024, sesudahnya panel harga Bapanas.
              {sebagian ? `${tanpaGkp(satu ? [satu] : wil.length <= MAKS_PISAH ? wil.map((k) => k.n) : [])} Yang tampil angka provinsi${wil.length > MAKS_PISAH ? `; pilih 2–${MAKS_PISAH} wilayah untuk melihat GKP per kab/kota` : ""}.` : ""}{" "}
              Galat uji mundur 36 bulan
              (MAPE):{" "}
            </>
          )}
          {[1, 2, 3].map((h) => `${h} bln ${mape(h) != null ? nf(mape(h)!, 1) : "–"}%`).join(", ")}.
        </p>
      </Panel>
    </div>
  )
}
