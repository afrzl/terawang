import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useSelection } from "@/lib/selection"

export interface Column<T> {
  head: string
  right?: boolean
  num?: boolean
  cell: (row: T) => React.ReactNode
  style?: React.CSSProperties
  /** Nilai untuk mengurutkan kolom; kolom tanpa `sort` tidak bisa diurutkan. */
  sort?: (row: T) => number | string
}

interface DataTableProps<T> {
  rows: T[]
  columns: Column<T>[]
  /** Nama wilayah tiap baris; klik baris memilih wilayah tersebut. */
  rowKey: (row: T, i: number) => string
  rowName: (row: T) => string
  /** Bila diisi, tabel dibagi per halaman dengan jumlah baris awal ini. */
  pageSize?: number
}

const UKURAN = [10, 20, 50]

/** Nomor halaman dengan elipsis: 1 … 4 5 6 … 12. */
function nomor(hal: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const out: (number | null)[] = [1]
  const a = Math.max(2, hal - 1)
  const b = Math.min(total - 1, hal + 1)
  if (a > 2) out.push(null)
  for (let i = a; i <= b; i++) out.push(i)
  if (b < total - 1) out.push(null)
  out.push(total)
  return out
}

type Urut = { col: number; dir: 1 | -1 } | null

export function DataTable<T>({ rows, columns, rowKey, rowName, pageSize }: DataTableProps<T>) {
  const { sel, select } = useSelection()
  const [urut, setUrut] = useState<Urut>(null)
  const [ukuran, setUkuran] = useState(pageSize ?? 0)
  const [hal, setHal] = useState(1)

  const shown = useMemo(() => {
    const f = urut && columns[urut.col]?.sort
    if (!urut || !f) return rows
    return rows
      .map((r, i) => ({ r, i, v: f(r) }))
      .sort((a, b) => {
        const c = typeof a.v === "number" && typeof b.v === "number" ? a.v - b.v : String(a.v).localeCompare(String(b.v), "id")
        return c * urut.dir || a.i - b.i
      })
      .map((x) => x.r)
  }, [rows, columns, urut])

  const total = ukuran ? Math.max(1, Math.ceil(shown.length / ukuran)) : 1
  const halaman = Math.min(hal, total)
  const dari = ukuran ? (halaman - 1) * ukuran : 0
  const tampil = ukuran ? shown.slice(dari, dari + ukuran) : shown
  // Kembali ke halaman 1 bila isi atau urutan berubah.
  useEffect(() => setHal(1), [rows.length, urut, ukuran])

  // Klik pertama: angka dari besar, teks dari A; klik kedua membalik; klik ketiga kembali ke urutan bawaan.
  const klik = (i: number) => {
    const first: 1 | -1 = typeof columns[i].sort!(rows[0]) === "number" ? -1 : 1
    setUrut((u) => (!u || u.col !== i ? { col: i, dir: first } : u.dir === first ? { col: i, dir: (-first) as 1 | -1 } : null))
  }

  return (
    <div className="tbl-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c, i) => {
              const on = urut?.col === i
              return (
                <th
                  key={c.head}
                  className={c.right ? "r" : undefined}
                  aria-sort={on ? (urut!.dir === 1 ? "ascending" : "descending") : c.sort ? "none" : undefined}
                >
                  {c.sort ? (
                    <button type="button" className={on ? "th-sort on" : "th-sort"} onClick={() => klik(i)} title="Urutkan">
                      {c.head}
                      {on ? urut!.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : <ArrowUpDown size={12} className="idle" />}
                    </button>
                  ) : (
                    c.head
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {tampil.map((row, i) => {
            const n = rowName(row)
            return (
              <tr key={rowKey(row, i)} className={n === sel ? "is-sel" : undefined} onClick={() => select(n)}>
                {columns.map((c) => (
                  <td key={c.head} className={[c.right && "r", c.num && "num"].filter(Boolean).join(" ") || undefined} style={c.style}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
      {ukuran > 0 && shown.length > 0 && (
        <nav className="pg" aria-label="Halaman tabel">
          <span className="pg-info">
            {dari + 1}–{Math.min(dari + ukuran, shown.length)} dari {shown.length}
          </span>
          <label className="pg-size">
            Baris
            <select value={ukuran} onChange={(e) => setUkuran(+e.target.value)}>
              {UKURAN.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          <div className="pg-nav">
            <button type="button" className="pg-b" onClick={() => setHal(halaman - 1)} disabled={halaman <= 1} aria-label="Halaman sebelumnya">
              <ChevronLeft size={15} />
            </button>
            {nomor(halaman, total).map((n, i) =>
              n === null ? (
                <span key={`e${i}`} className="pg-e">
                  …
                </span>
              ) : (
                <button key={n} type="button" className={`pg-b${n === halaman ? " on" : ""}`} aria-current={n === halaman ? "page" : undefined} onClick={() => setHal(n)}>
                  {n}
                </button>
              ),
            )}
            <button type="button" className="pg-b" onClick={() => setHal(halaman + 1)} disabled={halaman >= total} aria-label="Halaman berikutnya">
              <ChevronRight size={15} />
            </button>
          </div>
        </nav>
      )}
    </div>
  )
}
