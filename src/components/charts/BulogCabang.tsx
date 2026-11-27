import { BULAN_STOK_CABANG_PROKSI, PENGADAAN_CABANG, STOK_CABANG_PROKSI, TAHUN_PENGADAAN } from "@/lib/bulog"
import { nf } from "@/lib/format"
import { bul, useDataTafsir } from "@/lib/tafsir"

/** Daftar kantor cabang Bulog Jatim: pengadaan beras tahun terakhir yang tersedia dan tahun sebelumnya (data asli),
 *  ditambah stok Nov 2026 per cabang (PROKSI: angka pimpinan cabang di media bila ada, selain itu taksiran dari porsi pengadaan). */
export function BulogCabang() {
  const rows = PENGADAAN_CABANG.slice().sort((a, b) => b.ton - a.ton)
  const mx = Math.max(...rows.map((r) => r.ton), 1e-9)
  const tot = rows.reduce((a, r) => a + r.ton, 0)
  const adaLalu = rows.some((r) => r.tonLalu != null)
  const totLalu = rows.reduce((a, r) => a + (r.tonLalu ?? 0), 0)
  const stok = new Map(STOK_CABANG_PROKSI.map((s) => [s.cabang, s]))
  const adaStok = rows.some((r) => stok.has(r.cabang))
  const totStok = STOK_CABANG_PROKSI.reduce((a, s) => a + s.ton, 0)
  useDataTafsir("cabang", {
    satuan: "ton beras pengadaan per tahun",
    cabang: rows.map((r) => ({
      cabang: r.cabang,
      [`pengadaan_${TAHUN_PENGADAAN}`]: bul(r.ton * 1000, 0),
      ...(adaLalu ? { [`pengadaan_${TAHUN_PENGADAAN - 1}`]: bul(r.tonLalu == null ? null : r.tonLalu * 1000, 0) } : {}),
      ...(stok.has(r.cabang) ? { stok_proksi_nov_2026: bul(stok.get(r.cabang)!.ton * 1000, 0), jenis_stok: stok.get(r.cabang)!.jenis } : {}),
    })),
    total: {
      [`pengadaan_${TAHUN_PENGADAAN}`]: bul(tot * 1000, 0),
      ...(adaLalu ? { [`pengadaan_${TAHUN_PENGADAAN - 1}`]: bul(totLalu * 1000, 0) } : {}),
      ...(adaStok ? { stok_proksi_nov_2026: bul(totStok * 1000, 0) } : {}),
    },
    catatan_stok:
      "Bulog tidak menerbitkan stok per cabang. Stok 'berita' = pernyataan pimpinan cabang di media; 'taksiran' = porsi pengadaan 2025 dikali rasio stok berita terhadap porsi pengadaan cabang-cabang itu.",
  })

  return (
    <div className={`tbl-wrap cab${adaStok ? " cab-stok" : ""}`}>
      <table>
        <thead>
          <tr>
            <th>Kantor cabang</th>
            {adaLalu && <th className="r">Pengadaan {TAHUN_PENGADAAN - 1}</th>}
            <th className="r">Pengadaan {TAHUN_PENGADAAN}</th>
            {adaStok && <th className="r">Stok {BULAN_STOK_CABANG_PROKSI} (proksi)</th>}
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
              {adaStok && <StokSel s={stok.get(r.cabang)} />}
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
            {adaStok && (
              <td className="r num">
                <b>{nf(totStok * 1000)} ton</b>
              </td>
            )}
          </tr>
        </tbody>
      </table>
      {adaStok && (
        <p className="cab-cat">
          Stok per cabang tidak dipublikasikan Bulog. <b>Berita</b>: pernyataan pimpinan cabang di media (klik untuk sumber).{" "}
          <b>Taksiran</b>: porsi pengadaan {TAHUN_PENGADAAN} dikali rasio dari cabang berita.
        </p>
      )}
    </div>
  )
}

function StokSel({ s }: { s?: (typeof STOK_CABANG_PROKSI)[number] }) {
  if (!s) return <td className="r num">–</td>
  const tgl = s.tanggal ? new Date(s.tanggal).toLocaleDateString("id-ID", { day: "numeric", month: "short" }) : ""
  return (
    <td className="r num">
      {nf(s.ton * 1000)} ton
      <span className="cab-jenis">
        {s.url ? (
          <a href={s.url} target="_blank" rel="noreferrer" title={`Pernyataan pimpinan cabang, posisi ${tgl}`}>
            berita {tgl}
          </a>
        ) : (
          "taksiran"
        )}
      </span>
    </td>
  )
}
