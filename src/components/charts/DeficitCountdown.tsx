import { CountUp } from "@/components/ui/CountUp"
import { type Wilayah } from "@/lib/data"
import { DAY, NOW, dfmt, nf } from "@/lib/format"
import { useSelection } from "@/lib/selection"
import { useWilayah } from "@/lib/filter"

const DEF = 0.75

/** Hari sampai cakupan stok turun di bawah ambang defisit (interpolasi linear antarpekan); null bila tidak dalam 8 pekan. */
function daysToDeficit(k: Wilayah): number | null {
  const s = [k.cov].concat(k.covP)
  if (s[0] < DEF) return 0
  for (let i = 1; i < s.length; i++) {
    if (s[i] < DEF) {
      const f = (s[i - 1] - DEF) / (s[i - 1] - s[i])
      return Math.round((i - 1 + f) * 7)
    }
  }
  return null
}

function Ring({ frac, color }: { frac: number; color: string }) {
  const r = 22
  const c = 2 * Math.PI * r
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true" className="cd-ring">
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--rule-2)" strokeWidth="6" />
      <circle
        cx="28"
        cy="28"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${c * frac} ${c}`}
        transform="rotate(-90 28 28)"
      />
    </svg>
  )
}

/** Kartu hitung mundur: wilayah yang paling cepat jatuh ke defisit stok. */
export function DeficitCountdown() {
  const wil = useWilayah()
  const { sel, select } = useSelection()
  const list = wil.map((k) => ({ k, d: daysToDeficit(k) }))
    .filter((x): x is { k: Wilayah; d: number } => x.d != null)
    .sort((a, b) => a.d - b.d || a.k.cov - b.k.cov)
  const shown = list.slice(0, 8)

  return (
    <>
      <div className="cd-grid">
        {shown.map(({ k, d }) => {
          const color = d <= 14 ? "var(--crit)" : d <= 35 ? "var(--warn)" : "var(--d4)"
          return (
            <button
              key={k.n}
              type="button"
              className={`cd${k.n === sel ? " is-sel" : ""}`}
              onClick={() => select(k.n)}
              style={{ ["--cd" as string]: color }}
            >
              <div className="cd-top">
                <Ring frac={Math.min(1, d / 56)} color={color} />
                <div className="cd-num">
                  {d === 0 ? (
                    <b>sudah</b>
                  ) : (
                    <b>
                      <CountUp value={d} format={(v) => nf(v)} duration={900} />
                    </b>
                  )}
                  <span>{d === 0 ? "di bawah ambang" : "hari lagi"}</span>
                </div>
              </div>
              <div className="cd-name">{k.n}</div>
              <div className="cd-sub">
                stok {nf(k.cov, 2)} bln{d > 0 ? ` · defisit ≈ ${dfmt(new Date(+NOW + d * DAY))}` : ""}
              </div>
            </button>
          )
        })}
      </div>
    </>
  )
}
