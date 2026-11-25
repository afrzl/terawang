/** Otak bot: perintah baku dijawab langsung dari database (tanpa LLM); pesan bebas diteruskan ke llm.ts. */
import { config } from "./config.ts"
import { daftarPeringatan, infoBerasMurah, infoHarga, infoStok } from "./data.ts"
import { BANTUAN, teksBerasMurah, teksHarga, teksPeringatan, teksPilihWilayah, teksStok, rp, nf } from "./format.ts"
import * as kontak from "./kontak.ts"
import { q } from "./db.ts"
import { jawabBebas, llmAktif } from "./llm.ts"
import * as pagar from "./pagar.ts"
import { cariDiKalimat, cocokkan, labelWilayah, normal, semuaWilayah, type Wilayah } from "./wilayah.ts"

type Perintah = "harga" | "stok" | "sphp" | "peringatan" | "langganan" | "berhenti" | "lapor" | "bantuan"

const ALIAS: Record<string, Perintah> = {
  harga: "harga", cek: "harga", hrg: "harga",
  stok: "stok", stock: "stok", persediaan: "stok",
  sphp: "sphp", murah: "sphp", bandingkan: "sphp", "beras murah": "sphp",
  peringatan: "peringatan", status: "peringatan", siaga: "peringatan", waspada: "peringatan",
  langganan: "langganan", daftar: "langganan", subscribe: "langganan",
  berhenti: "berhenti", stop: "berhenti", unsubscribe: "berhenti", unsub: "berhenti",
  lapor: "lapor", laporan: "lapor",
  bantuan: "bantuan", menu: "bantuan", help: "bantuan", halo: "bantuan", hai: "bantuan", hi: "bantuan", start: "bantuan", mulai: "bantuan", info: "bantuan", p: "bantuan",
}

type Tunda =
  | { jenis: "pilih"; perintah: Perintah; pilihan: Wilayah[]; sampai: number; sisa?: string }
  | { jenis: "lapor"; sampai: number }
const tunda = new Map<string, Tunda>()
const MENIT = 60_000

export type Balasan = { teks: string; intent: string; wilayahId: number | null }

export function uraiPerintah(teks: string): { perintah: Perintah; arg: string; mentah: string } | null {
  const n = normal(teks)
  const mentah = teks.trim().replace(/^\S+\s*/, "")
  if (n.startsWith("beras murah")) return { perintah: "sphp", arg: n.slice("beras murah".length).trim(), mentah }
  const [kata, ...sisa] = n.split(" ")
  const p = ALIAS[kata]
  if (!p) return null
  // "cek harga malang", "harga beras malang"
  let arg = sisa.join(" ")
  arg = arg.replace(/^(harga|stok|beras|di|untuk|wilayah)\s+/g, "").replace(/^(beras|di)\s+/, "").trim()
  return { perintah: p, arg, mentah }
}

async function jalankan(p: Perintah, w: Wilayah | null, k: kontak.Kontak, arg: string): Promise<Balasan> {
  const wid = w?.id ?? null
  switch (p) {
    case "harga":
      return { teks: teksHarga(await infoHarga(w!)), intent: "harga", wilayahId: wid }
    case "stok":
      return { teks: teksStok(await infoStok(w!)), intent: "stok", wilayahId: wid }
    case "sphp":
      return { teks: teksBerasMurah(await infoBerasMurah(w!)), intent: "beras_murah", wilayahId: wid }
    case "peringatan":
      return { teks: teksPeringatan(await daftarPeringatan(w?.id), w ? labelWilayah(w) : undefined), intent: "peringatan", wilayahId: wid }
    case "langganan": {
      await kontak.berlangganan(k.id, w!.id)
      const semua = await kontak.daftarLangganan(k.id)
      return {
        teks: [
          `✅ Kamu berlangganan peringatan *${labelWilayah(w!)}*.`,
          "Peringatan *siaga* dikirim saat itu juga; ringkasan *waspada* tiap Senin pukul 06.00 WIB.",
          semua.length > 1 ? `Wilayah langgananmu: ${semua.map(labelWilayah).join(", ")}.` : "",
          "Balas *BERHENTI* kapan saja untuk berhenti.",
        ].filter(Boolean).join("\n"),
        intent: "langganan",
        wilayahId: wid,
      }
    }
    case "berhenti": {
      await kontak.berhenti(k.id, w?.id)
      return {
        teks: w ? `Langganan peringatan ${labelWilayah(w)} dihentikan.` : "Semua langganan peringatan dihentikan. Kamu tetap bisa bertanya kapan saja.",
        intent: "berhenti",
        wilayahId: wid,
      }
    }
    case "lapor":
      return laporHarga(k, arg)
    case "bantuan":
      return { teks: BANTUAN, intent: "bantuan", wilayahId: null }
  }
}

const BUTUH_WILAYAH: Perintah[] = ["harga", "stok", "sphp", "langganan"]

async function denganWilayah(nomor: string, k: kontak.Kontak, p: Perintah, arg: string): Promise<Balasan> {
  const daftar = await semuaWilayah()
  const wajib = BUTUH_WILAYAH.includes(p)
  if (!arg) {
    if (p === "berhenti" || p === "peringatan" || p === "bantuan" || p === "lapor") return jalankan(p, null, k, arg)
    const ingat = daftar.find((w) => w.id === k.wilayah_id)
    if (ingat) return jalankan(p, ingat, k, arg)
    return { teks: `Sebutkan wilayahnya, misalnya *${p.toUpperCase()} MALANG* atau *${p.toUpperCase()} KOTA SURABAYA*.`, intent: p, wilayahId: null }
  }
  const c = cocokkan(arg, daftar)
  if (c.jenis === "pas") {
    if (wajib) await kontak.ingatWilayah(k.id, c.wilayah.id)
    return jalankan(p, c.wilayah, k, arg)
  }
  if (c.jenis === "ambigu") {
    tunda.set(nomor, { jenis: "pilih", perintah: p, pilihan: c.pilihan, sampai: Date.now() + 10 * MENIT })
    return { teks: teksPilihWilayah(c.pilihan, labelWilayah), intent: p, wilayahId: null }
  }
  return { teks: `Wilayah "${arg}" tidak ditemukan. TERAWANG mencakup 38 kab/kota di Jawa Timur, misalnya Malang, Jember, Kota Surabaya.`, intent: p, wilayahId: null }
}

const POLA_LAPOR = /^(.+?)[,;\n]\s*(medium|premium)\s*[,;\n]\s*(?:rp\.?\s*)?([\d.,]+)/i

async function laporHarga(k: kontak.Kontak, arg: string): Promise<Balasan> {
  const m = arg.match(POLA_LAPOR)
  if (!m) {
    tunda.set(k.nomor_wa, { jenis: "lapor", sampai: Date.now() + 15 * MENIT })
    return {
      teks: "Kirim harga beras di pasarmu dengan format:\n*nama pasar, jenis beras, harga/kg*\n\nContoh: _Pasar Besar Malang, medium, 13800_",
      intent: "lapor",
      wilayahId: null,
    }
  }
  const pasar = m[1].trim()
  const jenis = m[2].toLowerCase()
  const harga = Number(m[3].replace(/[.,](?=\d{3}\b)/g, "").replace(",", "."))
  if (!Number.isFinite(harga) || harga < 5000 || harga > 40000) {
    return { teks: "Harganya sepertinya kurang tepat. Tulis harga per kg dalam rupiah, misalnya 13800.", intent: "lapor", wilayahId: null }
  }
  const daftar = await semuaWilayah()
  const c = cariDiKalimat(pasar, daftar)
  const wilayahId = c.jenis === "pas" ? c.wilayah.id : k.wilayah_id
  const w = daftar.find((x) => x.id === wilayahId)
  const r = await kontak.simpanLaporan(k.id, wilayahId, `beras_${jenis}`, pasar, Math.round(harga))
  tunda.delete(k.nomor_wa)
  return {
    teks: [
      "✓ *Laporan diterima*",
      `Pasar: ${pasar}${w ? ` (${labelWilayah(w)})` : ""}`,
      `Beras ${jenis}: ${rp(harga)}/kg`,
      r?.panel ? `Panel harga wilayah ini: ${rp(r.panel)}/kg (${(r.selisih ?? 0) > 0 ? "+" : ""}${nf(r.selisih)}%)` : "",
      "Status: menunggu validasi",
      "",
      "Terima kasih, laporanmu membantu memantau harga beras di wilayah ini.",
    ].filter(Boolean).join("\n"),
    intent: "lapor",
    wilayahId: wilayahId ?? null,
  }
}

async function riwayat(kontakId: number) {
  const rows = await q<{ arah: "MASUK" | "KELUAR"; isi: string }>(
    `select arah::text as arah, isi from app.percakapan_bot where kontak_id = $1 and dibuat_pada > now() - interval '2 hours'
      order by dibuat_pada desc limit 5`,
    [kontakId],
  )
  // pesan masuk yang sedang diproses sudah tercatat; buang supaya tidak dobel
  return rows.slice(1).reverse().slice(-4)
}

async function pesanBebas(k: kontak.Kontak, teks: string): Promise<Balasan> {
  const daftar = await semuaWilayah()
  // pesan yang isinya hanya nama wilayah -> HARGA (tanpa LLM)
  const hanya = cocokkan(teks, daftar)
  if (hanya.jenis === "pas" && normal(teks).split(" ").length <= 3) {
    await kontak.ingatWilayah(k.id, hanya.wilayah.id)
    return jalankan("harga", hanya.wilayah, k, teks)
  }
  if (!llmAktif()) return { teks: `Maaf, aku belum paham pesannya.\n\n${BANTUAN}`, intent: "tidak_dikenal", wilayahId: null }

  // guard rail sebelum OpenAI: panjang, injeksi prompt, topik
  const sebut = cariDiKalimat(teks, daftar).jenis !== "tidak_ada"
  const tolak = pagar.cekMasukan(teks, sebut)
  if (tolak) return { teks: tolak.teks, intent: `tolak_${tolak.alasan}`, wilayahId: null }

  // cache: pertanyaan yang sama dalam 30 menit dijawab tanpa memanggil OpenAI lagi
  const kunci = pagar.kunciCache(teks, k.wilayah_id)
  const c = pagar.ambilCache(kunci)
  if (c) return { teks: c.jawaban, intent: "llm_cache", wilayahId: c.wilayahId ?? null }

  const batas = pagar.cekBatas(k.id, await kontak.jumlahLlmHariIni(k.id))
  if (batas) return { teks: `${batas.teks}\n\n${BANTUAN}`, intent: `tolak_${batas.alasan}`, wilayahId: null }

  const ingat = daftar.find((w) => w.id === k.wilayah_id) ?? null
  try {
    const r = await jawabBebas(teks, await riwayat(k.id), ingat)
    pagar.catatToken(r.token)
    console.log(`[llm] kontak=${k.id} token=${r.token} alat=${r.pakaiAlat} hari_ini=${pagar.pemakaianHariIni().token}`)
    const jawaban = pagar.rapikanJawaban(r.jawaban)
    if (!jawaban || pagar.angkaTanpaData(jawaban, r.pakaiAlat)) {
      return { teks: `Maaf, aku belum bisa menjawab itu dengan data yang ada. Coba perintah baku:\n\n${BANTUAN}`, intent: "llm_ditolak", wilayahId: null }
    }
    if (r.wilayahId) await kontak.ingatWilayah(k.id, r.wilayahId)
    pagar.simpanCache(kunci, jawaban, r.wilayahId)
    return { teks: jawaban, intent: "llm", wilayahId: r.wilayahId ?? null }
  } catch (e) {
    console.error("[llm] gagal:", e)
    return { teks: `Maaf, layanan tanya-jawab sedang gangguan. Coba perintah baku dulu:\n\n${BANTUAN}`, intent: "llm_gagal", wilayahId: null }
  }
}

/** Tanggapi satu pesan masuk. Mencatat pesan masuk dan keluar di app.percakapan_bot. */
export async function tanggapi(nomor: string, nama: string | undefined, teks: string): Promise<Balasan> {
  const k = await kontak.kontakDari(nomor, nama)
  const bersih = teks.trim()
  await kontak.catat(k.id, "MASUK", bersih, null, null)
  let b: Balasan
  try {
    b = await proses(nomor, k, bersih)
  } catch (e) {
    console.error("[bot] galat:", e)
    b = { teks: "Maaf, terjadi gangguan saat mengambil data. Coba lagi sebentar lagi.", intent: "galat", wilayahId: null }
  }
  await kontak.catat(k.id, "KELUAR", b.teks, b.intent, b.wilayahId)
  return b
}

async function proses(nomor: string, k: kontak.Kontak, teks: string): Promise<Balasan> {
  const t = tunda.get(nomor)
  if (t && t.sampai < Date.now()) tunda.delete(nomor)
  const cmd = uraiPerintah(teks)

  if (t && t.sampai >= Date.now() && !cmd) {
    if (t.jenis === "pilih") {
      const i = Number(teks.trim()) - 1
      const w = t.pilihan[i] ?? (() => {
        const c = cocokkan(teks, t.pilihan)
        return c.jenis === "pas" ? c.wilayah : undefined
      })()
      if (w) {
        tunda.delete(nomor)
        if (BUTUH_WILAYAH.includes(t.perintah)) await kontak.ingatWilayah(k.id, w.id)
        return jalankan(t.perintah, w, k, "")
      }
    }
    if (t.jenis === "lapor") return laporHarga(k, teks)
  }
  if (cmd) {
    tunda.delete(nomor)
    if (cmd.perintah === "lapor") return laporHarga(k, cmd.mentah)
    return denganWilayah(nomor, k, cmd.perintah, cmd.arg)
  }
  return pesanBebas(k, teks)
}
