import { useEffect } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Monitor,
  PlayCircle,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { Logo } from "@/components/layout/AppShell";

type Tautan = { judul: string; ket: string; url: string; ikon: LucideIcon };

const TAUTAN: Tautan[] = [
  {
    judul: "Website",
    ket: "terawang.tech",
    url: "https://terawang.tech",
    ikon: Monitor,
  },
  {
    judul: "Video demo",
    ket: "Tur singkat fitur aplikasi",
    url: "https://drive.google.com/file/d/16Wcmo174IUPqHJguI1RW2l_BRhTZQ8dK/view?usp=sharing",
    ikon: PlayCircle,
  },
  {
    judul: "Buku pedoman",
    ket: "Panduan dasbor, bot WhatsApp, dan admin",
    url: "https://docs.google.com/document/d/1uyyS6JO_55ftF5DeOwf4P5gOYRV-hM_iOg0LY2ltELg/edit?tab=t.0",
    ikon: BookOpen,
  },
  {
    judul: "Pipeline data",
    ket: "dagster.terawang.tech",
    url: "https://dagster.terawang.tech",
    ikon: Workflow,
  },
];

const FONT_ID = "font-poppins";

/** Pola belah ketupat oranye di pojok kanan atas, seperti deck pitching. */
function Wajik() {
  const warna = ["#C8612B", "#F2A66B", "#F9D7C4"];
  const step = 34;
  const size = 12;
  const cols = 10;
  const rows = 7;
  const W = cols * step + step;
  const bentuk = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (c + r > 10) continue;
      const x = W - 12 - c * step - (r % 2 ? step / 2 : 0);
      const y = size + 4 + r * step * 0.95;
      bentuk.push(
        <path
          key={`${r}-${c}`}
          d={`M${x} ${y - size} L${x + size * 0.85} ${y} L${x} ${y + size} L${x - size * 0.85} ${y}Z`}
          fill={warna[Math.min(2, Math.floor((c + r) / 3))]}
          opacity={Math.max(0.25, 1 - (c + r) * 0.08)}
        />,
      );
    }
  return (
    <svg
      className="ltree-wajik"
      viewBox={`0 0 ${W} ${rows * step + size}`}
      aria-hidden="true"
    >
      {bentuk}
    </svg>
  );
}

export default function Linktree() {
  useEffect(() => {
    document.title = "Tautan · TERAWANG";
    if (!document.getElementById(FONT_ID)) {
      const l = document.createElement("link");
      l.id = FONT_ID;
      l.rel = "stylesheet";
      l.href =
        "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap";
      document.head.appendChild(l);
    }
  }, []);

  return (
    <div className="ltree-gulir">
      <div className="ltree">
        <Wajik />
        <span className="ltree-busur kiri" aria-hidden="true" />
        <span className="ltree-busur kanan" aria-hidden="true" />
        <svg
          className="ltree-awan"
          viewBox="0 0 1200 130"
          preserveAspectRatio="xMaxYMax meet"
          aria-hidden="true"
        >
          <circle cx="620" cy="150" r="90" fill="#F9D7C4" />
          <circle cx="780" cy="140" r="100" fill="#F9D7C4" />
          <circle cx="900" cy="150" r="110" fill="#F2A66B" />
          <circle cx="1080" cy="140" r="130" fill="#C8612B" />
        </svg>

        <main className="ltree-isi">
          <div className="ltree-brand">
            <div className="ltree-logo">
              <Logo />
            </div>
            <b>
              TERA<span>WANG</span>
            </b>
          </div>
          <span className="ltree-pill">
            PLAY IT! PLUS 2026 · Kategori AI Ketahanan Pangan
          </span>
          <h1 className="ltree-judul">
            Semua tautan <mark>TERAWANG</mark>
          </h1>
          <p className="ltree-moto">
            Pemantauan beras dari sawah ke pasar: estimasi produksi, stok
            beredar, dan peringatan dini harga berbasis citra satelit dan AI.
          </p>

          <section className="ltree-bingkai" aria-label="Daftar tautan">
            <span className="ltree-label">Tautan proyek</span>
            <ul className="ltree-daftar">
              {TAUTAN.map(({ judul, ket, url, ikon: Ikon }) => (
                <li key={url}>
                  <a
                    className="ltree-tautan"
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="ltree-ikon">
                      <Ikon size={22} aria-hidden="true" />
                    </span>
                    <span className="ltree-teks">
                      <b>{judul}</b>
                      <span>{ket}</span>
                    </span>
                    <ArrowUpRight
                      className="ltree-panah"
                      size={20}
                      aria-hidden="true"
                    />
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <footer className="ltree-tim">
            <b>Tim Makmur Jaya · Politeknik Statistika STIS</b>
            <span>Farid Ridho, Danang Wisnu Prabowo, Muh. Nur Afrizal</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
