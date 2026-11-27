import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react"
import { useLocation } from "react-router-dom"
import { ChevronDown, LogIn, LogOut, Settings, ShieldCheck } from "lucide-react"
import { tautanMasuk, useSesi } from "@/lib/sesi"

/**
 * Akun di bilah atas. Guest: tombol Masuk. Sudah masuk: tombol bernama pengguna yang membuka
 * menu berisi peran, tautan Admin (bila berhak), dan Keluar. Pola menu ARIA: panah atas/bawah,
 * Home/End, Esc menutup dan mengembalikan fokus ke tombol, Tab atau klik di luar menutup.
 */
export function AkunMenu() {
  const { sesi, siap, boleh, keluar } = useSesi()
  const { pathname } = useLocation()
  const [buka, setBuka] = useState(false)
  const akarRef = useRef<HTMLDivElement>(null)
  const tombolRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const fokusAwal = useRef<"awal" | "akhir">("awal")
  const id = useId()

  const item = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])

  const tutup = useCallback((kembalikanFokus = false) => {
    setBuka(false)
    if (kembalikanFokus) tombolRef.current?.focus()
  }, [])

  // Fokus ke item pertama/terakhir saat menu terbuka.
  useEffect(() => {
    if (!buka) return
    const xs = item()
    ;(fokusAwal.current === "akhir" ? xs[xs.length - 1] : xs[0])?.focus()
  }, [buka])

  // Klik/sentuh di luar menutup menu.
  useEffect(() => {
    if (!buka) return
    const luar = (e: PointerEvent) => {
      if (!akarRef.current?.contains(e.target as Node)) tutup()
    }
    document.addEventListener("pointerdown", luar)
    return () => document.removeEventListener("pointerdown", luar)
  }, [buka, tutup])

  // Pindah halaman menutup menu.
  useEffect(() => setBuka(false), [pathname])

  if (!siap) return null
  if (!sesi.pengguna)
    return (
      <a className="chip chip-akun" href={tautanMasuk(pathname)}>
        <LogIn size={13} />
        <b>Masuk</b>
      </a>
    )

  const bukaDengan = (posisi: "awal" | "akhir") => {
    fokusAwal.current = posisi
    setBuka(true)
  }

  const tombolKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      bukaDengan("awal")
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      bukaDengan("akhir")
    }
  }

  const menuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const xs = item()
    const i = xs.indexOf(document.activeElement as HTMLElement)
    const ke = (n: number) => {
      e.preventDefault()
      xs[(n + xs.length) % xs.length]?.focus()
    }
    if (e.key === "ArrowDown") ke(i + 1)
    else if (e.key === "ArrowUp") ke(i - 1)
    else if (e.key === "Home") ke(0)
    else if (e.key === "End") ke(xs.length - 1)
    else if (e.key === "Escape") {
      e.preventDefault()
      tutup(true)
    } else if (e.key === "Tab") tutup()
  }

  const inisial = sesi.pengguna.slice(0, 1).toUpperCase()

  return (
    <div className="akun" ref={akarRef}>
      <button
        ref={tombolRef}
        type="button"
        className={"akun-btn" + (buka ? " on" : "")}
        aria-label={`Akun ${sesi.pengguna}, ${sesi.labelPeran}`}
        aria-haspopup="menu"
        aria-expanded={buka}
        aria-controls={buka ? id : undefined}
        onClick={() => (buka ? tutup() : bukaDengan("awal"))}
        onKeyDown={tombolKey}
        title={`Masuk sebagai ${sesi.pengguna} (${sesi.labelPeran})`}
      >
        <span className="akun-av" aria-hidden="true">
          {inisial}
        </span>
        <span className="akun-nama">{sesi.pengguna}</span>
        <ChevronDown size={14} className="akun-car" aria-hidden="true" />
      </button>
      {buka && (
        <div className="akun-pop" id={id} role="menu" aria-label="Menu akun" ref={menuRef} onKeyDown={menuKey}>
          <div className="akun-kepala" role="presentation">
            <span className="akun-av besar" aria-hidden="true">
              {inisial}
            </span>
            <div>
              <b>{sesi.pengguna}</b>
              <span className="akun-peran">
                <ShieldCheck size={12} aria-hidden="true" />
                {sesi.labelPeran}
              </span>
            </div>
          </div>
          {boleh("pipeline") && (
            <a role="menuitem" tabIndex={-1} className="akun-item" href="/admin/">
              <Settings size={15} aria-hidden="true" />
              Halaman Admin
            </a>
          )}
          <button
            role="menuitem"
            tabIndex={-1}
            type="button"
            className="akun-item keluar"
            onClick={() => {
              tutup(true)
              void keluar()
            }}
          >
            <LogOut size={15} aria-hidden="true" />
            Keluar
          </button>
        </div>
      )}
    </div>
  )
}
