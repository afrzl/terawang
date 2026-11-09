import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
import { useMemo, useState } from "react"
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
}

type Urut = { col: number; dir: 1 | -1 } | null

export function DataTable<T>({ rows, columns, rowKey, rowName }: DataTableProps<T>) {
  const { sel, select } = useSelection()
  const [urut, setUrut] = useState<Urut>(null)

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
          {shown.map((row, i) => {
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
    </div>
  )
}
