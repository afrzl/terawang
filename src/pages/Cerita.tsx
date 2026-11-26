import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown } from "lucide-react"
import { MapLegend, PetaJatim, type MapArc } from "@/components/charts/PetaJatim"
import { CountUp } from "@/components/ui/CountUp"
import { REGIONS, regionOf } from "@/lib/arus"
import { byName, type Flow, type Wilayah } from "@/lib/data"
import { useSesi } from "@/lib/sesi"
import { nf } from "@/lib/format"
import { susunFakta, type LangkahFakta, type PetaLangkah } from "@/lib/ceritaFakta"

/** Edisi pekanan dari /api/cerita (lihat api/src/cerita.ts). */
interface LangkahEdisi {
  key: string
  k: string
  judul: string
  teks: string
  stat: { v: number; teks: string; unit: string }
  peta: PetaLangkah
}
interface Edisi {
  pekan: string
  terbit: string
  data_per_label: string
  sumber: "openai" | "templat"
  judul: string
  dek: string
  tigaAngka: { teks: string; label: string; href: string }[]
  langkah: LangkahEdisi[]
  aksi_sphp?: LangkahEdisi
  banding: { kini: Record<string, number | null>; lalu: Record<string, number | null> | null; pekan_lalu: string | null }
}
interface RingkasEdisi {
  pekan: string
  terbit: string
  judul: string
}

const BLN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
/** "2026-W48" -> "Pekan 48, 23–29 Nov 2026". */
function labelPekan(p: string) {
  const m = p.match(/^(\d{4})-W(\d{2})$/)
  if (!m) return p
  const th = +m[1]
  const no = +m[2]
  const jan4 = new Date(Date.UTC(th, 0, 4))
  const senin = new Date(+jan4 - ((jan4.getUTCDay() || 7) - 1) * 864e5 + (no - 1) * 7 * 864e5)
  const minggu = new Date(+senin + 6 * 864e5)
  const a = senin.getUTCMonth() === minggu.getUTCMonth() ? `${senin.getUTCDate()}` : `${senin.getUTCDate()} ${BLN[senin.getUTCMonth()]}`
  return `Pekan ${no}, ${a}–${minggu.getUTCDate()} ${BLN[minggu.getUTCMonth()]} ${minggu.getUTCFullYear()}`
}

async function muatJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { headers: { Accept: "application/json" }, credentials: "same-origin" })
    return r.ok && (r.headers.get("content-type") ?? "").includes("json") ? ((await r.json()) as T) : null
  } catch {
    return null
  }
}

/** Cadangan bila belum ada edisi di server: fakta dihitung langsung di browser dengan teks templat. */
let cadangan: ReturnType<typeof susunFakta> | null = null
const faktaLangsung = () => (cadangan ??= susunFakta())
const keEdisi = (l: LangkahFakta): LangkahEdisi => ({ key: l.key, k: l.k, judul: l.judul, teks: l.teks, stat: l.stat, peta: l.peta })

/** Kunci angka pekan lalu untuk tiap baris "tiga angka". */
const KUNCI_TIGA = ["perubahan_panen_persen", "wilayah_defisit", "wilayah_perhatian_harga_medium"]
const fmtBanding = (kunci: string, v: number) => (kunci === "perubahan_panen_persen" ? `${v < 0 ? "−" : "+"}${nf(Math.abs(v), 1)}%` : nf(v))

/** Format angka stat mengikuti teks jadinya (tanda, jumlah desimal, persen) supaya animasi hitung berakhir persis di teks itu. */
function fmtStat(teks: string) {
  const m = teks.match(/^([−+-]?)([\d.,]*)(%?)$/)
  if (!m) return () => teks
  const dec = (m[2].split(",")[1] ?? "").length
  return (v: number) => m[1] + nf(v, dec) + m[3]
}

interface Tampil {
  key: string
  k: string
  judul: string
  teks: string
  stat: { v: number; teks: string; unit: string }
  layer: PetaLangkah["layer"]
  getValue?: (k: Wilayah) => number
  valueLabel?: string
  legend?: string
  muted?: boolean
  arcs?: MapArc[]
  flowList?: Flow[]
}

function tampilkan(l: LangkahEdisi): Tampil {
  const p = l.peta
  const nilai = p.nilai
  return {
    key: l.key,
    k: l.k,
    judul: l.judul,
    teks: l.teks,
    stat: l.stat,
    layer: p.layer,
    getValue: nilai ? (k) => nilai[k.n] ?? 0 : undefined,
    valueLabel: p.valueLabel,
    legend: p.legend,
    muted: p.muted,
    arcs: p.arcs?.filter((a) => regionOf[a.from]).map((a) => ({ ...a, color: regionOf[a.from].color })),
    flowList: p.flows
      ?.filter((f) => byName[f.dari] && byName[f.ke])
      .map((f) => ({ from: byName[f.dari], to: byName[f.ke], ton: f.ton, km: f.km, bulan: f.bulan })),
  }
}

export default function Cerita() {
  const [active, setActive] = useState(0)
  const refs = useRef<(HTMLElement | null)[]>([])
  const [pekan, setPekan] = useState<string | null>(null)
  const [edisi, setEdisi] = useState<Edisi | null>(null)
  const [arsip, setArsip] = useState<RingkasEdisi[]>([])
  const [memuat, setMemuat] = useState(true)

  useEffect(() => {
    muatJson<RingkasEdisi[]>("/api/cerita/arsip").then((xs) => setArsip(xs ?? []))
  }, [])
  useEffect(() => {
    let batal = false
    setMemuat(true)
    muatJson<Edisi>(pekan ? `/api/cerita?pekan=${encodeURIComponent(pekan)}` : "/api/cerita").then((e) => {
      if (batal) return
      setEdisi(e)
      setMemuat(false)
    })
    return () => {
      batal = true
    }
  }, [pekan])

  const sphp = useSesi().boleh("dasbor_sphp")

  // Edisi dari server bila ada; selain itu fakta langsung dari data dasbor dengan teks templat.
  const isi = useMemo(() => {
    if (edisi) {
      const langkah = edisi.langkah.map((l) => (l.key === "aksi" && sphp && edisi.aksi_sphp ? edisi.aksi_sphp : l))
      return { ...edisi, langkah }
    }
    if (memuat) return null
    const f = faktaLangsung()
    const langkah = f.langkah.map((l) => keEdisi(l.key === "aksi" && !sphp ? f.aksiUmum : l))
    return { pekan: null, data_per_label: f.data_per_label, sumber: "langsung" as const, judul: f.judul, dek: f.dek, tigaAngka: f.tigaAngka, langkah, banding: null }
  }, [edisi, memuat, sphp])

  const steps = useMemo(() => (isi ? isi.langkah.map(tampilkan) : []), [isi])
  const st = steps[Math.min(active, steps.length - 1)]

  // langkah baru dirender sesudah edisi termuat, jadi pengamat dipasang ulang saat daftar langkah berganti
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i))
      },
      { rootMargin: "-48% 0px -48% 0px" },
    )
    refs.current.forEach((el) => el && io.observe(el))
    return () => io.disconnect()
  }, [steps])
  const lalu = isi?.banding?.lalu ?? null

  return (
    <section className="story">
      <header className="story-hero">
        <div className="story-hero-txt">
          <div className="story-kicker">
            <span>Laporan pekan{isi?.pekan ? ` · ${labelPekan(isi.pekan)}` : ""}</span>
            <span>{isi ? `Data per ${isi.data_per_label}` : "Memuat edisi"}</span>
          </div>
          <h1>{isi?.judul ?? "Dari sawah ke pasar"}</h1>
          <p className="story-dek">{isi?.dek ?? "\u00a0"}</p>
          <p className="story-byline">
            {isi?.sumber === "openai"
              ? "Narasi disusun otomatis tiap Senin pagi dari hasil model terbaru, lalu setiap angkanya dicocokkan dengan data. "
              : "Edisi pekan ini belum terbit, jadi angka di bawah dihitung langsung dari data terbaru. "}
            Sumber: citra Sentinel-1 dan Sentinel-2, data BPS dan Bulog, serta harga harian SISKAPERBAPO. Semua angka adalah hasil model dan masih punya galat.
          </p>
          <div className="story-cue-row">
            <a className="story-cue" href="#langkah-1">
              Mulai membaca <ChevronDown size={15} />
            </a>
            {arsip.length > 0 && (
              <label className="story-arsip">
                <span>Edisi</span>
                <select value={pekan ?? isi?.pekan ?? ""} onChange={(e) => setPekan(e.target.value || null)}>
                  {!isi?.pekan && <option value="">Data langsung</option>}
                  {arsip.map((a) => (
                    <option key={a.pekan} value={a.pekan}>
                      {labelPekan(a.pekan)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>
        <aside className="story-facts" aria-label="Pekan ini dalam tiga angka">
          <div className="story-facts-h">Pekan ini dalam tiga angka</div>
          {isi?.tigaAngka.map((t, i) => {
            const v = lalu?.[KUNCI_TIGA[i]]
            return (
              <a key={t.href} href={t.href}>
                <b>{t.teks}</b>
                <span>
                  {t.label}
                  {typeof v === "number" && <em className="story-lalu">Pekan lalu {fmtBanding(KUNCI_TIGA[i], v)}</em>}
                </span>
              </a>
            )
          })}
        </aside>
      </header>

      {st && (
        <div className="story-body">
          <div className="story-sticky">
            <div className="story-vis panel">
              <div className="story-vis-h">
                <span className="eyebrow">{st.k}</span>
                <div className="story-stat" key={`${isi?.pekan}-${st.key}`}>
                  <b>
                    <CountUp value={st.stat.v} format={fmtStat(st.stat.teks)} duration={900} />
                  </b>
                  <span>{st.stat.unit}</span>
                </div>
              </div>
              <div className="map">
                <PetaJatim
                  layer={st.layer}
                  getValue={st.getValue}
                  valueLabel={st.valueLabel}
                  muted={st.muted}
                  arcs={st.arcs}
                  flows={!!st.flowList?.length}
                  flowList={st.flowList}
                  labels={!st.arcs && !st.flowList?.length}
                />
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
                  <h2>{s.judul}</h2>
                  <p>{s.teks}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
