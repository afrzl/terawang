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
