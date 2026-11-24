import { prisma } from "../db.js"
import { angkaWajib, bacaCsv, catat, periksa, petaKabkotaNama, sumberId } from "./util.js"

const BERKAS = "data/bps/penduduk/kabkota/tahunan/bps_jatim_penduduk_kabkota_tahunan_2020_2026.csv"
const KOLOM = [
  { tahun: 2020, jenis_angka: "HASIL_SENSUS" as const, kolom: "penduduk_2020_jiwa", total: 40_665_696 },
  { tahun: 2025, jenis_angka: "PROYEKSI" as const, kolom: "penduduk_2025_proyeksi_jiwa", total: 42_089_271 },
  { tahun: 2026, jenis_angka: "PROYEKSI" as const, kolom: "penduduk_2026_proyeksi_jiwa", total: 42_352_024 },
]

export async function ingestPenduduk(): Promise<void> {
  catat("== silver.penduduk")
  const sid = await sumberId("bps_jda_2026_penduduk")
  const wilayah = await petaKabkotaNama()
  const csv = bacaCsv(BERKAS)

  const data = csv.flatMap((r) => {
    const wid = wilayah.get(r.wilayah)
    if (wid === undefined) throw new Error(`wilayah tidak dikenal: ${r.wilayah}`)
    return KOLOM.map((k) => ({
      wilayah_id: wid,
      tahun: k.tahun,
      jenis_angka: k.jenis_angka,
      jumlah_jiwa: angkaWajib(r[k.kolom], k.kolom),
      jenis_data: "ASLI" as const,
      sumber_id: sid,
    }))
  })

  await prisma.penduduk.deleteMany({ where: { sumber_id: sid } })
  await prisma.penduduk.createMany({ data })

  catat("-- pemeriksaan penduduk")
  periksa((await prisma.penduduk.count()) === 114, "114 baris (38 wilayah x 3 tahun)")
  for (const k of KOLOM) {
    const s = await prisma.penduduk.aggregate({ where: { tahun: k.tahun }, _sum: { jumlah_jiwa: true } })
    periksa(s._sum.jumlah_jiwa === k.total, `total ${k.tahun} = ${k.total.toLocaleString("id-ID")} jiwa (sama dengan baris Jawa Timur di publikasi)`)
  }
}
