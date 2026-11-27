/**
 * Validasi angka jawaban LLM: setiap angka penting di jawaban harus berasal dari hasil fungsi (DB TERAWANG),
 * dari pesan pengguna, atau selisih/persen sederhana dari dua angka hasil fungsi.
 */

/**
 * Ambil angka dari teks berformat Indonesia: "Rp12.550" -> 12550, "1,3 bulan" -> 1.3.
 * Bentuk ambigu "1,413" / "1.413" (pemisah + tepat 3 digit) punya dua tafsiran: ribuan atau desimal.
 */
export function kandidatAngka(teks: string): number[][] {
  const hasil: number[][] = []
  for (const m of teks.matchAll(/\d[\d.,]*/g)) {
    const s = m[0].replace(/[.,]+$/, "")
    const calon = new Set<number>()
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) calon.add(Number(s.replace(/\./g, "").replace(",", "."))) // 12.550 / 1.234,5
    if (/^\d{1,3}(,\d{3})+$/.test(s)) calon.add(Number(s.replace(/,/g, ""))) // 12,550 gaya Inggris
    if (/^\d+[.,]\d+$/.test(s)) calon.add(Number(s.replace(",", "."))) // desimal: 1,413 / 0.93
    if (/^\d+$/.test(s)) calon.add(Number(s))
    const xs = [...calon].filter(Number.isFinite)
    if (xs.length) hasil.push(xs)
  }
  return hasil
}

export function angkaDariTeks(teks: string): number[] {
  return kandidatAngka(teks).map((xs) => xs[0])
}

/** Semua angka di hasil fungsi (rekursif), termasuk angka di dalam string seperti tanggal. */
export function angkaDariData(data: unknown, keluar: number[] = []): number[] {
  if (typeof data === "number") keluar.push(data)
  else if (typeof data === "string") keluar.push(...kandidatAngka(data.replace(/-/g, " ")).flat())
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
  const sah = (n: number) => {
    if (Number.isInteger(n) && n <= 38) return true
    if (Number.isInteger(n) && n >= 2000 && n <= 2100) return true
    if (dariPengguna.some((u) => dekat(n, u))) return true
    if (sumber.some((s) => dekat(n, s))) return true
    return turunan.some((t) => dekat(n, t))
  }
  // angka ambigu cukup cocok di salah satu tafsirannya
  return kandidatAngka(jawaban).filter((xs) => !xs.some(sah)).map((xs) => xs[0])
}
