import { SSTAT, STATUS, type HargaStatus, type StokStatus } from "@/lib/data"

export function HargaPill({ s }: { s: HargaStatus }) {
  return (
    <span className={`pill st-${s}`}>
      <i>{STATUS[s].g}</i>
      {STATUS[s].lab}
    </span>
  )
}

export function StokPill({ s }: { s: StokStatus }) {
  return (
    <span className={`pill st-${s}`}>
      <i>{SSTAT[s].g}</i>
      {SSTAT[s].lab}
    </span>
  )
}
