import { useEffect, useMemo, useRef, useState } from "react"
import { Map as MlMap, NavigationControl, ScaleControl, setWorkerUrl, type GeoJSONSource, type MapLayerMouseEvent, type ImageSource, type StyleSpecification } from "maplibre-gl"
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url"
import "maplibre-gl/dist/maplibre-gl.css"
import { Crosshair } from "lucide-react"
import { LAYERS, binColor, byName, type LayerKey, type Wilayah } from "@/lib/data"
import { fallbackKab, loadCitraKab, loadGeeKab, loadGeeOverlays, type CitraKab, type GeeOverlay, type KabCollection } from "@/lib/geo"
import { nf, rp } from "@/lib/format"
import { useSelection } from "@/lib/selection"
import { useTheme } from "@/lib/theme"
import { useTooltip } from "@/lib/tooltip"

setWorkerUrl(workerUrl)

type Basemap = "jalan" | "satelit"
type CitraMode = "off" | "sebelum" | "sesudah" | "kelas"

const JATIM_BOUNDS: [[number, number], [number, number]] = [
  [110.85, -8.85],
  [114.65, -6.65],
]
const BASE = import.meta.env.BASE_URL

const cssVar = (v: string) => {
  const m = /^var\((--[\w-]+)\)$/.exec(v)
  return m ? getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || "#999" : v
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

interface PetaInteraktifProps {
  layer: LayerKey
  getValue?: (k: Wilayah) => number
  valueLabel?: string
}

/** Peta 38 kabupaten/kota yang bisa digeser dan di-zoom (MapLibre), dengan basemap jalan/satelit dan lapisan citra GEE. */
export function PetaInteraktif({ layer, getValue, valueLabel }: PetaInteraktifProps) {
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const [ready, setReady] = useState(false)
  const [kab, setKab] = useState<KabCollection>(fallbackKab)
  const [geeBatas, setGeeBatas] = useState(false)
  const [overlays, setOverlays] = useState<GeeOverlay[]>([])
  const [citra, setCitra] = useState<CitraKab[]>([])
  const [basemap, setBasemap] = useState<Basemap>("jalan")
  const [ov, setOv] = useState<string>("off")
  const [citraMode, setCitraMode] = useState<CitraMode>("off")
  const [fillOp, setFillOp] = useState(0.7)
  const { sel, select } = useSelection()
  const { theme } = useTheme()
  const { show, hide } = useTooltip()
  const d = LAYERS[layer]
  const val = getValue ?? d.val

  // Data pendukung dari GEE (boleh belum ada).
  useEffect(() => {
    loadGeeKab().then((g) => {
      if (g) {
        setKab(g)
        setGeeBatas(true)
      }
    })
    loadGeeOverlays().then(setOverlays)
    loadCitraKab().then(setCitra)
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
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      cooperativeGestures: false,
    })
    map.touchZoomRotate.disableRotation()
    map.addControl(new NavigationControl({ showCompass: false }), "top-right")
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left")
    map.on("load", () => {
      map.addSource("kab", { type: "geojson", data: { type: "FeatureCollection", features: [] } })
      map.addLayer({ id: "kab-fill", type: "fill", source: "kab", paint: { "fill-color": ["get", "fill"], "fill-opacity": 0.7 } })
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
      if (hoverId !== undefined) map.setFeatureState({ source: "kab", id: hoverId }, { hover: false })
      hoverId = f.id
      if (hoverId !== undefined) map.setFeatureState({ source: "kab", id: hoverId }, { hover: true })
      map.getCanvas().style.cursor = "pointer"
      const k = byName[f.properties.n as string]
      if (!k) return
      show(
        <>
          <b>{k.n}</b>
          <br />
          {valueLabel ?? d.title.split(",")[0]}: <span className="m">{d.na?.(k) ? "sawah < 1.500 ha" : d.fmt(val(k))}</span>
          <br />
          Harga kini <span className="m">{rp(k.pNow)}</span> · stok <span className="m">{nf(k.cov, 2)}</span> bln
        </>,
        e.originalEvent,
      )
    }
    const leave = () => {
      if (hoverId !== undefined) map.setFeatureState({ source: "kab", id: hoverId }, { hover: false })
      hoverId = undefined
      map.getCanvas().style.cursor = ""
      hide()
    }
    const click = (e: MapLayerMouseEvent) => {
      const n = e.features?.[0]?.properties.n as string | undefined
      if (n && byName[n]) {
        hide()
        select(n)
      }
    }
    map.on("mousemove", "kab-fill", move)
    map.on("mouseleave", "kab-fill", leave)
    map.on("click", "kab-fill", click)
    return () => {
      map.off("mousemove", "kab-fill", move)
      map.off("mouseleave", "kab-fill", leave)
      map.off("click", "kab-fill", click)
    }
  }, [ready, d, val, valueLabel, show, hide, select])

  // Warna isian mengikuti lapisan, pekan, dan tema.
  const dataKey = useMemo(() => kab.features.map((f) => (byName[f.properties.n] ? val(byName[f.properties.n]) : 0)).join(","), [kab, val])
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const raf = requestAnimationFrame(() => {
      const data: KabCollection = {
        type: "FeatureCollection",
        features: kab.features.map((f) => {
          const k = byName[f.properties.n]
          const fill = !k ? "#999" : d.na?.(k) ? cssVar("var(--s0)") : cssVar(binColor(layer, val(k)))
          return { ...f, properties: { ...f.properties, fill } }
        }),
      }
      ;(map.getSource("kab") as GeoJSONSource | undefined)?.setData(data as unknown as Parameters<GeoJSONSource["setData"]>[0])
      map.setPaintProperty("kab-sel", "line-color", cssVar("var(--ink)"))
      map.setPaintProperty("kab-line", "line-color", basemap === "satelit" ? "#ffffff" : cssVar("var(--panel)"))
    })
    return () => cancelAnimationFrame(raf)
    // dataKey mewakili nilai per wilayah agar efek berjalan saat pekan/lapisan berubah.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, kab, layer, dataKey, theme, basemap])

  // Basemap.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const on = basemap === "satelit" ? "satelit" : theme === "dark" ? "jalanGelap" : "jalan"
    for (const id of ["jalan", "jalanGelap", "satelit"]) map.setLayoutProperty(id, "visibility", id === on ? "visible" : "none")
    const lbl = on === "jalan" ? "labelTerang" : "labelGelap"
    for (const id of ["labelTerang", "labelGelap"]) map.setLayoutProperty(id, "visibility", id === lbl ? "visible" : "none")
  }, [ready, basemap, theme])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    map.setPaintProperty("kab-fill", "fill-opacity", fillOp)
  }, [ready, fillOp])

  // Wilayah terpilih: garis tebal dan terbang ke batasnya.
  const first = useRef(true)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    map.setFilter("kab-sel", ["==", ["get", "n"], sel])
    if (first.current) {
      first.current = false
      return
    }
    const f = kab.features.find((x) => x.properties.n === sel)
    if (f) map.fitBounds(bboxOf(f), { padding: 40, maxZoom: 10.5, duration: 900 })
  }, [ready, sel, kab])

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

  const reset = () => mapRef.current?.fitBounds(JATIM_BOUNDS, { padding: 12, duration: 700 })
  const ovNow = overlays.find((o) => o.id === ov)

  return (
    <div className="pmap">
      <div className="pmap-bar">
        <div className="seg" role="group" aria-label="Peta dasar">
          {(
            [
              ["jalan", "Peta"],
              ["satelit", "Satelit"],
            ] as [Basemap, string][]
          ).map(([b, t]) => (
            <button key={b} type="button" aria-pressed={basemap === b} onClick={() => setBasemap(b)}>
              {t}
            </button>
          ))}
        </div>
        {overlays.length > 0 && (
          <label className="pmap-sel">
            <span>Lapisan GEE</span>
            <select value={ov} onChange={(e) => {
                const v = e.target.value
                // Lapisan GEE ada di bawah isian wilayah: tipiskan isian supaya terlihat.
                if (v !== "off" && fillOp > 0.2) setFillOp(0.1)
                if (v === "off" && fillOp < 0.2) setFillOp(0.7)
                setOv(v)
              }}>
              <option value="off">Tidak ada</option>
              {overlays.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="pmap-sel">
          <span>Citra {sel}</span>
          <select value={ck ? citraMode : "off"} onChange={(e) => setCitraMode(e.target.value as CitraMode)} disabled={!ck}>
            <option value="off">{ck ? "Tidak ditampilkan" : "Belum ada citra"}</option>
            {ck && (
              <>
                <option value="sebelum">Sebelum tanam (Sentinel-2)</option>
                <option value="sesudah">Sesudah tanam (Sentinel-2)</option>
                <option value="kelas">Kelas petak</option>
              </>
            )}
          </select>
        </label>
        <label className="pmap-op">
          <span>Isian</span>
          <input type="range" min={0} max={0.95} step={0.05} value={fillOp} onChange={(e) => setFillOp(+e.target.value)} aria-label="Transparansi isian wilayah" />
        </label>
      </div>
      <div className="pmap-stage">
        <div className="pmap-box">
          <div ref={box} className="pmap-canvas" />
          <button type="button" className="pmap-reset" onClick={reset} title="Kembali ke seluruh Jawa Timur" aria-label="Kembali ke seluruh Jawa Timur">
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
      <div className="pmap-src">
        Geser untuk berpindah, gulir atau cubit untuk zoom, klik wilayah untuk memilih. Batas wilayah: {geeBatas ? "FAO GAUL via Google Earth Engine" : "GADM (disederhanakan)"}
        {ovNow?.sumber ? ` · ${ovNow.sumber}` : ""}
        {citraMode !== "off" && ck ? ` · Citra ${sel}: Sentinel-2 via Google Earth Engine` : ""}
      </div>
    </div>
  )
}
