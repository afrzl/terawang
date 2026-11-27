import { useEffect, useRef } from "react"
import { NavLink, Outlet, useLocation } from "react-router-dom"
import { ThemeToggle } from "@/components/layout/ThemeToggle"
import { navItems } from "@/components/layout/nav"
import { FilterPanel } from "@/components/layout/FilterPanel"
import { WaFab } from "@/components/layout/WaFab"
import { useFilter } from "@/lib/filter"
import { useSelection } from "@/lib/selection"
import { AkunMenu } from "@/components/layout/AkunMenu"


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
            <AkunMenu />
          </div>
        </div>
      </header>
      <div className="body">
        <FilterPanel />
        <div className={"scroll" + (pathname === "/" ? " full" : "")} ref={scrollRef}>
          <main className={pathname === "/" ? "full" : "wrap"}>
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
          {pathname !== "/" && (
          <footer>
            <div className="wrap" style={{ textAlign: "center" }}>
              TERAWANG by Makmur Jaya, Politeknik Statistika STIS 2026
            </div>
          </footer>
          )}
        </div>
      </div>
      <WaFab />
    </div>
  )
}
