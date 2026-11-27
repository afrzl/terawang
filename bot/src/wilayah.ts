/** Daftar kab/kota Jawa Timur dan pencocokan nama dari ketikan warga (huruf besar-kecil, Kab./Kota, salah ketik ringan). */
import { q } from "./db.ts"

export type Wilayah = { id: number; kode: string; nama: string; jenis: "KABUPATEN" | "KOTA"; dasar: string }

let cache: Wilayah[] | null = null

export function normal(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** "Kabupaten Malang" -> "malang", "Kota Batu" -> "batu". */
export function namaDasar(s: string): string {
  return normal(s)
    .replace(/^(kabupaten|kab|kota|kot|kt)\s+/, "")
    .trim()
}

export function setWilayah(daftar: Wilayah[]) {
  cache = daftar
}

export async function semuaWilayah(): Promise<Wilayah[]> {
  if (cache) return cache
  const rows = await q<{ id: number; kode: string; nama: string; jenis: "KABUPATEN" | "KOTA" }>(
    `select w.id, w.kode, w.nama, w.jenis::text as jenis
       from ref.wilayah w
      where w.level = 'KABKOTA' and w.kode like '35%'
      order by w.kode`,
  )
  cache = rows.map((r) => ({ ...r, dasar: namaDasar(r.nama) }))
  return cache
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}

export type HasilCari =
  | { jenis: "pas"; wilayah: Wilayah }
  | { jenis: "ambigu"; pilihan: Wilayah[] }
  | { jenis: "tidak_ada" }

/** Cocokkan teks pendek (argumen perintah) ke satu kab/kota. */
export function cocokkan(teks: string, daftar: Wilayah[]): HasilCari {
  const n = normal(teks)
  if (!n) return { jenis: "tidak_ada" }
  const mintaKota = /^(kota|kot|kt)\b/.test(n)
  const mintaKab = /^(kabupaten|kab)\b/.test(n)
  const dasar = namaDasar(n)
  const saring = (ws: Wilayah[]) => {
    if (mintaKota) return ws.filter((w) => w.jenis === "KOTA")
    if (mintaKab) return ws.filter((w) => w.jenis === "KABUPATEN")
    return ws
  }
  const hasil = (ws: Wilayah[]): HasilCari | null => {
    const s = saring(ws)
    if (s.length === 1) return { jenis: "pas", wilayah: s[0] }
    if (s.length > 1) return { jenis: "ambigu", pilihan: s }
    return null
  }

  // 1. sama persis dengan nama dasar
  const persis = daftar.filter((w) => w.dasar === dasar)
  const h1 = hasil(persis)
  if (h1) return h1

  // 2. awalan (minimal 4 huruf), mis. "banyuw" -> Banyuwangi
  if (dasar.length >= 4) {
    const awal = daftar.filter((w) => w.dasar.startsWith(dasar))
    const h2 = hasil(awal)
    if (h2) return h2
  }

  // 3. salah ketik ringan
  const batas = dasar.length <= 5 ? 1 : 2
  const skor = daftar.map((w) => ({ w, d: levenshtein(dasar, w.dasar) })).filter((x) => x.d <= batas)
  if (skor.length) {
    const terbaik = Math.min(...skor.map((x) => x.d))
    const h3 = hasil(skor.filter((x) => x.d === terbaik).map((x) => x.w))
    if (h3) return h3
  }
  return { jenis: "tidak_ada" }
}

/** Cari nama kab/kota yang disebut di dalam kalimat bebas (untuk LAPOR dan pesan bebas). */
export function cariDiKalimat(teks: string, daftar: Wilayah[]): HasilCari {
  const n = ` ${normal(teks)} `
  const kena = daftar.filter((w) => n.includes(` ${w.dasar} `))
  if (!kena.length) return { jenis: "tidak_ada" }
  const panjang = Math.max(...kena.map((w) => w.dasar.length))
  let calon = kena.filter((w) => w.dasar.length === panjang)
  if (calon.length > 1) {
    const dasar = calon[0].dasar
    if (n.includes(` kota ${dasar} `)) calon = calon.filter((w) => w.jenis === "KOTA")
    else if (n.includes(` kab ${dasar} `) || n.includes(` kabupaten ${dasar} `)) calon = calon.filter((w) => w.jenis === "KABUPATEN")
  }
  return calon.length === 1 ? { jenis: "pas", wilayah: calon[0] } : { jenis: "ambigu", pilihan: calon }
}

/** Nama tampilan: kabupaten di ref.wilayah tersimpan tanpa awalan ("Malang"), kota dengan awalan ("Kota Malang"). */
export function labelWilayah(w: Pick<Wilayah, "nama" | "jenis">): string {
  return w.jenis === "KABUPATEN" && !/^kab/i.test(w.nama) ? `Kab. ${w.nama}` : w.nama
}
