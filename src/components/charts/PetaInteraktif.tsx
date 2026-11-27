import { useEffect, useMemo, useRef, useState } from "react"
import { curveCatmullRom, line as d3line } from "d3-shape"
import { Map as MlMap, Marker, ScaleControl, setWorkerUrl, type GeoJSONSource, type MapLayerMouseEvent, type ImageSource, type StyleSpecification, type ExpressionSpecification } from "maplibre-gl"
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url"
import "maplibre-gl/dist/maplibre-gl.css"
import { Box, ChevronDown, ChevronUp, Compass, Crosshair, Map as MapIcon, Minus, Plus, RotateCcw, RotateCw, Type } from "lucide-react"
import { LAYERS, binColor, binIndex, byName, type LayerKey, type Wilayah } from "@/lib/data"
import { warnaSpec, type LayerSpec } from "@/lib/petaLayers"
import { fallbackKab, loadGeeKab, type KabCollection } from "@/lib/geo"
import { usePeta } from "@/lib/peta"
import { regionOf, tradeFor } from "@/lib/arus"
import { flowsBulan, gabungRute } from "@/lib/data"
import { nf, short } from "@/lib/format"
import { useFilter, useWilayah } from "@/lib/filter"
import { useSelection } from "@/lib/selection"
import { useTheme } from "@/lib/theme"
import { useTooltip } from "@/lib/tooltip"
import { BarisKini } from "@/components/charts/PetaJatim"

setWorkerUrl(workerUrl)


/** Tinggi wilayah 3D (meter): nilai terendah di antara wilayah yang lolos filter = MIN, tertinggi = MAKS. */
const TINGGI_MIN = 1200
const TINGGI_MAKS = 16000
/** Tinggi wilayah yang tidak lolos filter (meter). */
const TINGGI_REDUP = 300
/** Lama animasi naik (ms). */
const LAMA_NAIK = 1100
/** Kemiringan kamera mode 3D (derajat). */
const PITCH_3D = 55
const BEARING_3D = -14
const JATIM_BOUNDS: [[number, number], [number, number]] = [
  [110.85, -8.85],
  [114.65, -6.65],
]
const BASE = import.meta.env.BASE_URL

/** Ikon gudang (lucide) untuk penanda cabang Bulog. */
const IKON_GUDANG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z"/><path d="M6 18h12"/><path d="M6 14h12"/><rect width="12" height="12" x="6" y="10"/></svg>'

const cssVar = (v: string) => {
  const m = /^var\((--[\w-]+)\)$/.exec(v)
  return m ? getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || "#999" : v
}

/** Campur warna hex dengan putih (0 = tetap, 1 = putih). Warna non-hex dikembalikan apa adanya. */
function terangkan(c: string, k: number) {
  let h = c.trim().replace("#", "")
  if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(h)) return c
  if (h.length === 3) h = h.replace(/./g, (x) => x + x)
  const n = parseInt(h, 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * k))
  return `rgb(${ch.join(",")})`
}

/** Poligon wilayah dikecilkan sedikit ke arah titik beratnya, agar di mode 3D ada celah tipis antarwilayah yang tingginya sama. */
function susutkan(f: KabCollection["features"][number], k = 0.95): KabCollection["features"][number] {
  const berat = (ring: [number, number][]): [number, number] => {
    let a = 0, cx = 0, cy = 0
    for (let i = 0; i < ring.length - 1; i++) {
      const [x0, y0] = ring[i]
      const [x1, y1] = ring[i + 1]
      const q = x0 * y1 - x1 * y0
      a += q
      cx += (x0 + x1) * q
      cy += (y0 + y1) * q
    }
    if (a === 0) return ring[0]
    return [cx / (3 * a), cy / (3 * a)]
  }
  const skala = (ring: [number, number][], [ox, oy]: [number, number], s: number) => ring.map(([x, y]) => [ox + (x - ox) * s, oy + (y - oy) * s] as [number, number])
  return {
    ...f,
    geometry: {
      ...f.geometry,
      coordinates: f.geometry.coordinates.map((poly) => {
        const pusat = berat(poly[0] as [number, number][])
        // Cincin luar mengecil ke pusatnya; lubang (mis. kota di dalam kabupaten) membesar agar celahnya juga terbentuk.
        return poly.map((ring, i) => (i === 0 ? skala(ring as [number, number][], pusat, k) : skala(ring as [number, number][], berat(ring as [number, number][]), 2 - k)))
      }),
    },
  } as KabCollection["features"][number]
}

/** Perkiraan pergeseran layar (px, ke atas) untuk titik setinggi `h` meter di atas titik tanah `c`. */
function angkatPx(map: MlMap, c: [number, number], h: number) {
  if (h <= 0) return 0
  const pitch = (map.getPitch() * Math.PI) / 180
  if (pitch < 0.01) return 0
  const d = 0.01
  const p0 = map.project(c)
  const pe = map.project([c[0] + d, c[1]])
  const pn = map.project([c[0], c[1] + d])
  const luas = Math.abs((pe.x - p0.x) * (pn.y - p0.y) - (pe.y - p0.y) * (pn.x - p0.x))
  const mE = d * 111320 * Math.cos((c[1] * Math.PI) / 180)
  const mN = d * 110570
  const pxPerM = Math.sqrt(luas / Math.max(0.05, Math.cos(pitch)) / (mE * mN))
  return h * pxPerM * Math.sin(pitch)
}

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services"
const esri = (svc: string, maxzoom: number) => ({
  type: "raster" as const,
  tiles: [`${ESRI}/${svc}/MapServer/tile/{z}/{y}/{x}`],
  tileSize: 256,
  maxzoom,
  attribution: "Peta dasar © Esri, HERE, Garmin, © OpenStreetMap",
})

function baseStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      // Esri Canvas (abu-abu, tanpa kunci API). Label dipisah agar bisa ditaruh di atas isian wilayah.
      jalan: esri("Canvas/World_Light_Gray_Base", 16),
      jalanGelap: esri("Canvas/World_Dark_Gray_Base", 16),
      labelTerang: esri("Canvas/World_Light_Gray_Reference", 16),
      labelGelap: esri("Canvas/World_Dark_Gray_Reference", 16),
      satelit: {
        type: "raster",
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256,
        maxzoom: 19,
        attribution: "Citra dasar © Esri, Maxar, Earthstar Geographics",
      },
    },
    layers: [
      { id: "jalan", type: "raster", source: "jalan" },
      { id: "jalanGelap", type: "raster", source: "jalanGelap", layout: { visibility: "none" } },
      { id: "satelit", type: "raster", source: "satelit", layout: { visibility: "none" } },
    ],
  }
}

/** Titik pusat poligon terluas (daratan utama), agar pulau kecil di lepas pantai tidak menggeser titik ke laut. */
function pusatDaratan(f: KabCollection["features"][number]): [number, number] {
  let terbaik: [number, number] = [0, 0]
  let maks = -1
  for (const poly of f.geometry.coordinates) {
    const ring = poly[0]
    let a = 0
    let cx = 0
    let cy = 0
    for (let i = 0; i < ring.length - 1; i++) {
      const [x0, y0] = ring[i]
      const [x1, y1] = ring[i + 1]
      const k = x0 * y1 - x1 * y0
      a += k
      cx += (x0 + x1) * k
      cy += (y0 + y1) * k
    }
    if (Math.abs(a) > maks && a !== 0) {
      maks = Math.abs(a)
      terbaik = [cx / (3 * a), cy / (3 * a)]
    }
  }
  return terbaik
}

function bboxOf(f: KabCollection["features"][number]): [[number, number], [number, number]] {
  let w = 180,
    s = 90,
    e = -180,
    n = -90
  for (const poly of f.geometry.coordinates)
    for (const ring of poly)
      for (const [x, y] of ring) {
        w = Math.min(w, x)
        e = Math.max(e, x)
        s = Math.min(s, y)
        n = Math.max(n, y)
      }
  return [
    [w, s],
    [e, n],
  ]
}

const corners = ([w, s, e, n]: [number, number, number, number]): [[number, number], [number, number], [number, number], [number, number]] => [
  [w, n],
  [e, n],
  [e, s],
  [w, s],
]

type Fitur = {
  type: "Feature"
  properties: Record<string, string | number>
  geometry: { type: "LineString"; coordinates: [number, number][] } | { type: "Point"; coordinates: [number, number] } | { type: "Polygon"; coordinates: [number, number][][] }
}

interface PetaInteraktifProps {
  /** Lapisan menurut keluaran metodologi (halaman Ringkasan Peta). */
  spec?: LayerSpec
  /** Lapisan lama, dipakai halaman Ringkasan (lama). */
  layer?: LayerKey
  getValue?: (k: Wilayah) => number
  valueLabel?: string
  /** Tampil sebagai kotak berukuran tetap di dalam halaman, bukan memenuhi area. */
  embedded?: boolean
  /** Dipanggil saat pengguna mengeklik kabupaten/kota pada peta. */
  onPick?: (n: string) => void
  /** false: tidak ada wilayah yang disorot dan peta tidak zoom ke wilayah terpilih. */
  fokus?: boolean
}

/** Peta 38 kabupaten/kota yang bisa digeser dan di-zoom (MapLibre), dengan basemap jalan/satelit dan lapisan citra GEE. */
/** Ruang tepi saat peta penuh menyesuaikan seluruh Jatim: desktop memberi tempat panel mengambang; HP/tablet tegak tidak, karena panel ada di bawah peta. */
function padPenuh(kiri: number) {
  if (window.matchMedia?.("(max-width: 899px)").matches) return { top: 50, bottom: 12, left: 8, right: 8 }
  return { top: 80, bottom: 150, left: kiri, right: 360 }
}

export function PetaInteraktif({ spec, layer = "harga", getValue, valueLabel, embedded, onPick, fokus = true }: PetaInteraktifProps) {
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const kanvasRef = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)
  const [bearing, setBearing] = useState(0)
  const [kab, setKab] = useState<KabCollection>(fallbackKab)
  // Tinggi 3D: target per id wilayah, tinggi yang sedang tampil, dan kemajuan animasi.
  const tinggiTarget = useRef<Map<number | string, number>>(new Map())
  const tinggiKini = useRef<Map<number | string, number>>(new Map())
  const animRef = useRef(0)
  const arusK = useRef(1)
  const tigaRef = useRef(false)
  const geserLabel = useRef<(() => void) | null>(null)
  const peta = usePeta()
  const { basemap, fillOp, overlays, citra } = peta
  const arus = spec ? peta.arus : "off"
  const tiga = spec ? peta.dim === "3d" : false
  tigaRef.current = tiga
  // Halaman Ringkasan Peta (spec) tidak memakai lapisan GEE dan citra kabupaten.
  const ov = spec ? "off" : peta.ov
  const citraMode = spec ? "off" : peta.citraMode
  const { sel, select } = useSelection()
  const { lolos, mulai, akhir } = useFilter()
  const W = useWilayah()
  const lastFilter = useRef(0)
  const { theme } = useTheme()
  const { show, hide } = useTooltip()
  const d = LAYERS[layer]
  const val = spec ? spec.val : (getValue ?? d.val)
  const fmtVal = (k: Wilayah) => (spec ? spec.fmt(spec.val(k)) : d.na?.(k) ? "sawah < 1.500 ha" : d.fmt(val(k)))
  const warna = (k: Wilayah) => (spec ? warnaSpec(spec, k) : d.na?.(k) ? "var(--s0)" : binColor(layer, val(k)))
  const namaNilai = spec ? spec.label : (valueLabel ?? d.title.split(",")[0])

  // Data pendukung dari GEE (boleh belum ada).
  useEffect(() => {
    loadGeeKab().then((g) => {
      if (g) {
        setKab(g)
      }
    })
  }, [])

  // Buat peta sekali.
  useEffect(() => {
    if (!box.current) return
    const map = new MlMap({
      container: box.current,
      style: baseStyle(),
      bounds: JATIM_BOUNDS,
      fitBoundsOptions: { padding: 12 },
      maxBounds: [
        [108.8, -10.2],
        [116.6, -5.2],
      ],
      minZoom: 5.5,
      maxZoom: 17,
      attributionControl: { compact: true, customAttribution: "Batas wilayah: FAO GAUL via Google Earth Engine" },
      dragRotate: false,
      pitchWithRotate: false,
      cooperativeGestures: false,
    })
    map.touchZoomRotate.disableRotation()
    map.on("rotate", () => setBearing(map.getBearing()))
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left")
    map.on("load", () => {
      // HP/tablet tegak: sesuaikan ulang ke seluruh Jatim setelah ukuran kotak peta final, dan ciutkan atribusi agar tidak menutupi peta.
      if (!embedded && window.matchMedia?.("(max-width: 899px)").matches) {
        map.resize()
        map.fitBounds(JATIM_BOUNDS, { padding: padPenuh(20), duration: 0 })
        box.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show")
      }
      map.addSource("kab", { type: "geojson", data: { type: "FeatureCollection", features: [] } })
      map.addLayer({ id: "kab-fill", type: "fill", source: "kab", paint: { "fill-color": ["get", "fill"], "fill-opacity": 0.7 } })
      map.addSource("kab3d", { type: "geojson", data: { type: "FeatureCollection", features: [] } })
      // Bayangan semu: siluet wilayah digeser ke kanan bawah layar, terlihat di laut dan di celah antarwilayah.
      map.addLayer({
        id: "kab-bayang",
        type: "fill",
        source: "kab3d",
        layout: { visibility: "none" },
        paint: { "fill-color": "#000", "fill-opacity": 0.32, "fill-translate": [12, 16], "fill-translate-anchor": "viewport", "fill-antialias": false },
      })
      map.addLayer({
        id: "kab-3d",
        type: "fill-extrusion",
        source: "kab3d",
        layout: { visibility: "none" },
        paint: {
          "fill-extrusion-color": [
            "case",
            ["boolean", ["feature-state", "sel"], false],
            ["get", "fillSel"],
            ["boolean", ["feature-state", "hover"], false],
            ["get", "fillHi"],
            ["get", "fill"],
          ],
          "fill-extrusion-height": ["get", "h1"],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 1,
          "fill-extrusion-vertical-gradient": true,
        },
      })
      // Cahaya dari kiri atas layar agar sisi wilayah berbeda terang-gelapnya.
      map.setLight({ anchor: "viewport", color: "#ffffff", intensity: 0.6, position: [1.5, 215, 62] })
      map.addLayer({
        id: "kab-line",
        type: "line",
        source: "kab",
        paint: { "line-color": "#ffffff", "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 2.2, 0.8], "line-opacity": 0.9 },
      })
      map.addLayer({ id: "kab-sel", type: "line", source: "kab", filter: ["==", ["get", "n"], ""], paint: { "line-color": "#111", "line-width": 2.6 } })
      map.addLayer({ id: "labelTerang", type: "raster", source: "labelTerang" })
      map.addLayer({ id: "labelGelap", type: "raster", source: "labelGelap", layout: { visibility: "none" } })
      setReady(true)
    })
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Hover & klik.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    let hoverId: number | string | undefined
    const move = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0]
      if (!f) return
      if (hoverId !== undefined) for (const source of ["kab", "kab3d"]) map.setFeatureState({ source, id: hoverId }, { hover: false })
      hoverId = f.id
      if (hoverId !== undefined) for (const source of ["kab", "kab3d"]) map.setFeatureState({ source, id: hoverId }, { hover: true })
      map.getCanvas().style.cursor = "pointer"
      const k = byName[f.properties.n as string]
      if (!k) return
      show(
        <>
          <b>{k.n}</b>
          <br />
          {namaNilai}: <span className="m">{fmtVal(k)}</span>
          <br />
          <BarisKini k={k} />
        </>,
        e.originalEvent,
      )
    }
    const leave = () => {
      if (hoverId !== undefined) for (const source of ["kab", "kab3d"]) map.setFeatureState({ source, id: hoverId }, { hover: false })
      hoverId = undefined
      map.getCanvas().style.cursor = ""
      hide()
    }
    const click = (e: MapLayerMouseEvent) => {
      const n = e.features?.[0]?.properties.n as string | undefined
      if (n && byName[n]) {
        hide()
        select(n)
        onPickRef.current?.(n)
      }
    }
    const lids = tiga ? ["kab-3d", "kab-fill"] : ["kab-fill"]
    for (const lid of lids) {
      map.on("mousemove", lid, move)
      map.on("mouseleave", lid, leave)
      map.on("click", lid, click)
    }
    return () => {
      for (const lid of lids) {
        map.off("mousemove", lid, move)
        map.off("mouseleave", lid, leave)
        map.off("click", lid, click)
      }
    }
  }, [ready, d, val, valueLabel, spec, tiga, show, hide, select])

  // Warna isian mengikuti lapisan, pekan, dan tema.
  const dataKey = useMemo(
    () => kab.features.map((f) => (byName[f.properties.n] ? val(byName[f.properties.n]) + (lolos(byName[f.properties.n]) ? "" : "x") : 0)).join(","),
    [kab, val, lolos],
  )
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const raf = requestAnimationFrame(() => {
      const data: KabCollection = {
        type: "FeatureCollection",
        features: kab.features.map((f) => {
          const k = byName[f.properties.n]
          const fill = !k ? "#999" : !lolos(k) ? cssVar("var(--rule)") : cssVar(warna(k))
          return { ...f, properties: { ...f.properties, fill } }
        }),
      }
      ;(map.getSource("kab") as GeoJSONSource | undefined)?.setData(data as unknown as Parameters<GeoJSONSource["setData"]>[0])
      // Mode 3D: seluruh wilayah diangkat. Tinggi mengikuti kelas legenda (kelas lebih tinggi = lebih tinggi) ditambah posisi nilai di dalam kelasnya,
      // jadi tinggi sejalan dengan warna dan wilayah sekelas tetap berbeda sedikit.
      const nilai = kab.features.map((f) => byName[f.properties.n]).filter((k): k is Wilayah => !!k && lolos(k)).map((k) => val(k)).filter(Number.isFinite)
      const lo = nilai.length ? Math.min(...nilai) : 0
      const hi = nilai.length ? Math.max(...nilai) : 1
      const target = new Map<number | string, number>()
      for (const f of kab.features) {
        const k = byName[f.properties.n]
        let h = TINGGI_REDUP
        if (k && lolos(k)) {
          const v = val(k)
          const bins = spec ? spec.bins : d.bins
          const bi = binIndex(bins, v)
          // Batas kelas terbuka (mis. ≥ 15.000) dipotong ke nilai data agar posisi di dalam kelas tetap bermakna.
          const b0 = Math.max(bins[bi][0], lo)
          const b1 = Math.min(bins[bi][1], hi)
          const frac = !Number.isFinite(v) ? (v > 0 ? 1 : 0) : b1 > b0 ? Math.min(1, Math.max(0, (v - b0) / (b1 - b0))) : 0.5
          const t = (bi + frac) / bins.length
          h = TINGGI_MIN + t * (TINGGI_MAKS - TINGGI_MIN)
        }
        target.set(f.id, h)
      }
      tinggiTarget.current = target
      const isi = new Map(data.features.map((f) => [f.id, f.properties.fill as string]))
      kab3dWarna.current = isi
      naikkan(map, tigaRef.current ? tinggiKini.current : null)
      map.setPaintProperty("kab-sel", "line-color", cssVar("var(--ink)"))
      map.setPaintProperty("kab-line", "line-color", basemap === "satelit" ? "#ffffff" : cssVar("var(--panel)"))
    })
    return () => cancelAnimationFrame(raf)
    // dataKey mewakili nilai per wilayah agar efek berjalan saat pekan/lapisan berubah.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, kab, layer, spec?.key, dataKey, theme, basemap])

  // Geometri 3D (poligon disusutkan) dihitung sekali per batas wilayah.
  const kabSusut = useMemo(() => kab.features.map((f) => susutkan(f)), [kab])
  const kab3dWarna = useRef<Map<number | string, string>>(new Map())

  /** Pasang data 3D lalu animasikan tinggi dari `dari` (null = langsung ke target, 0 bila belum ada) menuju target. */
  const naikkan = (map: MlMap, dari: Map<number | string, number> | null) => {
    cancelAnimationFrame(animRef.current)
    const target = tinggiTarget.current
    const awal = new Map<number | string, number>()
    for (const [id, h] of target) awal.set(id, dari ? (dari.get(id) ?? 0) : h)
    const features = kabSusut.map((f) => {
      const fill = kab3dWarna.current.get(f.id) ?? "#999"
      return { ...f, properties: { ...f.properties, fill, fillHi: terangkan(fill, 0.28), fillSel: terangkan(fill, 0.45), h0: awal.get(f.id) ?? 0, h1: target.get(f.id) ?? 0 } }
    })
    ;(map.getSource("kab3d") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features } as unknown as Parameters<GeoJSONSource["setData"]>[0])
    const pasang = (t: number) => {
      const tinggi: ExpressionSpecification = ["+", ["get", "h0"], ["*", ["-", ["get", "h1"], ["get", "h0"]], t]]
      map.setPaintProperty("kab-3d", "fill-extrusion-height", ["*", arusK.current, tinggi])
      const kini = new Map<number | string, number>()
      for (const [id, h] of target) {
        const h0 = awal.get(id) ?? 0
        kini.set(id, h0 + (h - h0) * t)
      }
      tinggiKini.current = kini
      geserLabel.current?.()
    }
    const beda = [...target].some(([id, h]) => Math.abs((awal.get(id) ?? 0) - h) > 1)
    const diam = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    if (!dari || !beda || diam) {
      pasang(1)
      return
    }
    const mulaiT = performance.now()
    const langkah = (now: number) => {
      const u = Math.min(1, (now - mulaiT) / LAMA_NAIK)
      // easeOutBack ringan: naik cepat, sedikit melewati target, lalu turun ke tempatnya.
      const c = 1.2
      const e = 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2)
      pasang(e)
      if (u < 1) animRef.current = requestAnimationFrame(langkah)
    }
    animRef.current = requestAnimationFrame(langkah)
  }
  useEffect(() => () => cancelAnimationFrame(animRef.current), [])

  // 2D atau 3D: kemiringan kamera, menara, dan putar dengan seret klik kanan.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    for (const id of ["kab-3d", "kab-bayang"]) map.setLayoutProperty(id, "visibility", tiga ? "visible" : "none")
    // Garis batas dan label peta dasar digambar di permukaan tanah, jadi disembunyikan agar tidak menimpa wilayah yang terangkat.
    for (const id of ["kab-line", "kab-sel"]) map.setLayoutProperty(id, "visibility", tiga ? "none" : "visible")
    aturLabelDasar(map)
    map.setPaintProperty("kab-fill", "fill-opacity", tiga ? Math.min(fillOp, 0.4) : fillOp)
    if (tiga) map.dragRotate.enable()
    else map.dragRotate.disable()
    map.easeTo({ pitch: tiga ? PITCH_3D : 0, bearing: tiga ? BEARING_3D : 0, duration: 900 })
    if (!tiga) {
      cancelAnimationFrame(animRef.current)
      tinggiKini.current = new Map()
      return
    }
    // Wilayah naik dari tanah saat mode 3D dibuka.
    naikkan(map, new Map())
    // Kamera bergoyang pelan ke kiri-kanan sampai pengguna menyentuh peta. Tidak dijalankan di layar kecil atau bila pengguna memilih gerak minimal.
    const hemat = window.matchMedia?.("(prefers-reduced-motion: reduce), (max-width: 720px), (pointer: coarse)").matches
    if (hemat) return
    let raf = 0
    let t0 = 0
    const berhenti = (e?: object) => {
      if (e && (e as { goyang?: boolean }).goyang) return
      cancelAnimationFrame(raf)
      raf = -1
      map.off("movestart", berhenti)
    }
    const goyang = (now: number) => {
      if (raf === -1) return
      if (!t0) t0 = now
      const b = BEARING_3D + 10 * Math.sin(((now - t0) / 1000) * ((2 * Math.PI) / 36))
      map.setBearing(b, { goyang: true })
      raf = requestAnimationFrame(goyang)
    }
    const mulaiGoyang = window.setTimeout(() => {
      map.on("movestart", berhenti)
      raf = requestAnimationFrame(goyang)
    }, 1000)
    return () => {
      window.clearTimeout(mulaiGoyang)
      berhenti()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, tiga])

  // Menara dipendekkan saat arus ditampilkan agar jalur terlihat.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    map.setPaintProperty("kab-3d", "fill-extrusion-opacity", arus !== "off" ? 0.85 : 1)
    arusK.current = arus !== "off" ? 0.28 : 1
    naikkan(map, tigaRef.current ? tinggiKini.current : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, arus])

  const aturLabelDasar = (map: MlMap) => {
    const on = basemap === "satelit" ? "satelit" : theme === "dark" ? "jalanGelap" : "jalan"
    const lbl = tigaRef.current ? "" : on === "jalan" ? "labelTerang" : "labelGelap"
    for (const id of ["labelTerang", "labelGelap"]) map.setLayoutProperty(id, "visibility", id === lbl ? "visible" : "none")
  }

  // Basemap.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const on = basemap === "satelit" ? "satelit" : theme === "dark" ? "jalanGelap" : "jalan"
    for (const id of ["jalan", "jalanGelap", "satelit"]) map.setLayoutProperty(id, "visibility", id === on ? "visible" : "none")
    aturLabelDasar(map)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, basemap, theme])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    map.setPaintProperty("kab-fill", "fill-opacity", tiga ? Math.min(fillOp, 0.4) : fillOp)
    map.setPaintProperty("kab-3d", "fill-extrusion-opacity", arus !== "off" ? 0.85 : 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, fillOp])

  // Wilayah terpilih: garis tebal dan terbang ke batasnya.
  const first = useRef(true)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    map.setFilter("kab-sel", ["==", ["get", "n"], fokus ? sel : ""])
    for (const f of kab.features) map.setFeatureState({ source: "kab3d", id: f.id }, { sel: fokus && f.properties.n === sel })
    if (!fokus) {
      // Lepas fokus: kembali ke cakupan filter (atau seluruh Jawa Timur).
      // Pemuatan awal sudah selesai, jadi klik pertama sesudahnya tidak boleh dilewati.
      first.current = false
      lastFilter.current = 0
      fitFilter(map)
      return
    }
    // Pindah pilihan akibat filter sudah ditangani zoom ke wilayah terfilter.
    if (Date.now() - lastFilter.current < 600) return
    if (first.current) {
      first.current = false
      return
    }
    const f = kab.features.find((x) => x.properties.n === sel)
    if (f) map.fitBounds(bboxOf(f), { padding: 40, maxZoom: 10.5, duration: 900 })
  }, [ready, sel, kab, fokus])

  // Zoom mengikuti filter: tampilkan semua wilayah yang lolos.
  const wKey = W.map((k) => k.n).join("|")
  const fitFilter = (map: MlMap) => {
    const semua = W.length === kab.features.length || W.length === 0
    if (semua) {
      map.fitBounds(JATIM_BOUNDS, { padding: embedded ? 12 : padPenuh(20), duration: 700 })
      return
    }
    const ada = new Set(W.map((k) => k.n))
    let w = 180, s = 90, e = -180, n = -90
    for (const f of kab.features) {
      if (!ada.has(f.properties.n)) continue
      const [[fw, fs], [fe, fn]] = bboxOf(f)
      w = Math.min(w, fw); e = Math.max(e, fe); s = Math.min(s, fs); n = Math.max(n, fn)
    }
    if (e < w) return
    map.fitBounds([[w, s], [e, n]], { padding: embedded ? 30 : padPenuh(30), maxZoom: 10.5, duration: 800 })
  }
  const firstFit = useRef(true)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const semua = W.length === kab.features.length || W.length === 0
    if (firstFit.current) {
      firstFit.current = false
      if (semua) return
    }
    lastFilter.current = Date.now()
    fitFilter(map)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, wKey, kab])


  // Label nilai per wilayah (opsional): nama dan nilai di pusat daratan; label yang bertabrakan disembunyikan.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !spec || !peta.labelNilai) return
    const items: { el: HTMLElement; mk: Marker; c: [number, number]; prio: number; id: number | string }[] = []
    // Peringkat 3 tertinggi dan 3 terendah di antara wilayah yang lolos filter. Wilayah yang nilainya sama dengan batas peringkat dilewati agar tidak ada peringkat semu.
    const urut = kab.features.map((f) => byName[f.properties.n]).filter((k): k is Wilayah => !!k && lolos(k)).map((k) => ({ n: k.n, v: val(k) })).sort((a, b) => b.v - a.v)
    const peringkat = new Map<string, { atas: boolean; no: number }>()
    if (urut.length >= 7) {
      for (let i = 0; i < 3; i++) {
        if (urut[i].v !== urut[3].v) peringkat.set(urut[i].n, { atas: true, no: i + 1 })
        const j = urut.length - 1 - i
        if (urut[j].v !== urut[urut.length - 4].v) peringkat.set(urut[j].n, { atas: false, no: i + 1 })
      }
    }
    for (const f of kab.features) {
      const k = byName[f.properties.n]
      if (!k || !lolos(k)) continue
      const el = document.createElement("div")
      el.className = "nilai-lbl" + (tiga ? " tiga" : "")
      const pk = tiga ? undefined : peringkat.get(k.n)
      if (pk) {
        el.classList.add(pk.atas ? "atas" : "bawah")
        el.title = pk.atas ? `Peringkat ${pk.no} tertinggi` : `Peringkat ${pk.no} terendah`
        const bd = document.createElement("i")
        bd.textContent = `${pk.atas ? "▲" : "▼"}${pk.no}`
        el.append(bd)
      }
      const nm = document.createElement("span")
      nm.textContent = short(k.n)
      // Mode 3D: cukup nama wilayah. Statusnya terbaca dari warna, detailnya muncul saat kursor di atas wilayah.
      if (tiga) el.append(nm)
      else {
        const v = document.createElement("b")
        v.textContent = fmtVal(k)
        el.append(nm, v)
      }
      const c = pusatDaratan(f)
      const mk = new Marker({ element: el, anchor: tiga ? "bottom" : "center" }).setLngLat(c).addTo(map)
      items.push({ el, mk, c, prio: k.n === sel ? 0 : pk ? 1 : 2, id: f.id })
    }
    const susun = () => {
      const pakai: { x: number; y: number; w: number; h: number }[] = []
      for (const it of [...items].sort((a, b) => a.prio - b.prio)) {
        const p = map.project(it.c)
        if (tiga) {
          // Label diletakkan di atas permukaan wilayah yang terangkat.
          const dy = angkatPx(map, it.c, (tinggiKini.current.get(it.id) ?? 0) * arusK.current) + 4
          it.mk.setOffset([0, -dy])
          p.y -= dy + it.el.offsetHeight / 2
        }
        const w = it.el.offsetWidth
        const h = it.el.offsetHeight
        const r = { x: p.x - w / 2, y: p.y - h / 2, w, h }
        const bentrok = pakai.some((t) => r.x < t.x + t.w + 2 && r.x + r.w + 2 > t.x && r.y < t.y + t.h + 2 && r.y + r.h + 2 > t.y)
        it.el.style.visibility = bentrok ? "hidden" : "visible"
        if (!bentrok) pakai.push(r)
      }
    }
    susun()
    // Mode 3D: tinggi label mengikuti kemiringan kamera dan animasi naik, jadi disusun ulang tiap bingkai (paling banyak sekali per frame).
    let raf = 0
    const susunNanti = () => {
      if (!raf) raf = requestAnimationFrame(() => {
        raf = 0
        susun()
      })
    }
    const ev = tiga ? "move" : "moveend"
    map.on(ev, tiga ? susunNanti : susun)
    if (tiga) geserLabel.current = susunNanti
    return () => {
      map.off(ev, tiga ? susunNanti : susun)
      cancelAnimationFrame(raf)
      if (geserLabel.current === susunNanti) geserLabel.current = null
      for (const it of items) it.mk.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, spec, spec?.key, peta.labelNilai, kab, dataKey, W, sel, tiga])

  // Garis arus beras: lengkung dari asal ke tujuan, tebal = volume, dasbor bergerak ke arah tujuan.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const markers: Marker[] = []
    // Label SPHP: ditata ulang tiap peta bergerak agar tidak saling menimpa dan tidak menutup ikon cabang.
    const labelItems: { el: HTMLElement; mk: Marker; c: [number, number]; dasar: number; prio: number }[] = []
    const ikonPos: [number, number][] = []
    const susun = () => {
      const kena = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
        a.x < b.x + b.w + 3 && a.x + a.w + 3 > b.x && a.y < b.y + b.h + 3 && a.y + a.h + 3 > b.y
      const terpasang: { x: number; y: number; w: number; h: number }[] = ikonPos.map((c) => {
        const p = map.project(c)
        return { x: p.x - 14, y: p.y - 14, w: 28, h: 28 }
      })
      for (const it of [...labelItems].sort((a, b) => a.prio - b.prio)) {
        const p = map.project(it.c)
        const w = it.el.offsetWidth
        const h = it.el.offsetHeight
        let dy = it.dasar
        let ok = false
        for (let k = 0; k < 6 && !ok; k++) {
          const r = { x: p.x - w / 2, y: p.y + dy, w, h }
          if (!terpasang.some((t) => kena(r, t))) {
            terpasang.push(r)
            ok = true
          } else dy += h + 4
        }
        it.mk.setOffset([0, dy])
        it.el.style.visibility = ok ? "visible" : "hidden"
      }
    }
    const hapus = () => {
      map.off("moveend", susun)
      for (const id of ["arus-anim", "arus-base", "arus-pts", "arus3d", "arus-lokal"]) if (map.getLayer(id)) map.removeLayer(id)
      for (const id of ["arus", "arus-pts", "arus3d", "arus-lokal"]) if (map.getSource(id)) map.removeSource(id)
      while (markers.length) markers.pop()!.remove()
    }
    hapus()
    if (arus === "off") return
    const pusat = (n: string): [number, number] | null => {
      const f = kab.features.find((x) => x.properties.n === n)
      if (!f) return null
      return pusatDaratan(f)
    }
    // Rekomendasi SPHP: kiriman di lokasi cabang digambar sebagai lingkaran, dan tiap wilayah yang terlibat diberi label nama (serta volume bila lokal).
    if (arus === "sphp") {
      const fl = flowsBulan(mulai, akhir)
      const lokal = new Map<string, number>()
      for (const f of fl) if (f.from === f.to && lolos(f.from)) lokal.set(f.from.n, (lokal.get(f.from.n) ?? 0) + f.ton)
      const nama = new Set<string>()
      for (const f of fl) if (lolos(f.from) || lolos(f.to)) nama.add(f.from.n).add(f.to.n)
      const cincin: Fitur[] = []
      for (const [n, ton] of lokal) {
        const c = pusat(n)
        if (c) cincin.push({ type: "Feature", properties: { r: Math.min(34, Math.max(10, 6 + Math.sqrt(ton) * 0.3)) }, geometry: { type: "Point", coordinates: c } })
      }
      map.addSource("arus-lokal", { type: "geojson", data: { type: "FeatureCollection", features: cincin } as never })
      map.addLayer({
        id: "arus-lokal",
        type: "circle",
        source: "arus-lokal",
        paint: { "circle-radius": ["get", "r"], "circle-color": cssVar("var(--accent)"), "circle-opacity": 0.45, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.5 },
      })
      // Cabang Bulog asal ditandai ikon gudang.
      const asal = new Set<string>()
      for (const f of fl) if (lolos(f.from) || lolos(f.to)) asal.add(f.from.n)
      for (const n of asal) {
        const c = pusat(n)
        if (!c) continue
        const ik = document.createElement("div")
        ik.className = "bulog-ik"
        ik.innerHTML = IKON_GUDANG
        markers.push(new Marker({ element: ik, anchor: "center" }).setLngLat(c).addTo(map))
        ikonPos.push(c)
      }
      for (const n of nama) {
        const c = pusat(n)
        if (!c) continue
        const el = document.createElement("div")
        el.className = "sphp-lbl"
        el.textContent = ""
        const nm = document.createElement("div")
        nm.textContent = short(n)
        el.appendChild(nm)
        if (lokal.has(n)) {
          const sub = document.createElement("div")
          sub.className = "sphp-sub"
          sub.textContent = `${nf(lokal.get(n)!)} ton untuk wilayah sendiri`
          el.appendChild(sub)
        }
        const dasar = lokal.has(n) ? 20 : 16
        const mk = new Marker({ element: el, anchor: "top", offset: [0, dasar] }).setLngLat(c).addTo(map)
        markers.push(mk)
        labelItems.push({ el, mk, c, dasar, prio: lokal.has(n) ? 0 : asal.has(n) ? 1 : 2 })
      }
      susun()
      map.on("moveend", susun)
    }
    const rute =
      arus === "sphp"
        ? gabungRute(flowsBulan(mulai, akhir)).map((f) => ({ a: f.from.n, b: f.to.n, ton: f.ton, c: "var(--accent)", lolos: lolos(f.from) || lolos(f.to) }))
        : tradeFor(akhir).slice(0, 25).map((t) => ({ a: t.from.n, b: t.to.n, ton: t.ton, c: regionOf[t.from.n].color, lolos: lolos(t.from) || lolos(t.to) }))
    const maks = Math.max(1, ...rute.map((r) => r.ton))
    const garis: Fitur[] = []
    const busur: { koord: [number, number][]; w: number; c: string; ton: number }[] = []
    const titik: Fitur[] = []
    for (const r of rute) {
      if (!r.lolos) continue
      const A = pusat(r.a)
      const B = pusat(r.b)
      if (!A || !B) continue
      const mx = (A[0] + B[0]) / 2
      const my = (A[1] + B[1]) / 2
      const dx = B[0] - A[0]
      const dy = B[1] - A[1]
      const k = tiga ? 0.08 : 0.22
      const cx = mx - dy * k
      const cy = my + dx * k
      const koord: [number, number][] = []
      for (let i = 0; i <= 24; i++) {
        const t = i / 24
        koord.push([(1 - t) * (1 - t) * A[0] + 2 * (1 - t) * t * cx + t * t * B[0], (1 - t) * (1 - t) * A[1] + 2 * (1 - t) * t * cy + t * t * B[1]])
      }
      const w = 1.4 + (r.ton / maks) * 4.6
      const c = cssVar(r.c)
      garis.push({ type: "Feature", properties: { w, c }, geometry: { type: "LineString", coordinates: koord } })
      if (tiga) busur.push({ koord, w, c, ton: r.ton })
      titik.push({ type: "Feature", properties: { c, r: 2 + w * 0.7, akhir: 1 }, geometry: { type: "Point", coordinates: B } })
      if (arus !== "sphp") titik.push({ type: "Feature", properties: { c, r: 2, akhir: 0 }, geometry: { type: "Point", coordinates: A } })
    }
    if (tiga) {
      // Mode 3D: lengkung digambar di kanvas di atas peta (halus, tanpa blok). Titik tanah diproyeksikan lalu diangkat ke atas layar.
      const cv = kanvasRef.current
      const ctx = cv?.getContext("2d")
      if (!cv || !ctx) return
      const diam = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      const gambar = (waktu = 0) => {
        const dpr = window.devicePixelRatio || 1
        const W = cv.clientWidth
        const H = cv.clientHeight
        if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
          cv.width = Math.round(W * dpr)
          cv.height = Math.round(H * dpr)
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, W, H)
        const naik = Math.sin((map.getPitch() * Math.PI) / 180)
        for (const b of busur) {
          const tanah = b.koord.map((c) => map.project(c as [number, number]))
          const jarak = Math.hypot(tanah[tanah.length - 1].x - tanah[0].x, tanah[tanah.length - 1].y - tanah[0].y)
          const puncak = Math.min(90, jarak * 0.14) * naik
          const n = tanah.length - 1
          const atas = tanah.map((p, i) => ({ x: p.x, y: p.y - puncak * 4 * (i / n) * (1 - i / n) }))
          const jalur = d3line<{ x: number; y: number }>().x((p) => p.x).y((p) => p.y).curve(curveCatmullRom.alpha(0.5))
          ctx.lineCap = "round"
          ctx.lineJoin = "round"
          // Bayangan di tanah
          ctx.beginPath()
          jalur.context(ctx)(tanah)
          ctx.strokeStyle = "rgba(0,0,0,0.28)"
          ctx.lineWidth = Math.max(1, b.w * 0.5)
          ctx.stroke()
          // Garis arus: tepi putih tipis lalu warna kawasan
          ctx.beginPath()
          jalur.context(ctx)(atas)
          ctx.strokeStyle = "rgba(255,255,255,0.55)"
          ctx.lineWidth = b.w * 1.3 + 1.2
          ctx.stroke()
          ctx.beginPath()
          jalur.context(ctx)(atas)
          ctx.strokeStyle = b.c
          ctx.lineWidth = b.w * 1.3
          ctx.stroke()
          // Asal: lingkaran kosong. Tujuan dan tengah jalur: kepala panah searah arus.
          const o = atas[0]
          if (arus !== "sphp") {
            ctx.beginPath()
            ctx.arc(o.x, o.y, 3 + b.w * 0.4, 0, Math.PI * 2)
            ctx.fillStyle = "#fff"
            ctx.fill()
            ctx.strokeStyle = b.c
            ctx.lineWidth = 2
            ctx.stroke()
          }
          const panah = (p: { x: number; y: number }, q: { x: number; y: number }, ukuran: number) => {
            const sd = Math.atan2(p.y - q.y, p.x - q.x)
            ctx.save()
            ctx.translate(p.x, p.y)
            ctx.rotate(sd)
            ctx.beginPath()
            ctx.moveTo(0, 0)
            ctx.lineTo(-ukuran, -ukuran * 0.62)
            ctx.lineTo(-ukuran * 0.7, 0)
            ctx.lineTo(-ukuran, ukuran * 0.62)
            ctx.closePath()
            ctx.fillStyle = b.c
            ctx.fill()
            ctx.strokeStyle = "#fff"
            ctx.lineWidth = 1.2
            ctx.stroke()
            ctx.restore()
          }
          const ukuran = 9 + b.w * 1.4
          // Panah bergerak dari asal ke tujuan, jaraknya merata sepanjang jalur.
          const bergerak = 3
          for (let j = 0; j < bergerak; j++) {
            const u = diam ? (j + 0.5) / bergerak : (((waktu / 1000) * 0.14 + j / bergerak) % 1)
            const pos = u * n
            const i0 = Math.min(n - 1, Math.floor(pos))
            const f = pos - i0
            const p = { x: atas[i0].x + (atas[i0 + 1].x - atas[i0].x) * f, y: atas[i0].y + (atas[i0 + 1].y - atas[i0].y) * f }
            const q = { x: atas[i0].x, y: atas[i0].y }
            const alpha = Math.min(1, u * 8, (1 - u) * 8)
            ctx.globalAlpha = alpha
            panah(p, q.x === p.x && q.y === p.y ? atas[Math.max(0, i0 - 1)] : q, ukuran * 0.8)
            ctx.globalAlpha = 1
          }
          panah(atas[n], atas[n - 1], ukuran)
        }
      }
      let raf = 0
      const putar = (t: number) => {
        gambar(t)
        raf = requestAnimationFrame(putar)
      }
      const sekali = () => gambar(0)
      if (diam) {
        sekali()
        map.on("render", sekali)
      } else raf = requestAnimationFrame(putar)
      return () => {
        cancelAnimationFrame(raf)
        map.off("render", sekali)
        ctx.clearRect(0, 0, cv.width, cv.height)
        if (mapRef.current) hapus()
      }
    }
    map.addSource("arus", { type: "geojson", data: { type: "FeatureCollection", features: garis } as never })
    map.addSource("arus-pts", { type: "geojson", data: { type: "FeatureCollection", features: titik } as never })
    map.addLayer({ id: "arus-base", type: "line", source: "arus", layout: { "line-cap": "round" }, paint: { "line-color": ["get", "c"], "line-width": ["get", "w"], "line-opacity": 0.7 } }, "labelTerang")
    map.addLayer({ id: "arus-anim", type: "line", source: "arus", paint: { "line-color": "#ffffff", "line-width": ["*", ["get", "w"], 0.45], "line-opacity": 0.9, "line-dasharray": [0, 4, 3] } }, "labelTerang")
    map.addLayer({ id: "arus-pts", type: "circle", source: "arus-pts", paint: { "circle-color": ["get", "c"], "circle-radius": ["get", "r"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 1, "circle-opacity": ["case", ["==", ["get", "akhir"], 1], 1, 0.7] } }, "labelTerang")
    // Animasi: geser pola putus-putus tiap langkah.
    const pola: number[][] = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0], [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]]
    let i = 0
    const id = window.setInterval(() => {
      i = (i + 1) % pola.length
      if (map.getLayer("arus-anim")) map.setPaintProperty("arus-anim", "line-dasharray", pola[i])
    }, 90)
    return () => {
      window.clearInterval(id)
      if (mapRef.current) hapus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, arus, kab, lolos, tiga, mulai, akhir])

  // Overlay GEE seluruh provinsi.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    for (const o of overlays) {
      const id = `ov-${o.id}`
      if (!map.getSource(id)) {
        map.addSource(id, { type: "image", url: `${BASE}citra/jatim/${o.file}`, coordinates: corners(o.bounds) })
        map.addLayer({ id, type: "raster", source: id, paint: { "raster-opacity": 0.9, "raster-fade-duration": 0 }, layout: { visibility: "none" } }, "kab-fill")
      }
      map.setLayoutProperty(id, "visibility", ov === o.id ? "visible" : "none")
    }
  }, [ready, overlays, ov])

  // Citra GEE per kabupaten (kotak kecil sebelum/sesudah tanam).
  const ck = citra.find((c) => c.lokasi.toLowerCase() === sel.toLowerCase())
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const show = citraMode !== "off" && ck
    if (show) {
      const url = `${BASE}citra/${ck.folder}/${citraMode === "kelas" ? "sesudah_kelas" : citraMode}.png`
      const src = map.getSource("citra") as ImageSource | undefined
      if (src) src.updateImage({ url, coordinates: corners(ck.bbox) })
      else {
        map.addSource("citra", { type: "image", url, coordinates: corners(ck.bbox) })
        map.addLayer({ id: "citra", type: "raster", source: "citra", paint: { "raster-fade-duration": 0 } })
        map.addSource("citra-box", { type: "geojson", data: { type: "FeatureCollection", features: [] } })
        map.addLayer({ id: "citra-box", type: "line", source: "citra-box", paint: { "line-color": "#FFD166", "line-width": 2 } })
      }
      const [w, s, e, n] = ck.bbox
      ;(map.getSource("citra-box") as GeoJSONSource).setData({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: [[w, n], [e, n], [e, s], [w, s], [w, n]] },
      })
      map.setLayoutProperty("citra", "visibility", "visible")
      map.setLayoutProperty("citra-box", "visibility", "visible")
      map.fitBounds(
        [
          [w, s],
          [e, n],
        ],
        { padding: 60, maxZoom: 14, duration: 900 },
      )
    } else if (map.getLayer("citra")) {
      map.setLayoutProperty("citra", "visibility", "none")
      map.setLayoutProperty("citra-box", "visibility", "none")
    }
    // fitBounds hanya saat mode/kabupaten berubah.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, citraMode, ck?.folder])

  const reset = () => mapRef.current?.fitBounds(JATIM_BOUNDS, { padding: embedded ? 12 : padPenuh(20), bearing: 0, pitch: tiga ? PITCH_3D : 0, duration: 700 })
  const ovNow = overlays.find((o) => o.id === ov)

  return (
    <div className={"pmap" + (embedded ? " emb" : "")}>
      <div className="pmap-stage">
        <div className="pmap-box">
          <div ref={box} className="pmap-canvas" />
          <canvas ref={kanvasRef} className="pmap-arus" aria-hidden="true" />
        </div>
        {spec && (
          <div className="mdim" role="group" aria-label="Tampilan peta">
            <button type="button" aria-pressed={!tiga} onClick={() => peta.setDim("2d")} title="Peta datar">
              <MapIcon size={15} />
              2D
            </button>
            <button type="button" aria-pressed={tiga} onClick={() => peta.setDim("3d")} title="Peta 3D dengan batang">
              <Box size={15} />
              3D
            </button>
            <button type="button" aria-pressed={peta.labelNilai} onClick={() => peta.setLabelNilai(!peta.labelNilai)} title="Tampilkan nilai tiap wilayah di peta">
              <Type size={15} />
              Nilai
            </button>
          </div>
        )}
        <div className="mtools" role="group" aria-label="Navigasi peta">
          <button type="button" onClick={() => mapRef.current?.zoomIn()} title="Perbesar" aria-label="Perbesar">
            <Plus size={16} />
          </button>
          <button type="button" onClick={() => mapRef.current?.zoomOut()} title="Perkecil" aria-label="Perkecil">
            <Minus size={16} />
          </button>
          <i />
          <button type="button" disabled={!tiga} onClick={() => mapRef.current?.easeTo({ pitch: Math.min(60, (mapRef.current?.getPitch() ?? 0) + 10), duration: 300 })} title="Miringkan" aria-label="Miringkan">
            <ChevronUp size={16} />
          </button>
          <button type="button" disabled={!tiga} onClick={() => mapRef.current?.easeTo({ pitch: Math.max(0, (mapRef.current?.getPitch() ?? 0) - 10), duration: 300 })} title="Tegakkan" aria-label="Tegakkan">
            <ChevronDown size={16} />
          </button>
          <button type="button" disabled={!tiga} onClick={() => mapRef.current?.easeTo({ bearing: (mapRef.current?.getBearing() ?? 0) - 20, duration: 300 })} title="Putar ke kiri" aria-label="Putar ke kiri">
            <RotateCcw size={15} />
          </button>
          <button type="button" disabled={!tiga} onClick={() => mapRef.current?.easeTo({ bearing: (mapRef.current?.getBearing() ?? 0) + 20, duration: 300 })} title="Putar ke kanan" aria-label="Putar ke kanan">
            <RotateCw size={15} />
          </button>
          <button type="button" onClick={() => mapRef.current?.easeTo({ bearing: 0, duration: 500 })} title="Arahkan ke utara" aria-label="Arahkan ke utara">
            <Compass size={16} style={{ transform: `rotate(${-bearing}deg)` }} />
          </button>
          <i />
          <button type="button" onClick={reset} title="Kembali ke seluruh Jawa Timur" aria-label="Kembali ke seluruh Jawa Timur">
            <Crosshair size={15} />
          </button>
        </div>
        {ovNow?.legenda && ovNow.legenda.length > 0 && (
          <div className="pmap-leg">
            <b>{ovNow.label}</b>
            {ovNow.legenda.map(([c, t]) => (
              <span key={t}>
                <i style={{ background: c }} />
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
