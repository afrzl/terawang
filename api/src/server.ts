/**
 * API baca-saja TERAWANG untuk dasbor (src/lib/api.ts).
 *
 *   GET /api/produksi  hasil K1 terbaru  (app.prediksi_produksi + BPS 2025 dari silver.produksi_padi)
 *   GET /api/stok      hasil K2 terbaru  (app.estimasi_stok, tiga skenario)
 *   GET /api/harga     hasil K3a terbaru (app.prediksi_harga 7/14/21/28 hari + riwayat harga mingguan silver.harga_kabkota_harian)
 *   GET /api/sphp      hasil K3b terbaru (app.rekomendasi_sphp), hanya untuk akun berhak `dasbor_sphp` (dicek ke layanan admin)
 *   GET /api/citra     olahan citra per wilayah (gee_wilayah.json keluaran aset bronze_citra), bila berkasnya ada
 *   GET /api/deret     deret EVI/LSWI/VH per wilayah (deret_satelit.json keluaran aset deret_satelit_wilayah)
 *   GET /api/fase      fase tumbuh per wilayah per bulan (fase_bulanan.json keluaran aset fase_tumbuh_bulanan)
 *   GET /api/gkp       harga GKP petani Jatim bulanan + prakiraan 1-3 bulan (gkp_prakiraan.json keluaran aset k3_prakiraan_gkp)
 *   GET /api/bulog     stok Bulog Jatim bulanan dan pengadaan per kantor cabang (silver.stok_bulog_bulanan, silver.pengadaan_bulog)
 *   POST /api/tafsir   interpretasi singkat satu grafik dari data yang dikirim dasbor (OpenAI, lihat tafsir.ts)
 *   GET /api/cerita    edisi pekanan halaman Cerita (?pekan=2026-W48; bawaan terbaru), langkah SPHP lengkap hanya untuk akun berhak (lihat cerita.ts)
 *   GET /api/cerita/arsip  daftar edisi per pekan
 *   GET /api/status    ringkas: model_run terakhir per jenis (untuk cek kesehatan)
 *
 * Deret bulanan memakai indeks 0 = Jan 2026 sampai bulan kini + 2 (horizon K2), sama dengan dasbor (src/lib/api.ts).
 * Env: DATABASE_URL (wajib), API_HOST (bawaan 127.0.0.1), API_PORT (3072), ADMIN_URL (http://127.0.0.1:3071), TERAWANG_GEE_JSON, TERAWANG_DERET_JSON, TERAWANG_FASE_JSON.
 *
 *   npm run api
 */
import "dotenv/config"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import express, { type Request, type Response } from "express"
import pg from "pg"
import { Galat, pemakaianTafsir, tafsirkan } from "./tafsir.js"
import { POLA_PEKAN, ambilEdisi, daftarEdisi, mulaiJadwal, pakaiPool, tokenCocok } from "./cerita.js"

const AWAL_TAHUN = 2026
const AWAL_BULAN = 1
/** Jumlah bulan dalam jendela: Jan 2026 sampai bulan kini + 2. */
const jumlahBulan = () => {
  const d = new Date()
  return Math.max(1, (d.getFullYear() - AWAL_TAHUN) * 12 + d.getMonth() - (AWAL_BULAN - 1) + 3)
}
const HORIZON = [7, 14, 21, 28]
const PEKAN_RIWAYAT = 26
const KOMODITAS = { medium: "beras_medium", premium: "beras_premium" } as const

/** Buang parameter `schema` milik Prisma dari URL; pg tidak mengenalnya. */
function urlPg(url: string | undefined) {
  if (!url) throw new Error("DATABASE_URL belum diisi (api/.env)")
  const u = new URL(url)
  u.searchParams.delete("schema")
  return u.toString()
}

const pool = new pg.Pool({ connectionString: urlPg(process.env.DATABASE_URL), max: 4, idleTimeoutMillis: 30_000 })
pakaiPool(pool)
const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows as T[]

const idxBulan = (tahun: number, bulan: number) => (tahun - AWAL_TAHUN) * 12 + (bulan - AWAL_BULAN)
const kosong = <T>(n: number) => Array<T | null>(n).fill(null)
const angka = (v: unknown) => (v === null || v === undefined ? null : Number(v))
const tgl = (d: unknown) => (d instanceof Date ? d.toISOString() : d === null || d === undefined ? null : String(d))
/** Tanggal kolom `date` dibaca pg sebagai Date tengah malam waktu lokal; ambil Y-M-D lokalnya. */
const ymd = (d: unknown) => {
  if (!(d instanceof Date)) return String(d).slice(0, 10)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

interface Run {
  id: number
  nama_versi: string
  dibuat_pada: Date
  selesai_pada: Date | null
  parameter: Record<string, unknown> | null
  metrik: Record<string, unknown> | null
}

/** model_run SELESAI terbaru untuk `jenis` yang punya baris di `tabel` (lewati run yang gagal di tengah jalan). */
async function runTerbaru(jenis: string, tabel: string, syarat = "true", per?: string): Promise<Run | null> {
  const pilih = (batas: string, urut: string, args: unknown[]) =>
    q<Run>(
      `select m.id, m.nama_versi, m.dibuat_pada, m.selesai_pada, m.parameter, m.metrik from app.model_run m
       where m.jenis = $1 and m.status = 'SELESAI' and ${batas} and exists (select 1 from ${tabel} t where t.model_run_id = m.id and ${syarat})
       order by m.id ${urut} limit 1`,
      args,
    )
  if (!per) return (await pilih("true", "desc", [jenis]))[0] ?? null
  // Mode tanggal acuan (edisi Cerita pekan lalu): run terakhir yang sudah ada pada `per`; bila belum ada sama sekali, run paling awal.
  return (await pilih("m.dibuat_pada <= $2::timestamptz", "desc", [jenis, per]))[0] ?? (await pilih("true", "asc", [jenis]))[0] ?? null
}

const metaRun = (r: Run, jenis_data: string | null) => ({
  model_run_id: r.id,
  versi: r.nama_versi,
  dibuat: tgl(r.selesai_pada ?? r.dibuat_pada),
  jenis_data: jenis_data ?? "MODEL",
})

async function produksi(per?: string) {
  const run = await runTerbaru("K1_PRODUKSI", "app.prediksi_produksi", "true", per)
  if (!run) return null
  const rows = await q<{ kab: string; tahun: number; bulan: number; v: number; lo: number | null; hi: number | null; jd: string }>(
    `select w.nama_repo kab, p.tahun, p.bulan, p.produksi_beras_ton v, p.batas_bawah_ton lo, p.batas_atas_ton hi, p.jenis_data::text jd
     from app.prediksi_produksi p join ref.wilayah w on w.id = p.wilayah_id where p.model_run_id = $1`,
    [run.id],
  )
  const bps = await q<{ kab: string; bulan: number; v: number | null }>(
    `select distinct on (w.id, p.bulan_awal) w.nama_repo kab, p.bulan_awal bulan, p.produksi_beras_ton v
     from silver.produksi_padi p join ref.wilayah w on w.id = p.wilayah_id
     where w.level = 'KABKOTA' and p.tahun = 2025 and p.granularitas = 'BULANAN' and p.bulan_awal = p.bulan_akhir
     order by w.id, p.bulan_awal, (p.status_angka = 'TETAP') desc, p.sumber_id desc`,
  )
  const N = jumlahBulan()
  const wilayah: Record<string, { k1: (number | null)[]; p10: (number | null)[]; p90: (number | null)[]; bps2025: (number | null)[] }> = {}
  const ambil = (kab: string) => (wilayah[kab] ??= { k1: kosong(N), p10: kosong(N), p90: kosong(N), bps2025: Array(12).fill(null) })
  for (const r of rows) {
    const i = idxBulan(r.tahun, r.bulan)
    if (i < 0 || i >= N) continue
    const w = ambil(r.kab)
    w.k1[i] = angka(r.v)
    w.p10[i] = angka(r.lo)
    w.p90[i] = angka(r.hi)
  }
  for (const r of bps) if (r.bulan >= 1 && r.bulan <= 12) ambil(r.kab).bps2025[r.bulan - 1] = angka(r.v)
  return {
    meta: { ...metaRun(run, rows[0]?.jd ?? null), awal: `${AWAL_TAHUN}-${String(AWAL_BULAN).padStart(2, "0")}`, bulan: N, satuan: "ton beras" },
    wilayah,
  }
}

async function stok(per?: string) {
  const run = await runTerbaru("K2_STOK", "app.estimasi_stok", "true", per)
  if (!run) return null
  const rows = await q<{ kab: string; tahun: number; bulan: number; sk: string; stok: number; cak: number | null; st: string | null; jd: string }>(
    `select w.nama_repo kab, e.tahun, e.bulan, e.skenario::text sk, e.stok_ton stok, e.cakupan_bulan cak, e.status::text st, e.jenis_data::text jd
     from app.estimasi_stok e join ref.wilayah w on w.id = e.wilayah_id where e.model_run_id = $1`,
    [run.id],
  )
  type W = { cakupan: (number | null)[]; p10: (number | null)[]; p90: (number | null)[]; stok: (number | null)[]; status: (string | null)[]; konsumsi: number | null }
  const N = jumlahBulan()
  const wilayah: Record<string, W> = {}
  for (const r of rows) {
    const i = idxBulan(r.tahun, r.bulan)
    if (i < 0 || i >= N) continue
    const w = (wilayah[r.kab] ??= { cakupan: kosong(N), p10: kosong(N), p90: kosong(N), stok: kosong(N), status: kosong(N), konsumsi: null })
    const cak = angka(r.cak)
    if (r.sk === "TENGAH") {
      w.cakupan[i] = cak
      w.stok[i] = angka(r.stok)
      w.status[i] = r.st
      if (w.konsumsi === null && cak) w.konsumsi = Number(r.stok) / cak
    } else if (r.sk === "RENDAH") w.p10[i] = cak
    else if (r.sk === "TINGGI") w.p90[i] = cak
  }
  const m = run.metrik ?? {}
  return {
    meta: {
      ...metaRun(run, rows[0]?.jd ?? null),
      jangkar_bulan_konsumsi: angka(m.jangkar_bulan_konsumsi),
      hari_ke_defisit: (m.hari_ke_defisit as Record<string, number>) ?? {},
      sudah_defisit: (m.sudah_defisit as string[]) ?? [],
      /** Arus antar kab (LP jarak jalan) yang dipakai neraca K2, ton per bulan. */
      arus: (m.arus_antar_kab as { dari: string; ke: string; ton_bulan: number }[]) ?? [],
    },
    wilayah,
  }
}

async function harga(per?: string) {
  // K3a: run yang punya keempat horizon (7, 14, 21, 28 hari). Run baseline lama (14/28 hari saja) dilewati.
  const run = await runTerbaru("K3_HARGA", "app.prediksi_harga", "t.horizon_hari = 7", per)
  if (!run) return null
  const rows = await q<{ kab: string; kom: string; acuan: Date; h: number; m: number; lo: number | null; hi: number | null; st: string | null; jd: string }>(
    `select w.nama_repo kab, k.kode kom, p.tanggal_acuan acuan, p.horizon_hari h, p.harga_prediksi m, p.batas_bawah lo, p.batas_atas hi, p.status::text st, p.jenis_data::text jd
     from app.prediksi_harga p join ref.wilayah w on w.id = p.wilayah_id join ref.komoditas k on k.id = p.komoditas_id
     where p.model_run_id = $1 order by p.horizon_hari`,
    [run.id],
  )
  if (!rows.length) return null
  let acuan = rows.map((r) => ymd(r.acuan)).sort().at(-1) as string
  // mode tanggal acuan: riwayat harga dipotong sehari sebelum `per`, jadi tidak ada harga dari masa depan
  if (per) {
    const batas = new Date(Date.parse(per) + 7 * 3600_000 - 864e5).toISOString().slice(0, 10)
    if (batas < acuan) acuan = batas
  }
  // Riwayat: rata-rata harian per pekan berakhir di tanggal acuan (pekan ke-0 = 7 hari terakhir), 26 pekan.
  const hist = await q<{ kab: string; kom: string; pekan: number; v: number | null }>(
    `select w.nama_repo kab, k.kode kom, floor(($1::date - h.tanggal) / 7)::int pekan, avg(h.harga_rata2_rp_kg) v
     from silver.harga_kabkota_harian h join ref.wilayah w on w.id = h.wilayah_id join ref.komoditas k on k.id = h.komoditas_id
     where h.tanggal <= $1::date and h.tanggal > $1::date - ($2::int * 7) and k.kode = any($3) and h.harga_rata2_rp_kg is not null
     group by 1, 2, 3`,
    [acuan, PEKAN_RIWAYAT, Object.values(KOMODITAS)],
  )
  type Seri = { price: (number | null)[]; fc: { m: number; lo: number; hi: number }[]; status: string[] }
  const baru = (): Seri => ({ price: Array(PEKAN_RIWAYAT).fill(null), fc: [], status: [] })
  const jenis = (kode: string) => (kode === KOMODITAS.medium ? "medium" : kode === KOMODITAS.premium ? "premium" : null)
  const wilayah: Record<string, { medium: Seri; premium: Seri }> = {}
  const ambil = (kab: string) => (wilayah[kab] ??= { medium: baru(), premium: baru() })
  for (const r of rows) {
    const j = jenis(r.kom)
    if (!j || !HORIZON.includes(r.h)) continue
    const s = ambil(r.kab)[j]
    const m = Number(r.m)
    s.fc.push({ m, lo: angka(r.lo) ?? m, hi: angka(r.hi) ?? m })
    s.status.push(r.st ?? "AMAN")
  }
  for (const r of hist) {
    const j = jenis(r.kom)
    if (!j || r.pekan < 0 || r.pekan >= PEKAN_RIWAYAT || !wilayah[r.kab]) continue
    wilayah[r.kab][j].price[PEKAN_RIWAYAT - 1 - r.pekan] = angka(r.v)
  }
  const het = (run.parameter?.het as Record<string, number> | undefined) ?? null
  const kom = await q<{ id: number; kode: string }>(`select id, kode from ref.komoditas`)
  const hetNama = het ? Object.fromEntries(kom.filter((k) => het[k.id] != null && jenis(k.kode)).map((k) => [jenis(k.kode) as string, Number(het[k.id])])) : null
  // Kalibrasi ambang WASPADA per jenis beras dan horizon (F1, AUC peluang melewati HET pada backtest).
  const kalibrasi = (run.parameter?.kalibrasi_ambang as Record<string, Record<string, unknown>> | undefined) ?? null
  return { meta: { ...metaRun(run, rows[0]?.jd ?? null), tanggal_acuan: acuan, het: hetNama, kalibrasi }, wilayah }
}

async function sphp(per?: string) {
  const run = await runTerbaru("K3_SPHP", "app.rekomendasi_sphp", "true", per)
  if (!run) return null
  const rows = await q<{ tahun: number; bulan: number; dari: string; ke: string; ton: number; km: number | null; jd: string }>(
    `select s.tahun, s.bulan, d.nama_repo dari, k.nama_repo ke, s.volume_ton ton, s.jarak_jalan_km km, s.jenis_data::text jd
     from app.rekomendasi_sphp s join ref.wilayah d on d.id = s.dari_id join ref.wilayah k on k.id = s.ke_id
     where s.model_run_id = $1 order by s.tahun, s.bulan, s.volume_ton desc`,
    [run.id],
  )
  return {
    meta: metaRun(run, rows[0]?.jd ?? null),
    rute: rows.map((r) => ({ bulan: idxBulan(r.tahun, r.bulan), dari: r.dari, ke: r.ke, ton: Number(r.ton), km: angka(r.km) ?? 0 })),
  }
}

const ADMIN_URL = (process.env.ADMIN_URL ?? "http://127.0.0.1:3071").replace(/\/$/, "")

/** Tanya layanan admin apakah cookie sesi peminta punya hak `hak`. Admin mati = tidak berhak. */
async function berhak(req: Request, hak: string) {
  // proses penyusun edisi Cerita (cerita-fakta.ts) memakai token internal, bukan cookie
  if (tokenCocok(req.headers["x-terawang-internal"])) return true
  const cookie = req.headers.cookie
  if (!cookie) return false
  try {
    const r = await fetch(`${ADMIN_URL}/admin/api/saya`, { headers: { cookie, accept: "application/json" }, signal: AbortSignal.timeout(2000) })
    if (!r.ok) return false
    const j = (await r.json()) as { hak?: string[] }
    return Array.isArray(j.hak) && j.hak.includes(hak)
  } catch {
    return false
  }
}

const GEE_JSON = process.env.TERAWANG_GEE_JSON ?? path.join(os.homedir(), ".local/share/terawang/gee_wilayah.json")
const GKP_JSON = process.env.TERAWANG_GKP_JSON ?? path.join(os.homedir(), ".local/share/terawang/gkp_prakiraan.json")
const DERET_JSON = process.env.TERAWANG_DERET_JSON ?? path.join(os.homedir(), ".local/share/terawang/deret_satelit.json")
const FASE_JSON = process.env.TERAWANG_FASE_JSON ?? path.join(os.homedir(), ".local/share/terawang/fase_bulanan.json")

async function bulog() {
  const stok = await q<{ tahun: number; bulan: number; awal: number; masuk: number; keluar: number; akhir: number; jd: string }>(
    `select s.tahun, s.bulan, s.persediaan_awal_kg awal, s.pemasukan_kg masuk, s.pengeluaran_kg keluar, s.persediaan_akhir_kg akhir, s.jenis_data::text jd
     from silver.stok_bulog_bulanan s join silver.kantor_wilayah_bulog k on k.id = s.kanwil_id
     where k.nama ilike '%jawa timur%' order by s.tahun, s.bulan`,
  )
  const pengadaan = await q<{ cabang: string; tahun: number; kg: number }>(
    `select c.nama cabang, p.tahun, sum(p.volume_kg) kg from silver.pengadaan_bulog p join silver.kantor_cabang_bulog c on c.id = p.cabang_id
     group by 1, 2 order by 2, 1`,
  )
  if (!stok.length && !pengadaan.length) return null
  const rb = (kg: number) => Math.round(Number(kg) / 1e5) / 10 // kg -> ribu ton, 1 desimal
  return {
    stok: stok.map((r) => ({ tahun: r.tahun, bulan: r.bulan, awal: rb(r.awal), masuk: rb(r.masuk), keluar: rb(r.keluar), akhir: rb(r.akhir), jenis_data: r.jd })),
    pengadaan: pengadaan.map((r) => ({ cabang: r.cabang, tahun: r.tahun, ton: rb(r.kg) })),
  }
}

/** Cache singkat agar dasbor yang dibuka banyak orang tidak memukul database tiap muat. */
const cache = new Map<string, { t: number; v: unknown }>()
const UMUR_CACHE = Number(process.env.API_CACHE_MS ?? 60_000)
async function tembolok<T>(kunci: string, f: () => Promise<T>) {
  const c = cache.get(kunci)
  if (c && Date.now() - c.t < UMUR_CACHE) return c.v as T
  const v = await f()
  cache.set(kunci, { t: Date.now(), v })
  return v
}

const app = express()
app.disable("x-powered-by")

/** `?per=<ISO>` (data sebagaimana ada pada waktu itu) hanya untuk penyusun edisi Cerita yang memakai token internal. */
const perDari = (req: Request) => {
  const p = req.query.per
  return typeof p === "string" && !Number.isNaN(Date.parse(p)) && tokenCocok(req.headers["x-terawang-internal"]) ? new Date(p).toISOString() : undefined
}

const kirim = (nama: string, f: (per?: string) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    const per = perDari(req)
    const v = await tembolok(per ? `${nama}@${per}` : nama, () => f(per))
    if (v === null) return res.status(404).json({ galat: `belum ada hasil ${nama}` })
    res.set("Cache-Control", "no-store").json(v)
  } catch (e) {
    console.error(`[api] ${nama}:`, e)
    res.status(500).json({ galat: "gagal membaca database" })
  }
}

app.get("/api/produksi", kirim("produksi", produksi))
app.get("/api/stok", kirim("stok", stok))
app.get("/api/harga", kirim("harga", harga))
app.get("/api/sphp", async (req, res, next) => {
  if (!(await berhak(req, "dasbor_sphp"))) return res.status(403).json({ galat: "perlu akun perusahaan, dinas, atau superadmin" })
  res.set("Vary", "Cookie")
  return kirim("sphp", sphp)(req, res).catch(next)
})
app.get("/api/citra", async (_req, res) => {
  try {
    const isi = await fs.readFile(GEE_JSON, "utf8")
    res.set("Cache-Control", "no-store").type("application/json").send(isi)
  } catch {
    res.status(404).json({ galat: "berkas olahan citra belum ada" })
  }
})
app.get("/api/deret", async (_req, res) => {
  try {
    const isi = await fs.readFile(DERET_JSON, "utf8")
    res.set("Cache-Control", "no-store").type("application/json").send(isi)
  } catch {
    res.status(404).json({ galat: "berkas deret satelit belum ada" })
  }
})
app.get("/api/fase", async (_req, res) => {
  try {
    const isi = await fs.readFile(FASE_JSON, "utf8")
    res.set("Cache-Control", "no-store").type("application/json").send(isi)
  } catch {
    res.status(404).json({ galat: "berkas fase tumbuh bulanan belum ada" })
  }
})
app.get("/api/gkp", async (_req, res) => {
  try {
    const isi = await fs.readFile(GKP_JSON, "utf8")
    res.set("Cache-Control", "no-store").type("application/json").send(isi)
  } catch {
    res.status(404).json({ galat: "berkas prakiraan GKP belum ada" })
  }
})
app.get("/api/bulog", kirim("bulog", bulog))
app.get("/api/cerita/arsip", async (_req, res) => {
  try {
    res.set("Cache-Control", "no-store").json(await daftarEdisi())
  } catch (e) {
    console.error("[api] cerita/arsip:", e)
    res.status(500).json({ galat: "gagal membaca arsip" })
  }
})
app.get("/api/cerita", async (req, res) => {
  const pekan = typeof req.query.pekan === "string" && POLA_PEKAN.test(req.query.pekan) ? req.query.pekan : undefined
  try {
    const e = await ambilEdisi(pekan)
    if (!e) return res.status(404).json({ galat: "belum ada edisi" })
    const { aksi_sphp, ...publik } = e
    const boleh = aksi_sphp && (await berhak(req, "dasbor_sphp"))
    res.set({ "Cache-Control": "no-store", Vary: "Cookie" }).json(boleh ? { ...publik, aksi_sphp } : publik)
  } catch (err) {
    console.error("[api] cerita:", err)
    res.status(500).json({ galat: "gagal membaca edisi" })
  }
})
app.get("/api/status", kirim("status", async () => ({
  runs: await q(`select distinct on (jenis) jenis::text, id, nama_versi, status::text, dibuat_pada, selesai_pada from app.model_run order by jenis, id desc`),
  harga_terakhir: (await q<{ t: Date }>(`select max(tanggal) t from silver.harga_kabkota_harian`))[0]?.t ?? null,
})))
app.post("/api/tafsir", express.json({ limit: "64kb" }), async (req, res) => {
  // IP asli dari Traefik/serve.py; hanya untuk batas pemakaian per perangkat.
  const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim()
  try {
    res.set("Cache-Control", "no-store").json(await tafsirkan(req.body, ip))
  } catch (e) {
    if (e instanceof Galat) return res.status(e.status).json({ galat: e.message })
    console.error("[api] tafsir:", e)
    res.status(500).json({ galat: "interpretasi gagal dibuat" })
  }
})
app.get("/api/tafsir/status", (_req, res) => res.set("Cache-Control", "no-store").json(pemakaianTafsir()))
app.use("/api", (_req, res) => res.status(404).json({ galat: "tidak ada" }))

const HOST = process.env.API_HOST ?? "127.0.0.1"
const PORT = Number(process.env.API_PORT ?? 3072)
app.listen(PORT, HOST, () => {
  console.log(`[api] TERAWANG baca-saja di http://${HOST}:${PORT}`)
  mulaiJadwal(`http://${HOST === "0.0.0.0" ? "127.0.0.1" : HOST}:${PORT}`)
})
