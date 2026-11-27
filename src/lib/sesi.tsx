import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"

/**
 * Sesi pengguna dasbor, dibaca dari layanan admin (GET /admin/api/saya, cookie sesi HttpOnly).
 * Dasbor wajib masuk. Hak tiap peran diatur lewat matriks di halaman admin "Akun & peran":
 *   tamu        peta ringkasan, produksi, stok, arus beras, laporan pekan; hanya data yang sudah terjadi
 *   perusahaan  semua halaman dasbor + harga + SPHP, dengan estimasi dan prakiraan
 *   dinas       seperti perusahaan + panel admin (pipeline, unggah berkas manual)
 *   superadmin  semua fitur (label "Admin")
 * `npm run dev` tanpa layanan admin: sesi pengembang dengan semua hak dasbor.
 */
export type Peran = "tamu" | "perusahaan" | "dinas" | "superadmin"

export interface Sesi {
  pengguna: string | null
  peran: Peran | null
  labelPeran: string
  hak: string[]
  demo?: boolean
}

export interface AkunDemo {
  peran: Peran
  label: string
  pengguna: string
  sandi: string
}

const ANONIM: Sesi = { pengguna: null, peran: null, labelPeran: "Belum masuk", hak: [] }
const PENGEMBANG: Sesi = {
  pengguna: "pengembang",
  peran: "superadmin",
  labelPeran: "Pengembang (lokal)",
  hak: ["dasbor_ringkasan", "dasbor_produksi", "dasbor_stok", "dasbor_arus", "dasbor_cerita", "dasbor_harga", "dasbor_sphp", "dasbor_estimasi", "dasbor_whatsapp"],
}

interface Ctx {
  sesi: Sesi
  siap: boolean
  boleh: (hak: string) => boolean
  masuk: (pengguna: string, sandi: string) => Promise<Sesi>
  keluar: () => Promise<void>
}

const SesiCtx = createContext<Ctx>({
  sesi: ANONIM,
  siap: false,
  boleh: () => false,
  masuk: async () => ANONIM,
  keluar: async () => {},
})

const HEADER = { "X-Terawang-Admin": "1", Accept: "application/json" }

export function SesiProvider({ children }: { children: ReactNode }) {
  const [sesi, setSesi] = useState<Sesi>(ANONIM)
  const [siap, setSiap] = useState(false)

  useEffect(() => {
    let batal = false
    fetch("/admin/api/saya", { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then((r) => {
        if (r.ok && (r.headers.get("content-type") || "").includes("json")) return r.json()
        throw new Error("layanan admin tidak terjangkau")
      })
      .then((d: Sesi) => !batal && setSesi(d && Array.isArray(d.hak) ? d : ANONIM))
      .catch(() => !batal && setSesi(import.meta.env.DEV ? PENGEMBANG : ANONIM))
      .finally(() => !batal && setSiap(true))
    return () => {
      batal = true
    }
  }, [])

  const boleh = useCallback((hak: string) => sesi.hak.includes(hak), [sesi])

  const masuk = useCallback(async (pengguna: string, sandi: string) => {
    const r = await fetch("/admin/api/masuk", {
      method: "POST",
      credentials: "same-origin",
      headers: { ...HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({ pengguna, sandi }),
    })
    let d: Partial<Sesi> & { galat?: string } = {}
    try {
      d = await r.json()
    } catch {
      /* bukan JSON */
    }
    if (!r.ok || !d.pengguna) throw new Error(d.galat || "Layanan masuk sedang tidak bisa dijangkau.")
    const baru = d as Sesi
    setSesi(baru)
    return baru
  }, [])

  const keluar = useCallback(async () => {
    try {
      await fetch("/admin/api/keluar", { method: "POST", credentials: "same-origin", headers: HEADER })
    } finally {
      setSesi(ANONIM)
    }
  }, [])

  return <SesiCtx.Provider value={{ sesi, siap, boleh, masuk, keluar }}>{children}</SesiCtx.Provider>
}

export const useSesi = () => useContext(SesiCtx)

/** Prakiraan dan estimasi ke depan hanya untuk peran berhak `dasbor_estimasi` (tamu: hanya data yang sudah terjadi). */
export const useEstimasi = () => useSesi().boleh("dasbor_estimasi")

/** Halaman masuk yang kembali ke halaman ini setelah login. */
export function tautanMasuk(path: string) {
  return `/masuk?kembali=${encodeURIComponent(path)}`
}

/** Hak admin yang membuka panel /admin/. */
export const HAK_ADMIN = ["pipeline", "unggah", "jalankan", "laporan", "whatsapp", "konfigurasi", "akun", "jejak"]

export async function muatAkunDemo(): Promise<AkunDemo[]> {
  try {
    const r = await fetch("/admin/api/demo", { headers: { Accept: "application/json" } })
    if (!r.ok) return []
    const d = (await r.json()) as { akun?: AkunDemo[] }
    return Array.isArray(d.akun) ? d.akun : []
  } catch {
    return []
  }
}
