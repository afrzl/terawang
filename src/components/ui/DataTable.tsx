import { useSelection } from "@/lib/selection"

export interface Column<T> {
  head: string
  right?: boolean
  num?: boolean
  cell: (row: T) => React.ReactNode
  style?: React.CSSProperties
}

interface DataTableProps<T> {
  rows: T[]
  columns: Column<T>[]
  /** Nama wilayah tiap baris; klik baris memilih wilayah tersebut. */
  rowKey: (row: T, i: number) => string
  rowName: (row: T) => string
}

export function DataTable<T>({ rows, columns, rowKey, rowName }: DataTableProps<T>) {
  const { sel, select } = useSelection()
  return (
    <div className="tbl-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.head} className={c.right ? "r" : undefined}>
                {c.head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
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
