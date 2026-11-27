import { useEffect, useRef, useState, type FormEvent } from "react"
import { Navigate, useNavigate, useSearchParams } from "react-router-dom"
import { LogIn } from "lucide-react"
import { Logo } from "@/components/layout/AppShell"
import { ThemeToggle } from "@/components/layout/ThemeToggle"
import { HAK_ADMIN, muatAkunDemo, useSesi, type AkunDemo, type Peran } from "@/lib/sesi"

const AKSES: Record<Peran, string> = {
  tamu: "Peta, produksi, stok, arus beras, laporan pekan",
  perusahaan: "Semua dasbor, harga, SPHP, dan prakiraan",
  dinas: "Dasbor lengkap dan unggah data manual",
  superadmin: "Semua fitur dan pengaturan sistem",
}

/** Tujuan sesudah masuk: hanya path di situs ini. */
function tujuanAman(k: string | null) {
  return k && k.startsWith("/") && !k.startsWith("//") && !k.startsWith("/\\") && !k.startsWith("/masuk") ? k : "/"
}

export default function Masuk() {
  const { sesi, siap, masuk } = useSesi()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const kembali = tujuanAman(params.get("kembali"))
  const [pengguna, setPengguna] = useState("")
  const [sandi, setSandi] = useState("")
  const [galat, setGalat] = useState("")
  const [proses, setProses] = useState(false)
  const [demo, setDemo] = useState<AkunDemo[]>([])
  const [dipilih, setDipilih] = useState<string | null>(null)
  const tombolRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    document.title = "Masuk · TERAWANG"
    void muatAkunDemo().then(setDemo)
  }, [])

  if (siap && sesi.pengguna) return <Navigate to={kembali} replace />

  const kirim = async (e: FormEvent) => {
    e.preventDefault()
    setGalat("")
    setProses(true)
    try {
      const s = await masuk(pengguna, sandi)
      // akun yang hanya punya hak admin (tanpa halaman dasbor) langsung ke panel admin
      if (!s.hak.some((h) => h.startsWith("dasbor_")) && s.hak.some((h) => HAK_ADMIN.includes(h))) window.location.href = "/admin/"
      else navigate(kembali, { replace: true })
    } catch (err) {
      setGalat(err instanceof Error ? err.message : String(err))
    } finally {
      setProses(false)
    }
  }

  const isi = (a: AkunDemo) => {
    setPengguna(a.pengguna)
    setSandi(a.sandi)
    setDipilih(a.pengguna)
    setGalat("")
    tombolRef.current?.focus()
  }

  return (
    <div className="masuk">
      <section className="masuk-kop">
        <div className="masuk-kop-isi">
          <div className="brand">
            <div className="logo">
              <Logo />
            </div>
            <h1>
              TERA<span>WANG</span>
            </h1>
          </div>
          <p className="masuk-moto">Pemantauan beras dari sawah ke pasar: estimasi produksi, stok beredar, dan peringatan dini harga Jawa Timur.</p>
        </div>
        <div className="masuk-tema">
          <ThemeToggle />
        </div>
      </section>

      <main className="masuk-badan">
        <form className="masuk-kartu" onSubmit={kirim} noValidate>
          <div className="masuk-judul">
            <h2>Masuk</h2>
            <p>Gunakan akun yang diberikan untuk instansi atau perusahaan Anda.</p>
          </div>

          {demo.length > 0 && (
            <fieldset className="masuk-demo">
              <legend>Masuk sebagai</legend>
              <div className="masuk-demo-grid">
                {demo.map((a) => (
                  <button
                    key={a.pengguna}
                    type="button"
                    className="masuk-peran"
                    aria-pressed={dipilih === a.pengguna}
                    onClick={() => isi(a)}
                  >
                    <b>{a.label}</b>
                    <span>{AKSES[a.peran]}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <label className="masuk-isian">
            <span>Nama pengguna</span>
            <input
              name="pengguna"
              autoComplete="username"
              value={pengguna}
              onChange={(e) => {
                setPengguna(e.target.value)
                setDipilih(null)
              }}
              required
            />
          </label>
          <label className="masuk-isian">
            <span>Sandi</span>
            <input
              name="sandi"
              type="password"
              autoComplete="current-password"
              value={sandi}
              onChange={(e) => {
                setSandi(e.target.value)
                setDipilih(null)
              }}
              required
            />
          </label>
          <p className="masuk-galat" role="alert">
            {galat}
          </p>
          <button ref={tombolRef} className="masuk-tombol" type="submit" disabled={proses || !pengguna || !sandi}>
            <LogIn size={16} aria-hidden="true" />
            {proses ? "Memeriksa…" : "Masuk"}
          </button>
        </form>
        <footer className="masuk-kaki">TERAWANG by Makmur Jaya, Politeknik Statistika STIS 2026</footer>
      </main>
    </div>
  )
}
