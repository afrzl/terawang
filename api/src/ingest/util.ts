import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"
import { fileURLToPath } from "node:url"
import { parse } from "csv-parse/sync"
import { prisma } from "../db.js"

/** Akar repo (folder terawang/). Path relatif dibaca dari sini; path absolut dipakai apa adanya. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")

export type Baris = Record<string, string>

function parseCsv(teks: string): Baris[] {
  return parse(teks, { columns: true, skip_empty_lines: true, bom: true }) as Baris[]
}

export function bacaCsv(relPath: string): Baris[] {
  return parseCsv(fs.readFileSync(path.resolve(ROOT, relPath), "utf-8"))
}

export function bacaCsvGz(relPath: string): Baris[] {
  return parseCsv(zlib.gunzipSync(fs.readFileSync(path.resolve(ROOT, relPath))).toString("utf-8"))
}

export function bacaJson<T>(relPath: string): T {
  return JSON.parse(fs.readFileSync(path.resolve(ROOT, relPath), "utf-8")) as T
}

/** Angka dari teks CSV; kosong menjadi null. */
export function angka(s: string | undefined): number | null {
  if (s === undefined || s.trim() === "") return null
  const n = Number(s)
  if (!Number.isFinite(n)) throw new Error(`bukan angka: "${s}"`)
  return n
}

export function angkaWajib(s: string | undefined, label = "nilai"): number {
  const n = angka(s)
  if (n === null) throw new Error(`${label} kosong`)
  return n
}

/** Tanggal "YYYY-MM-DD" sebagai tengah malam UTC (kolom DATE). */
export function tanggal(s: string): Date {
  const d = new Date(`${s}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) throw new Error(`tanggal tidak valid: ${s}`)
  return d
}

/** Peta kode sumber -> id, dibaca sekali. */
let cacheSumber: Map<string, number> | null = null
export async function sumberId(kode: string): Promise<number> {
  if (!cacheSumber) {
    const semua = await prisma.sumber.findMany({ select: { id: true, kode: true } })
    cacheSumber = new Map(semua.map((s) => [s.kode, s.id]))
  }
  const id = cacheSumber.get(kode)
  if (id === undefined) throw new Error(`sumber belum terdaftar: ${kode} (jalankan ingest ref dulu)`)
  return id
}

/** Peta kode BPS wilayah -> id. */
export async function petaWilayah(): Promise<Map<string, number>> {
  const w = await prisma.wilayah.findMany({ select: { id: true, kode: true } })
  return new Map(w.map((x) => [x.kode, x.id]))
}

/** Peta nama wilayah (penamaan BPS) -> id, untuk kab/kota. */
export async function petaKabkotaNama(): Promise<Map<string, number>> {
  const w = await prisma.wilayah.findMany({ where: { level: "KABKOTA" }, select: { id: true, nama: true } })
  return new Map(w.map((x) => [x.nama, x.id]))
}

/** Memasukkan data dalam potongan agar tidak melewati batas parameter PostgreSQL. */
export async function sisipkanBanyak<T>(
  data: T[],
  simpan: (potongan: T[]) => Promise<unknown>,
  ukuran = 5000,
): Promise<void> {
  for (let i = 0; i < data.length; i += ukuran) await simpan(data.slice(i, i + ukuran))
}

export function catat(...a: unknown[]): void {
  console.log(...a)
}

export function periksa(kondisi: boolean, pesan: string): void {
  if (!kondisi) throw new Error(`PEMERIKSAAN GAGAL: ${pesan}`)
  catat(`  OK  ${pesan}`)
}
