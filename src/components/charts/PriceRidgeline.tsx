import { useId } from "react"
import { HET, HET_PREMIUM, HIST, SIAGA_KALI, fcDates, fcHarga, histDates, seriHarga } from "@/lib/data"
import { dfmt, nf, rp, scale } from "@/lib/format"
import { useTooltip } from "@/lib/tooltip"
import { useWilayah } from "@/lib/filter"
import { bul, useDataTafsir } from "@/lib/tafsir"

const NH = 12
const W = 760
const ML = 84
const MR = 16
const STEP = 19
const RH = 62
const TOP = RH + 28
const BW = 95

type Jenis = "medium" | "premium"
const WARNA: Record<Jenis, string> = { medium: "var(--accent)", premium: "var(--warn)" }

/** Ridgeline sebaran harga beras 38 wilayah per pekan: 12 pekan terakhir dan 4 pekan prakiraan.
 *  Satu jenis: warna menurut posisi terhadap HET. Dua jenis: dua punggung bertumpuk per pekan, satu warna per jenis. Premium: seri K3a premium (selisih tetap dari medium hanya bila API mati). */
export function PriceRidgeline({ jenis }: { jenis: Jenis[] }) {
  const wil = useWilayah()
  const ganda = jenis.length > 1
  const hetOf = (j: Jenis) => (j === "premium" ? HET_PREMIUM : HET)
  const popF = wil.reduce((a, k) => a + k.pop, 0) || 1
  const rataF = (f: (k: (typeof wil)[number]) => number) => wil.reduce((a, k) => a + f(k) * k.pop, 0) / popF
  const { show, hide } = useTooltip()
  const gid = useId().replace(/:/g, "")
  const seri = jenis.map((j) => {
    const weeks = [
      ...Array.from({ length: NH }, (_, jj) => {
        const i = HIST - NH + jj
        return { d: histDates[i], fc: false, vals: wil.map((k) => seriHarga(k, j)[i]), mine: rataF((k) => seriHarga(k, j)[i]) }
      }),
      ...fcDates.map((d, h) => ({ d, fc: true, vals: wil.map((k) => fcHarga(k, j)[h].m), mine: rataF((k) => fcHarga(k, j)[h].m) })),
    ]
    return { j, weeks }
  })
  useDataTafsir("ridgeline", {
    satuan: "rupiah per kg",
    jumlah_wilayah: wil.length,
    het: Object.fromEntries(jenis.map((j) => [j, hetOf(j)])),
    pekan: seri.flatMap((q) =>
      q.weeks.map((w) => {
        const iMin = w.vals.indexOf(Math.min(...w.vals))
        const iMax = w.vals.indexOf(Math.max(...w.vals))
        return {
          pekan: `${w.d.getFullYear()}-${String(w.d.getMonth() + 1).padStart(2, "0")}-${String(w.d.getDate()).padStart(2, "0")}`,
          ...(ganda ? { jenis: q.j } : {}),
          jenis_nilai: w.fc ? "prakiraan" : "aktual",
          rata_rata: bul(w.mine, 0),
          termurah: bul(w.vals[iMin], 0),
          wilayah_termurah: wil[iMin]?.n,
          termahal: bul(w.vals[iMax], 0),
          wilayah_termahal: wil[iMax]?.n,
          wilayah_di_atas_het: w.vals.filter((v) => v > hetOf(q.j)).length,
        }
      }),
    ),
  })
  const all = seri.flatMap((q) => q.weeks.flatMap((w) => w.vals))
  const lo = Math.floor((Math.min(...all) - 250) / 100) * 100
  const hi = Math.ceil((Math.max(...all) + 250) / 100) * 100
  const x = scale(lo, hi, ML, W - MR)
  const nW = seri[0].weeks.length
  const H = TOP + (nW - 1) * STEP + 34
  const N = 140
  const grid = Array.from({ length: N + 1 }, (_, i) => lo + ((hi - lo) * i) / N)
  const dens = seri.map((q) =>
    q.weeks.map((w) => grid.map((gx) => w.vals.reduce((a, v) => a + Math.exp(-0.5 * ((gx - v) / BW) ** 2), 0) / (w.vals.length * BW * Math.sqrt(2 * Math.PI)))),
  )
  const dmax = Math.max(...dens.flat(2))
  const ticks = []
  for (let t = Math.ceil(lo / 500) * 500; t <= hi; t += 500) ticks.push(t)
  const pct = (v: number) => `${((x(v) - x(lo)) / (x(hi) - x(lo))) * 100}%`
  const HET_K = hetOf(jenis[0])
  const SIAGA_K = Math.round(HET_K * SIAGA_KALI)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Sebaran harga beras per pekan" className="ridge">
      <defs>
        <linearGradient id={`rg${gid}`} gradientUnits="userSpaceOnUse" x1={x(lo)} x2={x(hi)} y1="0" y2="0">
          <stop offset="0%" stopColor="var(--ok)" />
          <stop offset={pct(HET_K - 150)} stopColor="var(--ok)" />
          <stop offset={pct(HET_K)} stopColor="var(--warn)" />
          <stop offset={pct(SIAGA_K)} stopColor="var(--warn)" />
          <stop offset={pct(SIAGA_K + 150)} stopColor="var(--crit)" />
          <stop offset="100%" stopColor="var(--crit)" />
        </linearGradient>
      </defs>
      <g className="grid">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={20} y2={H - 22} />
            <text x={x(t)} y={H - 6} textAnchor="middle">
              {nf(t)}
            </text>
          </g>
        ))}
      </g>
      {ganda
        ? jenis.map((j) => (
            <g key={j}>
              <line x1={x(hetOf(j))} x2={x(hetOf(j))} y1={20} y2={H - 22} stroke={WARNA[j]} strokeDasharray="4 3" />
              <text x={x(hetOf(j))} y={14} textAnchor="middle" className="lab-b" style={{ fill: WARNA[j] }}>
                HET {j}
              </text>
            </g>
          ))
        : [
            [HET_K, "HET"],
            [SIAGA_K, "HET +5%"],
          ].map(([v, l]) => (
            <g key={l}>
              <line x1={x(+v)} x2={x(+v)} y1={20} y2={H - 22} stroke={l === "HET" ? "var(--ink-2)" : "var(--crit)"} strokeDasharray="4 3" />
              <text x={x(+v)} y={14} textAnchor="middle" className="lab-b" style={{ fill: l === "HET" ? "var(--ink-2)" : "var(--crit)" }}>
                {l}
              </text>
            </g>
          ))}
      {Array.from({ length: nW }, (_, wi) => {
        const base = TOP + wi * STEP
        const w0 = seri[0].weeks[wi]
        return (
          <g
            key={wi}
            onMouseMove={(e) =>
              show(
                <>
                  <b>
                    {dfmt(w0.d)} {w0.d.getFullYear()}{w0.fc ? ", prakiraan" : ""}
                  </b>
                  {seri.map((q) => {
                    const w = q.weeks[wi]
                    const sorted = w.vals.slice().sort((a, b) => a - b)
                    const med = (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2
                    const above = w.vals.filter((v) => v > hetOf(q.j)).length
                    return (
                      <span key={q.j}>
                        <br />
                        {ganda && <b style={{ textTransform: "capitalize" }}>{q.j}: </b>}
                        median <span className="m">{rp(med)}</span>, rentang{" "}
                        <span className="m">
                          {rp(sorted[0])}–{rp(sorted[sorted.length - 1])}
                        </span>
                        , di atas HET <span className="m">{above} wilayah</span>
                      </span>
                    )
                  })}
                </>,
                e,
              )
            }
            onMouseLeave={hide}
          >
            {seri.map((q, si) => {
              const w = q.weeks[wi]
              const pts = grid.map((gx, i) => `${x(gx).toFixed(1)},${(base - (dens[si][wi][i] / dmax) * RH).toFixed(1)}`)
              const d = `M${x(lo)},${base}L${pts.join("L")}L${x(hi)},${base}Z`
              const top = pts.filter((_, i) => dens[si][wi][i] > dmax * 0.012)
              return (
                <g key={q.j}>
                  <path d={d} fill={ganda ? WARNA[q.j] : `url(#rg${gid})`} fillOpacity={ganda ? (w.fc ? 0.3 : 0.5) : w.fc ? 0.42 : 0.8} />
                  <path
                    d={`M${top.join("L")}`}
                    fill="none"
                    stroke={ganda ? WARNA[q.j] : w.fc ? "var(--ink-2)" : "var(--panel)"}
                    strokeWidth={w.fc ? 1.1 : 1.4}
                    strokeDasharray={w.fc ? "4 3" : undefined}
                  />
                  <circle cx={x(w.mine)} cy={base} r={2.8} fill={ganda ? WARNA[q.j] : "var(--ink)"} stroke={ganda ? "var(--panel)" : undefined} strokeWidth={1} />
                </g>
              )
            })}
            <text x={ML - 8} y={base} textAnchor="end" className={w0.fc ? "lab-b" : "lab"}>
              {w0.fc ? `+${wi - NH + 1} pkn` : dfmt(w0.d)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
