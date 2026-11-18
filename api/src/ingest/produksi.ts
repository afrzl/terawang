import { prisma } from "../db.js"
import { angka, angkaWajib, bacaCsv, catat, periksa, petaKabkotaNama, petaWilayah, sumberId } from "./util.js"

const DIR = "data/bps/produksi_padi"
type Status = "TETAP" | "SEMENTARA" | "POTENSI"
type Gran = "BULANAN" | "PERIODE" | "TAHUNAN"
interface Baris {
  wilayah_id: number
  granularitas: Gran
  tahun: number
  bulan_awal: number
  bulan_akhir: number
  status_angka: Status
  luas_panen_ha: number | null
  produksi_gkp_ton: number | null
  produksi_gkg_ton: number | null
  produksi_beras_ton: number | null
  jenis_data: "ASLI"
  sumber_id: number
  catatan?: string | null
  koreksi?: object
}

const JUTA = 1_000_000

export async function ingestProduksi(): Promise<void> {
  catat("== silver.produksi_padi")
  const sNov = await sumberId("bps_brs_71_11_35_2026")
  const sFeb = await sumberId("bps_brs_11_02_35_2026")
  const sTabel = await sumberId("bps_tabel_luas_panen_produksi_kabkota_bulanan")
  const kab = await petaKabkotaNama()
  const kode = await petaWilayah()
  const w = (nama: string): number => {
    const id = kab.get(nama)
    if (id === undefined) throw new Error(`kab/kota tidak dikenal: ${nama}`)
    return id
  }
  const data: Baris[] = []
  const baris = (b: Omit<Baris, "jenis_data">) => data.push({ ...b, jenis_data: "ASLI" })

  // 1. Tahunan 2025 (tetap) dan 2026 (sementara): BRS Nov 2026, Tabel 1-4
  for (const r of bacaCsv(`${DIR}/kabkota/tahunan/bps_jatim_padi_kabkota_tahunan_2025_2026s.csv`)) {
    for (const [tahun, sfx, status] of [[2025, "2025", "TETAP"], [2026, "2026s", "SEMENTARA"]] as const) {
      baris({
        wilayah_id: w(r.wilayah), granularitas: "TAHUNAN", tahun, bulan_awal: 1, bulan_akhir: 12, status_angka: status,
        luas_panen_ha: angkaWajib(r[`luas_panen_${sfx}_ha`]), produksi_gkp_ton: angkaWajib(r[`produksi_gkp_${sfx}_ton`]),
        produksi_gkg_ton: angkaWajib(r[`produksi_gkg_${sfx}_ton`]), produksi_beras_ton: angkaWajib(r[`produksi_beras_${sfx}_ton`]),
        sumber_id: sNov,
      })
    }
  }

  // 2. Tahunan 2024 (tetap): BRS Feb 2026, Tabel 1-3 (2025 di berkas itu identik dengan BRS Nov, tidak dimuat dua kali)
  for (const r of bacaCsv(`${DIR}/kabkota/tahunan/bps_jatim_padi_kabkota_tahunan_2024_2025.csv`)) {
    baris({
      wilayah_id: w(r.wilayah), granularitas: "TAHUNAN", tahun: 2024, bulan_awal: 1, bulan_akhir: 12, status_angka: "TETAP",
      luas_panen_ha: angkaWajib(r.luas_panen_2024_ha), produksi_gkp_ton: null,
      produksi_gkg_ton: angkaWajib(r.produksi_gkg_2024_ton), produksi_beras_ton: angkaWajib(r.produksi_beras_2024_ton),
      sumber_id: sFeb,
    })
  }

  // 3. Periode Jan-Sep dan Okt-Des, 2025 dan 2026: BRS Nov 2026, Tabel 5-8
  for (const r of bacaCsv(`${DIR}/kabkota/periode/bps_jatim_padi_kabkota_periode_2025_2026.csv`)) {
    const p: [number, number, number, string, Status][] = [
      [2025, 1, 9, "jan_sep_2025", "TETAP"], [2026, 1, 9, "jan_sep_2026s", "SEMENTARA"],
      [2025, 10, 12, "okt_des_2025", "TETAP"], [2026, 10, 12, "okt_des_2026p", "POTENSI"],
    ]
    for (const [tahun, a, b, sfx, status] of p) {
      baris({
        wilayah_id: w(r.wilayah), granularitas: "PERIODE", tahun, bulan_awal: a, bulan_akhir: b, status_angka: status,
        luas_panen_ha: angkaWajib(r[`luas_panen_${sfx}_ha`]), produksi_gkp_ton: angkaWajib(r[`produksi_gkp_${sfx}_ton`]),
        produksi_gkg_ton: angkaWajib(r[`produksi_gkg_${sfx}_ton`]), produksi_beras_ton: angkaWajib(r[`produksi_beras_${sfx}_ton`]),
        sumber_id: sNov,
      })
    }
  }

  // 4. Jan-Mar 2025 (tetap) dan Jan-Mar 2026 (potensi): BRS Feb 2026, Tabel 4-6
  for (const r of bacaCsv(`${DIR}/kabkota/periode/bps_jatim_padi_kabkota_janmar_2025_2026p.csv`)) {
    for (const [tahun, sfx, status] of [[2025, "2025", "TETAP"], [2026, "2026p", "POTENSI"]] as const) {
      baris({
        wilayah_id: w(r.wilayah), granularitas: "PERIODE", tahun, bulan_awal: 1, bulan_akhir: 3, status_angka: status,
        luas_panen_ha: angkaWajib(r[`luas_panen_janmar_${sfx}_ha`]), produksi_gkp_ton: null,
        produksi_gkg_ton: angkaWajib(r[`produksi_gkg_janmar_${sfx}_ton`]), produksi_beras_ton: angkaWajib(r[`produksi_beras_janmar_${sfx}_ton`]),
        sumber_id: sFeb,
      })
    }
  }

  // 5. Bulanan per kabupaten 2025: tabel dinamis BPS (luas panen dan produksi beras), dengan 5 koreksi salah ketik
  for (const r of bacaCsv(`${DIR}/kabkota/bulanan/bps_jatim_padi_kabkota_bulanan_2025.csv`)) {
    const bulan = angkaWajib(r.bulan)
    const asli = r.koreksi.match(/dikoreksi dari ([\d.]+)/)
    baris({
      wilayah_id: w(r.wilayah), granularitas: "BULANAN", tahun: angkaWajib(r.tahun), bulan_awal: bulan, bulan_akhir: bulan, status_angka: "TETAP",
      luas_panen_ha: angkaWajib(r.luas_panen_ha), produksi_gkp_ton: null, produksi_gkg_ton: null, produksi_beras_ton: angkaWajib(r.produksi_beras_ton),
      sumber_id: sTabel,
      catatan: r.koreksi || null,
      ...(asli ? { koreksi: { produksi_beras_ton: { nilai_di_sumber: Number(asli[1]) } } } : {}),
    })
  }

  // 6. Bulanan provinsi Jawa Timur 2024-2026 (BRS Nov 2026, Gambar 1-3 dan 5): satuan juta, dibulatkan BPS 2 desimal
  const jatim = kode.get("35")!
  for (const r of bacaCsv(`${DIR}/provinsi/bulanan/bps_jatim_padi_provinsi_bulanan_2024_2026.csv`)) {
    const bulan = angkaWajib(r.bulan)
    baris({
      wilayah_id: jatim, granularitas: "BULANAN", tahun: angkaWajib(r.tahun), bulan_awal: bulan, bulan_akhir: bulan,
      status_angka: r.status_angka.toUpperCase() as Status,
      luas_panen_ha: Math.round((angka(r.luas_panen_juta_ha) ?? 0) * JUTA), produksi_gkp_ton: Math.round((angka(r.produksi_gkp_juta_ton) ?? 0) * JUTA),
      produksi_gkg_ton: Math.round((angka(r.produksi_gkg_juta_ton) ?? 0) * JUTA), produksi_beras_ton: Math.round((angka(r.produksi_beras_juta_ton) ?? 0) * JUTA),
      sumber_id: sNov, catatan: "Dibulatkan BPS ke 2 desimal dalam satuan juta",
    })
  }

  await prisma.produksiPadi.deleteMany({ where: { sumber_id: { in: [sNov, sFeb, sTabel] } } })
  await prisma.produksiPadi.createMany({ data: data.map((b) => ({ ...b, catatan: b.catatan ?? null })) })

  // ---------- pemeriksaan
  catat("-- pemeriksaan produksi")
  periksa((await prisma.produksiPadi.count()) === 834 && data.length === 834, "834 baris (76 + 38 + 152 + 76 + 456 + 36)")
  const hitung = (g: Gran, tahun: number, w2?: number) => prisma.produksiPadi.count({ where: { granularitas: g, tahun, ...(w2 ? { wilayah_id: w2 } : {}) } })
  periksa((await hitung("TAHUNAN", 2025)) === 38 && (await hitung("TAHUNAN", 2026)) === 38 && (await hitung("TAHUNAN", 2024)) === 38, "tahunan 2024, 2025, 2026: masing-masing 38 kab/kota")

  const tot = async (tahun: number, kolom: "luas_panen_ha" | "produksi_gkg_ton" | "produksi_beras_ton") =>
    (await prisma.produksiPadi.aggregate({ where: { granularitas: "TAHUNAN", tahun }, _sum: { [kolom]: true } }))._sum[kolom] ?? 0
  periksa(Math.abs((await tot(2025, "luas_panen_ha")) - 1_841_345) <= 2, "luas panen 2025 = 1.841.345 ha (publikasi 1.841.346, selisih pembulatan)")
  periksa(Math.abs((await tot(2025, "produksi_gkg_ton")) - 10_438_363) <= 4, "produksi GKG 2025 = 10.438.363 ton (publikasi 10.438.361)")
  periksa(Math.abs((await tot(2026, "produksi_gkg_ton")) - 10_607_300) <= 4, "produksi GKG 2026 sementara = 10.607.300 ton (publikasi 10.607.303)")
  periksa(Math.abs((await tot(2025, "produksi_beras_ton")) - 6_027_319) <= 2, "produksi beras 2025 = 6.027.319 ton (publikasi 6.027.320)")

  // bulanan per kabupaten vs tahunan (BRS): selisih maksimum 1 (pembulatan BRS)
  const bul = await prisma.produksiPadi.groupBy({
    by: ["wilayah_id"], where: { granularitas: "BULANAN", tahun: 2025, sumber_id: sTabel }, _sum: { luas_panen_ha: true, produksi_beras_ton: true },
  })
  const thn = new Map((await prisma.produksiPadi.findMany({ where: { granularitas: "TAHUNAN", tahun: 2025 }, select: { wilayah_id: true, luas_panen_ha: true, produksi_beras_ton: true } })).map((x) => [x.wilayah_id, x]))
  let mxL = 0, mxB = 0
  for (const b of bul) {
    const t = thn.get(b.wilayah_id)!
    mxL = Math.max(mxL, Math.abs((b._sum.luas_panen_ha ?? 0) - (t.luas_panen_ha ?? 0)))
    mxB = Math.max(mxB, Math.abs((b._sum.produksi_beras_ton ?? 0) - (t.produksi_beras_ton ?? 0)))
  }
  periksa(bul.length === 38 && mxL <= 1 && mxB <= 1, `jumlah 12 bulan = tahunan BRS untuk 38 kabupaten (selisih maks ${mxL.toFixed(2)} ha, ${mxB.toFixed(2)} ton)`)
  const kor = await prisma.produksiPadi.findMany({ where: { sumber_id: sTabel, catatan: { not: null } }, select: { koreksi: true } })
  periksa(kor.length === 5 && kor.every((k) => k.koreksi !== null), "tepat 5 baris terkoreksi, semuanya menyimpan nilai asli")
  periksa((await prisma.produksiPadi.count({ where: { wilayah_id: jatim, granularitas: "BULANAN" } })) === 36, "provinsi Jawa Timur: 36 bulan (2024-2026)")
  const okt26 = await prisma.produksiPadi.findFirst({ where: { wilayah_id: jatim, tahun: 2026, bulan_awal: 12 } })
  periksa(okt26?.status_angka === "POTENSI", "Des 2026 berstatus POTENSI")
}
