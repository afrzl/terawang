import type { LayerSpec } from "@/lib/petaLayers"

/** Legenda warna untuk satu lapisan peta. */
export function Legenda({ spec }: { spec: LayerSpec }) {
  return (
    <div className="legend">
      <span className="ttl">{spec.title}</span>
      {spec.bins.map((b) => (
        <span key={b[3]}>
          <span className="sw" style={{ background: `var(${b[2]})` }} />
          {b[3]}
        </span>
      ))}
    </div>
  )
}
