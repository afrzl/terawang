import { useEffect, useMemo, useState } from "react"
import { MoveHorizontal } from "lucide-react"
import { WILAYAH, byName, type Wilayah } from "@/lib/data"
import { hash, nf, rng } from "@/lib/format"
import { useSelection } from "@/lib/selection"

const W = 720
const H = 420

type Land = "bera" | "olah" | "genang" | "muda" | "veg" | "gen" | "lag"

/** Warna komposit warna alami (tidak ikut tema, karena mewakili citra). [hue, saturasi, terang] */
const HSL: Record<Land, [number, number, number]> = {
  bera: [37, 30, 60],
  olah: [28, 24, 41],
  genang: [197, 30, 33],
  muda: [150, 24, 37],
  veg: [94, 46, 41],
  gen: [70, 48, 47],
  lag: [34, 26, 55],
}

const LAND_LABEL: [Land, string][] = [
  ["bera", "Bera / tanah kering"],
  ["olah", "Olah tanah"],
  ["genang", "Genangan"],
  ["muda", "Bibit baru tanam"],
  ["veg", "Vegetatif"],
  ["gen", "Generatif"],
]

interface Parcel {
  x: number
  y: number
  w: number
  h: number
  before: Land
  after: Land
  j: number
}

interface Village {
  x: number
  y: number
  trees: [number, number, number][]
  roofs: [number, number, number, number][]
}

function buildScene(k: Wilayah) {
  const R = rng(hash(k.n + "sat"))
  const standing = (k.ph[2] + k.ph[3]) / 100
  const young = k.ph[1] / 100
  const lag = k.lag / 100
  const parcels: Parcel[] = []
  let y = -90
  let row = 0
  while (y < H + 90) {
    const rh = 15 + R() * 13
    const rowBias = R()
    let x = -110
    while (x < W + 110) {
      const pw = 20 + R() * 46
      const u = 0.55 * rowBias + 0.45 * R()
      const ub = R()
      const before: Land = ub < 0.66 ? "bera" : ub < 0.86 ? "olah" : "genang"
      let after: Land
      if (u < standing * 0.78) after = "veg"
      else if (u < standing) after = "gen"
      else if (u < standing + young) after = "muda"
      else if (u < standing + young + lag) after = "lag"
      else after = R() < 0.5 ? "genang" : "olah"
      parcels.push({ x, y, w: pw - 2.4, h: rh - 2.4, before, after, j: R() * 2 - 1 })
      x += pw
    }
    y += rh
    row++
  }
  const villages: Village[] = [...Array(3)].map(() => {
    const vx = 80 + R() * (W - 160)
    const vy = 70 + R() * (H - 140)
    const trees: [number, number, number][] = [...Array(26)].map(() => [vx + (R() - 0.5) * 120, vy + (R() - 0.5) * 70, 5 + R() * 7])
    const roofs: [number, number, number, number][] = [...Array(14)].map(() => [
      vx + (R() - 0.5) * 96,
      vy + (R() - 0.5) * 52,
      5 + R() * 6,
      4 + R() * 4,
    ])
    return { x: vx, y: vy, trees, roofs }
  })
  const n = parcels.length
  const share = (f: (p: Parcel) => boolean) => parcels.filter(f).length / n
  return {
    parcels,
    villages,
    rows: row,
    tilt: -6 - R() * 6,
    river: R() > 0.5,
    stat: {
      before: share((p) => p.before === "genang") * 100,
      after: share((p) => p.after === "veg" || p.after === "gen" || p.after === "muda") * 100,
      lag: share((p) => p.after === "lag") * 100,
    },
  }
}

type Scene = ReturnType<typeof buildScene>

const col = (l: Land, j: number) => {
  const [h, s, L] = HSL[l]
  return `hsl(${h} ${s}% ${L + j * 4}%)`
}

function SatImage({ scene, when }: { scene: Scene; when: "before" | "after" }) {
  const after = when === "after"
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width={W} height={H} fill={after ? "hsl(70 16% 52%)" : "hsl(45 18% 64%)"} />
      <g transform={`rotate(${scene.tilt} ${W / 2} ${H / 2})`}>
        {scene.parcels.map((p, i) => {
          const l = after ? p.after : p.before
          return (
            <rect
              key={i}
              x={p.x}
              y={p.y}
              width={p.w}
              height={p.h}
              fill={col(l, p.j)}
              stroke={after && l === "lag" ? "#E5484D" : undefined}
              strokeWidth={after && l === "lag" ? 1.8 : undefined}
            />
          )
        })}
      </g>
      {scene.river ? (
        <>
          <path
            d="M-20 70 C 170 150 250 30 410 120 S 650 270 760 210"
            fill="none"
            stroke="hsl(120 26% 22%)"
            strokeWidth={30}
            strokeLinecap="round"
            opacity={0.85}
          />
          <path d="M-20 70 C 170 150 250 30 410 120 S 650 270 760 210" fill="none" stroke="hsl(198 34% 27%)" strokeWidth={13} />
        </>
      ) : (
        <path d="M-20 300 C 200 280 300 350 470 320 S 650 260 760 280" fill="none" stroke="hsl(198 30% 32%)" strokeWidth={6} />
      )}
      <path d="M-20 360 L 760 230" stroke="hsl(40 10% 82%)" strokeWidth={5} />
      <path d="M260 -20 L 330 440" stroke="hsl(40 10% 78%)" strokeWidth={3} />
      {scene.villages.map((v, i) => (
        <g key={i}>
          {v.trees.map(([x, y, r], j) => (
            <circle key={j} cx={x} cy={y} r={r} fill={`hsl(118 30% ${18 + (j % 4) * 3}%)`} />
          ))}
          {v.roofs.map(([x, y, w, h], j) => (
            <rect key={j} x={x} y={y} width={w} height={h} fill={j % 3 ? "hsl(12 38% 48%)" : "hsl(30 8% 70%)"} />
          ))}
        </g>
      ))}
      <rect width={W} height={H} fill={after ? "hsl(200 40% 60%)" : "hsl(40 40% 70%)"} opacity={0.06} />
    </svg>
  )
}

/** Isi meta.json dari skrip GEE (gee-citra/terawang_citra_tanam.js), ditambah nama folder. */
interface CitraMeta {
  folder: string
  lokasi: string
  bbox: [number, number, number, number]
  kotak_km?: [number, number]
  tanggal_sebelum: string
  tanggal_sesudah: string
  mode_label: "aturan" | "dummy"
  jendela_hari?: number
  /** Tanggal akuisisi Sentinel-2 yang cukup cerah di jendela komposit tiap citra. */
  tanggal_citra?: { s2_sebelum: string[]; s2_sesudah: string[] }
  stat: {
    genang_sebelum_pct: number
    /** Petak yang NDVI-nya belum hijau (< 0,35) di citra awal: bera, baru diolah, atau tergenang. */
    belum_hijau_sebelum_pct?: number
    tertanam_sesudah_pct: number
    tertinggal_pct: number
    jumlah_petak: number
  }
}

type Tampilan = "alami" | "kelas" | "radar"
const TAMPILAN: [Tampilan, string][] = [
  ["alami", "Warna alami"],
  ["kelas", "Kelas petak"],
  ["radar", "Radar S1"],
]
const KELAS_LABEL: [string, string][] = [
  ["#A8865B", "Kering / bera"],
  ["#2F7FB8", "Tergenang (siap tanam)"],
  ["#3E9B4F", "Sudah tertanam"],
  ["#E5484D", "Tertinggal"],
]

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
const tgl = (s: string) => {
  const [y, m, d] = s.split("-").map(Number)
  return `${d} ${BULAN[m - 1]} ${y}`
}
/** Label tanggal citra: rentang akuisisi S2 cerah yang masuk komposit (mis. "3–13 Sep 2026"), atau tanggal acuan. */
function labelTanggal(acuan: string, cerah?: string[]) {
  if (!cerah?.length) return tgl(acuan)
  const a = cerah[0].split("-").map(Number)
  const b = cerah[cerah.length - 1].split("-").map(Number)
  if (cerah.length === 1 || cerah[0] === cerah[cerah.length - 1]) return tgl(cerah[0])
  if (a[0] === b[0] && a[1] === b[1]) return `${a[2]}–${b[2]} ${BULAN[b[1] - 1]} ${b[0]}`
  if (a[0] === b[0]) return `${a[2]} ${BULAN[a[1] - 1]} – ${b[2]} ${BULAN[b[1] - 1]} ${b[0]}`
  return `${tgl(cerah[0])} – ${tgl(cerah[cerah.length - 1])}`
}
const selisihHari = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000)
const BASE = import.meta.env.BASE_URL

/** Daftar citra GEE di public/citra/index.json; dimuat sekali. Kosong bila belum ada. */
let indeksCache: Promise<CitraMeta[]> | null = null
function muatIndeks() {
  indeksCache ??= fetch(`${BASE}citra/index.json`)
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => [])
  return indeksCache
}

/** Seberapa jelas perubahan sebelum -> sesudah tanam terlihat di kotak contoh: utamakan petak yang tergenang dulu lalu
 *  tertanam (kontras air -> hijau). Kotak yang sebelumnya sudah hijau (tergenang 0%) diurutkan sesudahnya menurut % tertanam. */
export function skorPerubahan(m: CitraMeta) {
  const { genang_sebelum_pct: g, belum_hijau_sebelum_pct: bh, tertanam_sesudah_pct: t } = m.stat
  const awal = bh ?? g
  return (awal >= 10 ? 1000 : 0) + (awal * t) / 100 + t / 1000
}

/** Daftar citra GEE (kosong sampai termuat). */
export function useCitraIndeks() {
  const [daftar, setDaftar] = useState<CitraMeta[]>([])
  useEffect(() => {
    muatIndeks().then(setDaftar)
  }, [])
  return daftar
}

/** Pembanding citra sebelum/sesudah tanam yang bisa digeser.
 *  Bila public/citra/index.json punya entri untuk kabupaten terpilih, dipakai citra Sentinel asli dari GEE;
 *  selain itu tampil ilustrasi simulasi. */
export function SatCompare({ wilayah, onPilih, kandidat }: { wilayah?: string; onPilih?: (n: string) => void; kandidat?: string[] } = {}) {
  const g = useSelection()
  const sel = wilayah ?? g.sel
  const select = onPilih ?? g.select
  const k = byName[sel]
  const [pos, setPos] = useState(50)
  const daftar = useCitraIndeks()
  const [mode, setMode] = useState<Tampilan>("alami")
  const asli = daftar.find((m) => m.lokasi.toLowerCase() === sel.toLowerCase())
  const scene = useMemo(() => buildScene(k), [k])
  const clip = `inset(0 0 0 ${pos}%)`

  const src = (when: "sebelum" | "sesudah") =>
    `${BASE}citra/${asli!.folder}/${when}${mode === "alami" ? "" : "_" + mode}.png`
  const stat = asli
    ? { before: asli.stat.belum_hijau_sebelum_pct ?? asli.stat.genang_sebelum_pct, after: asli.stat.tertanam_sesudah_pct, lag: asli.stat.tertinggal_pct }
    : scene.stat
  const adaBelumHijau = asli?.stat.belum_hijau_sebelum_pct != null

  // Pintasan wilayah: bila semua wilayah terpilih, tampilkan yang perubahannya paling terlihat (tergenang -> tertanam dulu);
  // bila disaring, tampilkan wilayah terpilih.
  const semua = !kandidat || kandidat.length >= WILAYAH.length
  const contoh = daftar
    .filter((m) => (!kandidat || kandidat.includes(m.lokasi)) && (!semua || m.stat.tertanam_sesudah_pct >= 20))
    .sort((a, b) => skorPerubahan(b) - skorPerubahan(a))
    .slice(0, 6)

  return (
    <div className="sat">
      {contoh.length > 1 && (
        <div className="wt-chips sat-contoh" role="group" aria-label="Contoh wilayah">
          <span className="sat-contoh-t">{semua ? "Contoh wilayah" : "Wilayah"}</span>
          {contoh.map((m) => (
            <button
              key={m.folder}
              type="button"
              className={`wt-chip${m.lokasi === sel ? " on" : ""}`}
              onClick={() => select(m.lokasi)}
              title={`${m.stat.belum_hijau_sebelum_pct != null ? `Petak belum hijau di citra awal ${nf(m.stat.belum_hijau_sebelum_pct, 0)}% · ` : ""}petak tergenang di citra awal ${nf(m.stat.genang_sebelum_pct, 0)}% · petak yang hijaunya bertambah ${nf(m.stat.tertanam_sesudah_pct, 0)}%`}
            >
              {m.lokasi} · {nf(m.stat.tertanam_sesudah_pct, 0)}%
            </button>
          ))}
        </div>
      )}
      {asli ? (
        <div className="seg" style={{ marginBottom: 8 }} role="group" aria-label="Jenis tampilan citra">
          {TAMPILAN.map(([m, t]) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
              {t}
            </button>
          ))}
        </div>
      ) : null}
      <div className="sat-stage">
        {asli ? <img className="sat-img" src={src("sebelum")} alt="" draggable={false} /> : <SatImage scene={scene} when="before" />}
        <div className="sat-after" style={{ clipPath: clip, WebkitClipPath: clip }}>
          {asli ? <img className="sat-img" src={src("sesudah")} alt="" draggable={false} /> : <SatImage scene={scene} when="after" />}
        </div>
        <div className="sat-handle" style={{ left: `${pos}%` }} aria-hidden="true">
          <span>
            <MoveHorizontal size={16} />
          </span>
        </div>
        <span className="sat-tag l">
          {asli ? labelTanggal(asli.tanggal_sebelum, asli.tanggal_citra?.s2_sebelum) : "30 Sep 2026"}
          <span className="x"> · awal</span>
        </span>
        <span className="sat-tag r">
          {asli ? labelTanggal(asli.tanggal_sesudah, asli.tanggal_citra?.s2_sesudah) : "30 Okt 2026"}
          <span className="x"> · terbaru</span>
        </span>
        <span className="sat-note">
          {asli
            ? `${mode === "radar" ? "Sentinel-1" : "Sentinel-2"} · petak dideteksi otomatis`
            : "Ilustrasi pola tanam"}
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={0.5}
          value={pos}
          onChange={(e) => setPos(+e.target.value)}
          aria-label="Geser pembanding citra tanggal awal dan terbaru"
        />
      </div>
      <div className="sat-stats">
        <div>
          <span>{adaBelumHijau ? "Petak belum hijau (citra awal)" : "Petak tergenang (citra awal)"}</span>
          <b>{nf(stat.before, 0)}%</b>
          {adaBelumHijau && <small>termasuk {nf(asli!.stat.genang_sebelum_pct, 0)}% tergenang</small>}
        </div>
        <div>
          <span>Petak hijau bertambah (citra terbaru)</span>
          <b>{nf(stat.after, 0)}%</b>
        </div>
      </div>
      <div className="legend" style={{ padding: "8px 0 0" }}>
        {asli && mode === "kelas"
          ? KELAS_LABEL.map(([c, t]) => (
              <span key={t}>
                <span className="sw" style={{ background: c }} />
                {t}
              </span>
            ))
          : asli
            ? (
                <span>
                  Kotak contoh {asli.kotak_km?.join(" × ")} km{asli.stat.jumlah_petak ? ` · ${nf(asli.stat.jumlah_petak, 0)} petak` : ""}
                  {` · jarak ${selisihHari(asli.tanggal_sebelum, asli.tanggal_sesudah)} hari`}
                  {asli.jendela_hari ? ` · komposit median ±${asli.jendela_hari} hari` : ""}
                </span>
              )
            : (
                <>
                  {LAND_LABEL.map(([l, t]) => (
                    <span key={l}>
                      <span className="sw" style={{ background: col(l, 0) }} />
                      {t}
                    </span>
                  ))}
                  <span>
                    <span className="sw" style={{ background: col("lag", 0), outline: "1.8px solid #E5484D", outlineOffset: -2 }} />
                    Petak tertinggal
                  </span>
                </>
              )}
      </div>
    </div>
  )
}
