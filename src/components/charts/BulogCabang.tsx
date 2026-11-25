import { PENGADAAN_CABANG, TAHUN_PENGADAAN } from "@/lib/bulog"
import { nf } from "@/lib/format"

/** Daftar kantor cabang Bulog Jatim: pengadaan beras tahun terakhir yang tersedia dan tahun sebelumnya (data asli).
 *  Stok per cabang tidak dipublikasikan, jadi tidak ditampilkan. */
export function BulogCabang() {
  const rows = PENGADAAN_CABANG.slice().sort((a, b) => b.ton - a.ton)
  const mx = Math.max(...rows.map((r) => r.ton), 1e-9)
  const tot = rows.reduce((a, r) => a + r.ton, 0)
  const adaLalu = rows.some((r) => r.tonLalu != null)
  const totLalu = rows.reduce((a, r) => a + (r.tonLalu ?? 0), 0)

  return (
    <div className="tbl-wrap cab">
      <table>
        <thead>
          <tr>
            <th>Kantor cabang</th>
            {adaLalu && <th className="r">Pengadaan {TAHUN_PENGADAAN - 1}</th>}
            <th className="r">Pengadaan {TAHUN_PENGADAAN}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.cabang}>
              <td>
                <b>{r.cabang}</b>
              </td>
              {adaLalu && <td className="r num">{r.tonLalu == null ? "–" : `${nf(r.tonLalu * 1000)} ton`}</td>}
              <td className="r">
                <div className="bar-cell">
                  <span className="num">{nf(r.ton * 1000)} ton</span>
                  <span className="minibar">
                    <span style={{ width: `${(r.ton / mx) * 100}%`, background: "var(--accent)" }} />
                  </span>
                </div>
              </td>
            </tr>
          ))}
          <tr>
            <td>
              <b>Jawa Timur</b>
            </td>
            {adaLalu && (
              <td className="r num">
                <b>{nf(totLalu * 1000)} ton</b>
              </td>
            )}
            <td className="r num">
              <b>{nf(tot * 1000)} ton</b>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
