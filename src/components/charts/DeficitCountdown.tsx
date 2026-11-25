import { BULAN_KINI, K2 } from "@/lib/api"
import { type Wilayah } from "@/lib/data"
import { DAY, dfmt, nf } from "@/lib/format"
import { covBulan } from "@/lib/petaLayers"
import { useSelection } from "@/lib/selection"
import { useWilayah } from "@/lib/filter"

const DEF = 0.75
/** Tanggal acuan hitung mundur: tanggal run K2 (model menghitung dari "hari ini" saat run); tanpa API = hari ini. */
const ACUAN = (() => {
  const t = K2?.meta.dibuat ? new Date(K2.meta.dibuat) : new Date()
  return new Date(t.getFullYear(), t.getMonth(), t.getDate())
})()

/** Hari sampai cakupan stok turun di bawah ambang defisit. Dari keluaran K2 (hari_ke_defisit, sudah_defisit) bila API tersambung;
 *  selain itu interpolasi linear antar akhir bulan (bulan lalu sampai bulan kini + 2). Null bila tidak dalam prakiraan. */
function daysToDeficit(k: Wilayah): { d: number; cov: number } | null {
  if (K2) {
    const cov = covBulan(k, BULAN_KINI)
    if (K2.meta.sudah_defisit.includes(k.n)) return { d: 0, cov }
    const h = K2.meta.hari_ke_defisit[k.n]
    return h != null ? { d: Math.round(h), cov } : null
  }
  const idx = [BULAN_KINI - 1, BULAN_KINI, BULAN_KINI + 1, BULAN_KINI + 2]
  const titik = idx.map((i) => ({ t: +new Date(2026, i + 1, 0), c: covBulan(k, i) }))
  const t0 = +ACUAN
  const awal = titik[0].c + ((titik[1].c - titik[0].c) * (t0 - titik[0].t)) / (titik[1].t - titik[0].t)
  if (awal < DEF) return { d: 0, cov: awal }
  let prevT = t0
  let prevC = awal
  for (let i = 2; i < titik.length; i++) {
    if (titik[i].c < DEF || titik[i - 1].c < DEF) {
      const a = i === 2 ? { t: t0, c: awal } : { t: prevT, c: prevC }
      const b = titik[i]
      const f = (a.c - DEF) / (a.c - b.c)
      return { d: Math.round(((a.t + (b.t - a.t) * f) - t0) / DAY), cov: awal }
    }
    prevT = titik[i].t
    prevC = titik[i].c
  }
  return null
}

/** Kartu hitung mundur: wilayah yang paling cepat jatuh ke defisit stok. */
export function DeficitCountdown() {
  const wil = useWilayah()
  const { sel, select } = useSelection()
  const list = wil
    .map((k) => ({ k, r: daysToDeficit(k) }))
    .filter((x): x is { k: Wilayah; r: { d: number; cov: number } } => x.r != null)
    .map((x) => ({ k: x.k, d: x.r.d, cov: x.r.cov }))
    .sort((a, b) => a.d - b.d || a.cov - b.cov)
  const shown = list.slice(0, 8)

  const SKALA = 1.5
  return (
    <div className="cdl" role="list">
      {shown.map(({ k, d, cov }) => {
        const warna = d <= 14 ? "var(--crit)" : d <= 35 ? "var(--warn)" : "var(--d4)"
        return (
          <button key={k.n} type="button" role="listitem" className={`cdl-row${k.n === sel ? " is-sel" : ""}`} onClick={() => select(k.n)}>
            <span className="cdl-n">{k.n}</span>
            <span className="cdl-bar" aria-hidden="true">
              <span className="cdl-fill" style={{ width: `${Math.min(100, (cov / SKALA) * 100)}%`, background: warna }} />
              <span className="cdl-thr" style={{ left: `${(DEF / SKALA) * 100}%` }} />
            </span>
            <span className="cdl-c">{nf(cov, 2)} bln</span>
            <span className="cdl-t">{d === 0 ? "sudah di bawah" : dfmt(new Date(+ACUAN + d * DAY))}</span>
            <span className="cdl-d">{d === 0 ? "" : `${nf(d)} hari`}</span>
          </button>
        )
      })}
      {shown.length === 0 && <div className="method">Tidak ada wilayah yang diperkirakan defisit dalam horizon prakiraan.</div>}
    </div>
  )
}
