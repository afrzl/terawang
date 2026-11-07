import { useState } from "react"
import { Link } from "react-router-dom"
import { MapLegend, PetaJatim } from "@/components/charts/PetaJatim"
import { Sparkline } from "@/components/charts/Sparkline"
import { DataTable, type Column } from "@/components/ui/DataTable"
import { Panel, ViewHeader } from "@/components/ui/Panel"
import { HargaPill, StokPill } from "@/components/ui/Pill"
import { FLOWS, LAYERS, LAYER_KEYS, WILAYAH, byName, fcDates, risk, type LayerKey, type Wilayah } from "@/lib/data"
import { dfmt, nf, rp, short, sum } from "@/lib/format"
import { useSelection } from "@/lib/selection"

const LAYER_KEY = "terawang.layer"

function initialLayer(): LayerKey {
  try {
    const l = localStorage.getItem(LAYER_KEY)
    if (l && l in LAYERS) return l as LayerKey
  } catch {
    /* abaikan */
  }
  return "harga"
}

function suggestedAction(k: Wilayah) {
  const fl = FLOWS.filter((f) => f.to === k)
  if (fl.length) {
    const asal = fl.length > 3 ? `${fl.length} gudang (${fl.slice(0, 2).map((f) => short(f.from.n)).join(", ")}, …)` : fl.map((f) => short(f.from.n)).join(", ")
    return `SPHP ${nf(sum(fl, (f) => f.ton))} ton dari ${asal}`
  }
  return k.hs !== "aman" ? "Pantau pasar, siapkan operasi pasar" : "Pantau"
}

const watchColumns: Column<Wilayah>[] = [
  { head: "Wilayah", cell: (k) => <b>{k.n}</b> },
  { head: "Harga kini", right: true, num: true, cell: (k) => rp(k.pNow) },
  { head: "Prakiraan +4 pkn", right: true, num: true, cell: (k) => rp(k.p4) },
  { head: "Status harga", cell: (k) => <HargaPill s={k.hs} /> },
  { head: "Stok +4 pkn", right: true, num: true, cell: (k) => `${nf(k.covP[3], 2)} bln` },
  { head: "Status stok", cell: (k) => <StokPill s={k.ss} /> },
  { head: "Tindakan yang disarankan", cell: suggestedAction },
]

export default function Ringkasan() {
  const [layer, setLayer] = useState<LayerKey>(initialLayer)
  const chooseLayer = (l: LayerKey) => {
    setLayer(l)
    try {
      localStorage.setItem(LAYER_KEY, l)
    } catch {
      /* abaikan */
    }
  }

  const estT = sum(WILAYAH, (k) => k.est)
  const prevT = sum(WILAYAH, (k) => k.prev)
  const yoy = estT / prevT - 1
  const stT = sum(WILAYAH, (k) => k.cov * k.C)
  const cT = sum(WILAYAH, (k) => k.C)
  const popT = sum(WILAYAH, (k) => k.pop)
  const pAvg = sum(WILAYAH, (k) => k.pNow * k.pop) / popT
  const fAvg = sum(WILAYAH, (k) => k.p4 * k.pop) / popT
  const nDef = WILAYAH.filter((k) => k.ss === "defisit").length
  const nTip = WILAYAH.filter((k) => k.ss === "tipis").length
  const nS = WILAYAH.filter((k) => k.hs === "siaga").length
  const nW = WILAYAH.filter((k) => k.hs === "waspada").length
  const tonS = sum(FLOWS, (f) => f.ton)
  const ciPct = (Math.sqrt(sum(WILAYAH, (k) => k.ci * k.ci)) / estT) * 100
  const watch = WILAYAH.slice()
    .sort((a, b) => risk(b) - risk(a))
    .slice(0, 12)

  return (
    <section className="view">
      <ViewHeader eyebrow="Laporan pekanan untuk DKP, TPID, Bulog Kanwil Jatim" title="Ringkasan kondisi beras Jawa Timur">
        Tanam MT I mundur karena awal musim hujan terlambat, sehingga panen Nov–Jan diproyeksikan {nf(Math.abs(yoy * 100), 1)}% lebih rendah dari
        periode yang sama 2025. Stok di {nDef} wilayah diproyeksikan jatuh di bawah batas aman dalam 4 pekan, dan {nS} wilayah diprakirakan
        melewati HET lebih dari 3%.
      </ViewHeader>

      <div className="chain">
        <Link className="link" to="/produksi">
          <div className="stage">
            <span className="eyebrow">K1 · Sawah</span>
          </div>
          <div className="big">
            {nf(estT / 1000, 2)} <small>juta ton GKG</small>
          </div>
          <div className="line">
            Proyeksi panen Nov 2026 – Jan 2027 · <span className="delta-dn">{nf(yoy * 100, 1)}%</span> vs 2025 · selang 90% ±{nf(ciPct, 1)}%
          </div>
        </Link>
        <Link className="link" to="/stok">
          <div className="stage">
            <span className="eyebrow">K2 · Stok</span>
          </div>
          <div className="big">
            {nf(stT, 0)} <small>ribu ton beras</small>
          </div>
          <div className="line">
            Setara {nf(stT / cT, 2)} bulan konsumsi provinsi · <b>{nDef}</b> wilayah proyeksi defisit, {nTip} tipis
          </div>
        </Link>
        <Link className="link" to="/harga">
          <div className="stage">
            <span className="eyebrow">K3 · Pasar</span>
          </div>
          <div className="big">
            {rp(pAvg)} <small>/kg medium</small>
          </div>
          <div className="line">
            Prakiraan 4 pekan {rp(fAvg)} · <b>{nS}</b> Siaga, {nW} Waspada · SPHP {nf(tonS)} ton ke {new Set(FLOWS.map((f) => f.to.n)).size} wilayah
          </div>
        </Link>
      </div>

      <div className="grid-ov">
        <Panel
          className="map-panel"
          title="Peta 38 kabupaten/kota"
          actions={
            <div className="seg" role="group" aria-label="Lapisan peta">
              {LAYER_KEYS.map((l) => (
                <button key={l} type="button" aria-pressed={l === layer} onClick={() => chooseLayer(l)}>
                  {LAYERS[l].label}
                </button>
              ))}
            </div>
          }
        >
          <div className="map">
            <PetaJatim layer={layer} />
          </div>
          <MapLegend layer={layer} />
        </Panel>
        <KabCard />
      </div>

      <Panel title="Daftar perhatian pekan ini" note="Urut dari risiko tertinggi. Klik baris untuk memilih wilayah.">
        <DataTable rows={watch} columns={watchColumns} rowKey={(k) => k.n} rowName={(k) => k.n} />
      </Panel>
    </section>
  )
}

function KabCard() {
  const { sel } = useSelection()
  const k = byName[sel]
  const fl = FLOWS.filter((f) => f.to === k)
  const out = FLOWS.filter((f) => f.from === k)

  let rec: React.ReactNode
  if (fl.length) {
    const asal =
      fl.length > 3
        ? `${fl.length} gudang wilayah surplus, terdekat ${fl
            .slice(0, 2)
            .map((f) => `${f.from.n} (${nf(f.km)} km)`)
            .join(" dan ")}`
        : fl.map((f) => `gudang wilayah ${f.from.n} (${nf(f.km)} km)`).join(" dan ")
    rec = (
      <>
        <b>Rekomendasi:</b> salurkan beras SPHP {nf(sum(fl, (f) => f.ton))} ton dari {asal}, tiba sebelum {dfmt(fcDates[1])}.
      </>
    )
  } else if (out.length) {
    rec = (
      <>
        <b>Wilayah pemasok:</b> stok surplus. Gudang di wilayah ini direkomendasikan memasok {nf(sum(out, (f) => f.ton))} ton SPHP ke{" "}
        {out.map((f) => f.to.n).join(", ")}.
      </>
    )
  } else if (k.hs !== "aman") {
    rec = (
      <>
        <b>Rekomendasi:</b> harga mendekati HET. Pantau pasar utama dan siapkan Gerakan Pangan Murah bila harga pekan depan naik lagi.
      </>
    )
  } else {
    rec = (
      <>
        <b>Kondisi terkendali.</b> Tidak ada intervensi yang disarankan pekan ini.
      </>
    )
  }

  return (
    <aside className="panel" aria-live="polite">
      <div className="kab-h">
        <div>
          <div className="eyebrow">
            {k.isKota ? "Kota" : "Kabupaten"} · {nf(k.pop * 1000)} jiwa
          </div>
          <h3>{k.n}</h3>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
          <HargaPill s={k.hs} />
          <StokPill s={k.ss} />
        </div>
      </div>
      <div className="facts">
        <div className="fact has-spark">
          <span className="k">Harga beras medium, kini → +4 pekan</span>
          <span className="v">
            {rp(k.pNow)} <small>→ {rp(k.p4)}</small>
          </span>
          <Sparkline vals={k.price.slice(-12)} color="var(--ink-2)" fc={k.fc.map((f) => f.m)} />
          <span className="sub">HET Rp13.500 · premium {rp(k.prem)}</span>
        </div>
        <div className="fact has-spark">
          <span className="k">Cakupan stok, kini → +4 pekan</span>
          <span className="v">
            {nf(k.cov, 2)} <small>→ {nf(k.covP[3], 2)} bln</small>
          </span>
          <Sparkline vals={k.covH.slice(-12)} color="var(--ink-2)" fc={k.covP.slice(0, 4)} />
          <span className="sub">
            ≈ {nf(k.cov * k.C * 1000)} ton beras · konsumsi {nf(k.C * 1000)} ton/bln
          </span>
        </div>
        <div className="fact">
          <span className="k">Proyeksi panen Nov–Jan</span>
          <span className="v">
            {k.est < 10 ? nf(k.est * 1000) : nf(k.est, 1)} <small>{k.est < 10 ? "ton" : "rb ton"} GKG</small>
          </span>
          <span className="sub">
            ±{nf((k.ci / k.est) * 100, 0)}% (selang 90%) · <span className="delta-dn">{nf(k.yoy * 100, 1)}%</span> vs 2025
          </span>
        </div>
        <div className="fact">
          <span className="k">Sawah berdiri (vegetatif + generatif)</span>
          <span className="v">
            {nf(k.ph[2] + k.ph[3], 0)}
            <small>%</small>
          </span>
          <span className="sub">
            {nf(k.ha)} ha baku sawah · {nf(k.lag, 1)}% petak tertinggal (indeks vegetasi rendah)
          </span>
        </div>
      </div>
      <div className="rec">{rec}</div>
    </aside>
  )
}
