import { useEffect, useId, useRef, useState } from "react"
import { CalendarDays, Check, ChevronDown } from "lucide-react"
import { N_BULAN } from "@/lib/api"
import { BULAN_KINI, bulanLabel, useFilterOpsional } from "@/lib/filter"

const N_MAKS = N_BULAN - 1
const status = (i: number) => (i < BULAN_KINI ? "Riwayat" : "Estimasi")
const warna = (i: number) => (i < BULAN_KINI ? "var(--ink-3)" : "var(--warn)")

/** Pilihan bulan (Jan 2026 – Jan 2027) dengan penanda riwayat dan estimasi. */
export function BulanPicker({ bulan, setBulan, label }: { bulan: number; setBulan: (i: number) => void; label: string }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(bulan)
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  // Tanpa hak estimasi daftar berhenti di bulan lengkap terakhir.
  const n = (useFilterOpsional()?.bulanMaks ?? N_MAKS) + 1

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" })
  }, [open, active])

  const pilih = (i: number) => {
    setBulan(i)
    setOpen(false)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      if (!open) {
        setActive(bulan)
        setOpen(true)
      } else setActive((a) => Math.min(n - 1, Math.max(0, a + (e.key === "ArrowDown" ? -1 : 1))))
    } else if (e.key === "Enter" && open) {
      e.preventDefault()
      pilih(active)
    } else if (e.key === "Escape") setOpen(false)
  }

  return (
    <div className="picker" ref={rootRef}>
      <button
        type="button"
        className="picker-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={label}
        ref={btnRef}
        onClick={() => {
          const r = btnRef.current?.getBoundingClientRect()
          // Posisi tetap agar daftar tidak terpotong area sidebar yang bergulir.
          if (r) setPos({ left: r.left, top: Math.max(8, Math.min(r.bottom + 4, window.innerHeight - 360)) })
          setActive(bulan)
          setOpen((o) => !o)
        }}
        onKeyDown={onKey}
      >
        <CalendarDays size={14} />
        <span className="picker-lbl">{bulanLabel(bulan)}</span>
        <span className="bp-tag" style={{ color: warna(bulan) }}>
          {status(bulan)}
        </span>
        <ChevronDown size={15} className="picker-chev" />
      </button>
      {open && (
        <div className="picker-pop bp-pop" role="dialog" aria-label={label} onKeyDown={onKey} style={pos ? { position: "fixed", left: pos.left, top: pos.top, right: "auto", width: 264 } : undefined}>
          <div className="picker-list" role="listbox" id={listId} ref={listRef}>
            {Array.from({ length: n }, (_, k) => n - 1 - k).map((i) => (
              <div
                key={i}
                data-i={i}
                role="option"
                aria-selected={i === bulan}
                className={`picker-opt${i === active ? " is-active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => pilih(i)}
              >
                <span className="picker-dot" style={{ background: warna(i) }} />
                <span className="nm">{bulanLabel(i)}</span>
                <span className="pr">{status(i)}</span>
                {i === bulan ? <Check size={14} className="ck" /> : <span className="ck" />}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
