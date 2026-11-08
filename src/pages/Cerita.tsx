import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { ArrowRight, ChevronDown, MessageCircle } from "lucide-react"
import { MapLegend, PetaJatim, type MapArc } from "@/components/charts/PetaJatim"
import { CountUp } from "@/components/ui/CountUp"
import { REGIONS, TRADE, TRADE_TOTAL, regionOf } from "@/lib/arus"
import { FLOWS, WILAYAH, type LayerKey } from "@/lib/data"
import { nf, sum } from "@/lib/format"

interface Step {
  key: string
  k: string
  title: string
  text: React.ReactNode
  stat: { v: number; fmt: (v: number) => string; unit: string; from?: number }
  layer: LayerKey
  muted?: boolean
  arcs?: MapArc[]
  flows?: boolean
}

const estT = sum(WILAYAH, (k) => k.est)
const prevT = sum(WILAYAH, (k) => k.prev)
const yoy = (estT / prevT - 1) * 100
const lagHa = sum(WILAYAH, (k) => (k.ha * k.lag) / 100)
const nDef = WILAYAH.filter((k) => k.ss === "defisit").length
const nTip = WILAYAH.filter((k) => k.ss === "tipis").length
const nS = WILAYAH.filter((k) => k.hs === "siaga").length
const nW = WILAYAH.filter((k) => k.hs === "waspada").length
const tonS = sum(FLOWS, (f) => f.ton)

const STEPS: Step[] = [
  {
    key: "sawah",
    k: "01 · Sawah",
    title: "Hujan datang terlambat",
    text: (
      <>
        Radar Sentinel-1 menembus awan dan membaca genangan sawah setiap 12 hari. Musim ini genangan muncul 2–3 pekan lebih lambat dari rata-rata tiga
        musim terakhir, jadi tanam MT I ikut mundur. Petak yang tertinggal ditandai dari citra Sentinel-2.
      </>
    ),
    stat: { v: lagHa / 1000, fmt: (v) => nf(v, 1), unit: "ribu ha petak tertinggal" },
    layer: "fase",
  },
  {
    key: "panen",
    k: "02 · Panen",
    title: "Panen Nov–Jan menyusut",
    text: (
      <>
        Luas tanam dan fase tumbuh diubah menjadi proyeksi produksi, lalu dikalibrasi ke ubinan BPS. Hasilnya {nf(estT / 1000, 2)} juta ton GKG, turun{" "}
        {nf(Math.abs(yoy), 1)}% dari periode yang sama tahun lalu. Lumbung di utara dan barat tetap terbesar.
      </>
    ),
    stat: { v: Math.abs(yoy), fmt: (v) => "−" + nf(v, 1) + "%", unit: "proyeksi panen vs 2025" },
    layer: "produksi",
  },
  {
    key: "stok",
    k: "03 · Stok",
    title: "Stok kota dan Madura menipis",
    text: (
      <>
        Filter Kalman menaksir stok beredar tiap pekan dari produksi, konsumsi, dan data stok Bulog. Wilayah dengan sawah sedikit paling cepat habis:{" "}
        {nDef} wilayah diproyeksikan defisit dalam 4 pekan dan {nTip} lainnya tipis.
      </>
    ),
    stat: { v: nDef, fmt: (v) => nf(v), unit: "wilayah defisit dalam 4 pekan" },
    layer: "stok",
  },
  {
    key: "arus",
    k: "04 · Arus",
    title: "Beras berpindah ke yang kekurangan",
    text: (
      <>
        Selisih produksi dan konsumsi menggerakkan beras dari lumbung ke kota. Model gravitasi menaksir sekitar {nf(TRADE_TOTAL / 1000, 1)} ribu ton
        bergerak tiap bulan. Bila panen di lumbung mundur, arus ini mengecil dan wilayah penerima merasakannya lebih dulu.
      </>
    ),
    stat: { v: TRADE_TOTAL / 1000, fmt: (v) => nf(v, 1), unit: "ribu ton beras per bulan" },
    layer: "stok",
    muted: true,
    arcs: TRADE.slice(0, 22).map((t) => ({ from: t.from.n, to: t.to.n, ton: t.ton, color: regionOf[t.from.n].color })),
  },
  {
    key: "harga",
    k: "05 · Pasar",
    title: "Harga merambat ke HET",
    text: (
      <>
        Prakiraan harga 4 pekan memakai produksi dan stok sebagai penjelas. {nS} wilayah diprakirakan melewati HET lebih dari 3% (Siaga) dan {nW}{" "}
        lainnya mendekati HET (Waspada).
      </>
    ),
    stat: { v: nS, fmt: (v) => nf(v), unit: `wilayah Siaga · ${nW} Waspada` },
    layer: "harga",
  },
  {
    key: "aksi",
    k: "06 · Tindakan",
    title: "Bertindak sebelum harga naik",
    text: (
      <>
        Wilayah Siaga dipasangkan dengan gudang surplus terdekat untuk penyaluran beras SPHP, {nf(tonS)} ton dalam {FLOWS.length} rute. Warga bisa
        mengecek harga dan lokasi SPHP lewat WhatsApp tanpa membuka dasbor.
      </>
    ),
    stat: { v: tonS, fmt: (v) => nf(v), unit: "ton SPHP direkomendasikan" },
    layer: "harga",
    flows: true,
  },
]

export default function Cerita() {
  const [active, setActive] = useState(0)
  const refs = useRef<(HTMLElement | null)[]>([])

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i))
      },
      { rootMargin: "-48% 0px -48% 0px" },
    )
    refs.current.forEach((el) => el && io.observe(el))
    return () => io.disconnect()
  }, [])

  const st = STEPS[active]

  return (
    <section className="story">
      <header className="story-hero">
        <div className="story-hero-txt">
          <div className="story-kicker">Laporan pekanan · Pekan 44, 1 November 2026</div>
          <h1>Dari sawah ke pasar</h1>
          <p className="story-dek">
            Hujan yang datang terlambat memundurkan tanam di sawah. Dampaknya merambat pelan: panen menyusut, stok di kota menipis, lalu harga mulai
            menyentuh HET. Enam bagian berikut menelusuri rantai itu dan apa yang bisa dilakukan sebelum terlambat.
          </p>
          <p className="story-byline">
            Disusun dari radar Sentinel-1, citra Sentinel-2, data stok Bulog, dan Panel Harga Pangan Bapanas. Angka di prototipe ini adalah simulasi.
          </p>
          <a className="story-cue" href="#langkah-1">
            Mulai membaca <ChevronDown size={15} />
          </a>
        </div>
        <aside className="story-facts" aria-label="Pekan ini dalam tiga angka">
          <div className="story-facts-h">Pekan ini dalam tiga angka</div>
          <a href="#langkah-2">
            <b>−{nf(Math.abs(yoy), 1)}%</b>
            <span>proyeksi panen Nov–Jan dibanding periode yang sama tahun lalu</span>
          </a>
          <a href="#langkah-3">
            <b>{nDef}</b>
            <span>kabupaten/kota diproyeksikan kekurangan stok dalam empat pekan</span>
          </a>
          <a href="#langkah-5">
            <b>{nS}</b>
            <span>wilayah dengan prakiraan harga lebih dari 3% di atas HET</span>
          </a>
        </aside>
      </header>

      <div className="story-body">
        <div className="story-sticky">
          <div className="story-vis panel">
            <div className="story-vis-h">
              <span className="eyebrow">{st.k}</span>
              <div className="story-stat" key={st.key}>
                <b>
                  <CountUp value={st.stat.v} format={st.stat.fmt} duration={900} />
                </b>
                <span>{st.stat.unit}</span>
              </div>
            </div>
            <div className="map">
              <PetaJatim layer={st.layer} muted={st.muted} arcs={st.arcs} flows={st.flows} labels={!st.arcs && !st.flows} />
            </div>
            {st.arcs ? (
              <div className="legend">
                <span className="ttl">Warna arus = kawasan asal</span>
                {REGIONS.map((r) => (
                  <span key={r.key}>
                    <span className="sw" style={{ background: r.color }} />
                    {r.short}
                  </span>
                ))}
              </div>
            ) : (
              <MapLegend layer={st.layer} />
            )}
            <div className="story-dots" aria-hidden="true">
              {STEPS.map((s, i) => (
                <span key={s.key} className={i === active ? "on" : i < active ? "done" : undefined} />
              ))}
            </div>
          </div>
        </div>
        <div className="story-steps">
          {STEPS.map((s, i) => (
            <article
              key={s.key}
              id={`langkah-${i + 1}`}
              data-i={i}
              ref={(el) => {
                refs.current[i] = el
              }}
              className={`story-step${i === active ? " is-on" : ""}`}
            >
              <div className="story-card">
                <div className="eyebrow">{s.k}</div>
                <h2>{s.title}</h2>
                <p>{s.text}</p>
              </div>
            </article>
          ))}
        </div>
      </div>

      <footer className="story-end">
        <h2>Semua angka ini diperbarui tiap pekan.</h2>
        <div className="story-cta">
          <Link to="/" className="btn primary">
            Buka ringkasan pekan ini <ArrowRight size={16} />
          </Link>
          <Link to="/whatsapp" className="btn">
            <MessageCircle size={16} /> Lihat kanal warga
          </Link>
        </div>
      </footer>
    </section>
  )
}
