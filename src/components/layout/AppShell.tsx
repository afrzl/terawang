import { useEffect } from "react"
import { NavLink, Outlet, useLocation } from "react-router-dom"
import { ThemeToggle } from "@/components/layout/ThemeToggle"
import { navItems } from "@/components/layout/nav"
import { WILAYAH_SORTED } from "@/lib/data"
import { useSelection } from "@/lib/selection"

export function AppShell() {
  const { sel, select } = useSelection()
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <>
      <header className="kop">
        <div className="wrap">
          <div className="brand">
            <h1>TERAWANG</h1>
            <div className="sub">Pemantauan beras dari sawah ke pasar · Provinsi Jawa Timur, 38 kabupaten/kota</div>
          </div>
          <div className="meta">
            <span>
              <b>Pekan 44/2026</b> · data s.d. Minggu, 1 Nov 2026
            </span>
            <span>
              Musim: <b>MT I 2026/27</b>
            </span>
            <label className="sel" htmlFor="kabSel">
              Wilayah
              <select id="kabSel" value={sel} onChange={(e) => select(e.target.value)}>
                {WILAYAH_SORTED.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <span className="tag">Prototipe · data simulasi</span>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <nav className="tabs" aria-label="Bagian dasbor">
        <div className="wrap">
          {navItems.map((it) => (
            <NavLink key={it.to} to={it.to} end>
              <span className="k">{it.k}</span>
              {it.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <main className="wrap">
        <Outlet />
      </main>
      <footer>
        <div className="wrap">
          TERAWANG · Tim Makmur Jaya, Politeknik Statistika STIS · PLAY IT! Hackathon DeepTech 2026. Semua angka di prototipe ini
          adalah data simulasi yang dibangkitkan untuk peragaan, bukan data resmi. Batas wilayah: GADM; Kota Blitar ditandai titik,
          pulau kecil (Bawean, Masalembu) tidak digambar.
        </div>
      </footer>
    </>
  )
}
