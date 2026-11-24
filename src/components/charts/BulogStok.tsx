import { STOK_BULOG_2026 } from "@/lib/bulog"
import { BULAN_NAMA } from "@/lib/filter"
import { nf, scale, ticks } from "@/lib/format"
import { useTooltip } from "@/lib/tooltip"

const W = 760
const H = 500
const M = { l: 52, r: 16, t: 16, b: 30 }

/** Stok Bulog Jawa Timur per bulan, 2026: persediaan akhir (garis) dengan pemasukan dan pengeluaran (batang), ribu ton. Tingkat provinsi. */
export function BulogStok() {
  const { show, hide } = useTooltip()
  const d = STOK_BULOG_2026
  const ymax = Math.max(...d.map((r) => Math.max(r.akhir, r.masuk, r.keluar))) * 1.1
  const y = scale(0, ymax, H - M.b, M.t)
  const SLOT = 12
  const lebar = (W - M.l - M.r) / SLOT
  const cx = (i: number) => M.l + lebar * i + lebar / 2
  const garis = d.map((r, i) => `${i ? "L" : "M"}${cx(i).toFixed(1)} ${y(r.akhir).toFixed(1)}`).join(" ")
  const bw = Math.min(14, lebar * 0.28)

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Stok beras Bulog Jawa Timur per bulan, 2026">
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
                  <b>{BULAN_NAMA[i]} 2026</b>
                  <br />
                  Persediaan akhir <span className="m">{nf(r.akhir, 1)} rb ton</span>
                  <br />
                  Pemasukan <span className="m">{nf(r.masuk, 1)} rb ton</span>
                  <br />
                  Pengeluaran <span className="m">{nf(r.keluar, 1)} rb ton</span>
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
        <span>ribu ton</span>
      </div>
    </>
  )
}
