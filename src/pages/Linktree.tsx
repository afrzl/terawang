import { useEffect } from "react"
import { ArrowUpRight, BookOpen, Globe, PlayCircle, Workflow, type LucideIcon } from "lucide-react"
import { Logo } from "@/components/layout/AppShell"
import { ThemeToggle } from "@/components/layout/ThemeToggle"

type Tautan = { judul: string; ket: string; url: string; ikon: LucideIcon }

const TAUTAN: Tautan[] = [
  { judul: "Website", ket: "Dasbor TERAWANG · terawang.tech", url: "https://terawang.tech", ikon: Globe },
  {
    judul: "Video demo",
    ket: "Tur singkat fitur aplikasi",
    url: "https://drive.google.com/file/d/16Wcmo174IUPqHJguI1RW2l_BRhTZQ8dK/view?usp=sharing",
    ikon: PlayCircle,
  },
  {
    judul: "Buku pedoman",
    ket: "Panduan penggunaan dasbor, bot WhatsApp, dan admin",
    url: "https://docs.google.com/document/d/1uyyS6JO_55ftF5DeOwf4P5gOYRV-hM_iOg0LY2ltELg/edit?tab=t.0",
    ikon: BookOpen,
  },
  { judul: "Pipeline data", ket: "Alur data Dagster · dagster.terawang.tech", url: "https://dagster.terawang.tech", ikon: Workflow },
]

export default function Linktree() {
  useEffect(() => {
    document.title = "Tautan · TERAWANG"
  }, [])

  return (
    <div className="ltree">
      <div className="ltree-tema">
        <ThemeToggle />
      </div>
      <main className="ltree-isi">
        <header className="ltree-kop">
          <div className="ltree-logo">
            <Logo />
          </div>
          <h1>
            TERA<span>WANG</span>
          </h1>
          <p>Pemantauan beras dari sawah ke pasar: estimasi produksi, stok beredar, dan peringatan dini harga berbasis citra satelit dan AI.</p>
        </header>

        <ul className="ltree-daftar">
          {TAUTAN.map(({ judul, ket, url, ikon: Ikon }) => (
            <li key={url}>
              <a className="ltree-tautan" href={url} target="_blank" rel="noopener noreferrer">
                <span className="ltree-ikon">
                  <Ikon size={20} aria-hidden="true" />
                </span>
                <span className="ltree-teks">
                  <b>{judul}</b>
                  <span>{ket}</span>
                </span>
                <ArrowUpRight className="ltree-panah" size={18} aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>

        <footer className="ltree-kaki">TERAWANG by Makmur Jaya · Politeknik Statistika STIS 2026</footer>
      </main>
    </div>
  )
}
