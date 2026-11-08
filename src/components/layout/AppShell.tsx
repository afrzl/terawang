import { useEffect } from "react"
import { Link, NavLink, Outlet, useLocation } from "react-router-dom"
import { CalendarDays, Sprout } from "lucide-react"
import { KopPattern } from "@/components/layout/KopPattern"
import { ThemeToggle } from "@/components/layout/ThemeToggle"
import { navItems } from "@/components/layout/nav"
import { WilayahPicker } from "@/components/ui/WilayahPicker"
import { FLOWS, WILAYAH } from "@/lib/data"
import { nf, sum } from "@/lib/format"

const estT = sum(WILAYAH, (k) => k.est)
const yoy = (estT / sum(WILAYAH, (k) => k.prev) - 1) * 100
const nSiaga = WILAYAH.filter((k) => k.hs === "siaga").length
const nDefisit = WILAYAH.filter((k) => k.ss === "defisit").length
const tonSphp = sum(FLOWS, (f) => f.ton)

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

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <>
      <header className="kop">
        <KopPattern />
        <div className="wrap">
          <div className="brand">
            <div className="logo">
              <Logo />
            </div>
            <div>
              <h1>
                TERA<span>WANG</span>
              </h1>
              <div className="sub">Pemantauan beras dari sawah ke pasar · Jawa Timur, 38 kabupaten/kota</div>
            </div>
          </div>
          <div className="meta">
            <span className="chip">
              <CalendarDays size={13} />
              <b>Pekan 44/2026</b> · s.d. 1 Nov
            </span>
            <span className="chip">
              <Sprout size={13} />
              <b>MT I 2026/27</b>
            </span>
            <WilayahPicker />
            <span className="tag">Prototipe · data simulasi</span>
            <ThemeToggle />
          </div>
          <div className="pulse" aria-label="Sorotan pekan ini">
            <Link to="/produksi">
              <span className="dot" style={{ background: "#B9E39A" }} />
              <span className="n">{nf(yoy, 1)}%</span>
              <span className="lbl">panen Nov–Jan vs 2025</span>
            </Link>
            <Link to="/stok">
              <span className="dot" style={{ background: "#F2C76B" }} />
              <span className="n">{nDefisit}</span>
              <span className="lbl">wilayah stok defisit dalam 4 pekan</span>
            </Link>
            <Link to="/harga">
              <span className="dot live" style={{ background: "#FF8A73" }} />
              <span className="n">{nSiaga}</span>
              <span className="lbl">wilayah Siaga harga</span>
            </Link>
            <Link to="/harga">
              <span className="dot" style={{ background: "#9CC3F5" }} />
              <span className="n">{nf(tonSphp)} t</span>
              <span className="lbl">rekomendasi SPHP</span>
            </Link>
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
