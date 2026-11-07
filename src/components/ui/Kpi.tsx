export interface KpiItem {
  k: string
  v: React.ReactNode
  t: React.ReactNode
}

export function KpiStrip({ items }: { items: KpiItem[] }) {
  return (
    <div className="kpis">
      {items.map((it) => (
        <div className="kpi" key={it.k}>
          <div className="k">{it.k}</div>
          <div className="v">{it.v}</div>
          <div className="t">{it.t}</div>
        </div>
      ))}
    </div>
  )
}
