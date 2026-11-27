import type { ReactNode } from "react"
import { Lock } from "lucide-react"
import { useSesi } from "@/lib/sesi"

/** Tampilkan isi hanya untuk peran yang punya `hak`; selain itu keterangan bahwa bagian ini untuk akun mitra. */
export function Terkunci({ hak = "dasbor_sphp", judul, children, ringkas = false }: { hak?: string; judul: string; children: ReactNode; ringkas?: boolean }) {
  const { boleh, siap, sesi } = useSesi()
  if (boleh(hak)) return <>{children}</>
  if (!siap) return null
  if (ringkas)
    return (
      <span className="terkunci-ringkas">
        <Lock size={12} /> {judul} untuk akun mitra
      </span>
    )
  return (
    <div className="terkunci">
      <Lock size={18} aria-hidden="true" />
      <div>
        <b>{judul}</b>
        <p>Tersedia untuk akun perusahaan, dinas/Bulog, dan admin. Akun {sesi.labelPeran.toLowerCase()} melihat data yang sudah tercatat.</p>
      </div>
    </div>
  )
}
