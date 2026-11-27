/** Jembatan ke GoWA (go-whatsapp-web-multidevice): kirim pesan dan urai webhook pesan masuk. */
import { createHmac, timingSafeEqual } from "node:crypto"
import { config } from "./config.ts"

function header(): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" }
  if (config.gowa.basicAuth) h.authorization = "Basic " + Buffer.from(config.gowa.basicAuth).toString("base64")
  if (config.gowa.deviceId) h["x-device-id"] = config.gowa.deviceId
  return h
}

/** Kirim teks. `tujuan` boleh JID (628xx@s.whatsapp.net) atau nomor 628xx. */
export async function kirim(tujuan: string, pesan: string): Promise<string | undefined> {
  const phone = tujuan.includes("@") ? tujuan : `${tujuan.replace(/\D/g, "")}@s.whatsapp.net`
  const res = await fetch(`${config.gowa.url}/send/message`, {
    method: "POST",
    headers: header(),
    body: JSON.stringify({ phone, message: pesan }),
    signal: AbortSignal.timeout(20_000),
  })
  const teks = await res.text()
  if (!res.ok) throw new Error(`GoWA ${res.status}: ${teks.slice(0, 300)}`)
  try {
    const j = JSON.parse(teks) as { results?: { message_id?: string } }
    return j.results?.message_id
  } catch {
    return undefined
  }
}

/** Indikator "sedang mengetik..." di WhatsApp. Gagal diabaikan (hanya kosmetik). */
export async function mengetik(tujuan: string, action: "start" | "stop"): Promise<void> {
  const phone = tujuan.includes("@") ? tujuan : `${tujuan.replace(/\D/g, "")}@s.whatsapp.net`
  try {
    const res = await fetch(`${config.gowa.url}/send/chat-presence`, {
      method: "POST",
      headers: header(),
      body: JSON.stringify({ phone, action }),
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) console.warn(`[gowa] chat-presence ${action} ditolak ${res.status}: ${(await res.text()).slice(0, 200)}`)
  } catch {
    /* abaikan */
  }
}

/** Tampilkan "mengetik..." selama `kerja` berjalan: mulai setelah jeda singkat, diulang tiap 8 detik. */
export async function sambilMengetik<T>(tujuan: string, kerja: () => Promise<T>): Promise<T> {
  let aktif = false
  const mulai = () => {
    aktif = true
    void mengetik(tujuan, "start")
  }
  const t1 = setTimeout(mulai, 600) // jawaban instan (perintah baku) tidak perlu indikator
  const ulang = setInterval(() => aktif && void mengetik(tujuan, "start"), 8_000)
  try {
    return await kerja()
  } finally {
    clearTimeout(t1)
    clearInterval(ulang)
    if (aktif) void mengetik(tujuan, "stop")
  }
}

/** Nomor WA bot yang sedang login di GoWA (untuk tombol WhatsApp di dasbor). null bila tidak ada yang tersambung. */
let cacheNomor: { waktu: number; nomor: string | null } | null = null
export async function nomorBot(): Promise<string | null> {
  if (cacheNomor && Date.now() - cacheNomor.waktu < 60_000) return cacheNomor.nomor
  let nomor: string | null = null
  try {
    const res = await fetch(`${config.gowa.url}/devices`, { headers: header(), signal: AbortSignal.timeout(5_000) })
    const j = (await res.json()) as { results?: unknown }
    const daftar = (Array.isArray(j.results) ? j.results : Array.isArray(j) ? j : []) as { id?: string; state?: string; phone_number?: string; jid?: string }[]
    const dev = daftar.find((d) => d.id === config.gowa.deviceId) ?? (daftar.length === 1 ? daftar[0] : undefined)
    if (dev && dev.state === "logged_in") {
      const n = (dev.phone_number || (dev.jid ?? "").split(/[@:]/)[0] || "").replace(/\D/g, "")
      nomor = n.length >= 9 ? n : null
    }
  } catch {
    nomor = null
  }
  cacheNomor = { waktu: Date.now(), nomor }
  return nomor
}

export async function sehat(): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(`${config.gowa.url}/app/devices`, { headers: header(), signal: AbortSignal.timeout(5_000) })
    const t = await res.text()
    return { ok: res.ok, detail: t.slice(0, 300) }
  } catch (e) {
    return { ok: false, detail: String((e as Error).message) }
  }
}

export function tandaTanganSah(mentah: Buffer, tanda: string | undefined): boolean {
  if (!config.gowa.webhookSecret) return true
  if (!tanda) return false
  const harap = "sha256=" + createHmac("sha256", config.gowa.webhookSecret).update(mentah).digest("hex")
  const a = Buffer.from(harap)
  const b = Buffer.from(tanda.startsWith("sha256=") ? tanda : "sha256=" + tanda)
  return a.length === b.length && timingSafeEqual(a, b)
}

export type PesanMasuk = { id?: string; jid: string; nomor: string; nama?: string; teks: string }

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined)

/**
 * Urai payload webhook GoWA. Mendukung bentuk lama ({ from, message: { text } })
 * dan bentuk baru ({ event: "message", payload: { from, body } }). Abaikan grup, status, dan pesan sendiri.
 */
export function uraiWebhook(body: unknown): PesanMasuk | null {
  if (!body || typeof body !== "object") return null
  const b = body as Record<string, any>
  const ev = str(b.event)
  if (ev && !/^message$/i.test(ev)) return null
  const r: Record<string, any> = b.payload && typeof b.payload === "object" ? b.payload : b
  if (r.is_from_me === true || r.from_me === true || r.message?.is_from_me === true || r.info?.IsFromMe === true) return null
  const teks = str(r.message?.text) ?? str(r.body) ?? str(r.text) ?? str(r.message?.conversation) ?? str(r.message?.extendedTextMessage?.text)
  if (!teks) return null
  let jid = str(r.chat_id) ?? str(r.from) ?? ""
  if (jid.includes(" in ")) return null // format lama untuk pesan grup: "628xx@s.whatsapp.net in 1203xx@g.us"
  if (!jid.includes("@") && /^\d+$/.test(jid)) jid = `${jid}@s.whatsapp.net`
  if (!jid || /@(g\.us|broadcast|newsletter)$/.test(jid) || jid.startsWith("status@")) return null
  const nomorDari = str(r.sender_id) ?? str(r.from_pn) ?? jid.split("@")[0]
  const nomor = nomorDari.split("@")[0].split(":")[0].replace(/\D/g, "")
  return { id: str(r.message?.id) ?? str(r.id), jid, nomor, nama: str(r.pushname) ?? str(r.from_name), teks }
}
