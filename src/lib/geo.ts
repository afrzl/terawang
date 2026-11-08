import { GEO } from "./data"

/* Batas wilayah dalam lon/lat untuk peta interaktif. Sumber utama: public/citra/jatim/kab.geojson (ekspor GEE,
   FAO GAUL). Bila belum ada, path SVG jatim.json dibalik ke lon/lat (proyeksi linear di scripts/geo.py). */

const LON0 = 110.85
const LAT0 = -6.7
const K = Math.cos((7.5 * Math.PI) / 180)
const S = 230

export const toLngLat = (x: number, y: number): [number, number] => [x / (K * S) + LON0, LAT0 - y / S]

export interface KabFeature {
  type: "Feature"
  id: number
  properties: { n: string; fill?: string }
  geometry: { type: "MultiPolygon"; coordinates: [number, number][][][] }
}
export interface KabCollection {
  type: "FeatureCollection"
  features: KabFeature[]
}

function circle([lng, lat]: [number, number], r: number): [number, number][] {
  return Array.from({ length: 25 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2
    return [lng + (r / K) * Math.cos(a), lat + r * Math.sin(a)] as [number, number]
  })
}

/** Batas kasar dari jatim.json (cadangan). */
export function fallbackKab(): KabCollection {
  const features = Object.entries(GEO).map(([n, g], i): KabFeature => {
    const polys: [number, number][][][] = []
    if (g.d) {
      for (const part of g.d.split("Z")) {
        const pts = part
          .replace(/^M/, "")
          .split("L")
          .filter(Boolean)
          .map((p) => {
            const [x, y] = p.split(",").map(Number)
            return toLngLat(x, y)
          })
        if (pts.length >= 3) polys.push([[...pts, pts[0]]])
      }
    } else {
      polys.push([circle(toLngLat(g.c[0], g.c[1]), 0.022)])
    }
    return { type: "Feature", id: i, properties: { n }, geometry: { type: "MultiPolygon", coordinates: polys } }
  })
  return { type: "FeatureCollection", features }
}

const BASE = import.meta.env.BASE_URL
let kabCache: Promise<KabCollection | null> | null = null

/** Batas GEE bila tersedia; null bila belum diekspor. */
export function loadGeeKab(): Promise<KabCollection | null> {
  kabCache ??= fetch(`${BASE}citra/jatim/kab.geojson`)
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { features?: { properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }[] } | null) => {
      if (!j?.features?.length) return null
      const features = j.features.map((f, i): KabFeature => {
        const n = String(f.properties.n ?? f.properties.name ?? "")
        const coords = (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates) as [number, number][][][]
        return { type: "Feature", id: i, properties: { n }, geometry: { type: "MultiPolygon", coordinates: coords } }
      })
      return { type: "FeatureCollection", features } as KabCollection
    })
    .catch(() => null)
  return kabCache
}

export interface GeeOverlay {
  id: string
  label: string
  file: string
  bounds: [number, number, number, number]
  legenda?: [string, string][]
  sumber?: string
}
let ovCache: Promise<GeeOverlay[]> | null = null
/** Daftar overlay GEE seluruh provinsi (public/citra/jatim/index.json). */
export function loadGeeOverlays(): Promise<GeeOverlay[]> {
  ovCache ??= fetch(`${BASE}citra/jatim/index.json`)
    .then((r) => (r.ok ? r.json() : []))
    .then((j) => (Array.isArray(j) ? j : []))
    .catch(() => [])
  return ovCache
}

export interface CitraKab {
  folder: string
  lokasi: string
  bbox: [number, number, number, number]
  tanggal_sebelum: string
  tanggal_sesudah: string
}
let citraCache: Promise<CitraKab[]> | null = null
/** Citra sebelum/sesudah per kabupaten (public/citra/index.json). */
export function loadCitraKab(): Promise<CitraKab[]> {
  citraCache ??= fetch(`${BASE}citra/index.json`)
    .then((r) => (r.ok ? r.json() : []))
    .then((j) => (Array.isArray(j) ? j : []))
    .catch(() => [])
  return citraCache
}
