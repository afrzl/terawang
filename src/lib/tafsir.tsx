import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react"

/**
 * Data interpretasi grafik. Komponen grafik mendaftarkan data yang PERSIS mereka gambar ke Panel terdekat
 * lewat useDataTafsir(); tombol "Interpretasi" di Panel mengirim data itu ke POST /api/tafsir.
 * Komponen di luar Panel tidak terpengaruh (hook tidak melakukan apa-apa).
 */
type Daftar = (kunci: string, data: unknown | undefined) => void
const Ctx = createContext<Daftar | null>(null)

/** Dipakai Panel: kumpulan data terdaftar + provider. */
export function useWadahTafsir() {
  const [isi, setIsi] = useState<Record<string, unknown>>({})
  const daftar = useMemo<Daftar>(
    () => (kunci, data) =>
      setIsi((s) => {
        if (data === undefined) {
          if (!(kunci in s)) return s
          const { [kunci]: _, ...sisa } = s
          return sisa
        }
        return s[kunci] === data ? s : { ...s, [kunci]: data }
      }),
    [],
  )
  return { isi, Provider: Ctx.Provider, daftar }
}

/**
 * Daftarkan data grafik ke Panel. `data` dibandingkan lewat JSON, jadi aman dipanggil dengan objek baru tiap render.
 * `kunci` membedakan beberapa grafik dalam satu panel.
 */
export function useDataTafsir(kunci: string, data: unknown) {
  const daftar = useContext(Ctx)
  const json = daftar ? JSON.stringify(data ?? null) : ""
  const terakhir = useRef<string>("")
  useEffect(() => {
    if (!daftar || json === terakhir.current) return
    terakhir.current = json
    daftar(kunci, JSON.parse(json))
  }, [daftar, kunci, json])
  useEffect(() => {
    if (!daftar) return
    return () => daftar(kunci, undefined)
  }, [daftar, kunci])
}

/** Bulatkan angka supaya data yang dikirim ringkas dan sama dengan yang terbaca di grafik. */
export const bul = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d)
