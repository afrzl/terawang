import { prisma } from "../db.js"
import { angka, angkaWajib, bacaCsv, bacaCsvGz, catat, periksa, petaKabkotaNama, petaWilayah, sisipkanBanyak, sumberId, tanggal } from "./util.js"

const DIR = "data/siskaperbapo/harga_beras"
const KOM = [
  { kode: "beras_medium", berkas: "beras_medium" },
  { kode: "beras_premium", berkas: "beras_premium" },
] as const

/** Nama kab/kota di SISKAPERBAPO ("Kabupaten Pacitan", "Kota Batu") menjadi penamaan BPS ("Pacitan", "Kota Batu"). */
const namaBps = (s: string): string => (s.startsWith("Kabupaten ") ? s.slice("Kabupaten ".length) : s)

export async function ingestHarga(): Promise<void> {
  catat("== silver.harga (pasar, harian per pasar, harian per kab/kota, provinsi)")
  const sid = await sumberId("siskaperbapo_harga_komoditas")
  const kab = await petaKabkotaNama()
  const kode = await petaWilayah()
  const jatim = kode.get("35")!
  const idKom = new Map((await prisma.komoditas.findMany()).map((k) => [k.kode, k.id]))
  const wid = (nama: string): number => {
    const id = kab.get(namaBps(nama))
    if (id === undefined) throw new Error(`kab/kota SISKAPERBAPO tidak dikenal: ${nama}`)
    return id
  }

  // ---- pasar (dari berkas mentah medium; himpunan pasar sama untuk premium)
  const mentah = new Map(KOM.map((k) => [k.kode, bacaCsvGz(`${DIR}/pasar_harian_${k.berkas}.csv.gz`)]))
  const pasarUnik = new Map<string, { wilayah_id: number; nama: string }>()
  for (const rows of mentah.values()) for (const r of rows) pasarUnik.set(`${wid(r.kabkota)}|${r.pasar}`, { wilayah_id: wid(r.kabkota), nama: r.pasar })
  await prisma.pasar.createMany({ data: [...pasarUnik.values()], skipDuplicates: true })
  const idPasar = new Map((await prisma.pasar.findMany()).map((p) => [`${p.wilayah_id}|${p.nama}`, p.id]))

  await prisma.hargaPasarHarian.deleteMany({ where: { sumber_id: sid } })
  await prisma.hargaKabkotaHarian.deleteMany({ where: { sumber_id: sid } })
  await prisma.hargaProvinsiHarian.deleteMany({ where: { sumber_id: sid } })

  const ringkas: Record<string, { pasarBaris: number; pasarKosong: number; pasarJumlah: number; kabBaris: number; kabJumlah: number; provBaris: number; provJumlah: number }> = {}

  for (const k of KOM) {
    const kid = idKom.get(k.kode)!
    // 1. harga per pasar per hari (mentah)
    const pasar = mentah.get(k.kode)!.map((r) => ({
      pasar_id: idPasar.get(`${wid(r.kabkota)}|${r.pasar}`)!, komoditas_id: kid, tanggal: tanggal(r.tanggal),
      harga_rp_kg: angka(r.harga_rp_kg), jenis_data: "ASLI" as const, sumber_id: sid,
    }))
    await sisipkanBanyak(pasar, (p) => prisma.hargaPasarHarian.createMany({ data: p }), 8000)

    // 2. rata-rata per kab/kota per hari (turunan)
    const kabRows = bacaCsv(`${DIR}/kabkota_harian_${k.berkas}.csv`).map((r) => ({
      wilayah_id: wid(r.kabkota), komoditas_id: kid, tanggal: tanggal(r.tanggal), harga_rata2_rp_kg: angka(r.harga_rata2_rp_kg),
      pasar_bernilai: angkaWajib(r.pasar_bernilai), pasar_total: angkaWajib(r.pasar_total), pasar_dikecualikan: angkaWajib(r.pasar_dikecualikan),
      jenis_data: "MODEL" as const, sumber_id: sid,
    }))
    await sisipkanBanyak(kabRows, (p) => prisma.hargaKabkotaHarian.createMany({ data: p }), 8000)

    // 3. angka provinsi yang dipublikasikan sumber
    const prov = bacaCsv(`${DIR}/provinsi_harian_${k.berkas}.csv`).map((r) => ({
      wilayah_id: jatim, komoditas_id: kid, tanggal: tanggal(r.tanggal), harga_rp_kg: angka(r.harga_provinsi_publikasi_rp_kg),
      jenis_data: "ASLI" as const, sumber_id: sid,
    }))
    await prisma.hargaProvinsiHarian.createMany({ data: prov })

    ringkas[k.kode] = {
      pasarBaris: pasar.length, pasarKosong: pasar.filter((x) => x.harga_rp_kg === null).length,
      pasarJumlah: pasar.reduce((a, x) => a + (x.harga_rp_kg ?? 0), 0),
      kabBaris: kabRows.length, kabJumlah: kabRows.reduce((a, x) => a + (x.harga_rata2_rp_kg ?? 0), 0),
      provBaris: prov.length, provJumlah: prov.reduce((a, x) => a + (x.harga_rp_kg ?? 0), 0),
    }
  }

  // ---------- pemeriksaan: setiap angka di database dibandingkan dengan yang dihitung dari CSV
  catat("-- pemeriksaan harga")
  periksa((await prisma.pasar.count()) === 121, "121 pasar di 38 kab/kota")
  periksa((await prisma.pasar.groupBy({ by: ["wilayah_id"] })).length === 38, "setiap kab/kota punya pasar")
  for (const k of KOM) {
    const kid = idKom.get(k.kode)!
    const e = ringkas[k.kode]
    const ps = await prisma.hargaPasarHarian.aggregate({ where: { komoditas_id: kid }, _count: true, _sum: { harga_rp_kg: true } })
    periksa(ps._count === 215_985 && e.pasarBaris === 215_985, `${k.kode}: 215.985 baris pasar-hari`)
    periksa(ps._sum.harga_rp_kg === e.pasarJumlah, `${k.kode}: jumlah harga pasar sama dengan CSV (${e.pasarJumlah.toLocaleString("id-ID")})`)
    const kosong = await prisma.hargaPasarHarian.count({ where: { komoditas_id: kid, harga_rp_kg: null } })
    periksa(kosong === e.pasarKosong, `${k.kode}: ${kosong.toLocaleString("id-ID")} sel pasar kosong, sama dengan CSV`)
    const ka = await prisma.hargaKabkotaHarian.aggregate({ where: { komoditas_id: kid }, _count: true, _sum: { harga_rata2_rp_kg: true } })
    periksa(ka._count === 67_830 && Math.abs((ka._sum.harga_rata2_rp_kg ?? 0) - e.kabJumlah) < 1, `${k.kode}: 67.830 baris kab/kota (38 x 1.785 hari), jumlah rata-rata sama dengan CSV`)
    const pv = await prisma.hargaProvinsiHarian.aggregate({ where: { komoditas_id: kid }, _count: true, _sum: { harga_rp_kg: true } })
    periksa(pv._count === 1_785 && pv._sum.harga_rp_kg === e.provJumlah, `${k.kode}: 1.785 hari angka provinsi, jumlah sama dengan CSV`)
    const rentang = await prisma.hargaProvinsiHarian.aggregate({ where: { komoditas_id: kid }, _min: { tanggal: true }, _max: { tanggal: true } })
    periksa(rentang._min.tanggal?.toISOString().slice(0, 10) === "2021-12-29" && rentang._max.tanggal?.toISOString().slice(0, 10) === "2026-11-17", `${k.kode}: 29 Des 2021 sampai 17 Nov 2026`)
  }
  // contoh nilai: Beras Medium Jawa Timur 17 Nov 2026 = 13.024 (angka provinsi sumber)
  const contoh = await prisma.hargaProvinsiHarian.findFirst({ where: { komoditas_id: idKom.get("beras_medium")!, tanggal: tanggal("2026-11-17") } })
  periksa(contoh?.harga_rp_kg === 13024, "contoh: Beras Medium Jawa Timur 17 Nov 2026 = Rp13.024 (sesuai halaman SISKAPERBAPO)")
}
