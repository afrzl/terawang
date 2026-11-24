import { prisma } from "../db.js"
import { angkaWajib, bacaCsv, catat, periksa, petaKabkotaNama, sumberId } from "./util.js"

const DIR = "data/geografi/jarak_kabkota"

/** Matriks lebar (kolom pertama "dari", sisanya nama tujuan) menjadi peta "dari|ke" -> nilai. */
function matriks(berkas: string): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of bacaCsv(`${DIR}/${berkas}`)) {
    for (const [ke, v] of Object.entries(r)) if (ke !== "dari") m.set(`${r.dari}|${ke}`, angkaWajib(v, `${berkas} ${r.dari}->${ke}`))
  }
  return m
}

export async function ingestJarak(): Promise<void> {
  catat("== silver.jarak_antar_wilayah")
  const sid = await sumberId("terawang_jarak_osrm")
  const w = await petaKabkotaNama()
  const lurus = matriks("jarak_garis_lurus_km_kabkota.csv")
  const jalan = matriks("jarak_jalan_km_kabkota.csv")
  const waktu = matriks("waktu_tempuh_jam_kabkota.csv")
  if (lurus.size !== 1444 || jalan.size !== 1444 || waktu.size !== 1444) throw new Error("matriks bukan 38 x 38")

  const data = [...lurus.keys()].map((k) => {
    const [dari, ke] = k.split("|")
    const did = w.get(dari), kid = w.get(ke)
    if (did === undefined || kid === undefined) throw new Error(`wilayah tidak dikenal: ${k}`)
    return {
      dari_id: did, ke_id: kid, jarak_garis_lurus_km: lurus.get(k)!, jarak_jalan_km: jalan.get(k)!, waktu_tempuh_jam: waktu.get(k)!,
      jenis_data: "MODEL" as const, sumber_id: sid,
    }
  })

  await prisma.jarakAntarWilayah.deleteMany({ where: { sumber_id: sid } })
  await prisma.jarakAntarWilayah.createMany({ data })

  catat("-- pemeriksaan jarak")
  periksa((await prisma.jarakAntarWilayah.count()) === 1444, "1.444 pasangan (38 x 38)")
  const diag = await prisma.jarakAntarWilayah.findMany({ where: { jarak_jalan_km: 0 } })
  periksa(diag.length === 38 && diag.every((d) => d.dari_id === d.ke_id), "diagonal: 38 pasangan jarak nol, semuanya wilayah yang sama")
  const lebihPendek = await prisma.$queryRaw<{ n: bigint }[]>`select count(*)::bigint as n from silver.jarak_antar_wilayah where jarak_jalan_km < jarak_garis_lurus_km * 0.97 and dari_id <> ke_id`
  periksa(Number(lebihPendek[0].n) === 0, "jarak jalan tidak pernah lebih pendek dari garis lurus")
  const sm = await prisma.jarakAntarWilayah.findFirst({ where: { dari: { nama: "Kota Surabaya" }, ke: { nama: "Kota Malang" } } })
  periksa(sm?.jarak_jalan_km === jalan.get("Kota Surabaya|Kota Malang") && (sm?.jarak_jalan_km ?? 0) > 80 && (sm?.jarak_jalan_km ?? 0) < 100, `Surabaya-Malang jalan ${sm?.jarak_jalan_km} km (80-100 km wajar)`)
}
