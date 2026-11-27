import type { ReactNode } from "react"
import { Navigate, Outlet, useLocation } from "react-router-dom"
import { Lock } from "lucide-react"
import { navItems } from "@/components/layout/nav"
import { HAK_ADMIN, tautanMasuk, useSesi } from "@/lib/sesi"

/** Dasbor wajib masuk: tanpa sesi diarahkan ke /masuk lalu kembali ke halaman ini. */
export function WajibMasuk() {
  const { sesi, siap } = useSesi()
  const { pathname, search } = useLocation()
  if (!siap) return <div className="memuat-sesi">Memuat…</div>
  if (!sesi.pengguna) return <Navigate to={tautanMasuk(pathname + search)} replace />
  return <Outlet />
}

/** Halaman dasbor yang butuh `hak`. Tanpa hak: pindah ke halaman pertama yang boleh dibuka. */
export function PerluHak({ hak, children }: { hak: string; children: ReactNode }) {
  const { boleh, sesi } = useSesi()
  if (boleh(hak)) return <>{children}</>
  const pertama = navItems.find((it) => boleh(it.hak))
  if (pertama) return <Navigate to={pertama.to} replace />
  const admin = sesi.hak.some((h) => HAK_ADMIN.includes(h))
  return (
    <div className="terkunci">
      <Lock size={18} aria-hidden="true" />
      <div>
        <b>Belum ada halaman dasbor untuk peran {sesi.labelPeran}</b>
        <p>Akses halaman dasbor diatur admin di menu Akun &amp; peran.</p>
      </div>
      {admin && (
        <a className="btn-masuk" href="/admin/">
          Buka ruang kendali
        </a>
      )}
    </div>
  )
}
