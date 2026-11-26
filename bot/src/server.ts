/** Server HTTP bot: webhook GoWA, endpoint simulator dasbor, dan pemeriksaan kesehatan. */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { tanggapi } from "./bot.ts"
import { config } from "./config.ts"
import { pool } from "./db.ts"
import { kirim, sambilMengetik, sehat, tandaTanganSah, uraiWebhook } from "./gowa.ts"
import { pemakaianHariIni, muatTokenHariIni } from "./pagar.ts"
import { catatWebhook, pantau } from "./pantau.ts"
import { q } from "./db.ts"
import { mulaiPenjadwal } from "./siaran.ts"
import { semuaWilayah } from "./wilayah.ts"

const sudah = new Map<string, number>() // id pesan -> waktu, untuk membuang webhook ganda
const antrean = new Map<string, Promise<void>>() // satu nomor diproses berurutan

function bacaBody(req: IncomingMessage, maks = 1_000_000): Promise<Buffer> {
  return new Promise((ok, gagal) => {
    const bag: Buffer[] = []
    let n = 0
    req.on("data", (c: Buffer) => {
      n += c.length
      if (n > maks) {
        gagal(new Error("body terlalu besar"))
        req.destroy()
      } else bag.push(c)
    })
    req.on("end", () => ok(Buffer.concat(bag)))
    req.on("error", gagal)
  })
}

function json(res: ServerResponse, kode: number, isi: unknown) {
  res.writeHead(kode, { "content-type": "application/json" })
  res.end(JSON.stringify(isi))
}

function proses(jid: string, nomor: string, nama: string | undefined, teks: string) {
  const kirimDicatat = async (isi: string) => {
    try {
      await kirim(jid, isi)
      pantau.balasan.terakhirOk = Date.now()
      pantau.balasan.jumlahOk++
    } catch (e) {
      pantau.balasan.terakhirGagal = Date.now()
      pantau.balasan.jumlahGagal++
      pantau.balasan.galat = String((e as Error).message).slice(0, 300)
      throw e
    }
  }
  const sebelum = antrean.get(nomor) ?? Promise.resolve()
  const kini = sebelum
    .then(async () => {
      // "mengetik..." tampil selama bot menyiapkan jawaban (mis. menunggu OpenAI) sampai balasan terkirim
      const b = await sambilMengetik(jid, async () => {
        const b = await tanggapi(nomor, nama, teks)
        await kirimDicatat(b.teks)
        return b
      })
      console.log(`[pesan] ${nomor.slice(0, 4)}…${nomor.slice(-3)} intent=${b.intent}`)
    })
    .catch((e) => console.error("[pesan] gagal:", e))
    .finally(() => {
      if (antrean.get(nomor) === kini) antrean.delete(nomor)
    })
  antrean.set(nomor, kini)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://bot")
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      const [db, wa] = await Promise.all([pool.query("select 1").then(() => true, () => false), sehat()])
      return json(res, db ? 200 : 503, { db, gowa: wa.ok, llm: { aktif: Boolean(config.openai.apiKey), model: config.openai.model, ...pemakaianHariIni() } })
    }

    if (req.method === "POST" && url.pathname === "/webhook/wa") {
      const mentah = await bacaBody(req)
      if (!tandaTanganSah(mentah, req.headers["x-hub-signature-256"] as string | undefined)) {
        pantau.webhook.tandaTanganGagal++
        pantau.webhook.terakhirGagalTanda = Date.now()
        return json(res, 401, { ok: false })
      }
      json(res, 200, { ok: true })
      let body: unknown
      try {
        body = JSON.parse(mentah.toString("utf8"))
      } catch {
        return
      }
      catatWebhook(String((body as { event?: unknown })?.event ?? "message"))
      if (process.env.LOG_WEBHOOK === "1") console.log("[webhook]", mentah.toString("utf8").slice(0, 2000))
      const m = uraiWebhook(body)
      if (!m) return
      pantau.webhook.pesanTerakhir = Date.now()
      if (m.id) {
        if (sudah.has(m.id)) return
        sudah.set(m.id, Date.now())
        if (sudah.size > 5000) for (const [k, t] of sudah) if (Date.now() - t > 3_600_000) sudah.delete(k)
      }
      proses(m.jid, m.nomor, m.nama, m.teks)
      return
    }

    // Status untuk halaman admin: GET /api/status dengan Authorization: Bearer <BOT_API_TOKEN>
    if (req.method === "GET" && url.pathname === "/api/status") {
      if (!config.apiToken || req.headers.authorization !== `Bearer ${config.apiToken}`) return json(res, 401, { ok: false })
      const [wa, db] = await Promise.all([
        sehat(),
        q<{ intent: string | null; jumlah: number; terakhir: string }>(
          `select p.intent, count(*)::int as jumlah, max(p.dibuat_pada)::text as terakhir
             from app.percakapan_bot p join app.kontak_warga k on k.id = p.kontak_id
            where p.arah = 'KELUAR' and p.dibuat_pada > now() - interval '24 hours' and k.nomor_wa !~ '^(sim-|uji-)'
            group by 1 order by 2 desc`,
        ).catch(() => []),
      ])
      const kontak = await q<{ n: number; langganan: number }>(
        `select count(*)::int as n, count(*) filter (where opt_in)::int as langganan from app.kontak_warga where nomor_wa !~ '^(sim-|uji-)'`,
      ).catch(() => [{ n: 0, langganan: 0 }])
      return json(res, 200, {
        ok: true,
        mulai: pantau.mulai,
        gowa: { terjangkau: wa.ok, url: config.gowa.url, deviceId: config.gowa.deviceId || null },
        webhook: pantau.webhook,
        balasan: pantau.balasan,
        llm: { aktif: Boolean(config.openai.apiKey), model: config.openai.model, ...pemakaianHariIni(), terakhir: pantau.llm },
        perangkat: pantau.perangkat,
        intent24j: db,
        kontak: kontak[0],
      })
    }

    // Simulator di dasbor: POST /api/tanya { "teks": "HARGA MALANG", "sesi": "demo-1" } dengan header Authorization: Bearer <BOT_API_TOKEN>
    if (req.method === "POST" && url.pathname === "/api/tanya") {
      if (!config.apiToken || req.headers.authorization !== `Bearer ${config.apiToken}`) return json(res, 401, { ok: false })
      const b = JSON.parse((await bacaBody(req, 20_000)).toString("utf8") || "{}") as { teks?: string; sesi?: string }
      if (!b.teks) return json(res, 400, { ok: false, galat: "teks wajib" })
      const sesi = `sim-${String(b.sesi ?? "demo").replace(/[^a-z0-9-]/gi, "").slice(0, 32)}`
      const r = await tanggapi(sesi, "Simulator dasbor", b.teks)
      return json(res, 200, { ok: true, ...r })
    }

    json(res, 404, { ok: false })
  } catch (e) {
    console.error("[http]", e)
    if (!res.headersSent) json(res, 500, { ok: false })
  }
})

await muatTokenHariIni().catch(() => {})
await semuaWilayah().then((w) => console.log(`[bot] ${w.length} kab/kota dimuat`))
server.listen(config.port, () => console.log(`[bot] mendengar di :${config.port}, model ${config.openai.model}, LLM ${config.openai.apiKey ? "aktif" : "nonaktif"}`))
mulaiPenjadwal()

for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => server.close(() => pool.end().then(() => process.exit(0))))
