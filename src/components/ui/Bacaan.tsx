import type { ReactNode } from "react"

/** Kotak interpretasi singkat di bawah grafik: apa arti angka yang sedang tampil. */
export function Bacaan({ children, inset }: { children: ReactNode; inset?: boolean }) {
  if (!children) return null
  return (
    <div className={inset ? "bacaan inset" : "bacaan"}>
      <p>{children}</p>
    </div>
  )
}
