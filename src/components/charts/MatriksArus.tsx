import { regionOf, type Trade } from "@/lib/arus"
import { nf, short } from "@/lib/format"
import { useSelection } from "@/lib/selection"

const MAKS_ASAL = 12
const MAKS_TUJUAN = 10

/** Matriks asal × tujuan: ton beras per bulan; sel makin pekat makin besar. Asal dan tujuan terkecil digabung jadi "Lainnya". */
export function MatriksArus({ trade }: { trade: Trade[] }) {
  const { sel, select } = useSelection()
  const keluar = new Map<string, number>()
  const masuk = new Map<string, number>()
  for (const t of trade) {
    keluar.set(t.from.n, (keluar.get(t.from.n) ?? 0) + t.ton)
    masuk.set(t.to.n, (masuk.get(t.to.n) ?? 0) + t.ton)
  }
  const asal = [...keluar].sort((a, b) => b[1] - a[1]).map((d) => d[0])
  const tujuan = [...masuk].sort((a, b) => b[1] - a[1]).map((d) => d[0])
  const rows = asal.slice(0, MAKS_ASAL)
  const cols = tujuan.slice(0, MAKS_TUJUAN)

  const val = (a: string | null, t: string | null) =>
    trade
      .filter((x) => (a ? x.from.n === a : !rows.includes(x.from.n)) && (t ? x.to.n === t : !cols.includes(x.to.n)))
      .reduce((s, x) => s + x.ton, 0)

  const rowKeys: (string | null)[] = asal.length > MAKS_ASAL ? [...rows, null] : rows
  const colKeys: (string | null)[] = tujuan.length > MAKS_TUJUAN ? [...cols, null] : cols
  const cells = rowKeys.map((a) => colKeys.map((t) => val(a, t)))
  const mx = Math.max(1, ...cells.flat())
  const rowTot = cells.map((r) => r.reduce((s, v) => s + v, 0))
  const colTot = colKeys.map((_, j) => cells.reduce((s, r) => s + r[j], 0))
  const tot = rowTot.reduce((s, v) => s + v, 0)
  const nm = (n: string | null) => (n ? short(n) : "Lainnya")

  return (
    <div className="tbl-wrap mx">
      <table>
        <thead>
          <tr>
            <th>Asal \ Tujuan</th>
            {colKeys.map((t) => (
              <th key={t ?? "lain"} className={`r${t === sel ? " is-sel" : ""}`} onClick={() => t && select(t)} style={{ cursor: t ? "pointer" : undefined }}>
                {nm(t)}
              </th>
            ))}
            <th className="r">Jumlah</th>
          </tr>
        </thead>
        <tbody>
          {rowKeys.map((a, i) => (
            <tr key={a ?? "lain"}>
              <td>
                <span className="mx-dot" style={{ background: a ? regionOf[a].color : "var(--ink-3)" }} />
                <b style={{ cursor: a ? "pointer" : undefined }} onClick={() => a && select(a)}>
                  {nm(a)}
                </b>
              </td>
              {cells[i].map((v, j) => (
                <td
                  key={j}
                  className={`r num mx-c${colKeys[j] === sel || a === sel ? " is-sel" : ""}`}
                  style={v ? { background: `color-mix(in srgb, var(--accent) ${Math.round(12 + 62 * Math.sqrt(v / mx))}%, transparent)` } : undefined}
                  title={v ? `${nm(a)} ke ${nm(colKeys[j])}: ${nf(v)} ton` : undefined}
                >
                  {v ? nf(v) : ""}
                </td>
              ))}
              <td className="r num">
                <b>{nf(rowTot[i])}</b>
              </td>
            </tr>
          ))}
          <tr className="mx-sum">
            <td>
              <b>Jumlah</b>
            </td>
            {colTot.map((v, j) => (
              <td key={j} className="r num">
                <b>{nf(v)}</b>
              </td>
            ))}
            <td className="r num">
              <b>{nf(tot)}</b>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
