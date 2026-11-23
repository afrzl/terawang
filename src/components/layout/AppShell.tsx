import { useEffect, useRef } from "react"
import { NavLink, Outlet, useLocation } from "react-router-dom"
import { User } from "lucide-react"
import { KopPattern } from "@/components/layout/KopPattern"
import { ThemeToggle } from "@/components/layout/ThemeToggle"
import { navItems } from "@/components/layout/nav"
import { FilterPanel } from "@/components/layout/FilterPanel"
import { useFilter } from "@/lib/filter"
import { useSelection } from "@/lib/selection"


function Logo() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="13" fill="none" stroke="#B9E39A" strokeWidth="1.4" strokeDasharray="2 3" />
      <path d="M16 6c-1.2 5-5 7-5 12a5 5 0 0 0 10 0c0-5-3.8-7-5-12z" fill="#B9E39A" />
      <path d="M16 12v14" stroke="#163E66" strokeWidth="1.6" />
      <circle cx="27" cy="9" r="2.2" fill="#fff" />
    </svg>
  )
}

export function AppShell() {
  const { pathname } = useLocation()
  const { W, reset } = useFilter()
  const { sel, select } = useSelection()

  // Kalau wilayah terpilih tersaring keluar oleh filter, pindah ke wilayah pertama yang lolos.
  useEffect(() => {
    if (W.length && !W.some((k) => k.n === sel)) select(W[0].n)
  }, [W, sel, select])

  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0)
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <div className="shell">
      <header className="kop">
        <KopPattern />
        <div className="wrap">
          <div className="brand">
            <div className="logo">
              <Logo />
            </div>
            <h1>
              TERA<span>WANG</span>
            </h1>
          </div>
          <nav className="tabs" aria-label="Bagian dasbor">
            {navItems.map((it) => (
              <NavLink key={it.to} to={it.to} end>
                {it.label}
              </NavLink>
            ))}
          </nav>
          <div className="meta">
            <ThemeToggle />
            <button type="button" className="icon-btn" aria-label="Akun" title="Akun">
              <User size={15} />
            </button>
          </div>
        </div>
      </header>
      <div className="body">
        <FilterPanel />
        <div className="scroll" ref={scrollRef}>
          <main className="wrap">
            {W.length ? (
              <Outlet />
            ) : (
              <div className="fp-empty">
                <p>Tidak ada wilayah yang cocok dengan filter.</p>
                <button type="button" onClick={reset}>
                  Atur ulang filter
                </button>
              </div>
            )}
          </main>
          <footer>
            <div className="wrap">
              TERAWANG · Tim Makmur Jaya, Politeknik Statistika STIS · PLAY IT! Hackathon DeepTech 2026. Semua angka di prototipe ini
              adalah data simulasi yang dibangkitkan untuk peragaan, bukan data resmi. Batas wilayah: GADM; Kota Blitar ditandai titik,
              pulau kecil (Bawean, Masalembu) tidak digambar.
            </div>
          </footer>
        </div>
      </div>
    </div>
  )
}
