import { useEffect, useRef, useState } from "react"

/** Benar bila media query cocok; ikut berubah saat layar diputar atau jendela diubah ukurannya. */
export function useMedia(query: string) {
  const [cocok, setCocok] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return
    const ubah = () => setCocok(mq.matches)
    ubah()
    mq.addEventListener("change", ubah)
    return () => mq.removeEventListener("change", ubah)
  }, [query])
  return cocok
}

/** Lebar HP dan tablet tegak: di bawah 900 px sidebar filter berubah menjadi laci. */
export const MQ_SEMPIT = "(max-width: 899px)"

/** Lebar isi (tanpa padding) elemen induk, hanya diukur di HP (≤ 640 px). Dipakai grafik SVG agar viewBox mengikuti layar sehingga teks tidak mengecil. */
export function useLebarHp<T extends Element>(asal: number, min = 300) {
  const ref = useRef<T>(null)
  const hp = useMedia("(max-width: 640px)")
  const [lebar, setLebar] = useState(0)
  useEffect(() => {
    const el = ref.current?.parentElement
    if (!hp || !el || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver((es) => setLebar(Math.round(es[0].contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [hp])
  return { ref, hp, W: hp && lebar ? Math.min(asal, Math.max(lebar, min)) : asal }
}
