import { KELUAR_PROV, KELUAR_PROV_2025 } from "@/lib/arus"
import { BULAN_KINI, BULAN_NAMA, bulanLabel } from "@/lib/filter"
import { nf, scale, ticks } from "@/lib/format"
import { useTooltip } from "@/lib/tooltip"

const W = 760
const H = 300
const M = { l: 52, r: 16, t: 16, b: 30 }

/** Surplus beras Jawa Timur per bulan (ribu ton): batang 2026 sampai bulan terakhir jendela, garis putus-putus 2025. */
export function KeluarProvinsi({ terpilih }: { terpilih: number }) {
  const { show, hide } = useTooltip()
  if (!KELUAR_PROV) return null
  const d = KELUAR_PROV.map((v) => (v === null ? null : v / 1000))
  const pb = KELUAR_PROV_2025?.map((v) => v / 1000) ?? null
  const ymax = Math.max(1, ...d.map((v) => v ?? 0), ...(pb ?? [])) * 1.1
  const y = scale(0, ymax, H - M.b, M.t)
  const lebar = (W - M.l - M.r) / d.length
  const cx = (i: number) => M.l + lebar * i + lebar / 2
  const bw = Math.min(30, lebar * 0.6)
  const garisPb = pb?.map((v, i) => `${i ? "L" : "M"}${cx(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ")

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Surplus beras Jawa Timur per bulan">
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
        {d.map((v, i) => (
          <g key={i}>
            {v !== null && (
              <rect
                x={cx(i) - bw / 2}
                y={y(v)}
                width={bw}
                height={y(0) - y(v)}
                fill="var(--accent)"
                opacity={i > BULAN_KINI ? 0.45 : i === terpilih ? 1 : 0.8}
                stroke={i === terpilih ? "var(--ink)" : "none"}
                strokeWidth={1.2}
              />
            )}
            <text x={cx(i)} y={H - M.b + 18} textAnchor="middle">
              {BULAN_NAMA[i % 12]}
            </text>
          </g>
        ))}
        {garisPb && <path d={garisPb} fill="none" stroke="var(--ink-3)" strokeWidth={1.6} strokeDasharray="5 4" />}
        {d.map((v, i) => (
          <rect
            key={`h${i}`}
            x={M.l + lebar * i}
            y={M.t}
            width={lebar}
            height={H - M.t - M.b}
            fill="transparent"
            onMouseMove={(e) =>
              show(
                <>
                  <b>{bulanLabel(i)}</b>
                  <br />
                  Surplus <span className="m">{v === null ? "–" : `${nf(v, 1)} rb ton`}</span>
                  {pb && i < 12 && (
                    <>
                      <br />
                      {BULAN_NAMA[i]} 2025 <span className="m">{nf(pb[i], 1)} rb ton</span>
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
          2026–2027
        </span>
        {pb && (
          <span>
            <svg width="18" height="10" aria-hidden="true" style={{ marginRight: 6, verticalAlign: "middle" }}>
              <line x1="0" x2="18" y1="5" y2="5" stroke="var(--ink-3)" strokeWidth="2" strokeDasharray="4 3" />
            </svg>
            2025
          </span>
        )}
        <span>ribu ton</span>
      </div>
    </>
  )
}
