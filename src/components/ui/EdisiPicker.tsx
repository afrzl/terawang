import { useEffect, useId, useRef, useState } from "react"
import { Check, ChevronDown } from "lucide-react"

export interface OpsiEdisi {
  pekan: string
  /** Nomor pekan, mis. "48". */
  no: string
  /** Rentang tanggal, mis. "23–29 Nov 2026". */
  rentang: string
  judul: string
}

/** Pemilih edisi Laporan pekan: tombol + popover daftar pekan (nomor, tanggal, judul). Panah atas/bawah, Enter, Esc. */
export function EdisiPicker({ opsi, nilai, onPilih }: { opsi: OpsiEdisi[]; nilai: string | null; onPilih: (pekan: string) => void }) {
  const [buka, setBuka] = useState(false)
  const [fokus, setFokus] = useState(0)
  const akar = useRef<HTMLDivElement>(null)
  const daftar = useRef<HTMLUListElement>(null)
  const id = useId()
  const kini = opsi.find((o) => o.pekan === nilai) ?? opsi[0]

  useEffect(() => {
    if (!buka) return
    const tutup = (e: MouseEvent) => !akar.current?.contains(e.target as Node) && setBuka(false)
    document.addEventListener("mousedown", tutup)
    return () => document.removeEventListener("mousedown", tutup)
  }, [buka])
  useEffect(() => {
    if (buka) daftar.current?.querySelector<HTMLElement>(`[data-i="${fokus}"]`)?.scrollIntoView({ block: "nearest" })
  }, [buka, fokus])

  const bukaDaftar = () => {
    setFokus(Math.max(0, opsi.findIndex((o) => o.pekan === kini?.pekan)))
    setBuka(true)
    requestAnimationFrame(() => daftar.current?.focus())
  }
  const pilih = (i: number) => {
    const o = opsi[i]
    if (o) onPilih(o.pekan)
    setBuka(false)
  }
  const tombolKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      bukaDaftar()
    }
  }
  const daftarKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") setFokus((f) => Math.min(opsi.length - 1, f + 1))
    else if (e.key === "ArrowUp") setFokus((f) => Math.max(0, f - 1))
    else if (e.key === "Home") setFokus(0)
    else if (e.key === "End") setFokus(opsi.length - 1)
    else if (e.key === "Enter" || e.key === " ") pilih(fokus)
    else if (e.key === "Escape" || e.key === "Tab") setBuka(false)
    else return
    e.preventDefault()
  }

  if (!kini) return null
  return (
    <div className="edisi" ref={akar}>
      <button type="button" className="edisi-btn" aria-haspopup="listbox" aria-expanded={buka} aria-controls={id} onClick={() => (buka ? setBuka(false) : bukaDaftar())} onKeyDown={tombolKey}>
        <span className="edisi-no">
          <small>Edisi</small>
          {kini.no}
        </span>
        <span className="edisi-lbl">
          <b>Pekan {kini.no}</b>
          <span>{kini.rentang}</span>
        </span>
        <ChevronDown size={16} className="edisi-chev" />
      </button>
      {buka && (
        <ul className="edisi-pop" id={id} role="listbox" ref={daftar} tabIndex={-1} aria-activedescendant={`${id}-${fokus}`} onKeyDown={daftarKey}>
          {opsi.map((o, i) => (
            <li
              key={o.pekan}
              id={`${id}-${i}`}
              data-i={i}
              role="option"
              aria-selected={o.pekan === kini.pekan}
              className={i === fokus ? "is-fokus" : undefined}
              onMouseEnter={() => setFokus(i)}
              onClick={() => pilih(i)}
            >
              <span className="edisi-pop-no">{o.no}</span>
              <span className="edisi-pop-txt">
                <span className="edisi-pop-tgl">
                  {o.rentang}
                  {i === 0 && <em>Terbaru</em>}
                </span>
                <span className="edisi-pop-jdl">{o.judul}</span>
              </span>
              {o.pekan === kini.pekan && <Check size={16} className="edisi-pop-cek" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
