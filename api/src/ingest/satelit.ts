import { prisma } from "../db.js"
import type { Prisma } from "../../generated/prisma/client.js"
import { bacaJson, catat, periksa, sumberId, tanggal } from "./util.js"

interface Gee {
  acuan: string
  wilayah: {
    n: string
    ha: number
    ip: number
    ph: number[]
    lag: number
    est: number
    prev: number
    cakupan_s2: number
    vh: (number | null)[]
    vhAvg: (number | null)[]
  }[]
}

export async function ingestSatelit(): Promise<void> {
  catat("== silver.satelit_wilayah")
  const sid = await sumberId("gee_terawang_wilayah")
  const gee = bacaJson<Gee>("src/lib/gee_wilayah.json")
  const w = new Map((await prisma.wilayah.findMany({ where: { level: "KABKOTA" }, select: { id: true, nama_repo: true } })).map((x) => [x.nama_repo, x.id]))

  const data = gee.wilayah.map((g) => {
    const wid = w.get(g.n)
    if (wid === undefined) throw new Error(`wilayah GEE tidak dikenal: ${g.n}`)
    if (g.ph.length !== 5) throw new Error(`fase ${g.n} tidak 5 kelas`)
    return {
      wilayah_id: wid,
      tanggal_acuan: tanggal(gee.acuan),
      luas_sawah_proksi_ha: g.ha,
      indeks_pertanaman: g.ip,
      fase_bera_pct: g.ph[0],
      fase_olah_pct: g.ph[1],
      fase_vegetatif_pct: g.ph[2],
      fase_generatif_pct: g.ph[3],
      fase_siap_panen_pct: g.ph[4],
      petak_tertinggal_pct: g.lag,
      proyeksi_panen_ribu_ton: g.est,
      proyeksi_panen_lalu_ribu_ton: g.prev,
      cakupan_s2: g.cakupan_s2,
      vh_db: g.vh as Prisma.InputJsonValue,
      vh_rata3tahun_db: g.vhAvg as Prisma.InputJsonValue,
      jenis_data: "MODEL" as const,
      sumber_id: sid,
      catatan: "Produktivitas konstan 5,6 t/ha pada proyeksi panen (placeholder). Aturan ambang belum divalidasi lapangan.",
    }
  })

  await prisma.satelitWilayah.deleteMany({ where: { sumber_id: sid } })
  await prisma.satelitWilayah.createMany({ data })

  catat("-- pemeriksaan satelit")
  periksa((await prisma.satelitWilayah.count()) === 38, "38 kab/kota")
  const jumlahHa = gee.wilayah.reduce((a, g) => a + g.ha, 0)
  const db = await prisma.satelitWilayah.aggregate({ _sum: { luas_sawah_proksi_ha: true } })
  periksa(db._sum.luas_sawah_proksi_ha === jumlahHa, `jumlah luas sawah proksi = ${jumlahHa.toLocaleString("id-ID")} ha (sama dengan gee_wilayah.json)`)
  const fase = await prisma.satelitWilayah.findMany({ select: { fase_bera_pct: true, fase_olah_pct: true, fase_vegetatif_pct: true, fase_generatif_pct: true, fase_siap_panen_pct: true } })
  const jumlahFase = fase.map((f) => f.fase_bera_pct + f.fase_olah_pct + f.fase_vegetatif_pct + f.fase_generatif_pct + f.fase_siap_panen_pct)
  periksa(jumlahFase.every((x) => Math.abs(x - 100) < 0.05), "persentase 5 fase tumbuh berjumlah 100% di semua wilayah")
  const t = await prisma.satelitWilayah.findFirst({ select: { tanggal_acuan: true } })
  periksa(t?.tanggal_acuan.toISOString().slice(0, 10) === gee.acuan, `tanggal acuan ${gee.acuan}`)
}
