/**
 * Jalur pesan bebas: OpenAI hanya memahami pertanyaan dan merangkai jawaban.
 * Semua angka diambil lewat function calling ke data.ts. Nomor WA tidak pernah dikirim ke OpenAI.
 */
import { config } from "./config.ts"
import { daftarPeringatan, infoBerasMurah, infoHarga, infoStok, ringkasanJatim } from "./data.ts"
import { cocokkan, labelWilayah, semuaWilayah, type Wilayah } from "./wilayah.ts"

type Pesan =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: PanggilanAlat[] }
  | { role: "tool"; tool_call_id: string; content: string }
type PanggilanAlat = { id: string; type: "function"; function: { name: string; arguments: string } }

const paramWilayah = {
  type: "object",
  properties: { wilayah: { type: "string", description: "Nama kabupaten/kota di Jawa Timur, mis. 'Kota Malang', 'Jember'" } },
  required: ["wilayah"],
  additionalProperties: false,
}

const ALAT = [
  { name: "harga_wilayah", description: "Harga beras medium & premium terkini, HET, prakiraan 2 dan 4 pekan, dan status harga satu kab/kota.", parameters: paramWilayah },
  { name: "stok_wilayah", description: "Perkiraan stok beras, cakupan (bulan konsumsi), status, dan bulan defisit pertama satu kab/kota.", parameters: paramWilayah },
  { name: "beras_murah", description: "Wilayah terdekat yang harga berasnya lebih murah dan rekomendasi pasokan beras SPHP untuk satu kab/kota.", parameters: paramWilayah },
  {
    name: "daftar_peringatan",
    description: "Peringatan aktif (harga/stok) tingkat waspada atau siaga. Kosongkan wilayah untuk seluruh Jawa Timur.",
    parameters: { type: "object", properties: { wilayah: { type: "string" } }, additionalProperties: false },
  },
  { name: "ringkasan_jatim", description: "Jumlah kab/kota Jawa Timur per status gabungan (aman/waspada/siaga).", parameters: { type: "object", properties: {}, additionalProperties: false } },
].map((f) => ({ type: "function" as const, function: f }))

function promptSistem(wilayahIngat: Wilayah | null): string {
  const hari = new Date().toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", weekday: "long", day: "numeric", month: "long", year: "numeric" })
  return [
    "Kamu adalah bot WhatsApp TERAWANG Jawa Timur yang memberi info beras: harga, stok, beras murah/SPHP, dan peringatan, untuk warga dan pedagang kecil.",
    `Hari ini ${hari}. Cakupan hanya 38 kabupaten/kota di Jawa Timur.`,
    "Aturan:",
    "- Setiap angka WAJIB berasal dari hasil fungsi. Jangan menebak, menghitung prakiraan sendiri, atau memakai pengetahuanmu tentang harga.",
    "- Kalau data tidak ada, katakan belum tersedia.",
    "- Jawab dalam bahasa Indonesia sehari-hari yang sopan, singkat (maksimal 6-8 baris), format WhatsApp (*tebal* seperlunya, tanpa tabel atau markdown lain).",
    "- Kalau fungsi mengembalikan pilihan wilayah yang ambigu, tanyakan balik yang mana.",
    "- Pertanyaan di luar beras/pangan Jawa Timur: tolak dengan sopan dan sebutkan apa yang bisa kamu bantu.",
    "- Data stok memakai stok awal asumsi; sebutkan sebagai perkiraan.",
    "- Tutup dengan saran perintah singkat bila relevan: HARGA <wilayah>, STOK <wilayah>, SPHP <wilayah>, LANGGANAN <wilayah>.",
    wilayahIngat ? `Wilayah terakhir yang ditanyakan pengguna: ${labelWilayah(wilayahIngat)} (pakai bila pengguna tidak menyebut wilayah).` : "",
  ]
    .filter(Boolean)
    .join("\n")
}

async function jalankanAlat(nama: string, argumen: string): Promise<{ hasil: unknown; wilayahId?: number }> {
  let a: { wilayah?: string } = {}
  try {
    a = JSON.parse(argumen || "{}")
  } catch {
    return { hasil: { galat: "argumen tidak valid" } }
  }
  if (nama === "ringkasan_jatim") return { hasil: await ringkasanJatim() }
  const daftar = await semuaWilayah()
  let w: Wilayah | undefined
  if (a.wilayah) {
    const c = cocokkan(a.wilayah, daftar)
    if (c.jenis === "ambigu") return { hasil: { ambigu: true, pilihan: c.pilihan.map(labelWilayah) } }
    if (c.jenis === "tidak_ada") return { hasil: { galat: `wilayah '${a.wilayah}' tidak ditemukan di Jawa Timur` } }
    w = c.wilayah
  }
  if (nama === "daftar_peringatan") {
    const xs = await daftarPeringatan(w?.id)
    return { hasil: xs.slice(0, 20).map(({ wilayah, jenis, tingkat, judul, pesan }) => ({ wilayah, jenis, tingkat, judul, pesan })), wilayahId: w?.id }
  }
  if (!w) return { hasil: { galat: "wilayah wajib diisi" } }
  if (nama === "harga_wilayah") return { hasil: await infoHarga(w), wilayahId: w.id }
  if (nama === "stok_wilayah") return { hasil: await infoStok(w), wilayahId: w.id }
  if (nama === "beras_murah") return { hasil: await infoBerasMurah(w), wilayahId: w.id }
  return { hasil: { galat: `fungsi ${nama} tidak dikenal` } }
}

async function panggilOpenAI(pesan: Pesan[]) {
  const body: Record<string, unknown> = {
    model: config.openai.model,
    messages: pesan,
    tools: ALAT,
    max_completion_tokens: 1200,
  }
  if (config.openai.reasoningEffort && /^(gpt-5|o\d)/.test(config.openai.model)) body.reasoning_effort = config.openai.reasoningEffort
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.openai.apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  })
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const j = (await res.json()) as {
    choices: { message: { content: string | null; tool_calls?: PanggilanAlat[] } }[]
    usage?: { prompt_tokens: number; completion_tokens: number }
  }
  return { pesan: j.choices[0].message, usage: j.usage }
}

export const llmAktif = () => Boolean(config.openai.apiKey)

export async function jawabBebas(
  teks: string,
  riwayat: { arah: "MASUK" | "KELUAR"; isi: string }[],
  wilayahIngat: Wilayah | null,
): Promise<{ jawaban: string; wilayahId?: number; token?: number }> {
  const pesan: Pesan[] = [
    { role: "system", content: promptSistem(wilayahIngat) },
    ...riwayat.map((r) => (r.arah === "MASUK" ? { role: "user" as const, content: r.isi } : { role: "assistant" as const, content: r.isi })),
    { role: "user", content: teks.slice(0, 1000) },
  ]
  let wilayahId: number | undefined
  let token = 0
  for (let putaran = 0; putaran < 4; putaran++) {
    const { pesan: m, usage } = await panggilOpenAI(pesan)
    token += (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0)
    if (!m.tool_calls?.length) return { jawaban: (m.content ?? "").trim() || "Maaf, aku belum bisa menjawab itu.", wilayahId, token }
    pesan.push({ role: "assistant", content: m.content, tool_calls: m.tool_calls })
    for (const tc of m.tool_calls) {
      const r = await jalankanAlat(tc.function.name, tc.function.arguments).catch((e) => ({ hasil: { galat: String(e?.message ?? e) }, wilayahId: undefined }))
      if (r.wilayahId) wilayahId = r.wilayahId
      pesan.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(r.hasil) })
    }
  }
  return { jawaban: "Maaf, pertanyaannya belum bisa kuproses. Coba ketik *BANTUAN* untuk daftar perintah.", wilayahId, token }
}
