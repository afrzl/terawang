/**
 * Validasi angka jawaban LLM: setiap angka penting di jawaban harus berasal dari hasil fungsi (DB TERAWANG),
 * dari pesan pengguna, atau selisih/persen sederhana dari dua angka hasil fungsi.
 */

/** Ambil angka dari teks berformat Indonesia: "Rp12.550" -> 12550, "1,3 bulan" -> 1.3, "12.5%" -> 12.5. */
export function angkaDariTeks(teks: string): number[] {
  const hasil: number[] = []
  for (const m of teks.matchAll(/\d[\d.,]*/g)) {
    let s = m[0].replace(/[.,]+$/, "")
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".") // 12.550 / 1.234,5
    else if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, "") // 12,550 gaya Inggris
    else s = s.replace(",", ".")
    const n = Number(s)
    if (Number.isFinite(n)) hasil.push(n)
  }
  return hasil
}

/** Semua angka di hasil fungsi (rekursif), termasuk angka di dalam string seperti tanggal. */
export function angkaDariData(data: unknown, keluar: number[] = []): number[] {
  if (typeof data === "number") keluar.push(data)
  else if (typeof data === "string") keluar.push(...angkaDariTeks(data.replace(/-/g, " ")))
  else if (Array.isArray(data)) {
    keluar.push(data.length) // "5 kab/kota", "38 wilayah": jumlah baris hasil fungsi
    for (const x of data) angkaDariData(x, keluar)
  }
  else if (data && typeof data === "object") for (const x of Object.values(data)) angkaDariData(x, keluar)
  return keluar
}

const dekat = (a: number, b: number) => Math.abs(a - b) <= Math.max(Math.abs(b) * 0.005, 0.051)

/** Angka di jawaban yang tidak bisa dilacak ke data. Bilangan bulat <= 38 (tanggal, pekan, nomor urut, jumlah kab/kota Jatim) dan tahun dilewati. */
export function angkaTakCocok(jawaban: string, data: unknown[], teksPengguna: string): number[] {
  const sumber = [...new Set(data.flatMap((d) => angkaDariData(d)))].filter((x) => Number.isFinite(x))
  const dariPengguna = angkaDariTeks(teksPengguna)
  const turunan: number[] = []
  const besar = sumber.filter((x) => Math.abs(x) >= 1).slice(0, 300)
  for (let i = 0; i < besar.length; i++) {
    for (let j = 0; j < besar.length; j++) {
      if (i === j) continue
      turunan.push(Math.abs(besar[i] - besar[j]))
      if (besar[j] !== 0) turunan.push(Math.abs(((besar[i] - besar[j]) / besar[j]) * 100))
    }
  }
  return angkaDariTeks(jawaban).filter((n) => {
    if (Number.isInteger(n) && n <= 38) return false
    if (Number.isInteger(n) && n >= 2000 && n <= 2100) return false
    if (dariPengguna.some((u) => dekat(n, u))) return false
    if (sumber.some((s) => dekat(n, s))) return false
    return !turunan.some((t) => dekat(n, t))
  })
}
