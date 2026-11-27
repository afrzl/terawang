import { SSTAT, STATUS, type HargaStatus, type StokStatus } from "@/lib/data"

/** `pre` = label kecil di depan status (mis. "Harga"), dipakai bila status harga dan stok tampil berdampingan. */
export function HargaPill({ s, pre }: { s: HargaStatus; pre?: string }) {
  return (
    <span className={`pill st-${s}`}>
      <i>{STATUS[s].g}</i>
      {pre && <em className="pill-pre">{pre}</em>}
      {STATUS[s].lab}
    </span>
  )
}

export function StokPill({ s, pre }: { s: StokStatus; pre?: string }) {
  return (
    <span className={`pill st-${s}`}>
      <i>{SSTAT[s].g}</i>
      {pre && <em className="pill-pre">{pre}</em>}
      {SSTAT[s].lab}
    </span>
  )
}
