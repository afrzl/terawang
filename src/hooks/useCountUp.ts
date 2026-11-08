import { useEffect, useState } from "react"

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

/** Nilai yang naik dari 0 ke `target` saat komponen pertama kali tampil (dilewati bila pengguna memilih kurangi gerak). */
export function useCountUp(target: number, duration = 1100, delay = 0, from = 0) {
  const [v, setV] = useState(() => (reduced() ? target : from))
  useEffect(() => {
    let raf = 0
    let start = 0
    const tick = (t: number) => {
      if (!start) start = t
      const p = reduced() ? 1 : Math.min(1, Math.max(0, (t - start - delay) / duration))
      const e = 1 - Math.pow(1 - p, 3)
      setV(from + (target - from) * e)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration, delay, from])
  return v
}
