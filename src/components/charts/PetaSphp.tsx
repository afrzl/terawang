import { useEffect, useRef, useState } from "react"
import { Map as MlMap, Marker, NavigationControl, Popup, ScaleControl, setWorkerUrl, type GeoJSONSource, type MapLayerMouseEvent, type StyleSpecification } from "maplibre-gl"
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url"
import "maplibre-gl/dist/maplibre-gl.css"
import { pusatDaratan } from "@/components/charts/PetaInteraktif"
import { WILAYAH, binColor, gabungRute, type Flow, type Wilayah } from "@/lib/data"
import { nf, short } from "@/lib/format"
import { fallbackKab, loadGeeKab, type KabCollection } from "@/lib/geo"
import { covBulan } from "@/lib/petaLayers"
import { useTheme } from "@/lib/theme"

setWorkerUrl(workerUrl)

const JATIM: [[number, number], [number, number]] = [
  [110.85, -8.85],
  [114.65, -6.65],
]

/** Ikon gudang (lucide) untuk penanda cabang Bulog. */
const IKON_GUDANG =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z"/><path d="M6 18h12"/><path d="M6 14h12"/><rect width="12" height="12" x="6" y="10"/></svg>'

const cssVar = (v: string) => {
  const m = /^var\((--[\w-]+)\)$/.exec(v)
  return m ? getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || "#999" : v
}

/** Peta dasar OpenStreetMap (ubin raster standar), sedikit dipudarkan supaya warna wilayah dan rute tetap terbaca. */
function gaya(): StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["a", "b", "c", "d"].map((h) => `https://${h}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}@2x.png`),
        tileSize: 256,
        maxzoom: 18,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors, © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>',
      },
    },
    layers: [{ id: "osm", type: "raster", source: "osm", paint: { "raster-opacity": 1 } }],
  }
}

/** Gambar kepala panah (menghadap ke atas) untuk lapisan simbol; diputar menurut arah rute. */
function gambarPanah(warna: string) {
  const s = 48
  const c = document.createElement("canvas")
  c.width = c.height = s
  const g = c.getContext("2d")!
  g.beginPath()
  g.moveTo(s / 2, 4)
  g.lineTo(s - 8, s - 8)
  g.lineTo(s / 2, s - 18)
  g.lineTo(8, s - 8)
  g.closePath()
  g.fillStyle = warna
  g.fill()
  g.lineWidth = 3.5
  g.strokeStyle = "#ffffff"
  g.stroke()
  return g.getImageData(0, 0, s, s)
}

type Fitur = { type: "Feature"; properties: Record<string, string | number>; geometry: { type: "Point"; coordinates: [number, number] } | { type: "LineString"; coordinates: [number, number][] } }
const koleksi = (features: Fitur[]) => ({ type: "FeatureCollection" as const, features }) as never

/** Lengkung rute (Bezier kuadrat) dari A ke B; berhenti sedikit sebelum B agar kepala panah tepat di tujuan. */
function lengkung(A: [number, number], B: [number, number]) {
  const kx = Math.cos((7.5 * Math.PI) / 180)
  const dx = (B[0] - A[0]) * kx
  const dy = B[1] - A[1]
  const c: [number, number] = [(A[0] + B[0]) / 2 - (dy * 0.2) / kx, (A[1] + B[1]) / 2 + dx * 0.2]
  const titik = (t: number): [number, number] => [
    (1 - t) * (1 - t) * A[0] + 2 * (1 - t) * t * c[0] + t * t * B[0],
    (1 - t) * (1 - t) * A[1] + 2 * (1 - t) * t * c[1] + t * t * B[1],
  ]
  const koord = Array.from({ length: 33 }, (_, i) => titik((i / 32) * 0.96))
  const ujung = koord[koord.length - 1]
  const sebelum = koord[koord.length - 3]
  // Arah layar (derajat searah jarum jam dari utara) pada ujung lengkung.
  const arah = (Math.atan2((ujung[0] - sebelum[0]) * kx, ujung[1] - sebelum[1]) * 180) / Math.PI
  return { koord, ujung, arah }
}

interface Props {
  flows: Flow[]
  /** Indeks bulan akhir periode: warna wilayah = cakupan stok non-Bulog bulan itu. */
  akhir: number
  /** Wilayah yang lolos filter; wilayah lain dipudarkan. */
  wil: Wilayah[]
}

/** Peta rekomendasi SPHP di atas OpenStreetMap: warna = cakupan stok, garis lengkung berpanah = rute antar wilayah, lingkaran = kiriman di wilayah cabang sendiri. */
export function PetaSphp({ flows, akhir, wil }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const [siap, setSiap] = useState(false)
  const [kab, setKab] = useState<KabCollection>(fallbackKab)
  const { theme } = useTheme()

  useEffect(() => {
    loadGeeKab().then((g) => g && setKab(g))
  }, [])

  useEffect(() => {
    if (!box.current) return
    const map = new MlMap({
      container: box.current,
      style: gaya(),
      bounds: JATIM,
      fitBoundsOptions: { padding: 16 },
      maxBounds: [
        [108.8, -10.2],
        [116.6, -5.2],
      ],
      minZoom: 6,
      maxZoom: 14,
      attributionControl: { compact: false, customAttribution: "Batas wilayah: FAO GAUL" },
      dragRotate: false,
      pitchWithRotate: false,
      cooperativeGestures: true,
    })
    map.touchZoomRotate.disableRotation()
    map.addControl(new NavigationControl({ showCompass: false }), "top-right")
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left")
    map.on("load", () => {
      const aksen = cssVar("var(--accent)")
      map.addImage("panah", gambarPanah(aksen), { pixelRatio: 2 })
      map.addSource("kab", { type: "geojson", data: koleksi([]) })
      map.addLayer({ id: "kab-isi", type: "fill", source: "kab", paint: { "fill-color": ["get", "fill"], "fill-opacity": ["get", "op"] } })
      map.addLayer({ id: "kab-garis", type: "line", source: "kab", paint: { "line-color": "#ffffff", "line-width": 0.9, "line-opacity": 0.9 } })
      map.addSource("lokal", { type: "geojson", data: koleksi([]) })
      map.addLayer({
        id: "lokal",
        type: "circle",
        source: "lokal",
        paint: { "circle-radius": ["get", "r"], "circle-color": aksen, "circle-opacity": 0.28, "circle-stroke-color": aksen, "circle-stroke-width": 2.2 },
      })
      map.addSource("rute", { type: "geojson", data: koleksi([]) })
      map.addLayer({ id: "rute-tepi", type: "line", source: "rute", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": ["+", ["get", "w"], 4], "line-opacity": 1 } })
      map.addLayer({ id: "rute", type: "line", source: "rute", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": aksen, "line-width": ["get", "w"] } })
      map.addSource("panah", { type: "geojson", data: koleksi([]) })
      map.addLayer({
        id: "panah",
        type: "symbol",
        source: "panah",
        layout: {
          "icon-image": "panah",
          "icon-size": ["get", "s"],
          "icon-rotate": ["get", "arah"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      })
      const pop = new Popup({ closeButton: false, closeOnClick: false, offset: 10, className: "sphp-pop" })
      const tampil = (e: MapLayerMouseEvent) => {
        const p = e.features?.[0]?.properties
        if (!p) return
        map.getCanvas().style.cursor = "pointer"
        pop.setLngLat(e.lngLat).setHTML(String(p.html)).addTo(map)
      }
      const sembunyi = () => {
        map.getCanvas().style.cursor = ""
        pop.remove()
      }
      for (const id of ["rute", "lokal"]) {
        map.on("mousemove", id, tampil)
        map.on("mouseleave", id, sembunyi)
      }
      setSiap(true)
    })
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Isi data: warna wilayah, rute, lingkaran lokal, penanda cabang dan label.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !siap) return
    const lolos = new Set(wil.map((k) => k.n))
    const pusat = new Map<string, [number, number]>()
    for (const f of kab.features) pusat.set(f.properties.n, pusatDaratan(f))
    const isi = kab.features.map((f) => {
      const k = WILAYAH.find((w) => w.n === f.properties.n)
      const ok = k && lolos.has(k.n)
      return { ...f, properties: { n: f.properties.n, fill: k ? cssVar(binColor("stokK2", covBulan(k, akhir))) : "#bbbbbb", op: ok ? 0.82 : 0.25 } }
    })
    ;(map.getSource("kab") as GeoJSONSource).setData({ type: "FeatureCollection", features: isi } as never)

    const lokal = new Map<string, number>()
    for (const f of flows) if (f.from === f.to) lokal.set(f.from.n, (lokal.get(f.from.n) ?? 0) + f.ton)
    const rute = gabungRute(flows)
    const maks = Math.max(1, ...rute.map((r) => r.ton), ...lokal.values())
    const garis: Fitur[] = []
    const panah: Fitur[] = []
    for (const r of rute) {
      const A = pusat.get(r.from.n)
      const B = pusat.get(r.to.n)
      if (!A || !B) continue
      const { koord, ujung, arah } = lengkung(A, B)
      const w = 3 + (r.ton / maks) * 6
      const html = `<b>${r.from.n} → ${r.to.n}</b><br>${nf(r.ton)} ton · ${nf(r.km)} km`
      garis.push({ type: "Feature", properties: { w, html }, geometry: { type: "LineString", coordinates: koord } })
      panah.push({ type: "Feature", properties: { arah, s: 0.75 + w * 0.08 }, geometry: { type: "Point", coordinates: ujung } })
    }
    const cincin: Fitur[] = []
    for (const [n, ton] of lokal) {
      const c = pusat.get(n)
      if (c) cincin.push({ type: "Feature", properties: { r: 9 + Math.sqrt(ton / maks) * 22, html: `<b>${n}</b><br>${nf(ton)} ton disalurkan di wilayah cabang sendiri` }, geometry: { type: "Point", coordinates: c } })
    }
    ;(map.getSource("rute") as GeoJSONSource).setData(koleksi(garis))
    ;(map.getSource("panah") as GeoJSONSource).setData(koleksi(panah))
    ;(map.getSource("lokal") as GeoJSONSource).setData(koleksi(cincin))

    // Penanda HTML: ikon gudang di cabang asal, nama wilayah di bawah titiknya.
    const penanda: Marker[] = []
    const asal = new Set(flows.map((f) => f.from.n))
    const nama = new Set(flows.flatMap((f) => [f.from.n, f.to.n]))
    for (const n of asal) {
      const c = pusat.get(n)
      if (!c) continue
      const el = document.createElement("div")
      el.className = "bulog-ik"
      el.innerHTML = IKON_GUDANG
      el.title = `Cabang Bulog ${n}`
      penanda.push(new Marker({ element: el, anchor: "center" }).setLngLat(c).addTo(map))
    }
    for (const n of nama) {
      const c = pusat.get(n)
      if (!c) continue
      const el = document.createElement("div")
      el.className = "sphp-lbl"
      el.textContent = short(n)
      penanda.push(new Marker({ element: el, anchor: "top", offset: [0, asal.has(n) ? 17 : 8] }).setLngLat(c).addTo(map))
    }
    return () => penanda.forEach((m) => m.remove())
  }, [siap, kab, flows, akhir, wil, theme])

  return <div ref={box} className="peta-sphp" role="img" aria-label="Peta rekomendasi penyaluran SPHP di atas OpenStreetMap" />
}
