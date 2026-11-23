import { createContext, useCallback, useContext, useMemo, useState } from "react"
import { useLocation } from "react-router-dom"
import { REGIONS, type RegionKey } from "@/lib/arus"
import { WILAYAH, byName, type HargaStatus, type StokStatus, type Wilayah } from "@/lib/data"

export const HS_ALL: HargaStatus[] = ["aman", "waspada", "siaga"]
export const SS_ALL: StokStatus[] = ["surplus", "cukup", "tipis", "defisit"]

interface FilterState {
  /** Wilayah terpilih. Bawaan: semua. */
  wilayah: string[]
  hs: HargaStatus[]
  ss: StokStatus[]
}

/** Kelompok filter yang berlaku di tiap halaman. Kelompok yang tidak berlaku tidak ditampilkan dan tidak diterapkan. */
export interface Tersedia {
  waktu: boolean
  wilayah: boolean
  hs: boolean
  ss: boolean
}
const RUTE: Record<string, Tersedia> = {
  "/": { waktu: true, wilayah: true, hs: true, ss: true },
  "/produksi": { waktu: true, wilayah: true, hs: false, ss: false },
  "/stok": { waktu: true, wilayah: true, hs: false, ss: true },
  "/arus": { waktu: false, wilayah: true, hs: false, ss: true },
  "/harga": { waktu: true, wilayah: true, hs: true, ss: false },
}
const TIDAK: Tersedia = { waktu: false, wilayah: false, hs: false, ss: false }

export type Panel = "buka" | "tutup"

/** Bulan yang bisa dipilih: Jan 2026 sampai Jan 2027. Indeks 0 = Jan 2026. */
export const BULAN_NAMA = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
export const N_BULAN = 13
/** Bulan berjalan (Nov 2026). */
export const BULAN_KINI = 10
export const bulanLabel = (i: number) => `${BULAN_NAMA[i % 12]} ${2026 + Math.floor(i / 12)}`

interface FilterContextValue extends FilterState {
  /** Indeks bulan terpilih (0 = Jan 2026). */
  bulan: number
  setBulan: (i: number) => void
  panel: Panel
  setPanel: (p: Panel) => void
  tersedia: Tersedia
  toggleWilayah: (n: string) => void
  setWilayah: (n: string[]) => void
  /** Pilihan cepat: hanya wilayah di kawasan ini; bila sudah begitu, kembali ke semua wilayah. */
  pilihKawasan: (k: RegionKey) => void
  toggleHs: (s: HargaStatus) => void
  setHs: (s: HargaStatus[]) => void
  toggleSs: (s: StokStatus) => void
  setSs: (s: StokStatus[]) => void
  reset: () => void
  /** Jumlah kelompok filter yang sedang membatasi. */
  aktif: number
  lolos: (k: Wilayah) => boolean
  /** Wilayah yang lolos filter. */
  W: Wilayah[]
}

const KEY = "terawang.filter.v5"
const KEY_PANEL = "terawang.filter.panel"
const SEMUA_WILAYAH = WILAYAH.map((k) => k.n)
const kosong: FilterState = { wilayah: SEMUA_WILAYAH, hs: HS_ALL, ss: SS_ALL }

function muat(): FilterState {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as FilterState | null
    if (s && Array.isArray(s.wilayah) && Array.isArray(s.hs) && Array.isArray(s.ss)) {
      return {
        wilayah: s.wilayah.filter((n) => byName[n]),
        hs: s.hs.filter((x) => HS_ALL.includes(x)),
        ss: s.ss.filter((x) => SS_ALL.includes(x)),
      }
    }
  } catch {
    /* abaikan */
  }
  return kosong
}

const FilterContext = createContext<FilterContextValue | null>(null)

const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])

export function FilterProvider({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  const tersedia = RUTE[pathname] ?? TIDAK
  const [st, setSt] = useState<FilterState>(muat)
  const [bulan, setBulanState] = useState(BULAN_KINI)
  const setBulan = useCallback((i: number) => setBulanState(Math.min(N_BULAN - 1, Math.max(0, i))), [])
  const [panel, setPanelState] = useState<Panel>(() => {
    try {
      const p = localStorage.getItem(KEY_PANEL)
      if (p === "buka" || p === "tutup") return p
      if (p === "ciut") return "tutup"
    } catch {
      /* abaikan */
    }
    return window.innerWidth >= 1100 ? "buka" : "tutup"
  })
  const setPanel = useCallback((p: Panel) => {
    setPanelState(p)
    try {
      localStorage.setItem(KEY_PANEL, p)
    } catch {
      /* abaikan */
    }
  }, [])
  const simpan = useCallback((n: FilterState) => {
    setSt(n)
    try {
      localStorage.setItem(KEY, JSON.stringify(n))
    } catch {
      /* abaikan */
    }
  }, [])

  const value = useMemo<FilterContextValue>(() => {
    const lolos = (k: Wilayah) =>
      (!tersedia.wilayah || st.wilayah.includes(k.n)) &&
      (!tersedia.hs || st.hs.includes(k.hs)) &&
      (!tersedia.ss || st.ss.includes(k.ss))
    return {
      ...st,
      bulan,
      setBulan,
      panel,
      setPanel,
      tersedia,
      toggleWilayah: (n) => simpan({ ...st, wilayah: toggle(st.wilayah, n) }),
      setWilayah: (n) => simpan({ ...st, wilayah: n }),
      pilihKawasan: (key) => {
        const mem = REGIONS.find((r) => r.key === key)?.members ?? []
        const persis = st.wilayah.length === mem.length && mem.every((m) => st.wilayah.includes(m))
        simpan({ ...st, wilayah: persis ? SEMUA_WILAYAH : mem })
      },
      toggleHs: (s) => simpan({ ...st, hs: toggle(st.hs, s) }),
      toggleSs: (s) => simpan({ ...st, ss: toggle(st.ss, s) }),
      setHs: (n) => simpan({ ...st, hs: n }),
      setSs: (n) => simpan({ ...st, ss: n }),
      reset: () => {
        simpan(kosong)
        setBulan(BULAN_KINI)
      },
      aktif:
        (tersedia.wilayah && st.wilayah.length < WILAYAH.length ? 1 : 0) +
        (tersedia.hs && st.hs.length < HS_ALL.length ? 1 : 0) +
        (tersedia.ss && st.ss.length < SS_ALL.length ? 1 : 0),
      lolos,
      W: WILAYAH.filter(lolos),
    }
  }, [st, simpan, tersedia, panel, setPanel, bulan, setBulan])

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>
}

export function useFilter() {
  const ctx = useContext(FilterContext)
  if (!ctx) throw new Error("useFilter harus dipakai di dalam FilterProvider")
  return ctx
}

/** Wilayah yang lolos filter global. */
export const useWilayah = () => useFilter().W
