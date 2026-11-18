import { prisma } from "../db.js"
import { SUMBER } from "./sumber.js"
import { bacaCsv, bacaJson, catat, periksa, tanggal } from "./util.js"

interface Provinsi {
  kode: string
  nama: string
}
interface FiturGeo {
  properties: { n: string }
  geometry: unknown
}

const KOMODITAS = [
  { kode: "beras_medium", nama: "Beras Medium", satuan: "kg", kode_siskaperbapo: 4 },
  { kode: "beras_premium", nama: "Beras Premium", satuan: "kg", kode_siskaperbapo: 2 },
]

/** Kode BPS kab/kota Jawa Timur menurut urutan publikasi BPS: 3501-3529 (kabupaten) dan 3571-3579 (kota). */
function kodeKabkota(urutan: number): string {
  return String(urutan < 29 ? 3501 + urutan : 3571 + (urutan - 29))
}

export async function ingestRef(): Promise<void> {
  catat("== ref: sumber, komoditas, wilayah")

  for (const s of SUMBER) {
    const data = {
      nama: s.nama,
      penerbit: s.penerbit,
      nomor_rilis: s.nomor_rilis ?? null,
      url: s.url ?? null,
      tanggal_terbit: s.tanggal_terbit ? tanggal(s.tanggal_terbit) : null,
      tanggal_ambil: tanggal(s.tanggal_ambil),
      catatan: s.catatan ?? null,
    }
    await prisma.sumber.upsert({ where: { kode: s.kode }, create: { kode: s.kode, ...data }, update: data })
  }

  for (const k of KOMODITAS) {
    await prisma.komoditas.upsert({ where: { kode: k.kode }, create: k, update: k })
  }

  const indonesia = await prisma.wilayah.upsert({
    where: { kode: "00" },
    create: { kode: "00", nama: "Indonesia", level: "NASIONAL" },
    update: { nama: "Indonesia", level: "NASIONAL" },
  })

  const provinsi = bacaJson<Provinsi[]>("api/seed/provinsi.json")
  const idProvinsi = new Map<string, number>()
  for (const p of provinsi) {
    const w = await prisma.wilayah.upsert({
      where: { kode: p.kode },
      create: { kode: p.kode, nama: p.nama, level: "PROVINSI", induk_id: indonesia.id },
      update: { nama: p.nama, level: "PROVINSI", induk_id: indonesia.id },
    })
    idProvinsi.set(p.kode, w.id)
  }
  const idJatim = idProvinsi.get("35")
  if (idJatim === undefined) throw new Error("provinsi Jawa Timur (35) tidak ada di seed")

  // 38 kab/kota: nama, jenis, nama_repo dari CSV penduduk (urutan BPS); titik pusat dari CSV jarak; batas dari kab.geojson
  const daftar = bacaCsv("data/bps/penduduk/kabkota/tahunan/bps_jatim_penduduk_kabkota_tahunan_2020_2026.csv")
  if (daftar.length !== 38) throw new Error(`diharapkan 38 kab/kota, ada ${daftar.length}`)
  const pusat = new Map(bacaCsv("data/geografi/jarak_kabkota/titik_pusat_kabkota_jatim.csv").map((r) => [r.wilayah, r]))
  const batas = new Map(
    bacaJson<{ features: FiturGeo[] }>("public/citra/jatim/kab.geojson").features.map((f) => [f.properties.n, f.geometry]),
  )

  for (const [i, r] of daftar.entries()) {
    const kode = kodeKabkota(i)
    const jenis = r.jenis === "kota" ? "KOTA" : "KABUPATEN"
    if ((i < 29) !== (jenis === "KABUPATEN")) throw new Error(`urutan jenis tidak sesuai di ${r.wilayah}`)
    const p = pusat.get(r.wilayah)
    const geo = batas.get(r.nama_repo)
    if (!p || !geo) throw new Error(`titik pusat atau batas tidak ditemukan: ${r.wilayah}`)
    const data = {
      nama: r.wilayah,
      nama_repo: r.nama_repo,
      level: "KABKOTA" as const,
      jenis: jenis as "KOTA" | "KABUPATEN",
      induk_id: idJatim,
      lon: Number(p.lon),
      lat: Number(p.lat),
      batas_geojson: geo as object,
    }
    await prisma.wilayah.upsert({ where: { kode }, create: { kode, ...data }, update: data })
  }

  // ---- pemeriksaan
  catat("-- pemeriksaan ref")
  periksa((await prisma.sumber.count()) === SUMBER.length, `sumber: ${SUMBER.length} baris`)
  periksa((await prisma.komoditas.count()) === KOMODITAS.length, `komoditas: ${KOMODITAS.length} baris`)
  periksa((await prisma.wilayah.count()) === 77, "wilayah: 77 baris (1 nasional + 38 provinsi + 38 kab/kota)")
  periksa((await prisma.wilayah.count({ where: { level: "PROVINSI" } })) === 38, "38 provinsi")
  periksa((await prisma.wilayah.count({ where: { induk_id: idJatim } })) === 38, "38 kab/kota di bawah Jawa Timur")
  periksa(
    (await prisma.wilayah.count({ where: { level: "KABKOTA", lon: { not: null }, lat: { not: null }, batas_geojson: { not: undefined } } })) === 38,
    "38 kab/kota punya titik pusat dan batas",
  )
  const sby = await prisma.wilayah.findUnique({ where: { kode: "3578" } })
  periksa(sby?.nama === "Kota Surabaya" && sby.jenis === "KOTA", "kode 3578 = Kota Surabaya (jenis KOTA)")
  const btu = await prisma.wilayah.findUnique({ where: { kode: "3579" } })
  periksa(btu?.nama === "Kota Batu" && btu.nama_repo === "Batu", "kode 3579 = Kota Batu (nama_repo Batu)")
}
