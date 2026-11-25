import { useEffect, useRef, useState } from "react"
import { ChevronDown } from "lucide-react"
import { MapLegend, PetaJatim, type MapArc } from "@/components/charts/PetaJatim"
import { CountUp } from "@/components/ui/CountUp"
import { REGIONS, regionOf, tradeFor } from "@/lib/arus"
import { FLOWS, WILAYAH, type LayerKey, type Wilayah } from "@/lib/data"
import { useSesi } from "@/lib/sesi"
import { NOW, dfmt, nf, short, sum } from "@/lib/format"
import { BULAN_KINI } from "@/lib/filter"
import { covBulan, produksiPrevRentang, produksiRentang, statusHargaAt } from "@/lib/petaLayers"

interface Step {
  key: string
  k: string
  title: string
  text: React.ReactNode
  stat: { v: number; fmt: (v: number) => string; unit: string; from?: number }
  layer: LayerKey
  /** Nilai peta menggantikan nilai bawaan lapisan (mis. cakupan stok bulan tertentu). */
  getValue?: (k: Wilayah) => number
  valueLabel?: string
  /** Judul legenda peta. */
  legend?: string
  muted?: boolean
  arcs?: MapArc[]
  flows?: boolean
}

const AWAL = BULAN_KINI
const AKHIR = BULAN_KINI + 2
const DES = BULAN_KINI + 1

// Produksi beras Nov 2026 sampai Jan 2027 (K1) dan pembanding periode yang sama setahun sebelumnya (BPS Nov dan Des 2025, Jan 2026 dari K1).
const estT = sum(WILAYAH, (k) => produksiRentang(k, AWAL, AKHIR)) / 1000 // ribu ton beras
const prevT = sum(WILAYAH, (k) => produksiPrevRentang(k, AWAL, AKHIR)) / 1000
const yoy = (estT / prevT - 1) * 100
const tanda = (v: number) => (v < 0 ? "−" : "+")
const luasRb = (estT * 1000) / 3.3 / 1000
const lumbung = WILAYAH.slice().sort((a, b) => produksiRentang(b, AWAL, AKHIR) - produksiRentang(a, AWAL, AKHIR)).slice(0, 3).map((k) => short(k.n))
const gabung = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")}, dan ${xs[xs.length - 1]}` : (xs[0] ?? ""))

const nDef = WILAYAH.filter((k) => covBulan(k, DES) < 0.75).length
const nTip = WILAYAH.filter((k) => covBulan(k, DES) >= 0.75 && covBulan(k, DES) < 1).length
const terendah = WILAYAH.slice().sort((a, b) => covBulan(a, DES) - covBulan(b, DES))[0]

const arusBulan = tradeFor(AWAL)
const arusTotal = arusBulan.reduce((a, t) => a + t.ton, 0)
const arusTerbesar = arusBulan[0]

const hitung = (kom: "medium" | "premium", st: "waspada" | "siaga") => WILAYAH.filter((k) => statusHargaAt(k, 4, kom) === st).length
const nWm = hitung("medium", "waspada")
const nSm = hitung("medium", "siaga")
const nWp = hitung("premium", "waspada")
const nSp = hitung("premium", "siaga")
const nPerhatianM = nWm + nSm
const nPerhatianP = nWp + nSp

const tonS = sum(FLOWS, (f) => f.ton)
const nPenerima = new Set(FLOWS.filter((f) => f.from !== f.to).map((f) => f.to.n)).size

const STEPS: Step[] = [
  {
    key: "sawah",
    k: "01 Sawah",
    title: "Awal tanam dibaca dari satelit",
    text: (
      <>
        Sentinel-2 membaca kehijauan dan kandungan air sawah tiap 12 hari. Sawah yang tergenang tapi belum hijau dianggap baru ditanami, dan panennya dihitung
        sekitar 96 hari kemudian. Kalau awan menutup, radar Sentinel-1 dipakai untuk mengisi celahnya.
      </>
    ),
    stat: { v: luasRb, fmt: (v) => nf(v, 0), unit: "ribu ha luas panen Nov–Jan" },
    layer: "produksi",
    getValue: (k) => produksiRentang(k, AWAL, AKHIR) / 1000,
    valueLabel: "Produksi beras Nov–Jan",
    legend: "Produksi beras Nov 2026 sampai Jan 2027, ribu ton",
  },
  {
    key: "panen",
    k: "02 Panen",
    title: yoy < 0 ? "Panen Nov–Jan lebih kecil dari tahun lalu" : "Panen Nov–Jan lebih besar dari tahun lalu",
    text: (
      <>
        Dari luas panen itu, model memperkirakan {nf(estT / 1000, 2)} juta ton beras untuk November sampai Januari, {yoy < 0 ? "turun" : "naik"} {nf(Math.abs(yoy), 1)}% dari
        periode yang sama tahun lalu menurut BPS. Penyumbang terbesarnya {gabung(lumbung)}. Galatnya sekitar 14% per kabupaten untuk tiga bulan ke depan.
      </>
    ),
    stat: { v: Math.abs(yoy), fmt: (v) => tanda(yoy) + nf(v, 1) + "%", unit: "proyeksi panen dibanding setahun lalu" },
    layer: "produksi",
    getValue: (k) => produksiRentang(k, AWAL, AKHIR) / 1000,
    valueLabel: "Produksi beras Nov–Jan",
    legend: "Produksi beras Nov 2026 sampai Jan 2027, ribu ton",
  },
  {
    key: "stok",
    k: "03 Stok",
    title: "Stok di beberapa wilayah mulai tipis",
    text: (
      <>
        Stok beras di luar gudang Bulog dihitung dari selisih produksi dan konsumsi tiap bulan. Pada akhir Desember, {nDef} wilayah diperkirakan di bawah 0,75 bulan
        konsumsi (defisit) dan {nTip} lainnya di bawah satu bulan (tipis). Yang paling rendah {terendah.n}. Yang lebih bisa dipegang adalah urutan antarwilayah, bukan
        angka stok mutlaknya.
      </>
    ),
    stat: { v: nDef, fmt: (v) => nf(v), unit: "wilayah defisit akhir Desember" },
    layer: "stokK2",
    getValue: (k) => covBulan(k, DES),
    valueLabel: "Cakupan stok akhir Des",
    legend: "Cakupan stok non-Bulog, akhir Des 2026",
  },
  {
    key: "arus",
    k: "04 Arus",
    title: "Beras bergerak ke wilayah yang kurang",
    text: (
      <>
        Wilayah yang produksinya melebihi konsumsi mengirim ke yang kekurangan. Perkiraannya sekitar {nf(arusTotal / 1000, 1)} ribu ton per bulan berpindah antarkabupaten,
        terbesar dari {arusTerbesar ? `${short(arusTerbesar.from.n)} ke ${short(arusTerbesar.to.n)}` : "-"}. Ini hasil hitungan model, bukan data pengiriman.
      </>
    ),
    stat: { v: arusTotal / 1000, fmt: (v) => nf(v, 1), unit: "ribu ton beras per bulan" },
    layer: "stokK2",
    getValue: (k) => covBulan(k, AWAL),
    valueLabel: "Cakupan stok akhir Nov",
    legend: "Cakupan stok non-Bulog, akhir Nov 2026",
    muted: true,
    arcs: arusBulan.slice(0, 22).map((t) => ({ from: t.from.n, to: t.to.n, ton: t.ton, color: regionOf[t.from.n].color })),
  },
  {
    key: "harga",
    k: "05 Pasar",
    title: "Harga dan batas HET",
    text: (
      <>
        Harga dilihat 28 hari ke depan terhadap HET. Untuk beras medium ada {nWm} wilayah berstatus Waspada dan {nSm} Siaga. Untuk premium ada {nWp} Waspada dan {nSp} Siaga.
        Prakiraannya hanya melanjutkan harga terakhir dan sebaran perubahan setahun terakhir, jadi lebih tepat dibaca sebagai peringatan dini.
      </>
    ),
    stat: { v: nPerhatianM, fmt: (v) => nf(v), unit: `wilayah Waspada atau Siaga untuk medium, ${nPerhatianP} untuk premium` },
    layer: "harga",
  },
  {
    key: "aksi",
    k: "06 Tindakan",
    title: "Menyiapkan penyaluran SPHP",
    text: (
      <>
        Bulog bisa melepas beras SPHP dari cabangnya ke kabupaten yang stoknya kurang. Rekomendasi terbaru {nf(tonS)} ton lewat {FLOWS.length} rute, dengan {nPenerima} wilayah
        penerima untuk November sampai Januari. Anggaran rilis dan lokasi cabang masih asumsi, jadi anggap ini rancangan.
      </>
    ),
    stat: { v: tonS, fmt: (v) => nf(v), unit: "ton SPHP direkomendasikan" },
    layer: "harga",
    flows: true,
  },
]

/** Versi langkah "Tindakan" untuk pengunjung tanpa login: tanpa angka dan rute SPHP. */
const STEP_AKSI_UMUM: Step = {
  ...STEPS[STEPS.length - 1],
  text: (
    <>
      Bulog bisa melepas beras SPHP dari cabangnya ke kabupaten yang stoknya kurang. Rincian rute dan volumenya hanya tersedia untuk akun dinas dan perusahaan mitra.
      Warga tetap bisa mengecek harga lewat WhatsApp.
    </>
  ),
  stat: { v: nPerhatianM, fmt: (v) => nf(v), unit: `wilayah Waspada atau Siaga untuk medium, ${nPerhatianP} untuk premium` },
  flows: false,
}

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

  const sphp = useSesi().boleh("dasbor_sphp")
  const steps = sphp ? STEPS : STEPS.map((x) => (x.key === "aksi" ? STEP_AKSI_UMUM : x))
  const st = steps[active]

  return (
    <section className="story">
      <header className="story-hero">
        <div className="story-hero-txt">
          <div className="story-kicker">
            <span>Laporan pekan</span>
            <span>Data per {dfmt(NOW)} 2026</span>
          </div>
          <h1>Dari sawah ke pasar</h1>
          <p className="story-dek">
            Panen November sampai Januari diperkirakan {yoy < 0 ? "lebih kecil" : "lebih besar"} dari tahun lalu, stok di beberapa kota mulai tipis, dan harga di sejumlah wilayah sudah
            di atas HET. Enam bagian di bawah menelusuri rantainya, dari sawah sampai beras SPHP.
          </p>
          <p className="story-byline">
            Sumber: citra Sentinel-1 dan Sentinel-2, data BPS dan Bulog, serta harga harian SISKAPERBAPO. Semua angka adalah hasil model dan masih punya galat.
          </p>
          <a className="story-cue" href="#langkah-1">
            Mulai membaca <ChevronDown size={15} />
          </a>
        </div>
        <aside className="story-facts" aria-label="Pekan ini dalam tiga angka">
          <div className="story-facts-h">Pekan ini dalam tiga angka</div>
          <a href="#langkah-2">
            <b>{tanda(yoy)}{nf(Math.abs(yoy), 1)}%</b>
            <span>proyeksi panen Nov–Jan dibanding periode yang sama tahun lalu</span>
          </a>
          <a href="#langkah-3">
            <b>{nDef}</b>
            <span>kabupaten/kota diperkirakan defisit stok pada akhir Desember</span>
          </a>
          <a href="#langkah-5">
            <b>{nPerhatianM}</b>
            <span>wilayah berstatus Waspada atau Siaga untuk beras medium, dan {nPerhatianP} untuk premium</span>
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
              <PetaJatim layer={st.layer} getValue={st.getValue} valueLabel={st.valueLabel} muted={st.muted} arcs={st.arcs} flows={st.flows} labels={!st.arcs && !st.flows} />
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
              <MapLegend layer={st.layer} title={st.legend} />
            )}
            <div className="story-dots" aria-hidden="true">
              {steps.map((s, i) => (
                <span key={s.key} className={i === active ? "on" : i < active ? "done" : undefined} />
              ))}
            </div>
          </div>
        </div>
        <div className="story-steps">
          {steps.map((s, i) => (
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

    </section>
  )
}
