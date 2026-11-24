import { prisma } from "../db.js"
import { angkaWajib, bacaCsv, catat, periksa, petaWilayah, sumberId } from "./util.js"

const DIR = "data/bulog"

export async function ingestBulog(): Promise<void> {
  catat("== silver.bulog")
  const sid = await sumberId("bps_jda_2026_bulog")
  const kode = await petaWilayah()
  const jatimProv = kode.get("35")!

  // kantor wilayah (26, tanpa baris Indonesia) dan kantor cabang (13, semuanya di Kanwil Jawa Timur)
  const stokKanwil = bacaCsv(`${DIR}/stok_beras/kanwil/tahunan/bulog_nasional_stok_beras_kanwil_tahunan_2023_2025.csv`)
  const baris26 = stokKanwil.filter((r) => r.kantor_wilayah !== "Indonesia")
  const totalIndonesia = stokKanwil.find((r) => r.kantor_wilayah === "Indonesia")
  if (baris26.length !== 26 || !totalIndonesia) throw new Error("diharapkan 26 kantor wilayah + baris Indonesia")
  const idKanwil = new Map<string, number>()
  for (const r of baris26) {
    const data = { nama: r.kantor_wilayah, wilayah_provinsi_id: r.kantor_wilayah === "Jawa Timur" ? jatimProv : null }
    const k = await prisma.kantorWilayahBulog.upsert({ where: { nama: r.kantor_wilayah }, create: data, update: data })
    idKanwil.set(r.kantor_wilayah, k.id)
  }
  const kanwilJatim = idKanwil.get("Jawa Timur")!

  const pengadaan = bacaCsv(`${DIR}/pengadaan_beras/kantor_cabang/tahunan/bulog_jatim_pengadaan_beras_kantorcabang_tahunan_2024_2025.csv`)
  const idCabang = new Map<string, number>()
  for (const r of pengadaan) {
    const c = await prisma.kantorCabangBulog.upsert({
      where: { nama: r.kantor_cabang }, create: { nama: r.kantor_cabang, kanwil_id: kanwilJatim }, update: { kanwil_id: kanwilJatim },
    })
    idCabang.set(r.kantor_cabang, c.id)
  }

  // bersihkan data fakta sumber ini
  await prisma.stokBulogBulanan.deleteMany({ where: { sumber_id: sid } })
  await prisma.stokBulogKanwil.deleteMany({ where: { sumber_id: sid } })
  await prisma.pengadaanBulog.deleteMany({ where: { sumber_id: sid } })
  await prisma.hargaPenggilinganBulog.deleteMany({ where: { sumber_id: sid } })
  await prisma.hargaPembelianPemerintah.deleteMany({ where: { sumber_id: sid } })

  // 1. stok bulanan Jatim 2025 (Tabel 10.1.3)
  await prisma.stokBulogBulanan.createMany({
    data: bacaCsv(`${DIR}/stok_beras/provinsi/bulanan/bulog_jatim_stok_beras_provinsi_bulanan_2025.csv`).map((r) => ({
      kanwil_id: kanwilJatim, tahun: angkaWajib(r.tahun), bulan: angkaWajib(r.bulan),
      persediaan_awal_kg: angkaWajib(r.persediaan_awal_kg), pemasukan_kg: angkaWajib(r.pemasukan_kg),
      persediaan_dikuasai_kg: angkaWajib(r.persediaan_dikuasai_kg), pengeluaran_kg: angkaWajib(r.pengeluaran_kg),
      persediaan_akhir_kg: angkaWajib(r.persediaan_akhir_kg), jenis_data: "ASLI" as const, sumber_id: sid,
    })),
  })

  // 2. stok per kantor wilayah (Tabel 10.1.7)
  await prisma.stokBulogKanwil.createMany({
    data: baris26.flatMap((r) =>
      [2023, 2024, 2025].map((th) => ({ kanwil_id: idKanwil.get(r.kantor_wilayah)!, tahun: th, stok_kg: angkaWajib(r[`stok_${th}_kg`]), jenis_data: "ASLI" as const, sumber_id: sid })),
    ),
  })

  // 3. pengadaan per cabang dan saluran (Tabel 10.1.6)
  const SALURAN = [["kud", "KUD"], ["non_kud_ktna", "NON_KUD_KTNA"], ["satgas_upgb_draying", "SATGAS_UPGB_DRAYING"]] as const
  await prisma.pengadaanBulog.createMany({
    data: pengadaan.flatMap((r) =>
      SALURAN.flatMap(([pfx, saluran]) =>
        [2024, 2025].map((th) => ({ cabang_id: idCabang.get(r.kantor_cabang)!, tahun: th, saluran, volume_kg: angkaWajib(r[`${pfx}_${th}_kg`]), jenis_data: "ASLI" as const, sumber_id: sid })),
      ),
    ),
  })

  // 4. harga beras di penggilingan per cabang (Tabel 10.1.5). 2025 persis 2024 x 1,02 (bukan pengamatan independen)
  await prisma.hargaPenggilinganBulog.createMany({
    data: bacaCsv(`${DIR}/harga_penggilingan/kantor_cabang/tahunan/bulog_jatim_harga_beras_penggilingan_kantorcabang_tahunan_2023_2025.csv`).flatMap((r) =>
      [2023, 2024, 2025].map((th) => ({
        cabang_id: idCabang.get(r.kantor_cabang)!, tahun: th, harga_rp_kg: angkaWajib(r[`harga_${th}_rp_kg`]), jenis_data: "ASLI" as const, sumber_id: sid,
        catatan: th === 2025 ? "Persis 2024 x 1,02 di semua cabang: bukan pengamatan independen" : null,
      })),
    ),
  })

  // 5. harga dasar dan pembelian pemerintah (Tabel 10.1.4)
  await prisma.hargaPembelianPemerintah.createMany({
    data: bacaCsv(`${DIR}/harga_acuan/provinsi/tahunan/bulog_jatim_harga_pembelian_pemerintah_gabah_beras_provinsi_tahunan_1999_2025.csv`).map((r) => ({
      tahun: angkaWajib(r.tahun), keterangan: r.keterangan, harga_dasar_gabah_rp_kg: angkaWajib(r.harga_dasar_gabah_rp_kg),
      gabah_kud_rp_kg: angkaWajib(r.gabah_kud_rp_kg), gabah_non_kud_rp_kg: angkaWajib(r.gabah_non_kud_rp_kg),
      beras_kud_rp_kg: angkaWajib(r.beras_kud_rp_kg), beras_non_kud_rp_kg: angkaWajib(r.beras_non_kud_rp_kg), jenis_data: "ASLI" as const, sumber_id: sid,
    })),
  })

  // ---------- pemeriksaan
  catat("-- pemeriksaan bulog")
  periksa((await prisma.kantorWilayahBulog.count()) === 26 && (await prisma.kantorCabangBulog.count()) === 13, "26 kantor wilayah dan 13 kantor cabang")
  periksa((await prisma.stokBulogBulanan.count()) === 12, "stok bulanan: 12 bulan")
  const b = await prisma.stokBulogBulanan.findMany({ orderBy: { bulan: "asc" } })
  periksa(b.every((x, i) => Math.abs(x.persediaan_awal_kg + x.pemasukan_kg - x.persediaan_dikuasai_kg) < 0.05 && Math.abs(x.persediaan_dikuasai_kg - x.pengeluaran_kg - x.persediaan_akhir_kg) < 0.05 && (i === 11 || Math.abs(x.persediaan_akhir_kg - b[i + 1].persediaan_awal_kg) < 0.05)),
    "awal + pemasukan = dikuasai; dikuasai - pengeluaran = akhir; akhir bulan t = awal bulan t+1 (12 bulan)")
  periksa(Math.round(b[11].persediaan_akhir_kg) === 796_367_296, "stok akhir Des 2025 = 796.367.296 kg (796,4 ribu ton)")
  periksa((await prisma.stokBulogKanwil.count()) === 78, "stok per kanwil: 78 baris (26 x 3 tahun)")
  for (const th of [2023, 2024, 2025] as const) {
    const s = await prisma.stokBulogKanwil.aggregate({ where: { tahun: th }, _sum: { stok_kg: true } })
    periksa(Math.abs((s._sum.stok_kg ?? 0) - angkaWajib(totalIndonesia[`stok_${th}_kg`])) < 1, `jumlah 26 kanwil ${th} = baris Indonesia di publikasi`)
  }
  periksa((await prisma.pengadaanBulog.count()) === 78, "pengadaan: 78 baris (13 cabang x 3 saluran x 2 tahun)")
  const p = await prisma.pengadaanBulog.aggregate({ where: { tahun: 2025, saluran: "NON_KUD_KTNA" }, _sum: { volume_kg: true } })
  periksa(Math.abs((p._sum.volume_kg ?? 0) - 577_439_537.83) < 0.5, "pengadaan non-KUD 2025 = 577.439.537,83 kg (baris total publikasi)")
  periksa((await prisma.hargaPenggilinganBulog.count()) === 39, "harga penggilingan: 39 baris (13 cabang x 3 tahun)")
  periksa((await prisma.hargaPembelianPemerintah.count()) === 29, "harga pembelian pemerintah: 29 baris (1999-2025)")
  const hpp = await prisma.hargaPembelianPemerintah.findUnique({ where: { tahun_keterangan: { tahun: 2025, keterangan: "GKP" } } })
  periksa(hpp?.beras_kud_rp_kg === 12000 && hpp.gabah_kud_rp_kg === 6500, "HPP 2025: gabah Rp6.500, beras Rp12.000")
}
