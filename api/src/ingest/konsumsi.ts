import { prisma } from "../db.js"
import { angka, angkaWajib, bacaCsv, bacaJson, catat, periksa, petaKabkotaNama, petaWilayah, sumberId } from "./util.js"

const KAB = "data/bps/konsumsi_beras/kabkota/tahunan/bps_jatim_konsumsi_beras_kabkota_tahunan_2025.csv"
const PROV = "data/bps/konsumsi_beras/provinsi/periode/bps_indonesia_konsumsi_beras_provinsi_sep_2025.csv"

export async function ingestKonsumsi(): Promise<void> {
  catat("== silver.konsumsi_beras")
  const sidKab = await sumberId("bps_susenas_maret_2025_tabel_2094")
  const sidProv = await sumberId("bps_susenas_sep_2025_konsumsi")
  const kab = await petaKabkotaNama()
  const kode = await petaWilayah()
  const seedProv = bacaJson<{ kode: string; nama: string }[]>("api/seed/provinsi.json")
  const provKode = new Map<string, string>([["Indonesia", "00"], ...seedProv.map((p) => [p.nama, p.kode] as [string, string])])

  const dataKab = bacaCsv(KAB).map((r) => {
    const wid = kab.get(r.wilayah)
    if (wid === undefined) throw new Error(`kab/kota tidak dikenal: ${r.wilayah}`)
    return {
      wilayah_id: wid,
      tahun: 2025,
      putaran: "MARET" as const,
      klasifikasi: "TOTAL" as const,
      satuan: "KG_KAPITA_MINGGU" as const,
      kg_per_kapita: angkaWajib(r.konsumsi_beras_2025_kg_kapita_minggu),
      nilai_rp_per_kapita_bulan: null,
      jenis_data: "ASLI" as const,
      sumber_id: sidKab,
    }
  })

  const dataProv = bacaCsv(PROV).flatMap((r) => {
    const k = provKode.get(r.provinsi)
    const wid = k ? kode.get(k) : undefined
    if (wid === undefined) throw new Error(`provinsi tidak dikenal: ${r.provinsi}`)
    const baris = (kl: "TOTAL" | "KOTA" | "DESA", kg: string | undefined, rp: string | undefined) => {
      const v = angka(kg)
      if (v === null) return [] // klasifikasi tidak ada di provinsi itu (DKI Jakarta tidak punya perdesaan)
      return [{
        wilayah_id: wid, tahun: 2025, putaran: "SEPTEMBER" as const, klasifikasi: kl, satuan: "KG_KAPITA_BULAN" as const,
        kg_per_kapita: v, nilai_rp_per_kapita_bulan: angka(rp), jenis_data: "ASLI" as const, sumber_id: sidProv,
      }]
    }
    return [
      ...baris("TOTAL", r.konsumsi_beras_total_kg_kapita_bulan, r.nilai_beras_total_rp_kapita_bulan),
      ...baris("KOTA", r.konsumsi_beras_kota_kg_kapita_bulan, r.nilai_beras_kota_rp_kapita_bulan),
      ...baris("DESA", r.konsumsi_beras_desa_kg_kapita_bulan, r.nilai_beras_desa_rp_kapita_bulan),
    ]
  })

  await prisma.konsumsiBeras.deleteMany({ where: { sumber_id: { in: [sidKab, sidProv] } } })
  await prisma.konsumsiBeras.createMany({ data: [...dataKab, ...dataProv] })

  catat("-- pemeriksaan konsumsi")
  periksa((await prisma.konsumsiBeras.count({ where: { sumber_id: sidKab } })) === 38, "38 kab/kota (Maret 2025, kg per minggu)")
  periksa((await prisma.konsumsiBeras.count({ where: { sumber_id: sidProv } })) === 116, "116 baris provinsi (39 wilayah x total/kota/desa, tanpa desa DKI Jakarta)")
  const s = await prisma.konsumsiBeras.aggregate({ where: { sumber_id: sidKab }, _sum: { kg_per_kapita: true } })
  periksa(Math.round((s._sum.kg_per_kapita ?? 0) * 1000) === 55198, "jumlah 38 kab/kota = 55,198 (sama dengan checksum yang dihitung dari halaman BPS)")
  const jatim = await prisma.konsumsiBeras.findFirst({ where: { wilayah: { kode: "35" }, klasifikasi: "TOTAL" } })
  periksa(jatim?.kg_per_kapita === 6.22, "Jawa Timur total 6,22 kg/kapita/bulan")
  const ind = await prisma.konsumsiBeras.findFirst({ where: { wilayah: { kode: "00" }, klasifikasi: "TOTAL" } })
  periksa(ind?.kg_per_kapita === 6.39, "Indonesia total 6,39 kg/kapita/bulan")
}
