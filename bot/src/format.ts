/** Templat jawaban WhatsApp (*tebal*, _miring_). Hanya merangkai angka dari data.ts. */
import type { InfoBerasMurah, InfoHarga, InfoStok, ItemPeringatan, Tingkat } from "./data.ts"

const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]

export const rp = (n: number | null | undefined) => (n === null || n === undefined ? "–" : "Rp" + Math.round(n).toLocaleString("id-ID"))
export const nf = (n: number | null | undefined, d = 1) =>
  n === null || n === undefined ? "–" : n.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d })
export const bulanTahun = (t: number, b: number) => `${BULAN[b - 1]} ${t}`
export function tgl(iso: string | null): string {
  if (!iso) return "–"
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number)
  return `${d} ${BULAN[m - 1].slice(0, 3)} ${y}`
}

const IKON: Record<string, string> = { AMAN: "🟢", WASPADA: "🟡", SIAGA: "🔴", CUKUP: "🟢", SURPLUS: "🟢", TIPIS: "🟡", DEFISIT: "🔴" }
const LABEL: Record<string, string> = { AMAN: "Aman", WASPADA: "Waspada", SIAGA: "Siaga", CUKUP: "Cukup", SURPLUS: "Surplus", TIPIS: "Tipis", DEFISIT: "Defisit" }
export const status = (s: string | null | undefined) => (s ? `${IKON[s] ?? ""} ${LABEL[s] ?? s}`.trim() : "–")

export function teksHarga(h: InfoHarga): string {
  if (h.medium_rp_kg === null && !h.prediksi.length) return `Belum ada data harga untuk ${h.wilayah}.`
  const baris = [
    `*Harga beras ${h.wilayah}*`,
    `_data ${tgl(h.tanggal_data)}_`,
    "",
    `Medium: *${rp(h.medium_rp_kg)}/kg*`,
    `Premium: ${rp(h.premium_rp_kg)}/kg`,
    `HET medium: ${rp(h.het_medium_rp_kg)}/kg${h.selisih_het_pct === null ? "" : ` (${h.selisih_het_pct > 0 ? "+" : ""}${nf(h.selisih_het_pct)}%)`}`,
  ]
  for (const p of h.prediksi) {
    const arah = h.medium_rp_kg === null ? "" : p.harga_rp_kg - h.medium_rp_kg > 100 ? "naik" : p.harga_rp_kg - h.medium_rp_kg < -100 ? "turun" : "stabil"
    baris.push(`${p.horizon_hari / 7} pekan lagi: ${arah ? arah + " ±" : "±"}${rp(p.harga_rp_kg)}`)
  }
  baris.push("", `Status: *${status(h.status_harga)}*`, "", "Balas *SPHP* untuk beras murah, *STOK* untuk stok, *LANGGANAN* untuk peringatan otomatis.")
  return baris.join("\n")
}

export function teksStok(s: InfoStok): string {
  if (!s.bulan_ini) return `Belum ada estimasi stok untuk ${s.wilayah}.`
  const b = s.bulan_ini
  const baris = [
    `*Stok beras ${s.wilayah}*`,
    `_${bulanTahun(b.tahun, b.bulan)}_`,
    "",
    `Perkiraan stok: ${b.stok_ton.toLocaleString("id-ID")} ton`,
    `Cukup untuk: *${nf(b.cakupan_bulan)} bulan* konsumsi`,
    `Status: *${status(b.status)}*`,
  ]
  if (s.bulan_defisit_pertama && (s.bulan_defisit_pertama.tahun !== b.tahun || s.bulan_defisit_pertama.bulan !== b.bulan)) {
    baris.push(`⚠ Diperkirakan defisit mulai *${bulanTahun(s.bulan_defisit_pertama.tahun, s.bulan_defisit_pertama.bulan)}*`)
  } else if (!s.bulan_defisit_pertama && s.proyeksi.length > 1) {
    const akhir = s.proyeksi[s.proyeksi.length - 1]
    baris.push(`Tidak ada defisit sampai ${bulanTahun(akhir.tahun, akhir.bulan)}.`)
  }
  baris.push("", `_${s.catatan}_`)
  return baris.join("\n")
}

export function teksBerasMurah(m: InfoBerasMurah): string {
  const baris = [`*Beras murah sekitar ${m.wilayah}*`, `Harga medium di sini: ${rp(m.harga_di_sini_rp_kg)}/kg`, ""]
  if (m.sekitar_lebih_murah.length) {
    baris.push("Wilayah terdekat yang lebih murah:")
    m.sekitar_lebih_murah.forEach((s, i) => baris.push(`${i + 1}. ${s.wilayah}: *${rp(s.harga_rp_kg)}/kg* · ${s.jarak_jalan_km} km (±${nf(s.waktu_tempuh_jam)} jam)`))
  } else {
    baris.push("Harga di wilayah sekitar tidak lebih murah dari sini.")
  }
  if (m.pasokan_sphp_masuk.length) {
    baris.push("", "Rekomendasi pasokan beras SPHP ke wilayah ini:")
    m.pasokan_sphp_masuk.slice(0, 3).forEach((s) => baris.push(`• dari ${s.dari}: ${s.volume_ton.toLocaleString("id-ID")} ton`))
  }
  baris.push("", `Beras SPHP dijual ${rp(m.harga_sphp_rp_kg)}/kg di pasar, RPK, dan Gerakan Pangan Murah.`)
  return baris.join("\n")
}

export function teksPeringatan(items: ItemPeringatan[], wilayah?: string): string {
  if (!items.length) return wilayah ? `Tidak ada peringatan aktif untuk ${wilayah}. ${status("AMAN")}` : `Tidak ada peringatan aktif di Jawa Timur saat ini. ${status("AMAN")}`
  const siaga = items.filter((i) => i.tingkat === "SIAGA")
  const waspada = items.filter((i) => i.tingkat === "WASPADA")
  const baris = [wilayah ? `*Peringatan ${wilayah}*` : `*Peringatan aktif Jawa Timur*`, ""]
  const daftar = (judul: string, xs: ItemPeringatan[], maks: number) => {
    if (!xs.length) return
    baris.push(judul)
    xs.slice(0, maks).forEach((x) => baris.push(`• ${wilayah ? x.judul : `${x.wilayah}: ${x.jenis === "HARGA" ? "harga" : "stok"}`}`))
    if (xs.length > maks) baris.push(`  _dan ${xs.length - maks} lainnya_`)
    baris.push("")
  }
  daftar(`${status("SIAGA")} (${siaga.length})`, siaga, wilayah ? 10 : 12)
  daftar(`${status("WASPADA")} (${waspada.length})`, waspada, wilayah ? 10 : 12)
  baris.push("Balas *HARGA <wilayah>* atau *STOK <wilayah>* untuk rinciannya.")
  return baris.join("\n").trim()
}

export function teksSiaran(items: ItemPeringatan[]): string {
  const siaga = items.some((i) => i.tingkat === "SIAGA")
  const baris = [siaga ? "⚠ *Peringatan TERAWANG*" : "*Ringkasan peringatan pekan ini*", ""]
  for (const i of items) baris.push(`${status(i.tingkat)} *${i.judul}*`, i.pesan, "")
  baris.push("Balas *SPHP* untuk beras murah terdekat, atau *BERHENTI* untuk berhenti berlangganan.")
  return baris.join("\n")
}

export const BANTUAN = [
  "*TERAWANG Jatim* · info beras dari sawah ke pasar",
  "",
  "Ketik salah satu:",
  "• *HARGA Malang* · harga beras dan prakiraannya",
  "• *STOK Jember* · cukup berapa bulan stok beras",
  "• *SPHP Kediri* · cari beras lebih murah",
  "• *PERINGATAN* · wilayah waspada/siaga",
  "• *LANGGANAN Blitar* · peringatan otomatis",
  "• *GRAFIK Malang* · grafik harga beras sebulan (atau _GRAFIK Malang 3 bulan_)",
  "• *LAPOR* · kirim harga di pasarmu",
  "• *BERHENTI* · berhenti berlangganan",
  "",
  "Bisa juga bertanya biasa, misalnya _beras di Surabaya naik nggak bulan depan?_",
].join("\n")

export function teksPilihWilayah(pilihan: { nama: string; jenis: "KABUPATEN" | "KOTA" }[], label: (w: { nama: string; jenis: "KABUPATEN" | "KOTA" }) => string): string {
  return ["Maksudnya wilayah yang mana? Balas dengan angkanya:", ...pilihan.map((w, i) => `${i + 1}. ${label(w)}`)].join("\n")
}

export const tingkatUrut: Record<Tingkat | "WASPADA" | "SIAGA", number> = { AMAN: 0, WASPADA: 1, SIAGA: 2 }

const BULAN_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]

/** Daftar peringkat kab/kota Jatim (termurah, termahal, stok paling tipis, ...). */
export function teksPeringkat(
  items: { wilayah: string; nilai: number; tanggal: string; status: string | null }[],
  ukuran: "harga_medium" | "harga_premium" | "stok_cakupan",
  urutan: "terendah" | "tertinggi",
): string {
  if (!items.length) return "Maaf, datanya belum tersedia untuk dibandingkan."
  const stok = ukuran === "stok_cakupan"
  const judul = stok
    ? urutan === "terendah" ? "Stok beras paling tipis" : "Stok beras paling longgar"
    : `Harga beras ${ukuran === "harga_premium" ? "premium" : "medium"} ${urutan === "terendah" ? "termurah" : "termahal"}`
  const t = items[0].tanggal
  const kapan = stok ? `${BULAN_ID[Number(t.slice(5, 7)) - 1]} ${t.slice(0, 4)}` : t.split("-").reverse().map((x, i) => (i === 1 ? BULAN_ID[Number(x) - 1] : x)).join(" ")
  return [
    `*${judul} di Jawa Timur* (${kapan})`,
    ...items.map((x, i) => `${i + 1}. ${x.wilayah}: ${stok ? `cukup ${nf(x.nilai)} bulan${x.status ? ` (${x.status.toLowerCase()})` : ""}` : `${rp(x.nilai)}/kg`}`),
    "",
    stok ? "Stok adalah perkiraan model, bukan angka resmi." : "",
    `Ketik *${stok ? "STOK" : "HARGA"} <wilayah>* untuk rinciannya.`,
  ].filter((s, i, a) => s !== "" || a[i - 1] !== "").join("\n").replace(/\n\n+/g, "\n\n")
}
