import { useEffect, useId, useRef, useState } from "react"
import { Check, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

export interface MultiOption<T extends string> {
  value: T
  label: string
  color: string
  n?: number
}

interface MultiSelectProps<T extends string> {
  label: string
  options: MultiOption<T>[]
  value: T[]
  onChange: (v: T[]) => void
}

const TINGGI_BARIS = 34
const TINGGI_KAKI = 42

/** Pilihan ganda berbentuk daftar tarik-turun dengan tombol pilih semua dan hapus semua. */
export function MultiSelect<T extends string>({ label, options, value, onChange }: MultiSelectProps<T>) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const id = useId()

  const semua = value.length === options.length
  const dipilih = options.filter((o) => value.includes(o.value))

  const tutup = () => setOpen(false)

  const buka = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const tinggi = options.length * TINGGI_BARIS + TINGGI_KAKI + 8
    const top = r.bottom + 4 + tinggi > window.innerHeight ? Math.max(8, r.top - 4 - tinggi) : r.bottom + 4
    setPos({ left: r.left, top, width: r.width })
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
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    window.addEventListener("resize", tutup)
    document.addEventListener("scroll", tutup, true)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
      window.removeEventListener("resize", tutup)
      document.removeEventListener("scroll", tutup, true)
    }
  }, [open])

  const toggle = (v: T) => onChange(value.includes(v) ? value.filter((x) => x !== v) : options.map((o) => o.value).filter((x) => x === v || value.includes(x)))

  return (
    <div className="ms" ref={rootRef}>
      <button
        ref={btnRef}
        type="button"
        className="ms-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        onClick={() => (open ? tutup() : buka())}
      >
        <span className="ms-val">
          {semua ? (
            <span className="ms-all">Semua</span>
          ) : dipilih.length === 0 ? (
            <span className="ms-none">Tidak ada</span>
          ) : (
            <>
              {dipilih.slice(0, 1).map((o) => (
                <span key={o.value} className="ms-tag">
                  <span className="ms-dot" style={{ background: o.color }} />
                  {o.label}
                </span>
              ))}
              {dipilih.length > 1 && <span className="ms-more">+{dipilih.length - 1}</span>}
            </>
          )}
        </span>
        <span className="ms-cnt">
          {dipilih.length}/{options.length}
        </span>
        <ChevronDown size={15} className="ms-chev" />
      </button>

      {open && pos && (
        <div ref={popRef} className="ms-pop" id={id} role="listbox" aria-multiselectable="true" aria-label={label} style={{ left: pos.left, top: pos.top, width: pos.width }}>
          {options.map((o) => {
            const on = value.includes(o.value)
            return (
              <button key={o.value} type="button" role="option" aria-selected={on} className={cn("ms-opt", on && "on")} onClick={() => toggle(o.value)}>
                <span className="fp-box">{on && <Check size={11} strokeWidth={3} />}</span>
                <span className="ms-dot" style={{ background: o.color }} />
                <span className="ms-nm">{o.label}</span>
                {o.n !== undefined && <span className="ms-n">{o.n}</span>}
              </button>
            )
          })}
          <div className="ms-foot">
            <button type="button" className="fp-link" onClick={() => onChange(options.map((o) => o.value))}>
              Pilih semua
            </button>
            <button type="button" className="fp-link" onClick={() => onChange([])}>
              Hapus semua
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
