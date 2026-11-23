import type { ReactNode } from "react"
import { useLocation } from "react-router-dom"
import { Lock } from "lucide-react"
import { tautanMasuk, useSesi } from "@/lib/sesi"

/** Tampilkan isi hanya untuk peran yang punya `hak`; selain itu kartu ajakan masuk. */
export function Terkunci({ hak = "dasbor_sphp", judul, children, ringkas = false }: { hak?: string; judul: string; children: ReactNode; ringkas?: boolean }) {
  const { boleh, siap } = useSesi()
  const { pathname } = useLocation()
  if (boleh(hak)) return <>{children}</>
  if (!siap) return null
  if (ringkas)
    return (
      <a className="terkunci-ringkas" href={tautanMasuk(pathname)}>
        <Lock size={12} /> Masuk untuk melihat {judul.toLowerCase()}
      </a>
    )
  return (
    <div className="terkunci">
      <Lock size={18} aria-hidden="true" />
      <div>
        <b>{judul}</b>
        <p>Tersedia untuk akun dinas dan perusahaan mitra. Pengunjung umum tetap bisa melihat prakiraan produksi, stok, dan harga.</p>
      </div>
      <a className="btn-masuk" href={tautanMasuk(pathname)}>
        Masuk
      </a>
    </div>
  )
}
