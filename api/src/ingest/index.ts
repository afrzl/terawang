import { prisma } from "../db.js"
import { catat } from "./util.js"
import { ingestRef } from "./ref.js"
import { ingestPenduduk } from "./penduduk.js"
import { ingestKonsumsi } from "./konsumsi.js"
import { ingestProduksi } from "./produksi.js"
import { ingestSatelit } from "./satelit.js"
import { ingestBulog } from "./bulog.js"
import { ingestHarga } from "./harga.js"
import { ingestJarak } from "./jarak.js"

/** Urutan memuat: ref dulu (sumber, komoditas, wilayah), lalu silver. Tiap modul idempoten (aman dijalankan ulang). */
const MODUL: Record<string, () => Promise<void>> = {
  ref: ingestRef,
  penduduk: ingestPenduduk,
  konsumsi: ingestKonsumsi,
  produksi: ingestProduksi,
  satelit: ingestSatelit,
  bulog: ingestBulog,
  harga: ingestHarga,
  jarak: ingestJarak,
}

async function main(): Promise<void> {
  const diminta = process.argv.slice(2)
  const urut = diminta.length ? diminta : Object.keys(MODUL)
  for (const nama of urut) {
    const fn = MODUL[nama]
    if (!fn) throw new Error(`modul tidak dikenal: ${nama}. Tersedia: ${Object.keys(MODUL).join(", ")}`)
    await fn()
  }
  catat("selesai")
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
