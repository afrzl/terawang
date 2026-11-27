import { STOK_BULOG, STOK_BULOG_PEMBANDING, TAHUN_STOK_BULOG } from "@/lib/bulog"
import { BULAN_NAMA } from "@/lib/filter"
import { nf, scale, ticks } from "@/lib/format"
import { useTooltip } from "@/lib/tooltip"
import { bul, useDataTafsir } from "@/lib/tafsir"

const W = 760
const H = 500
const M = { l: 52, r: 16, t: 16, b: 30 }

/** Stok Bulog Jawa Timur per bulan, tahun terakhir yang ada datanya: persediaan akhir (garis) dengan pemasukan dan pengeluaran (batang), ribu ton. Tingkat provinsi. */
export function BulogStok() {
  const { show, hide } = useTooltip()
  const d = STOK_BULOG
  const pb = STOK_BULOG_PEMBANDING
  useDataTafsir("bulog", {
    satuan: "ribu ton beras, tingkat provinsi Jawa Timur",
    tahun: TAHUN_STOK_BULOG,
    bulan: d.map((r) => ({ bulan: `${BULAN_NAMA[r.bulan - 1]} ${TAHUN_STOK_BULOG}`, persediaan_akhir: bul(r.akhir, 1), pemasukan: bul(r.masuk, 1), pengeluaran: bul(r.keluar, 1) })),
    ...(pb ? { [`persediaan_akhir_${pb.tahun}`]: pb.data.map((r) => ({ bulan: `${BULAN_NAMA[r.bulan - 1]} ${pb.tahun}`, persediaan_akhir: bul(r.akhir, 1) })) } : {}),
  })
  const ymax = Math.max(...d.map((r) => Math.max(r.akhir, r.masuk, r.keluar)), ...(pb?.data.map((r) => r.akhir) ?? [])) * 1.1
  const y = scale(0, ymax, H - M.b, M.t)
  const SLOT = 12
  const lebar = (W - M.l - M.r) / SLOT
  const cx = (i: number) => M.l + lebar * i + lebar / 2
  const garis = d.map((r, i) => `${i ? "L" : "M"}${cx(i).toFixed(1)} ${y(r.akhir).toFixed(1)}`).join(" ")
  const garisPb = pb?.data.map((r, i) => `${i ? "L" : "M"}${cx(i).toFixed(1)} ${y(r.akhir).toFixed(1)}`).join(" ")
  const bw = Math.min(14, lebar * 0.28)

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Stok beras Bulog Jawa Timur per bulan, ${TAHUN_STOK_BULOG}`}>
        <g className="grid">
          {ticks(0, ymax, 5).map((t) => (
            <g key={t}>
              <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} />
              <text x={M.l - 8} y={y(t) + 4} textAnchor="end">
                {nf(t)}
              </text>
            </g>
          ))}
        </g>
        {d.map((r, i) => (
          <g key={r.bulan}>
            <rect x={cx(i) - bw - 1} y={y(r.masuk)} width={bw} height={y(0) - y(r.masuk)} fill="var(--d5)" />
            <rect x={cx(i) + 1} y={y(r.keluar)} width={bw} height={y(0) - y(r.keluar)} fill="var(--d1)" />
            <text x={cx(i)} y={H - M.b + 18} textAnchor="middle">
              {BULAN_NAMA[i]}
            </text>
          </g>
        ))}
        {BULAN_NAMA.slice(d.length).map((n, j) => (
          <text key={n} x={cx(d.length + j)} y={H - M.b + 18} textAnchor="middle" style={{ opacity: 0.45 }}>
            {n}
          </text>
        ))}
        {garisPb && <path d={garisPb} fill="none" stroke="var(--ink-3)" strokeWidth={1.6} strokeDasharray="5 4" opacity={0.7} />}
        <path d={garis} fill="none" stroke="var(--accent)" strokeWidth={2.4} strokeLinejoin="round" />
        {d.map((r, i) => (
          <circle key={r.bulan} cx={cx(i)} cy={y(r.akhir)} r={3.5} fill="var(--panel)" stroke="var(--accent)" strokeWidth={2} />
        ))}
        {d.map((r, i) => (
          <rect
            key={`h${r.bulan}`}
            x={M.l + lebar * i}
            y={M.t}
            width={lebar}
            height={H - M.t - M.b}
            fill="transparent"
            onMouseMove={(e) =>
              show(
                <>
                  <b>{BULAN_NAMA[r.bulan - 1]} {TAHUN_STOK_BULOG}</b>
                  <br />
                  Persediaan akhir <span className="m">{nf(r.akhir, 1)} rb ton</span>
                  <br />
                  Pemasukan <span className="m">{nf(r.masuk, 1)} rb ton</span>
                  <br />
                  Pengeluaran <span className="m">{nf(r.keluar, 1)} rb ton</span>
                  {pb?.data[i] && (
                    <>
                      <br />
                      Persediaan akhir {pb.tahun} <span className="m">{nf(pb.data[i].akhir, 1)} rb ton</span>
                    </>
                  )}
                </>,
                e,
              )
            }
            onMouseLeave={hide}
          />
        ))}
      </svg>
      <div className="legend" style={{ padding: "6px 0 0" }}>
        <span>
          <span className="sw" style={{ background: "var(--accent)" }} />
          persediaan akhir
        </span>
        <span>
          <span className="sw" style={{ background: "var(--d5)" }} />
          pemasukan
        </span>
        <span>
          <span className="sw" style={{ background: "var(--d1)" }} />
          pengeluaran
        </span>
        {pb && (
          <span>
            <svg width="18" height="10" aria-hidden="true" style={{ marginRight: 6, verticalAlign: "middle" }}>
              <line x1="0" x2="18" y1="5" y2="5" stroke="var(--ink-3)" strokeWidth="2" strokeDasharray="4 3" />
            </svg>
            persediaan akhir {pb.tahun}
          </span>
        )}
        <span>ribu ton</span>
      </div>
    </>
  )
}
