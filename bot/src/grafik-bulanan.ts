/**
 * Grafik bulanan stok (K2, app.estimasi_stok) dan produksi beras (K1, app.prediksi_produksi) untuk WhatsApp.
 * Semua titik dan angka diambil dari run model SELESAI terbaru, sama seperti dasbor (tanpa LLM).
 */
import { q } from "./db.ts"
import { nf } from "./format.ts"
import { esc, langkahRapi, WARNA } from "./grafik.ts"
import { labelWilayah, type Wilayah } from "./wilayah.ts"

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
const labelBulan = (t: number, b: number) => `${BULAN[b - 1]} ${String(t).slice(2)}`
const namaBulan = (t: number, b: number) => `${BULAN[b - 1]} ${t}`

export type TitikBulan = { tahun: number; bulan: number; nilai: number; bawah: number | null; atas: number | null; defisit?: boolean; cakupan?: number | null }
export type GrafikBulanan = {
  topik: "stok" | "produksi"
  judul: string
  wilayahId: number | null
  satuan: "bulan" | "ton"
  titik: TitikBulan[]
  /** indeks titik bulan berjalan; titik sesudahnya adalah proyeksi */
  iKini: number
  bulanLalu: number
  /** stok: batas aman = 1 bulan konsumsi (ton) */
  aman?: number | null
}

/** Bulan lalu yang ditampilkan dari rentang hari (bawaan 6 bulan), 3 sampai 24. */
export const bulanDariHari = (hari: number | null) => Math.min(Math.max(Math.round((hari ?? 180) / 30), 3), 24)

const KINI = `(extract(year from now() at time zone 'Asia/Jakarta') * 12 + extract(month from now() at time zone 'Asia/Jakarta'))::int`

function indeksKini(titik: { tahun: number; bulan: number }[]): number {
  const d = new Date(Date.now() + 7 * 3600_000)
  const kini = d.getUTCFullYear() * 12 + d.getUTCMonth() + 1
  let i = -1
  titik.forEach((t, j) => { if (t.tahun * 12 + t.bulan <= kini) i = j })
  return i
}

/**
 * Stok beras dalam ton: skenario TENGAH dengan pita RENDAH-TINGGI, plus cakupan (bulan konsumsi) per titik
 * dan batas aman = 1 bulan konsumsi (ton). Jawa Timur dijumlahkan dari 38 kab/kota.
 * Stok di bawah 0 dipotong 0 seperti dasbor. Konsumsi bulanan = stok_ton / cakupan_bulan (konstan per wilayah di model K2).
 */
export async function dataStok(w: Wilayah | null, bulanLalu: number): Promise<GrafikBulanan> {
  const rows = await q<{ tahun: number; bulan: number; tengah: number | null; rendah: number | null; tinggi: number | null; cak: number | null; defisit: boolean; konsumsi: number | null }>(
    `with run as (
       select m.id from app.model_run m where m.jenis = 'K2_STOK' and m.status = 'SELESAI'
          and exists (select 1 from app.estimasi_stok t where t.model_run_id = m.id)
        order by m.id desc limit 1
     ), kons as (
       select wilayah_id, avg(stok_ton / cakupan_bulan) as c
         from app.estimasi_stok
        where model_run_id = (select id from run) and skenario::text = 'TENGAH' and abs(cakupan_bulan) > 0.05
          and ($1::int is null or wilayah_id = $1)
        group by 1
     ), e as (
       select tahun, bulan, skenario::text as sk, wilayah_id, greatest(stok_ton, 0) as stok, greatest(cakupan_bulan, 0) as cak, status::text as status
         from app.estimasi_stok
        where model_run_id = (select id from run) and ($1::int is null or wilayah_id = $1)
          and (tahun * 12 + bulan) between ${KINI} - $2::int and ${KINI} + 6
     )
     select tahun, bulan,
            sum(stok) filter (where sk = 'TENGAH')::float8 as tengah,
            sum(stok) filter (where sk = 'RENDAH')::float8 as rendah,
            sum(stok) filter (where sk = 'TINGGI')::float8 as tinggi,
            ${w ? "max(cak) filter (where sk = 'TENGAH')::float8" : "null::float8"} as cak,
            ${w ? "bool_or(sk = 'TENGAH' and status = 'DEFISIT')" : "false"} as defisit,
            (select sum(c) from kons)::float8 as konsumsi
       from e group by 1, 2 order by 1, 2`,
    [w?.id ?? null, bulanLalu],
  )
  const konsumsi = rows[0]?.konsumsi ?? null
  const titik = rows.filter((r) => r.tengah != null).map((r) => ({
    tahun: r.tahun, bulan: r.bulan, nilai: r.tengah!, bawah: r.rendah, atas: r.tinggi,
    cakupan: r.cak ?? (konsumsi ? r.tengah! / konsumsi : null),
    defisit: w ? r.defisit : undefined,
  }))
  return { topik: "stok", judul: w ? labelWilayah(w) : "Jawa Timur (total 38 kab/kota)", wilayahId: w?.id ?? null, satuan: "ton", titik, iKini: indeksKini(titik), bulanLalu, aman: konsumsi }
}

/** Produksi beras bulanan estimasi K1 (ton) dengan pita batas bawah-atas; Jawa Timur dijumlahkan. */
export async function dataProduksi(w: Wilayah | null, bulanLalu: number): Promise<GrafikBulanan> {
  const rows = await q<{ tahun: number; bulan: number; nilai: number; bawah: number | null; atas: number | null }>(
    `with run as (
       select m.id from app.model_run m where m.jenis = 'K1_PRODUKSI' and m.status = 'SELESAI'
          and exists (select 1 from app.prediksi_produksi t where t.model_run_id = m.id)
        order by m.id desc limit 1
     )
     select tahun, bulan, sum(produksi_beras_ton)::float8 as nilai, sum(batas_bawah_ton)::float8 as bawah, sum(batas_atas_ton)::float8 as atas
       from app.prediksi_produksi
      where model_run_id = (select id from run) and ($1::int is null or wilayah_id = $1)
        and (tahun * 12 + bulan) between ${KINI} - $2::int and ${KINI} + 6
      group by 1, 2 order by 1, 2`,
    [w?.id ?? null, bulanLalu],
  )
  return { topik: "produksi", judul: w ? labelWilayah(w) : "Jawa Timur (total 38 kab/kota)", wilayahId: w?.id ?? null, satuan: "ton", titik: rows, iKini: indeksKini(rows), bulanLalu }
}

const fmtNilai = (v: number, satuan: "bulan" | "ton") =>
  satuan === "bulan" ? (v < 0.05 ? "habis" : `${nf(v)} bln`) : v >= 10_000 ? `${nf(v / 1000, 0)} rb ton` : `${Math.round(v).toLocaleString("id-ID")} ton`
const fmtCakupan = (c: number | null | undefined) => (c == null ? "" : c < 0.05 ? "habis" : `cukup ${nf(c)} bln`)
const fmtSumbu = (v: number, satuan: "bulan" | "ton", rb = v >= 10_000) =>
  satuan === "bulan" ? nf(v) : v === 0 ? "0" : rb ? `${nf(v / 1000, Number.isInteger(v / 1000) ? 0 : 1)} rb` : Math.round(v).toLocaleString("id-ID")

export function svgBulanan(d: GrafikBulanan): string {
  const W = 1080, H = 720
  const kiri = 118, kanan = 40, atas = 150, bawah = 96
  const lebar = W - kiri - kanan, tinggi = H - atas - bawah
  const warna = d.topik === "stok" ? "#2E7D4F" : "#7A5A12"
  const n = d.titik.length
  const semua = d.titik.flatMap((t) => [t.nilai, t.bawah, t.atas]).filter((v): v is number => v != null)
  const aman = d.topik !== "stok" ? null : d.satuan === "bulan" ? 1 : d.aman ?? null
  const garisAman = aman != null && aman > 0
  let lo = Math.min(0, ...semua), hi = Math.max(...semua, garisAman ? aman * 1.2 : 0)
  if (hi - lo <= 0) hi = lo + 1
  const langkah = langkahRapi(hi - lo)
  lo = Math.floor(lo / langkah) * langkah
  hi = Math.ceil(hi / langkah) * langkah
  const x = (i: number) => kiri + (n <= 1 ? lebar / 2 : (i * lebar) / (n - 1))
  const y = (v: number) => atas + tinggi - ((v - lo) / (hi - lo)) * tinggi
  // y garis tren pada posisi px (interpolasi linear), untuk menghindari label tertabrak garis
  const yGaris = (px: number) => {
    if (n <= 1) return y(d.titik[0]?.nilai ?? 0)
    const f = Math.min(Math.max(((px - kiri) / lebar) * (n - 1), 0), n - 1), i0 = Math.floor(f), i1 = Math.min(i0 + 1, n - 1)
    return y(d.titik[i0].nilai) + (y(d.titik[i1].nilai) - y(d.titik[i0].nilai)) * (f - i0)
  }
  const rentangGaris = (x0: number, x1: number) => {
    let a = Infinity, b = -Infinity
    for (let px = x0; px <= x1; px += 6) { const v = yGaris(px); a = Math.min(a, v); b = Math.max(b, v) }
    return [a, b] as const
  }
  const o: string[] = []
  const judul = d.topik === "stok" ? "Stok beras" : "Produksi beras"
  const sub = d.topik === "stok"
    ? `${d.satuan === "bulan" ? "Bulan konsumsi" : "Ton"} per bulan · estimasi model, skenario tengah (pita: rendah–tinggi)`
    : "Ton per bulan · estimasi model K1 (pita: batas bawah–atas)"
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="DejaVu Sans, sans-serif">`)
  o.push(`<rect width="${W}" height="${H}" fill="${WARNA.latar}"/><rect width="${W}" height="8" fill="#163E66"/>`)
  o.push(`<text x="${kiri - 70}" y="62" font-size="34" font-weight="bold" fill="${WARNA.tinta}">${judul} · ${esc(d.judul)}</text>`)
  o.push(`<text x="${kiri - 70}" y="100" font-size="21" fill="${WARNA.tinta2}">${esc(sub)}</text>`)
  // daerah proyeksi
  if (d.iKini >= 0 && d.iKini < n - 1) {
    const x0 = x(d.iKini)
    o.push(`<rect x="${x0.toFixed(1)}" y="${atas}" width="${(W - kanan - x0).toFixed(1)}" height="${tinggi}" fill="#EEF3F0"/>`)
    o.push(`<text x="${(x0 + 10).toFixed(1)}" y="${atas + 26}" font-size="18" fill="${WARNA.tinta2}">proyeksi</text>`)
  }
  for (let v = lo; v <= hi + langkah / 1000; v += langkah) {
    const yy = y(v).toFixed(1)
    o.push(`<line x1="${kiri}" y1="${yy}" x2="${W - kanan}" y2="${yy}" stroke="${WARNA.garis}" stroke-width="1.5"/>`)
    o.push(`<text x="${kiri - 14}" y="${Number(yy) + 7}" font-size="19" text-anchor="end" fill="${WARNA.tinta2}">${fmtSumbu(v, d.satuan, hi >= 10_000)}</text>`)
  }
  // label bulan: maksimal 8
  const lompat = Math.max(1, Math.ceil(n / 8))
  d.titik.forEach((t, i) => {
    if (i % lompat && i !== n - 1) return
    const anchor = i === 0 ? "start" : i === n - 1 ? "end" : "middle"
    o.push(`<text x="${x(i).toFixed(1)}" y="${atas + tinggi + 36}" font-size="18" text-anchor="${anchor}" fill="${WARNA.tinta2}">${labelBulan(t.tahun, t.bulan)}</text>`)
  })
  // legenda
  let lx = kiri - 70
  o.push(`<rect x="${lx}" y="120" width="26" height="6" rx="3" fill="${warna}"/><text x="${lx + 34}" y="129" font-size="19" fill="${WARNA.tinta}">${d.topik === "stok" ? "Skenario tengah" : "Estimasi"}</text>`)
  lx += 34 + 200
  if (garisAman) {
    o.push(`<line x1="${lx}" y1="123" x2="${lx + 26}" y2="123" stroke="${WARNA.het}" stroke-width="3" stroke-dasharray="7 5"/><text x="${lx + 34}" y="129" font-size="19" fill="${WARNA.tinta}">Batas aman (1 bln konsumsi)</text>`)
    lx += 34 + 290
  }
  if (d.titik.some((t) => t.defisit)) o.push(`<circle cx="${lx + 8}" cy="123" r="7" fill="${WARNA.het}"/><text x="${lx + 24}" y="129" font-size="19" fill="${WARNA.tinta}">Defisit</text>`)
  // pita
  const pita = d.titik.map((t, i) => ({ i, b: t.bawah, a: t.atas })).filter((p): p is { i: number; b: number; a: number } => p.b != null && p.a != null)
  if (pita.length > 1) {
    const naik = pita.map((p, j) => `${j ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.a).toFixed(1)}`).join("")
    const turun = [...pita].reverse().map((p) => `L${x(p.i).toFixed(1)},${y(p.b).toFixed(1)}`).join("")
    o.push(`<path d="${naik}${turun}Z" fill="${warna}" fill-opacity="0.16"/>`)
  }
  if (garisAman) {
    const yy = y(aman).toFixed(1)
    o.push(`<line x1="${kiri}" y1="${yy}" x2="${W - kanan}" y2="${yy}" stroke="${WARNA.het}" stroke-width="2.5" stroke-dasharray="9 7"/>`)
    if (d.satuan === "ton") {
      // pilih sisi (kiri/kanan) dan posisi (atas/bawah garis) yang paling jauh dari garis tren
      const teks = fmtNilai(aman, "ton"), lb = teks.length * 10 + 12, y0 = Number(yy)
      const calon = [
        { x: kiri + 8, anchor: "start", x0: kiri, x1: kiri + lb },
        { x: W - kanan - 8, anchor: "end", x0: W - kanan - lb, x1: W - kanan },
      ].flatMap((c) => [{ ...c, ty: y0 - 8, a: y0 - 24, b: y0 }, { ...c, ty: y0 + 22, a: y0, b: y0 + 26 }])
        .map((c) => { const [ga, gb] = rentangGaris(c.x0, c.x1); return { ...c, jarak: gb < c.a ? c.a - gb : ga > c.b ? ga - c.b : -1 } })
        .sort((p, q) => q.jarak - p.jarak)
      const c = calon[0]
      o.push(`<text x="${c.x}" y="${c.ty.toFixed(1)}" font-size="17" text-anchor="${c.anchor}" fill="${WARNA.het}" stroke="${WARNA.latar}" stroke-width="4" paint-order="stroke">${teks}</text>`)
    }
  }
  o.push(`<path d="${d.titik.map((t, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(t.nilai).toFixed(1)}`).join("")}" fill="none" stroke="${warna}" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"/>`)
  d.titik.forEach((t, i) => {
    o.push(`<circle cx="${x(i).toFixed(1)}" cy="${y(t.nilai).toFixed(1)}" r="${t.defisit ? 7 : 4.5}" fill="${t.defisit ? WARNA.het : warna}" stroke="#fff" stroke-width="2"/>`)
  })
  if (d.iKini >= 0) {
    const t = d.titik[d.iKini]
    const cak = d.topik === "stok" && d.satuan === "ton" ? fmtCakupan(t.cakupan) : ""
    const lbl = fmtNilai(t.nilai, d.satuan) + (cak ? ` · ${cak}` : "")
    // geser label agar tidak terpotong di tepi
    const lx0 = Math.min(Math.max(x(d.iKini), kiri + lbl.length * 6.2), W - kanan - lbl.length * 6.2)
    const hw = lbl.length * 6.2 + 6
    const [ga, gb] = rentangGaris(lx0 - hw, lx0 + hw)
    const ly = ga - 16 < atas + 40 ? gb + 32 : ga - 16
    const yt = y(t.nilai), px = x(d.iKini)
    const [u0, u1] = ly < yt ? [ly + 8, yt - 9] : [yt + 9, ly - 22]
    if (u1 - u0 > 14) o.push(`<line x1="${px.toFixed(1)}" y1="${u0.toFixed(1)}" x2="${px.toFixed(1)}" y2="${u1.toFixed(1)}" stroke="${warna}" stroke-width="1.5" stroke-dasharray="3 3"/>`)
    o.push(`<text x="${lx0.toFixed(1)}" y="${ly.toFixed(1)}" font-size="21" font-weight="bold" text-anchor="middle" fill="${warna}" stroke="${WARNA.latar}" stroke-width="5" paint-order="stroke">${esc(lbl)}</text>`)
  }
  const sumber = d.topik === "stok" ? "Model neraca stok TERAWANG (K2); stok awal kab/kota adalah asumsi" : "Model estimasi produksi TERAWANG (K1), citra satelit + BPS"
  o.push(`<text x="${kiri - 70}" y="${H - 26}" font-size="17" fill="${WARNA.tinta2}">Sumber: ${esc(sumber)} · terawang.tech</text>`)
  o.push(`</svg>`)
  return o.join("")
}

export function teksBulanan(d: GrafikBulanan): string {
  const awal = d.titik[0], akhir = d.titik[d.titik.length - 1]
  const kini = d.iKini >= 0 ? d.titik[d.iKini] : null
  const judul = d.topik === "stok" ? "Stok beras" : "Produksi beras"
  const baris = [`📊 *${judul} ${d.judul}*`, `${namaBulan(awal.tahun, awal.bulan)} – ${namaBulan(akhir.tahun, akhir.bulan)}`, ""]
  if (kini) {
    const c = d.topik === "stok" ? kini.cakupan : null
    const ket = c == null ? "" : c < 0.05 ? " (stok habis)" : ` (cukup ${nf(c)} bulan konsumsi)`
    baris.push(`Bulan ini (${namaBulan(kini.tahun, kini.bulan)}): *${fmtNilai(kini.nilai, d.satuan)}*${ket}`)
  }
  const maks = d.titik.reduce((a, b) => (b.nilai > a.nilai ? b : a)), min = d.titik.reduce((a, b) => (b.nilai < a.nilai ? b : a))
  const fmtT = (v: number) => (d.topik === "stok" && v < 0.5 ? "habis (0 ton)" : fmtNilai(v, d.satuan))
  baris.push(`Tertinggi ${fmtT(maks.nilai)} (${namaBulan(maks.tahun, maks.bulan)}), terendah ${fmtT(min.nilai)} (${namaBulan(min.tahun, min.bulan)})`)
  if (d.topik === "stok") {
    const def = d.titik.slice(Math.max(d.iKini, 0)).find((t) => t.defisit)
    if (d.aman) baris.push(`Batas aman: ${fmtNilai(d.aman, "ton")} (1 bulan konsumsi)`)
    if (d.wilayahId != null) baris.push(def ? `⚠️ Proyeksi defisit mulai ${namaBulan(def.tahun, def.bulan)}` : "Tidak ada proyeksi defisit di rentang ini")
    else if (d.aman) {
      const tipis = d.titik.slice(Math.max(d.iKini, 0)).find((t) => t.nilai < d.aman!)
      if (tipis) baris.push(`⚠️ Total Jatim diproyeksi di bawah batas aman mulai ${namaBulan(tipis.tahun, tipis.bulan)}`)
    }
    baris.push("_Estimasi model, skenario tengah. Stok awal kab/kota adalah asumsi, bukan angka resmi._")
  } else {
    baris.push("_Estimasi model K1, bukan angka resmi BPS._")
  }
  baris.push("", "Mau lihat yang lain? Balas aja _harganya_, _produksinya_, _setahun_, atau nama wilayah lain.")
  return baris.join("\n")
}
