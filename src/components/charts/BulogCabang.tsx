import { BULOG_BULAN_TERAKHIR, stokPerCabang } from "@/lib/bulog"
import { bulanLabel } from "@/lib/filter"
import { nf } from "@/lib/format"

/** Daftar kantor cabang Bulog Jatim: pengadaan 2025 dan persediaan akhir bulan terpilih (ribu ton). */
export function BulogCabang({ bulan: bulanPilih }: { bulan: number }) {
  // Data Bulog baru ada sampai bulan terakhir yang selesai; bulan sesudahnya memakai posisi terakhir.
  const bulan = Math.min(bulanPilih, BULOG_BULAN_TERAKHIR)
  const rows = stokPerCabang(bulan).sort((a, b) => b.stok - a.stok)
  const mx = Math.max(...rows.map((r) => r.stok))
  const tot = rows.reduce((a, r) => a + r.stok, 0)
  const totP = rows.reduce((a, r) => a + r.ton, 0)

  return (
    <div className="tbl-wrap cab">
      <table>
        <thead>
          <tr>
            <th>Kantor cabang</th>
            <th className="r">Pengadaan 2025</th>
            <th className="r">Stok {bulanLabel(bulan)}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.cabang}>
              <td>
                <b>{r.cabang}</b>
              </td>
              <td className="r num">{nf(r.ton * 1000)} ton</td>
              <td className="r">
                <div className="bar-cell">
                  <span className="num">{nf(r.stok * 1000)} ton</span>
                  <span className="minibar">
                    <span style={{ width: `${(r.stok / mx) * 100}%`, background: "var(--accent)" }} />
                  </span>
                </div>
              </td>
            </tr>
          ))}
          <tr>
            <td>
              <b>Jawa Timur</b>
            </td>
            <td className="r num">
              <b>{nf(totP * 1000)} ton</b>
            </td>
            <td className="r num">
              <b>{nf(tot * 1000)} ton</b>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
