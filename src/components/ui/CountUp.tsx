import { useCountUp } from "@/hooks/useCountUp"

interface CountUpProps {
  value: number
  format: (v: number) => string
  duration?: number
  delay?: number
  /** Nilai awal hitungan (bawaan 0). */
  from?: number
}

/** Angka yang berhitung naik saat halaman dibuka. Lebar dikunci ke nilai akhir agar tata letak tidak bergeser. */
export function CountUp({ value, format, duration, delay, from }: CountUpProps) {
  const v = useCountUp(value, duration, delay, from)
  const final = format(value)
  return (
    <span className="countup" aria-label={final}>
      <span aria-hidden="true" className="countup-ghost">
        {final}
      </span>
      <span aria-hidden="true" className="countup-live">
        {format(v)}
      </span>
    </span>
  )
}
