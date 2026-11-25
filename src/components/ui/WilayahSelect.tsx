import { useEffect, useId, useRef, useState } from "react"
import { Check, ChevronDown, Search } from "lucide-react"
import { REGIONS } from "@/lib/arus"
import { WILAYAH_SORTED } from "@/lib/data"
import { useFilter } from "@/lib/filter"
import { cn } from "@/lib/utils"

const norm = (s: string) => s.toLowerCase().replace("kota ", "kt ").replace(/\s+/g, " ")
const LEBAR_MIN = 268
const TINGGI = 440

/** Pilihan wilayah (multi-select) berbentuk daftar tarik-turun. Pilihan cepat per kawasan ada di dalam daftar. */
export function WilayahSelect() {
  const { wilayah, toggleWilayah, pilihKawasan, setWilayah } = useFilter()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null)
  const [q, setQ] = useState("")
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const cariRef = useRef<HTMLInputElement>(null)
  const id = useId()

  const semua = wilayah.length === WILAYAH_SORTED.length
  const nq = norm(q.trim())
  const daftar = WILAYAH_SORTED.filter((n) => !nq || norm(n).includes(nq))
  const dipilih = WILAYAH_SORTED.filter((n) => wilayah.includes(n))

  const tutup = () => setOpen(false)
  const buka = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    // Dibuka di sisi kanan sidebar agar tombolnya tetap terlihat.
    const top = Math.max(8, Math.min(r.top, window.innerHeight - TINGGI - 8))
    setPos({ left: r.right + 8, top, width: LEBAR_MIN })
    setQ("")
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!rootRef.current?.contains(t) && !popRef.current?.contains(t)) tutup()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        tutup()
        btnRef.current?.focus()
      }
    }
    cariRef.current?.focus({ preventScroll: true })
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <div className="ms" ref={rootRef}>
      <button
        ref={btnRef}
        type="button"
        className="ms-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        aria-label="Wilayah"
        onClick={() => (open ? tutup() : buka())}
      >
        <span className="ms-val">
          {semua ? (
            <span className="ms-all">Semua</span>
          ) : dipilih.length === 0 ? (
            <span className="ms-none">Tidak ada</span>
          ) : (
            <>
              <span className="ms-tag">{dipilih[0]}</span>
              {dipilih.length > 1 && <span className="ms-more">+{dipilih.length - 1}</span>}
            </>
          )}
        </span>
        <span className="ms-cnt">
          {dipilih.length}/{WILAYAH_SORTED.length}
        </span>
        <ChevronDown size={15} className="ms-chev" />
      </button>

      {open && pos && (
        <div ref={popRef} className="ms-pop wt-pop" id={id} role="dialog" aria-label="Pilih wilayah" style={{ left: pos.left, top: pos.top, width: pos.width, height: TINGGI }}>
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
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari wilayah" aria-label="Cari wilayah" ref={cariRef} />
          </label>

          <div className="wt-list" role="listbox" aria-multiselectable="true">
            {daftar.map((n) => {
              const on = wilayah.includes(n)
              return (
                <button key={n} type="button" role="option" aria-selected={on} className={cn("fp-opt", on && "on")} onClick={() => toggleWilayah(n)}>
                  <span className="fp-box">{on && <Check size={11} strokeWidth={3} />}</span>
                  <span className="fp-nm">{n}</span>
                </button>
              )
            })}
            {!daftar.length && <div className="wt-empty">Tidak ada wilayah yang cocok.</div>}
          </div>

          <div className="ms-foot">
            <button type="button" className="fp-link" onClick={() => setWilayah(WILAYAH_SORTED)}>
              Pilih semua
            </button>
            <button type="button" className="fp-link" onClick={() => setWilayah([])}>
              Hapus semua
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
