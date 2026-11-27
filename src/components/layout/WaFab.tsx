import { useEffect, useState } from "react"

/** Tombol WhatsApp melayang di pojok kanan bawah. Nomor diambil dari bot yang sedang tersambung; tidak tampil bila tidak ada. */
export function WaFab() {
  const [nomor, setNomor] = useState<string | null>(null)
  useEffect(() => {
    let batal = false
    const muat = () =>
      fetch("/api/kontak-wa", { headers: { Accept: "application/json" } })
        .then((r) => (r.ok ? r.json() : { nomor: null }))
        .then((j: { nomor?: string | null }) => !batal && setNomor(typeof j.nomor === "string" ? j.nomor : null))
        .catch(() => !batal && setNomor(null))
    muat()
    const t = window.setInterval(muat, 5 * 60_000)
    return () => {
      batal = true
      window.clearInterval(t)
    }
  }, [])
  if (!nomor) return null
  const href = `https://wa.me/${nomor}?text=${encodeURIComponent("Halo TERAWANG")}`
  return (
    <a className="wa-fab" href={href} target="_blank" rel="noopener noreferrer" aria-label="Tanya bot TERAWANG lewat WhatsApp" title="Tanya lewat WhatsApp">
      <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
        <path
          fill="currentColor"
          d="M16.04 3C9.4 3 4 8.36 4 14.97c0 2.1.56 4.16 1.62 5.97L4 29l8.27-1.6a12.1 12.1 0 0 0 3.77.6C22.66 28 28 22.62 28 16.01 28 8.36 22.66 3 16.04 3Zm0 22.04c-1.2 0-2.39-.2-3.52-.6l-.5-.17-4.9.95.98-4.75-.2-.5a9.9 9.9 0 0 1-1.5-5c0-5.5 4.17-9.95 9.64-9.95 5.46 0 9.73 4.46 9.73 9.99 0 5.54-4.27 10.03-9.73 10.03Zm5.47-7.43c-.3-.15-1.77-.87-2.04-.97-.28-.1-.48-.15-.68.15-.2.3-.78.97-.96 1.17-.18.2-.35.22-.65.07-.3-.15-1.27-.47-2.42-1.49-.9-.8-1.5-1.78-1.67-2.08-.18-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.58c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48 0 1.47 1.07 2.88 1.22 3.08.15.2 2.1 3.2 5.08 4.48.71.31 1.27.49 1.7.63.72.23 1.37.2 1.88.12.58-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.13-.27-.2-.57-.35Z"
        />
      </svg>
    </a>
  )
}
