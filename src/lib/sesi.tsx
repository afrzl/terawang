import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"

/**
 * Peran pengguna dasbor, dibaca dari layanan admin (GET /admin/api/saya, cookie sesi HttpOnly).
 * Tanpa login atau layanan tidak terjangkau (mis. `npm run dev`) = guest.
 *   guest       dasbor umum
 *   perusahaan  dasbor lengkap termasuk SPHP
 *   dinas       dasbor lengkap + panel admin (pipeline, unggah manual)
 *   superadmin  semua + konfigurasi/secret, akun
 */
export type Peran = "guest" | "perusahaan" | "dinas" | "superadmin"

export interface Sesi {
  pengguna: string | null
  peran: Peran
  labelPeran: string
  hak: string[]
}

const GUEST: Sesi = { pengguna: null, peran: "guest", labelPeran: "Guest", hak: [] }

interface Ctx {
  sesi: Sesi
  siap: boolean
  boleh: (hak: string) => boolean
  keluar: () => Promise<void>
}

const SesiCtx = createContext<Ctx>({ sesi: GUEST, siap: false, boleh: () => false, keluar: async () => {} })

export function SesiProvider({ children }: { children: ReactNode }) {
  const [sesi, setSesi] = useState<Sesi>(GUEST)
  const [siap, setSiap] = useState(false)

  useEffect(() => {
    let batal = false
    fetch("/admin/api/saya", { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then((r) => (r.ok && (r.headers.get("content-type") || "").includes("json") ? r.json() : GUEST))
      .then((d: Sesi) => !batal && setSesi(d && d.peran ? d : GUEST))
      .catch(() => !batal && setSesi(GUEST))
      .finally(() => !batal && setSiap(true))
    return () => {
      batal = true
    }
  }, [])

  const boleh = useCallback((hak: string) => sesi.hak.includes(hak), [sesi])
  const keluar = useCallback(async () => {
    try {
      await fetch("/admin/api/keluar", { method: "POST", credentials: "same-origin", headers: { "X-Terawang-Admin": "1" } })
    } finally {
      setSesi(GUEST)
    }
  }, [])

  return <SesiCtx.Provider value={{ sesi, siap, boleh, keluar }}>{children}</SesiCtx.Provider>
}

export const useSesi = () => useContext(SesiCtx)

/** Tautan masuk yang kembali ke halaman ini setelah login. */
export function tautanMasuk(path: string) {
  return `/admin/?kembali=${encodeURIComponent(path)}`
}
