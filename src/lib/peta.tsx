import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { SPEC_LABEL, type Komoditas, type SpecKey } from "@/lib/petaLayers"
import { loadCitraKab, loadGeeOverlays, type CitraKab, type GeeOverlay } from "@/lib/geo"
import { useFilter } from "@/lib/filter"

export type Dimensi = "2d" | "3d"
export type ArusMode = "off" | "sphp" | "dagang"
export type Basemap = "jalan" | "satelit"
export type CitraMode = "off" | "sebelum" | "sesudah" | "kelas"

const KEY_LAYER = "terawang.layer.v2"

function layerAwal(): SpecKey {
  try {
    const l = localStorage.getItem(KEY_LAYER)
    if (l && l in SPEC_LABEL) return l as SpecKey
  } catch {
    /* abaikan */
  }
  return "statusHarga"
}

interface PetaValue {
  /** Visualisasi data pada isian wilayah. */
  layer: SpecKey
  setLayer: (l: SpecKey) => void
  /** Jenis beras untuk lapisan dan kartu harga. */
  kom: Komoditas
  setKom: (k: Komoditas) => void
  /** Horizon prakiraan harga, pekan (1–4). */
  hor: number
  setHor: (h: number) => void
  /** Tampilan peta: datar (2D) atau miring dengan menara tinggi (3D). */
  dim: Dimensi
  setDim: (d: Dimensi) => void
  /** Garis arus beras di atas peta: penyaluran SPHP (K3b) atau perdagangan antarwilayah. */
  arus: ArusMode
  setArus: (a: ArusMode) => void
  basemap: Basemap
  setBasemap: (b: Basemap) => void
  /** Id lapisan GEE satu provinsi, atau "off". */
  ov: string
  setOv: (id: string) => void
  citraMode: CitraMode
  setCitraMode: (m: CitraMode) => void
  /** Tampilkan nilai tiap wilayah sebagai label di peta. */
  labelNilai: boolean
  setLabelNilai: (b: boolean) => void
  fillOp: number
  setFillOp: (n: number) => void
  overlays: GeeOverlay[]
  citra: CitraKab[]
}

const Ctx = createContext<PetaValue | null>(null)

/** Pengaturan peta (visualisasi, peta dasar, lapisan, opasitas) yang dipakai sidebar filter dan peta. */
export function PetaProvider({ children }: { children: React.ReactNode }) {
  const [layer, setLayerState] = useState<SpecKey>(layerAwal)
  // Jenis beras disimpan di filter global agar sidebar, status harga, dan grafik memakai pilihan yang sama.
  const { kom, setKom } = useFilter()
  const [hor, setHor] = useState(4)
  const [dim, setDim] = useState<Dimensi>("2d")
  const [arus, setArus] = useState<ArusMode>("off")
  const [basemap, setBasemap] = useState<Basemap>("satelit")
  const [ov, setOvState] = useState("off")
  const [citraMode, setCitraMode] = useState<CitraMode>("off")
  const [labelNilai, setLabelNilai] = useState(true)
  const [fillOp, setFillOp] = useState(0.7)
  const [overlays, setOverlays] = useState<GeeOverlay[]>([])
  const [citra, setCitra] = useState<CitraKab[]>([])

  useEffect(() => {
    loadGeeOverlays().then(setOverlays)
    loadCitraKab().then(setCitra)
  }, [])

  const setLayer = useCallback((l: SpecKey) => {
    setLayerState(l)
    try {
      localStorage.setItem(KEY_LAYER, l)
    } catch {
      /* abaikan */
    }
  }, [])

  // Lapisan GEE ada di bawah isian wilayah: tipiskan isian supaya terlihat.
  const setOv = useCallback((v: string) => {
    if (v !== "off") setFillOp((o) => (o > 0.2 ? 0.1 : o))
    else setFillOp((o) => (o < 0.2 ? 0.7 : o))
    setOvState(v)
  }, [])

  const value = useMemo(
    () => ({ layer, setLayer, kom, setKom, hor, setHor, dim, setDim, arus, setArus, basemap, setBasemap, ov, setOv, citraMode, setCitraMode, labelNilai, setLabelNilai, fillOp, setFillOp, overlays, citra }),
    [layer, setLayer, kom, hor, dim, arus, basemap, ov, setOv, citraMode, labelNilai, fillOp, overlays, citra],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePeta() {
  const c = useContext(Ctx)
  if (!c) throw new Error("usePeta harus dipakai di dalam PetaProvider")
  return c
}
