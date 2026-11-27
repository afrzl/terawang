import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { NavLink, useLocation } from "react-router-dom"
import { ChevronDown } from "lucide-react"
import { adalahGrup, navItems, type NavGrup } from "@/components/layout/nav"
import { useSesi } from "@/lib/sesi"

/** Deretan menu di kop. Grup dengan satu sub menu yang boleh dibuka tampil sebagai menu biasa. */
export function NavMenu() {
  const { boleh } = useSesi()
  return (
    <>
      {navItems.map((e) => {
        if (!adalahGrup(e)) {
          return boleh(e.hak) ? (
            <NavLink key={e.to} to={e.to} end>
              {e.label}
            </NavLink>
          ) : null
        }
        const anak = e.anak.filter((a) => boleh(a.hak))
        if (!anak.length) return null
        if (anak.length === 1)
          return (
            <NavLink key={anak[0].to} to={anak[0].to} end>
              {anak[0].label}
            </NavLink>
          )
        return <MenuGrup key={e.label} grup={{ ...e, anak }} />
      })}
    </>
  )
}

/** Menu bersub menu. Daftar sub menu digambar di luar deretan menu (portal) karena deretan menu bisa digeser ke samping. */
function MenuGrup({ grup }: { grup: NavGrup }) {
  const { pathname } = useLocation()
  const [buka, setBuka] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; minWidth: number } | null>(null)
  const tombol = useRef<HTMLButtonElement>(null)
  const daftar = useRef<HTMLDivElement>(null)
  const aktif = grup.anak.some((a) => a.to === pathname)

  useEffect(() => setBuka(false), [pathname])

  useLayoutEffect(() => {
    if (!buka || !tombol.current) return
    const r = tombol.current.getBoundingClientRect()
    setPos({ top: r.bottom, left: r.left, minWidth: r.width })
  }, [buka])

  useEffect(() => {
    if (!buka) return
    const tutup = (ev: Event) => {
      const t = ev.target as Node
      if (tombol.current?.contains(t) || daftar.current?.contains(t)) return
      setBuka(false)
    }
    const esc = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        setBuka(false)
        tombol.current?.focus()
      }
    }
    const geser = () => setBuka(false)
    document.addEventListener("pointerdown", tutup)
    document.addEventListener("keydown", esc)
    window.addEventListener("resize", geser)
    window.addEventListener("scroll", geser, true)
    return () => {
      document.removeEventListener("pointerdown", tutup)
      document.removeEventListener("keydown", esc)
      window.removeEventListener("resize", geser)
      window.removeEventListener("scroll", geser, true)
    }
  }, [buka])

  return (
    <>
      <button
        ref={tombol}
        type="button"
        className="tab-grup"
        aria-haspopup="true"
        aria-expanded={buka}
        aria-current={aktif ? "page" : undefined}
        onClick={() => setBuka((b) => !b)}
      >
        {grup.label}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {buka &&
        pos &&
        createPortal(
          <div ref={daftar} className="submenu" role="menu" aria-label={grup.label} style={{ top: pos.top, left: pos.left, minWidth: pos.minWidth }}>
            {grup.anak.map((a) => (
              <NavLink key={a.to} to={a.to} end role="menuitem">
                {a.label}
              </NavLink>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
