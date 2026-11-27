import { createContext, useCallback, useContext, useMemo, useState } from "react"
import { useLocation } from "react-router-dom"
import { BULAN_KINI, N_BULAN } from "@/lib/api"
import { REGIONS, type RegionKey } from "@/lib/arus"
import { WILAYAH, byName, type HargaStatus, type StokStatus, type Wilayah } from "@/lib/data"
import { statusHargaAt, type Komoditas } from "@/lib/petaLayers"
import { useSesi } from "@/lib/sesi"

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
  /** Pengaturan lapisan peta ikut tampil di sidebar. */
  peta?: boolean
  /** Pilihan jenis beras (medium atau premium) tampil di sidebar. */
  jenis?: boolean
  /** Pilihan satuan produksi (beras, GKG, atau GKP) tampil di sidebar. */
  satuan?: boolean
}

/** Satuan produksi, faktor konversi BPS Jawa Timur (sama di semua kab/kota; rilis produksi 2025):
 *  GKG = beras / 0,5774 (BRS: Pacitan 2025 76.517 t beras = 132.516 t GKG); GKP = beras / 0,4802 (GKG = 0,8317 × GKP). */
export type Satuan = "beras" | "gkg" | "gkp"
export const SATUAN: Record<Satuan, { f: number; lab: string; kpi: string; panjang: string }> = {
  beras: { f: 1, lab: "beras", kpi: "Produksi beras", panjang: "beras" },
  gkg: { f: 1 / 0.5774, lab: "GKG", kpi: "Produksi padi (GKG)", panjang: "gabah kering giling (GKG)" },
  gkp: { f: 1 / 0.4802, lab: "GKP", kpi: "Produksi padi (GKP)", panjang: "gabah kering panen (GKP)" },
}
const RUTE: Record<string, Tersedia> = {
  "/": { waktu: true, wilayah: true, hs: true, ss: true, peta: true },
  "/ringkasan": { waktu: true, wilayah: true, hs: true, ss: true, peta: true },
  "/produksi": { waktu: true, wilayah: true, hs: false, ss: false, satuan: true },
  "/stok": { waktu: true, wilayah: true, hs: false, ss: true },
  "/arus": { waktu: true, wilayah: true, hs: false, ss: true },
  "/harga": { waktu: true, wilayah: true, hs: true, ss: false, jenis: true },
}
const TIDAK: Tersedia = { waktu: false, wilayah: false, hs: false, ss: false }

export type Panel = "buka" | "tutup"

/** Bulan yang bisa dipilih: Jan 2026 sampai bulan kini + 2. Indeks 0 = Jan 2026. Bulan kini mengikuti tanggal hari ini (lihat api.ts). */
export const BULAN_NAMA = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
export { BULAN_KINI, N_BULAN } from "@/lib/api"
export const bulanLabel = (i: number) => `${BULAN_NAMA[i % 12]} ${2026 + Math.floor(i / 12)}`

interface FilterContextValue extends FilterState {
  /** Indeks bulan terpilih (0 = Jan 2026). */
  bulan: number
  setBulan: (i: number) => void
  /** Mode rentang: dari `bulan` sampai `bulan2` (termasuk). Bila mati, hanya `bulan`. */
  rentang: boolean
  setRentang: (r: boolean) => void
  bulan2: number
  setBulan2: (i: number) => void
  /** Atur rentang sekaligus (otomatis menyalakan mode rentang). */
  setRange: (a: number, b: number) => void
  /** Bulan awal dan akhir yang berlaku (sama bila bukan mode rentang). */
  mulai: number
  akhir: number
  /** Bulan terakhir yang boleh dipilih: tanpa hak estimasi hanya sampai bulan lengkap terakhir (data yang sudah terjadi). */
  bulanMaks: number
  /** Bulan bawaan saat dibuka atau diatur ulang. */
  bulanAwal: number
  /** Peran ini boleh melihat estimasi dan prakiraan ke depan. */
  estimasi: boolean
  panel: Panel
  setPanel: (p: Panel) => void
  /** Jenis beras untuk status dan harga. */
  kom: Komoditas
  setKom: (k: Komoditas) => void
  /** Jenis beras yang ditampilkan di halaman Harga (satu atau keduanya). */
  jenisHarga: Komoditas[]
  setJenisHarga: (k: Komoditas[]) => void
  /** Satuan produksi di halaman Produksi. */
  satuan: Satuan
  setSatuan: (s: Satuan) => void
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
  const { boleh } = useSesi()
  const estimasi = boleh("dasbor_estimasi")
  // Status harga dihitung dari prakiraan 4 pekan, jadi filternya hanya untuk peran berhak harga dan estimasi.
  const lihatHarga = estimasi && boleh("dasbor_harga")
  const rute = RUTE[pathname] ?? TIDAK
  const tersedia = useMemo(() => (lihatHarga || !rute.hs ? rute : { ...rute, hs: false }), [rute, lihatHarga])
  const bulanMaks = estimasi ? N_BULAN - 1 : Math.max(0, BULAN_KINI - 1)
  const bulanAwal = Math.min(BULAN_KINI, bulanMaks)
  const [st, setSt] = useState<FilterState>(muat)
  const [bulan, setBulanState] = useState(BULAN_KINI)
  const [bulan2, setBulan2State] = useState(BULAN_KINI)
  const [rentang, setRentangState] = useState(false)
  const [kom, setKom] = useState<Komoditas>("medium")
  const [jenisHarga, setJenisHargaState] = useState<Komoditas[]>(["medium", "premium"])
  const [satuan, setSatuan] = useState<Satuan>("gkg")
  const setJenisHarga = useCallback((j: Komoditas[]) => setJenisHargaState(j.length ? (["medium", "premium"] as Komoditas[]).filter((x) => j.includes(x)) : ["medium", "premium"]), [])
  const klem = useCallback((i: number) => Math.min(bulanMaks, Math.max(0, i)), [bulanMaks])
  const setBulan = useCallback(
    (i: number) => {
      const v = klem(i)
      setBulanState(v)
      setBulan2State((b) => Math.max(b, v))
    },
    [klem],
  )
  const setBulan2 = useCallback(
    (i: number) => {
      const v = klem(i)
      setBulan2State(v)
      setBulanState((b) => Math.min(b, v))
    },
    [klem],
  )
  const setRange = useCallback(
    (a: number, b: number) => {
      const x = klem(Math.min(a, b))
      const y = klem(Math.max(a, b))
      setBulanState(x)
      setBulan2State(y)
      setRentangState(true)
    },
    [klem],
  )
  const setRentang = useCallback(
    (r: boolean) => {
      setRentangState(r)
      if (r) {
        // Awal rentang: 3 bulan berakhir di bulan terpilih.
        setBulan2State(klem(bulan))
        setBulanState(klem(bulan - 2))
      } else {
        setBulanState(klem(bulan2))
      }
    },
    [bulan, bulan2, klem],
  )
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

  // Sesi (dan batas bulan) baru diketahui setelah state awal dibuat, jadi bulan dijepit saat dibaca.
  const b1 = Math.min(bulan, bulanMaks)
  const b2 = Math.min(bulan2, bulanMaks)

  const value = useMemo<FilterContextValue>(() => {
    const lolos = (k: Wilayah) =>
      (!tersedia.wilayah || st.wilayah.includes(k.n)) &&
      (!tersedia.hs || (pathname === "/harga" ? jenisHarga : [kom]).some((j) => st.hs.includes(statusHargaAt(k, 4, j)))) &&
      (!tersedia.ss || st.ss.includes(k.ss))
    return {
      ...st,
      bulan: b1,
      setBulan,
      rentang,
      setRentang,
      bulan2: b2,
      setBulan2,
      setRange,
      mulai: b1,
      akhir: rentang ? b2 : b1,
      bulanMaks,
      bulanAwal,
      estimasi,
      panel,
      setPanel,
      kom,
      setKom,
      jenisHarga,
      setJenisHarga,
      satuan,
      setSatuan,
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
        setRentangState(false)
        setBulanState(bulanAwal)
        setBulan2State(bulanAwal)
      },
      aktif:
        (tersedia.wilayah && st.wilayah.length < WILAYAH.length ? 1 : 0) +
        (tersedia.hs && st.hs.length < HS_ALL.length ? 1 : 0) +
        (tersedia.ss && st.ss.length < SS_ALL.length ? 1 : 0),
      lolos,
      W: WILAYAH.filter(lolos),
    }
  }, [st, simpan, tersedia, pathname, jenisHarga, setJenisHarga, satuan, panel, setPanel, kom, b1, setBulan, rentang, setRentang, b2, setBulan2, setRange, bulanMaks, bulanAwal, estimasi])

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>
}

export function useFilter() {
  const ctx = useContext(FilterContext)
  if (!ctx) throw new Error("useFilter harus dipakai di dalam FilterProvider")
  return ctx
}

/** Wilayah yang lolos filter global. */
export const useWilayah = () => useFilter().W

/** Seperti useFilter, tetapi null di luar FilterProvider (dipakai Panel untuk konteks interpretasi). */
export const useFilterOpsional = () => useContext(FilterContext)
