import { useEffect, useId, useMemo, useRef, useState } from "react"
import { Check, ChevronDown, Search, X } from "lucide-react"

export interface OpsiEdisi {
  pekan: string
  /** Nomor pekan, mis. "48". */
  no: string
  /** Rentang tanggal, mis. "23–29 Nov 2026". */
  rentang: string
  judul: string
}

const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]
const HARI = 864e5

/** Senin awal pekan ISO "2026-W48" (UTC), atau null. */
function seninDari(p: string): Date | null {
  const m = p.match(/^(\d{4})-W(\d{2})$/)
  if (!m) return null
  const jan4 = new Date(Date.UTC(+m[1], 0, 4))
  return new Date(+jan4 - ((jan4.getUTCDay() || 7) - 1) * HARI + (+m[2] - 1) * 7 * HARI)
}

/** Bulan tempat sebuah pekan dikelompokkan: bulan hari Kamisnya (aturan ISO). */
function bulanPekan(p: string) {
  const s = seninDari(p)
  if (!s) return { kunci: "lain", label: "Lainnya", tahun: "" }
  const k = new Date(+s + 3 * HARI)
  const th = String(k.getUTCFullYear())
  return { kunci: `${th}-${k.getUTCMonth()}`, label: `${BULAN[k.getUTCMonth()]} ${th}`, tahun: th }
}

const normal = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim()

/** Tafsir ketikan sebagai tanggal: "12 nov", "12 november 2025", "12/11", "12-11-2025". */
function tanggalDari(q: string, tahunDefault: number): Date | null {
  let d: number, b: number, t: number | undefined
  const a = q.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/)
  const c = q.match(/^(\d{1,2})\s+([a-z]{3,})(?:\s+(\d{4}))?$/)
  if (a) {
    d = +a[1]
    b = +a[2] - 1
    t = a[3] ? (a[3].length === 2 ? 2000 + +a[3] : +a[3]) : undefined
  } else if (c) {
    const i = BULAN.findIndex((n) => normal(n).startsWith(c[2]) || (c[2] === "agt" && n === "Agustus"))
    if (i < 0) return null
    d = +c[1]
    b = i
    t = c[3] ? +c[3] : undefined
  } else return null
  if (b < 0 || b > 11 || d < 1 || d > 31) return null
  return new Date(Date.UTC(t ?? tahunDefault, b, d))
}

/** Pemilih edisi Laporan pekan: tombol + popover berisi kolom cari, saring tahun, dan daftar pekan berkelompok per bulan. */
export function EdisiPicker({ opsi, nilai, onPilih }: { opsi: OpsiEdisi[]; nilai: string | null; onPilih: (pekan: string) => void }) {
  const [buka, setBuka] = useState(false)
  const [fokus, setFokus] = useState(0)
  const [cari, setCari] = useState("")
  const [tahun, setTahun] = useState<string | null>(null)
  const akar = useRef<HTMLDivElement>(null)
  const daftar = useRef<HTMLDivElement>(null)
  const kolom = useRef<HTMLInputElement>(null)
  const id = useId()
  const kini = opsi.find((o) => o.pekan === nilai) ?? opsi[0]

  const kaya = useMemo(
    () =>
      opsi.map((o, i) => {
        const bln = bulanPekan(o.pekan)
        return { ...o, i, bln, teks: normal(`pekan ${o.no} w${o.no} ${o.pekan} ${o.rentang} ${bln.label} ${o.judul}`), senin: seninDari(o.pekan) }
      }),
    [opsi],
  )
  const daftarTahun = useMemo(() => [...new Set(kaya.map((o) => o.bln.tahun).filter(Boolean))], [kaya])

  const tersaring = useMemo(() => {
    const q = normal(cari)
    const thDefault = +(tahun ?? daftarTahun[0] ?? new Date().getFullYear())
    const tgl = q ? tanggalDari(q, thDefault) : null
    return kaya.filter((o) => {
      if (tahun && o.bln.tahun !== tahun && !(tgl && /\d{4}/.test(q))) return false
      if (!q) return true
      if (tgl && o.senin) return +tgl >= +o.senin && +tgl < +o.senin + 7 * HARI
      if (/^\d{1,2}$/.test(q)) return o.no === String(+q)
      return q.split(/\s+/).every((k) => o.teks.includes(k))
    })
  }, [kaya, cari, tahun, daftarTahun])

  const grup = useMemo(() => {
    const g: { kunci: string; label: string; isi: typeof tersaring }[] = []
    for (const o of tersaring) {
      const akhir = g[g.length - 1]
      if (akhir?.kunci === o.bln.kunci) akhir.isi.push(o)
      else g.push({ kunci: o.bln.kunci, label: o.bln.label, isi: [o] })
    }
    return g
  }, [tersaring])

  useEffect(() => {
    if (!buka) return
    const tutup = (e: MouseEvent) => !akar.current?.contains(e.target as Node) && setBuka(false)
    document.addEventListener("mousedown", tutup)
    return () => document.removeEventListener("mousedown", tutup)
  }, [buka])
  useEffect(() => {
    if (buka) daftar.current?.querySelector<HTMLElement>(`[data-i="${fokus}"]`)?.scrollIntoView({ block: "nearest" })
  }, [buka, fokus])
  // Saat saringan berubah, fokus pindah ke hasil pertama.
  useEffect(() => {
    if (buka && (cari || tahun)) setFokus(0)
  }, [cari, tahun, buka])

  const bukaDaftar = () => {
    setCari("")
    setTahun(null)
    setFokus(Math.max(0, opsi.findIndex((o) => o.pekan === kini?.pekan)))
    setBuka(true)
    requestAnimationFrame(() => kolom.current?.focus())
  }
  const pilih = (pekan: string | undefined) => {
    if (pekan) onPilih(pekan)
    setBuka(false)
  }
  const tombolKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      bukaDaftar()
    }
  }
  const n = tersaring.length
  const popKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") setFokus((f) => Math.min(n - 1, f + 1))
    else if (e.key === "ArrowUp") setFokus((f) => Math.max(0, f - 1))
    else if (e.key === "PageDown") setFokus((f) => Math.min(n - 1, f + 6))
    else if (e.key === "PageUp") setFokus((f) => Math.max(0, f - 6))
    else if (e.key === "Enter") pilih(tersaring[fokus]?.pekan)
    else if (e.key === "Escape") cari ? setCari("") : setBuka(false)
    else if (e.key === "Tab") setBuka(false)
    else return
    e.preventDefault()
  }

  if (!kini) return null
  const terbaru = opsi[0]
  let urut = 0
  return (
    <div className="edisi" ref={akar}>
      <button type="button" className="edisi-btn" aria-haspopup="listbox" aria-expanded={buka} aria-controls={id} onClick={() => (buka ? setBuka(false) : bukaDaftar())} onKeyDown={tombolKey}>
        <span className="edisi-no">
          <small>Edisi</small>
          {kini.no}
        </span>
        <span className="edisi-lbl">
          <b>Pekan {kini.no}</b>
          <span>{kini.rentang}</span>
        </span>
        <ChevronDown size={16} className="edisi-chev" />
      </button>
      {buka && (
        <div className="edisi-pop" onKeyDown={popKey}>
          <div className="edisi-cari">
            <label className="edisi-cari-kolom">
              <Search size={15} />
              <input
                ref={kolom}
                value={cari}
                onChange={(e) => setCari(e.target.value)}
                placeholder="Cari pekan, tanggal, bulan, judul…"
                aria-label="Cari edisi"
                role="combobox"
                aria-expanded
                aria-controls={id}
                aria-activedescendant={n ? `${id}-${tersaring[fokus]?.i}` : undefined}
              />
              {cari && (
                <button type="button" aria-label="Hapus pencarian" onClick={() => (setCari(""), kolom.current?.focus())}>
                  <X size={14} />
                </button>
              )}
            </label>
            {(daftarTahun.length > 1 || (terbaru && kini.pekan !== terbaru.pekan)) && (
              <div className="edisi-chip">
                {daftarTahun.length > 1 && (
                  <>
                    <button type="button" className={tahun === null ? "on" : undefined} onClick={() => setTahun(null)}>
                      Semua
                    </button>
                    {daftarTahun.map((t) => (
                      <button type="button" key={t} className={tahun === t ? "on" : undefined} onClick={() => setTahun(tahun === t ? null : t)}>
                        {t}
                      </button>
                    ))}
                  </>
                )}
                {terbaru && kini.pekan !== terbaru.pekan && (
                  <button type="button" className="edisi-chip-baru" onClick={() => pilih(terbaru.pekan)}>
                    Ke terbaru
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="edisi-daftar" ref={daftar} role="listbox" id={id} aria-label="Edisi Laporan pekan">
            {grup.map((g) => (
              <div key={g.kunci} role="group" aria-label={g.label}>
                <div className="edisi-bln" aria-hidden>
                  {g.label}
                  <span>{g.isi.length} edisi</span>
                </div>
                {g.isi.map((o) => {
                  const ke = urut++
                  return (
                    <div
                      key={o.pekan}
                      id={`${id}-${o.i}`}
                      data-i={ke}
                      role="option"
                      aria-selected={o.pekan === kini.pekan}
                      className={`edisi-opsi${ke === fokus ? " is-fokus" : ""}`}
                      onMouseEnter={() => setFokus(ke)}
                      onClick={() => pilih(o.pekan)}
                    >
                      <span className="edisi-pop-no">{o.no}</span>
                      <span className="edisi-pop-txt">
                        <span className="edisi-pop-tgl">
                          {o.rentang}
                          {o.i === 0 && <em>Terbaru</em>}
                        </span>
                        <span className="edisi-pop-jdl">{o.judul}</span>
                      </span>
                      {o.pekan === kini.pekan && <Check size={16} className="edisi-pop-cek" />}
                    </div>
                  )
                })}
              </div>
            ))}
            {!n && (
              <p className="edisi-kosong">
                Tidak ada edisi untuk “{cari}”. Coba nomor pekan (mis. 45), tanggal (12 nov 2025), atau nama bulan.
              </p>
            )}
          </div>
          <div className="edisi-kaki">
            {n === opsi.length ? `${opsi.length} edisi` : `${n} dari ${opsi.length} edisi`}
            <span>↑↓ pilih · Enter buka · Esc tutup</span>
          </div>
        </div>
      )}
    </div>
  )
}
