import { useEffect, useId, useMemo, useRef, useState } from "react"
import { Check, ChevronDown, MapPin, Search } from "lucide-react"
import { REGIONS } from "@/lib/arus"
import { STATUS, byName } from "@/lib/data"
import { rp } from "@/lib/format"
import { useSelection } from "@/lib/selection"

const norm = (s: string) => s.toLowerCase().replace("kota ", "kt ").replace(/\s+/g, " ")

/** Pemilih wilayah: pencarian, dikelompokkan per kawasan, dengan status harga dan harga kini. */
export function WilayahPicker() {
  const { sel, select } = useSelection()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const cur = byName[sel]

  const groups = useMemo(() => {
    const nq = norm(q.trim())
    return REGIONS.map((r) => ({
      r,
      items: r.members.filter((m) => !nq || norm(m).includes(nq) || norm(r.short).includes(nq)).sort((a, b) => a.localeCompare(b)),
    })).filter((g) => g.items.length)
  }, [q])
  const flat = groups.flatMap((g) => g.items)
  const indexOf = new Map(flat.map((n, i) => [n, i]))

  const openPicker = () => {
    setActive(Math.max(0, REGIONS.flatMap((r) => [...r.members].sort((a, b) => a.localeCompare(b))).indexOf(sel)))
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => inputRef.current?.focus())
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onEsc)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onEsc)
    }
  }, [open])

  useEffect(() => {
    // Gulir hanya di dalam daftar, bukan seluruh halaman.
    const list = listRef.current
    const el = list?.querySelector<HTMLElement>(`[data-i="${active}"]`)
    if (!list || !el) return
    const top = el.offsetTop - 28
    const bottom = el.offsetTop + el.offsetHeight
    if (top < list.scrollTop) list.scrollTop = top
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 6
  }, [active, open])

  const choose = (n: string) => {
    select(n)
    setOpen(false)
    setQ("")
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive((a) => Math.min(flat.length - 1, a + 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === "Enter") {
      e.preventDefault()
      if (flat[active]) choose(flat[active])
    } else if (e.key === "Escape") {
      setOpen(false)
    }
  }

  return (
    <div className="picker" ref={rootRef}>
      <button
        type="button"
        className="picker-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => (open ? setOpen(false) : openPicker())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault()
            openPicker()
          }
        }}
      >
        <MapPin size={14} />
        <span className="picker-lbl">
          <small>Wilayah</small>
          {sel}
        </span>
        <span className="picker-dot" style={{ background: STATUS[cur.hs].c }} title={`Harga ${STATUS[cur.hs].lab}`} />
        <ChevronDown size={15} className="picker-chev" />
      </button>
      {open && (
        <div className="picker-pop" role="dialog" aria-label="Pilih wilayah">
          <div className="picker-search">
            <Search size={14} />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setActive(0)
              }}
              onKeyDown={onKey}
              placeholder="Cari kabupaten/kota atau kawasan…"
              aria-controls={listId}
              aria-activedescendant={flat[active] ? `${listId}-${active}` : undefined}
            />
            <kbd>esc</kbd>
          </div>
          <div className="picker-list" role="listbox" id={listId} ref={listRef}>
            {groups.map((g) => (
              <div key={g.r.key} role="group" aria-label={g.r.name}>
                <div className="picker-grp">
                  <span className="sw" style={{ background: g.r.color }} />
                  {g.r.name}
                </div>
                {g.items.map((n) => {
                  const i = indexOf.get(n) ?? 0
                  const k = byName[n]
                  return (
                    <div
                      key={n}
                      id={`${listId}-${i}`}
                      data-i={i}
                      role="option"
                      aria-selected={n === sel}
                      className={`picker-opt${i === active ? " is-active" : ""}`}
                      onMouseEnter={() => setActive(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choose(n)}
                    >
                      <span className="picker-dot" style={{ background: STATUS[k.hs].c }} />
                      <span className="nm">{n}</span>
                      <span className="pr">{rp(k.pNow)}</span>
                      {n === sel ? <Check size={14} className="ck" /> : <span className="ck" />}
                    </div>
                  )
                })}
              </div>
            ))}
            {!flat.length && <div className="picker-empty">Tidak ada wilayah yang cocok.</div>}
          </div>
          <div className="picker-foot">
            <span>
              <span className="picker-dot" style={{ background: "var(--ok)" }} /> Aman
            </span>
            <span>
              <span className="picker-dot" style={{ background: "var(--warn)" }} /> Waspada
            </span>
            <span>
              <span className="picker-dot" style={{ background: "var(--crit)" }} /> Siaga
            </span>
            <span className="hint">↑↓ pilih · Enter</span>
          </div>
        </div>
      )}
    </div>
  )
}
