/**
 * Grafik harga beras untuk dikirim sebagai gambar WhatsApp.
 * Semua titik dan angka di gambar maupun keterangannya diambil dari silver.harga_kabkota_harian (tanpa LLM).
 */
import { Resvg } from "@resvg/resvg-js"
import { q } from "./db.ts"
import { hetMedium } from "./data.ts"
import { nf, rp } from "./format.ts"
import { labelWilayah, levenshtein, normal, type Wilayah } from "./wilayah.ts"

export const POLA_GRAFIK = /\b(grafik|grafiknya|chart|charts|diagram|visualisasi|visualisasinya|kurva|plot)\b/

export type Jenis = "medium" | "premium" | "keduanya"

export type TopikGrafik = "harga" | "stok" | "produksi"

/** Topik grafik yang disebut di kalimat ("stoknya", "produksi padi", "harganya"), atau null. */
export function topikDisebut(teks: string): TopikGrafik | null {
  const n = normal(teks)
  if (/\b(stok\w*|stock\w*|persediaan\w*|cadangan\w*|ketersediaan\w*)\b/.test(n)) return "stok"
  if (/\b(produksi\w*|panen\w*|hasil panen)\b/.test(n)) return "produksi"
  if (/\b(harga\w*|hrg)\b/.test(n)) return "harga"
  return null
}

/** Hal yang belum punya grafik: dijawab terus terang lewat teks. */
export const POLA_GRAFIK_BELUM = /\b(sphp|konsumsi\w*|distribusi\w*|arus|pasokan\w*|gabah|gkp|gkg|bulog|peringatan)\b/

/** Rentang hari yang disebut di kalimat ("seminggu", "2 minggu", "3 bulan", "setahun", "30 hari"), atau null. Salah ketik umum ikut dikenali. */
export function rentangDisebut(teks: string): number | null {
  const n = normal(teks)
  const m = n.match(/\b(\d{1,3}) ?(hari|hr|minggu|mgg|mg|pekan|bulan|bln|bl|tahun|thn|th|taun)\b/)
  if (m) {
    const x = Number(m[1])
    const kali = /^(hari|hr)$/.test(m[2]) ? 1 : /^(minggu|mgg|mg|pekan)$/.test(m[2]) ? 7 : /^(bulan|bln|bl)$/.test(m[2]) ? 30 : 365
    return batasi(x * kali)
  }
  if (/\b(seminggu|semingu|sminggu|smgg|sepekan|satu minggu|satu pekan|minggu ini|pekan ini)\b/.test(n)) return 7
  if (/\b(setahun|setaun|stahun|staun|sthn|sathun|setahn|setahon|satu tahun|tahun ini|setahunan)\b/.test(n)) return 365
  if (/\b(sebulan|sbln|sebln|sbulan|sebulanan|satu bulan|bulan ini)\b/.test(n)) return 30
  // salah ketik lain yang mirip: "sethaun", "setahn", "sebuln", "semnggu"
  for (const kata of n.split(" ")) {
    if (kata.length < 5 || !kata.startsWith("s")) continue
    if (levenshtein(kata, "setahun") <= 2) return 365
    if (levenshtein(kata, "sebulan") <= 2) return 30
    if (levenshtein(kata, "seminggu") <= 2) return 7
  }
  return null
}

/** Rentang dari kalimat, bawaan 30 hari. */
export function uraiRentang(teks: string): number {
  return rentangDisebut(teks) ?? 30
}

const batasi = (h: number) => Math.min(Math.max(h, 7), 365)

export function jenisDisebut(teks: string): Jenis | null {
  const n = normal(teks)
  const md = /\bmedium\b/.test(n), pr = /\bpremium\b/.test(n)
  return md && !pr ? "medium" : pr && !md ? "premium" : md && pr ? "keduanya" : null
}

export function uraiJenis(teks: string): Jenis {
  return jenisDisebut(teks) ?? "keduanya"
}

export type Titik = { tanggal: string; medium: number | null; premium: number | null }
export type DataGrafik = { judul: string; wilayahId: number | null; hari: number; titik: Titik[]; het: number | null; jenis: Jenis }

/** Rata-rata harian beras medium/premium satu kab/kota, atau rata-rata 38 kab/kota bila `w` null. */
export async function dataGrafik(w: Wilayah | null, hari: number, jenis: Jenis): Promise<DataGrafik> {
  const h = batasi(hari)
  const rows = await q<Titik>(
    `with akhir as (
       select max(tanggal) as t from silver.harga_kabkota_harian where ($1::int is null or wilayah_id = $1)
     )
     select h.tanggal::text as tanggal,
            round(avg(h.harga_rata2_rp_kg) filter (where k.kode = 'beras_medium'))::int as medium,
            round(avg(h.harga_rata2_rp_kg) filter (where k.kode = 'beras_premium'))::int as premium
       from silver.harga_kabkota_harian h join ref.komoditas k on k.id = h.komoditas_id
      where ($1::int is null or h.wilayah_id = $1) and k.kode in ('beras_medium', 'beras_premium')
        and h.harga_rata2_rp_kg is not null
        and h.tanggal > (select t from akhir) - $2::int and h.tanggal <= (select t from akhir)
      group by 1 order by 1`,
    [w?.id ?? null, h],
  )
  const het = jenis === "premium" ? null : (await hetMedium(w?.id ?? 0)).het
  return { judul: w ? labelWilayah(w) : "Jawa Timur (rata-rata 38 kab/kota)", wilayahId: w?.id ?? null, hari: h, titik: rows, het, jenis }
}

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
const tglPendek = (iso: string) => {
  const [, b, d] = iso.split("-").map(Number)
  return `${d} ${BULAN[b - 1]}`
}
const tglPanjang = (iso: string) => `${tglPendek(iso)} ${iso.slice(0, 4)}`
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

export const WARNA = { medium: "#1F5FA8", premium: "#C26A1B", het: "#B3261E", tinta: "#1B2A24", tinta2: "#5B6B63", garis: "#DCE3DE", latar: "#FFFFFF" }

type Seri = { kunci: "medium" | "premium"; label: string; warna: string; nilai: (number | null)[] }

function seriAktif(d: DataGrafik): Seri[] {
  const s: Seri[] = []
  if (d.jenis !== "premium") s.push({ kunci: "medium", label: "Beras medium", warna: WARNA.medium, nilai: d.titik.map((t) => t.medium) })
  if (d.jenis !== "medium") s.push({ kunci: "premium", label: "Beras premium", warna: WARNA.premium, nilai: d.titik.map((t) => t.premium) })
  return s.filter((x) => x.nilai.some((v) => v != null))
}

/** Langkah sumbu Y yang rapi (50, 100, 250, 500, 1000 ...). */
export function langkahRapi(rentang: number): number {
  const kasar = rentang / 5
  const p = 10 ** Math.floor(Math.log10(kasar))
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= kasar) ?? 10 * p
}

export function svgGrafik(d: DataGrafik): string {
  const W = 1080, H = 720
  const kiri = 118, kanan = 40, atas = 150, bawah = 96
  const lebar = W - kiri - kanan, tinggi = H - atas - bawah
  const seri = seriAktif(d)
  const semua = seri.flatMap((s) => s.nilai.filter((v): v is number => v != null))
  const tampilHet = d.het != null && semua.length > 0 && d.het >= Math.min(...semua) * 0.85 && d.het <= Math.max(...semua) * 1.15
  const ref = tampilHet ? [...semua, d.het!] : semua
  let lo = Math.min(...ref), hi = Math.max(...ref)
  if (hi - lo < 200) { lo -= 100; hi += 100 }
  const langkah = langkahRapi(hi - lo)
  lo = Math.floor(lo / langkah) * langkah
  hi = Math.ceil(hi / langkah) * langkah
  const n = d.titik.length
  const x = (i: number) => kiri + (n <= 1 ? lebar / 2 : (i * lebar) / (n - 1))
  const y = (v: number) => atas + tinggi - ((v - lo) / (hi - lo)) * tinggi
  const o: string[] = []
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="DejaVu Sans, sans-serif">`)
  o.push(`<rect width="${W}" height="${H}" fill="${WARNA.latar}"/>`)
  o.push(`<rect width="${W}" height="8" fill="#163E66"/>`)
  o.push(`<text x="${kiri - 70}" y="62" font-size="34" font-weight="bold" fill="${WARNA.tinta}">Harga beras · ${esc(d.judul)}</text>`)
  const rentangTgl = n ? `${tglPanjang(d.titik[0].tanggal)} – ${tglPanjang(d.titik[n - 1].tanggal)}` : ""
  o.push(`<text x="${kiri - 70}" y="100" font-size="21" fill="${WARNA.tinta2}">Rata-rata harian, Rp/kg · ${esc(rentangTgl)}</text>`)
  // legenda
  let lx = kiri - 70
  for (const s of seri) {
    o.push(`<rect x="${lx}" y="120" width="26" height="6" rx="3" fill="${s.warna}"/>`)
    o.push(`<text x="${lx + 34}" y="129" font-size="19" fill="${WARNA.tinta}">${s.label}</text>`)
    lx += 34 + s.label.length * 11 + 36
  }
  if (tampilHet) {
    o.push(`<line x1="${lx}" y1="123" x2="${lx + 26}" y2="123" stroke="${WARNA.het}" stroke-width="3" stroke-dasharray="7 5"/>`)
    o.push(`<text x="${lx + 34}" y="129" font-size="19" fill="${WARNA.tinta}">HET medium</text>`)
  }
  // sumbu Y
  for (let v = lo; v <= hi + 0.5; v += langkah) {
    const yy = y(v).toFixed(1)
    o.push(`<line x1="${kiri}" y1="${yy}" x2="${W - kanan}" y2="${yy}" stroke="${WARNA.garis}" stroke-width="1.5"/>`)
    o.push(`<text x="${kiri - 14}" y="${Number(yy) + 7}" font-size="19" text-anchor="end" fill="${WARNA.tinta2}">${Math.round(v).toLocaleString("id-ID")}</text>`)
  }
  // sumbu X: maksimal 6 label tanggal
  const nLabel = Math.min(6, n)
  for (let j = 0; j < nLabel; j++) {
    const i = nLabel === 1 ? 0 : Math.round((j * (n - 1)) / (nLabel - 1))
    const anchor = j === 0 ? "start" : j === nLabel - 1 ? "end" : "middle"
    o.push(`<text x="${x(i).toFixed(1)}" y="${atas + tinggi + 36}" font-size="19" text-anchor="${anchor}" fill="${WARNA.tinta2}">${tglPendek(d.titik[i].tanggal)}</text>`)
  }
  if (tampilHet) {
    const yy = y(d.het!).toFixed(1)
    o.push(`<line x1="${kiri}" y1="${yy}" x2="${W - kanan}" y2="${yy}" stroke="${WARNA.het}" stroke-width="2.5" stroke-dasharray="9 7"/>`)
  }
  for (const s of seri) {
    // putus di hari tanpa data
    let jalur = "", turun = false
    s.nilai.forEach((v, i) => {
      if (v == null) { turun = false; return }
      jalur += `${turun ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`
      turun = true
    })
    o.push(`<path d="${jalur}" fill="none" stroke="${s.warna}" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"/>`)
    const iAkhir = s.nilai.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0).pop()
    if (iAkhir != null) {
      const v = s.nilai[iAkhir]!
      o.push(`<circle cx="${x(iAkhir).toFixed(1)}" cy="${y(v).toFixed(1)}" r="7" fill="${s.warna}" stroke="#fff" stroke-width="2.5"/>`)
      o.push(`<text x="${(x(iAkhir) - 12).toFixed(1)}" y="${(y(v) - 16).toFixed(1)}" font-size="21" font-weight="bold" text-anchor="end" fill="${s.warna}">${rp(v)}</text>`)
    }
  }
  o.push(`<text x="${kiri - 70}" y="${H - 26}" font-size="17" fill="${WARNA.tinta2}">Sumber: SISKAPERBAPO Jatim, diolah TERAWANG · terawang.tech</text>`)
  o.push(`</svg>`)
  return o.join("")
}

export function pngGrafik(svg: string): Buffer {
  const r = new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: "DejaVu Sans" }, fitTo: { mode: "original" } })
  return Buffer.from(r.render().asPng())
}

/** Keterangan gambar: angka terakhir, tertinggi/terendah, dan perubahan sepanjang rentang. */
export function teksGrafik(d: DataGrafik): string {
  const baris = [`📈 *Harga beras ${d.judul}*`, `${tglPanjang(d.titik[0].tanggal)} – ${tglPanjang(d.titik[d.titik.length - 1].tanggal)}`, ""]
  for (const s of seriAktif(d)) {
    const ada = d.titik.map((t, i) => ({ t: t.tanggal, v: s.nilai[i] })).filter((p): p is { t: string; v: number } => p.v != null)
    const awal = ada[0], akhir = ada[ada.length - 1]
    const maks = ada.reduce((a, b) => (b.v > a.v ? b : a)), min = ada.reduce((a, b) => (b.v < a.v ? b : a))
    const ubah = ((akhir.v - awal.v) / awal.v) * 100
    const arah = Math.abs(ubah) < 0.05 ? "stabil" : `${ubah > 0 ? "naik" : "turun"} ${nf(Math.abs(ubah))}%`
    baris.push(`*${s.label}*: ${rp(akhir.v)}/kg (${tglPendek(akhir.t)}), ${arah} dari ${rp(awal.v)}`)
    baris.push(`Tertinggi ${rp(maks.v)} (${tglPendek(maks.t)}), terendah ${rp(min.v)} (${tglPendek(min.t)})`)
  }
  if (d.het != null && d.jenis !== "premium") baris.push(`HET beras medium: ${rp(d.het)}/kg`)
  baris.push("", "Mau versi lain? Balas aja _setahun_, _premium aja_, _stoknya_, atau nama wilayah lain.")
  return baris.join("\n")
}
