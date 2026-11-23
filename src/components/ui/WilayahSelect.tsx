import { useState } from "react"
import { Check, Search } from "lucide-react"
import { REGIONS } from "@/lib/arus"
import { WILAYAH_SORTED } from "@/lib/data"
import { useFilter } from "@/lib/filter"
import { cn } from "@/lib/utils"

const norm = (s: string) => s.toLowerCase().replace("kota ", "kt ").replace(/\s+/g, " ")

/** Pilihan wilayah (multi-select) dengan tombol pintas per kawasan. Tanpa centang berarti semua wilayah. */
export function WilayahSelect() {
  const { wilayah, toggleWilayah, pilihKawasan, setWilayah } = useFilter()
  const [q, setQ] = useState("")
  const semua = wilayah.length === WILAYAH_SORTED.length
  const nq = norm(q.trim())
  const daftar = WILAYAH_SORTED.filter((n) => !nq || norm(n).includes(nq))

  return (
    <div className="wt">
      <div className="wt-chips" role="group" aria-label="Pilihan cepat kawasan">
        <button type="button" className={cn("wt-chip", semua && "on")} aria-pressed={semua} onClick={() => setWilayah(WILAYAH_SORTED)}>
          Semua
        </button>
        {REGIONS.map((r) => {
          const on = wilayah.length === r.members.length && r.members.every((m) => wilayah.includes(m))
          return (
            <button key={r.key} type="button" className={cn("wt-chip", on && "on")} aria-pressed={on} onClick={() => pilihKawasan(r.key)}>
              {r.short}
            </button>
          )
        })}
      </div>

      <label className="wt-search">
        <Search size={13} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari wilayah" aria-label="Cari wilayah" />
      </label>

      <div className="wt-meta">{semua ? "Semua wilayah" : wilayah.length ? `${wilayah.length} dari ${WILAYAH_SORTED.length} dipilih` : "Tidak ada yang dipilih"}</div>

      <div className="wt-list">
        {daftar.map((n) => {
          const on = wilayah.includes(n)
          return (
            <button key={n} type="button" className={cn("fp-opt", on && "on")} aria-pressed={on} onClick={() => toggleWilayah(n)}>
              <span className="fp-box">{on && <Check size={11} strokeWidth={3} />}</span>
              <span className="fp-nm">{n}</span>
            </button>
          )
        })}
        {!daftar.length && <div className="wt-empty">Tidak ada wilayah yang cocok.</div>}
      </div>
    </div>
  )
}
