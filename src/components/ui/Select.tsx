import { Fragment, useEffect, useId, useRef, useState } from "react"
import { Check, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

export interface SelectOption<T extends string> {
  value: T
  label: string
  /** Judul kelompok; tampil sekali sebelum opsi pertama kelompok itu. */
  grup?: string
}

interface SelectProps<T extends string> {
  label: string
  options: SelectOption<T>[]
  value: T
  onChange: (v: T) => void
  disabled?: boolean
  placeholder?: string
}

const TINGGI_BARIS = 34

/** Pilihan tunggal berbentuk daftar tarik-turun, senada dengan MultiSelect. */
export function Select<T extends string>({ label, options, value, onChange, disabled, placeholder }: SelectProps<T>) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const now = options.find((o) => o.value === value)

  const tutup = () => setOpen(false)
  const buka = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const tinggi = (options.length + new Set(options.map((o) => o.grup).filter(Boolean)).size) * TINGGI_BARIS + 8
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
        disabled={disabled}
        onClick={() => (open ? tutup() : buka())}
      >
        <span className="ms-val">{now ? <span className="ms-sel">{now.label}</span> : <span className="ms-none">{placeholder ?? "Pilih"}</span>}</span>
        <ChevronDown size={15} className="ms-chev" />
      </button>
      {open && pos && (
        <div ref={popRef} className="ms-pop" id={id} role="listbox" aria-label={label} style={{ left: pos.left, top: pos.top, width: pos.width }}>
          {options.map((o, idx) => (
            <Fragment key={o.value}>
              {o.grup && o.grup !== options[idx - 1]?.grup && <div className="ms-grp">{o.grup}</div>}
            <button
              type="button"
              role="option"
              aria-selected={o.value === value}
              className={cn("ms-opt", o.value === value && "on")}
              onClick={() => {
                onChange(o.value)
                tutup()
              }}
            >
              <span className="ms-nm">{o.label}</span>
              {o.value === value && <Check size={13} strokeWidth={2.5} />}
            </button>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  )
}
