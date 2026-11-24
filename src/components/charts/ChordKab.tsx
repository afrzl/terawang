import { ChordArus, type ChordNode } from "@/components/charts/ChordArus"
import { regionOf, type Trade } from "@/lib/arus"
import { short } from "@/lib/format"

const MAKS = 14

/** Chord antar kabupaten: kabupaten dengan arus (kirim + terima) terbesar, sisanya digabung jadi "Lainnya". */
export function ChordKab({ trade }: { trade: Trade[] }) {
  const volume = new Map<string, number>()
  for (const t of trade) {
    volume.set(t.from.n, (volume.get(t.from.n) ?? 0) + t.ton)
    volume.set(t.to.n, (volume.get(t.to.n) ?? 0) + t.ton)
  }
  const top = [...volume].sort((a, b) => b[1] - a[1]).slice(0, MAKS).map((d) => d[0])
  const adaLain = volume.size > MAKS
  const nodes: ChordNode[] = [
    ...top.map((n) => ({ key: n, name: n, short: short(n), color: regionOf[n].color })),
    ...(adaLain ? [{ key: "lain", name: "Lainnya", short: "Lainnya", color: "var(--ink-3)" }] : []),
  ]
  const idx = (n: string) => {
    const i = top.indexOf(n)
    return i >= 0 ? i : top.length
  }
  const matrix = nodes.map(() => nodes.map(() => 0))
  for (const t of trade) matrix[idx(t.from.n)][idx(t.to.n)] += t.ton
  return <ChordArus matrix={matrix} nodes={nodes} />
}
