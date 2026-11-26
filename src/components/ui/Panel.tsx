import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useWadahTafsir } from "@/lib/tafsir"
import { useTafsir } from "@/components/ui/Tafsir"

interface PanelProps {
  title?: React.ReactNode
  note?: React.ReactNode
  actions?: React.ReactNode
  className?: string
  children: React.ReactNode
  /**
   * Interpretasi grafik. Tombol muncul otomatis bila grafik di dalam panel mendaftarkan datanya (useDataTafsir).
   * Isi dengan teks untuk menambah keterangan (satuan, status data), atau false untuk mematikan.
   */
  tafsir?: string | false
  /** Data interpretasi untuk grafik yang digambar langsung oleh komponen pemilik panel (tidak lewat useDataTafsir). */
  dataTafsir?: unknown
}

export function Panel({ title, note, actions, className, children, tafsir, dataTafsir }: PanelProps) {
  const { isi: terdaftar, Provider, daftar } = useWadahTafsir()
  const isi = dataTafsir === undefined ? terdaftar : { panel: dataTafsir, ...terdaftar }
  const judul = typeof title === "string" ? title : typeof note === "string" ? note : "Grafik"
  const { tombol, kotak } = useTafsir({ judul, data: tafsir === false ? {} : isi, keterangan: tafsir || undefined })
  return (
    <div className={cn("panel", className)}>
      {(title || note || actions || tombol) && (
        <div className="ph">
          <h3>{title}</h3>
          {note && <span className="note">{note}</span>}
          {(actions || tombol) && (
            <div className="ph-aksi">
              {actions}
              {tombol}
            </div>
          )}
        </div>
      )}
      {kotak}
      <Provider value={daftar}>{children}</Provider>
    </div>
  )
}

export function ViewHeader({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: React.ReactNode }) {
  return (
    <div className="vh">
      <div>
        <h2>
          <span className="vh-ico">
            <Icon size={19} />
          </span>
          {title}
        </h2>
        {children && <p>{children}</p>}
      </div>
    </div>
  )
}
