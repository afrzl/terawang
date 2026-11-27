/** Otak bot: perintah baku dijawab langsung dari database (tanpa LLM); pesan bebas diteruskan ke llm.ts. */
import { config } from "./config.ts"
import { daftarPeringatan, infoBerasMurah, infoHarga, infoStok, peringkatWilayah, type UkuranPeringkat } from "./data.ts"
import { BANTUAN, teksBerasMurah, teksHarga, teksPeringatan, teksPeringkat, teksPilihWilayah, teksStok, rp, nf } from "./format.ts"
import * as kontak from "./kontak.ts"
import { q } from "./db.ts"
import { jawabBebas, llmAktif, pilahNiat } from "./llm.ts"
import * as pagar from "./pagar.ts"
import * as lapor from "./lapor.ts"
import { pantau } from "./pantau.ts"
import { buangSalam, CONTOH, jawabBasaBasi, jawabIstilah, POLA_TERIMA_KASIH, TERIMA_KASIH } from "./istilah.ts"
import { dataGrafik, jenisDisebut, pngGrafik, POLA_GRAFIK, POLA_GRAFIK_BELUM, rentangDisebut, svgGrafik, teksGrafik, topikDisebut, type Jenis, type TopikGrafik } from "./grafik.ts"
import { bulanDariHari, dataProduksi, dataStok, svgBulanan, teksBulanan } from "./grafik-bulanan.ts"
import { cariDiKalimat, cocokkan, labelWilayah, normal, semuaWilayah, type Wilayah } from "./wilayah.ts"

type Perintah = "harga" | "stok" | "sphp" | "peringatan" | "langganan" | "berhenti" | "lapor" | "bantuan" | "grafik"

const ALIAS: Record<string, Perintah> = {
  harga: "harga", cek: "harga", hrg: "harga",
  stok: "stok", stock: "stok", persediaan: "stok",
  sphp: "sphp", murah: "sphp", bandingkan: "sphp", "beras murah": "sphp",
  peringatan: "peringatan", status: "peringatan", siaga: "peringatan", waspada: "peringatan",
  langganan: "langganan", daftar: "langganan", subscribe: "langganan",
  berhenti: "berhenti", stop: "berhenti", unsubscribe: "berhenti", unsub: "berhenti",
  lapor: "lapor", laporan: "lapor",
  grafik: "grafik", chart: "grafik", diagram: "grafik", visualisasi: "grafik", kurva: "grafik",
  bantuan: "bantuan", menu: "bantuan", help: "bantuan",  start: "bantuan", mulai: "bantuan", info: "bantuan",
}

type Tunda =
  | { jenis: "pilih"; perintah: Perintah; pilihan: Wilayah[]; sampai: number; sisa?: string }
  | { jenis: "lapor"; sampai: number; draf: lapor.Draf; tanya?: lapor.Isian | "wilayah"; teks?: string; calon?: number[]; usul?: number; wilayahId?: number }
const tunda = new Map<string, Tunda>()
// laporan terakhir yang baru disimpan: balasan pendek "pembeli"/"penjual" dalam 10 menit mengoreksi perannya
const laporTerakhir = new Map<string, { id: number; sampai: number }>()
const MENIT = 60_000

/** `gambar`: PNG yang dikirim sebagai gambar WhatsApp dengan `teks` sebagai keterangannya. */
export type Balasan = { teks: string; intent: string; wilayahId: number | null; topik?: string; gambar?: Buffer }

// konteks ringan per kontak: topik + wilayah terakhir, 30 menit. Cukup untuk pertanyaan lanjutan
// ("kalau 2 minggu lagi?") tanpa memperpanjang riwayat yang dikirim ke OpenAI.
type Konteks = { wilayahId: number; topik: string; sampai: number }
const konteks = new Map<number, Konteks>()
const TOPIK_ALAT: Record<string, string> = { harga_wilayah: "harga", stok_wilayah: "stok", beras_murah: "beras murah/SPHP" }

const PENGISI = new Set(["harga", "harganya", "stok", "stoknya", "beras", "berasnya", "di", "untuk", "buat", "wilayah", "daerah", "sekarang", "skrg", "hari", "ini", "dong", "donk", "ya", "nya", "gimana", "gmn", "berapa", "brp"])

export function uraiPerintah(teks: string): { perintah: Perintah; arg: string; mentah: string } | null {
  const n = normal(teks)
  const mentah = teks.trim().replace(/^\S+\s*/, "")
  if (n.startsWith("beras murah")) return { perintah: "sphp", arg: n.slice("beras murah".length).trim(), mentah }
  const [kata, ...sisa] = n.split(" ")
  const p = ALIAS[kata]
  if (!p) return null
  // "cek harga malang", "harga beras malang"
  let arg = sisa.join(" ")
  // buang kata pengisi di depan: "stok beras" -> "", "harga beras di malang" -> "malang"
  const isi = arg.split(" ")
  while (isi.length && PENGISI.has(isi[0])) isi.shift()
  arg = isi.join(" ")
  return { perintah: p, arg, mentah }
}

// ---- peringkat se-Jatim ("paling murah di mana?", "cek seluruh kab jatim") tanpa OpenAI

const POLA_SELURUH = /\b(semua|seluruh|se ?jatim|se ?jawa timur|jatim|jawa timur|tiap|setiap|masing masing|all)\b/

export function deteksiPeringkat(teks: string): { ukuran: UkuranPeringkat; urutan: "terendah" | "tertinggi" } | null {
  const n = normal(teks)
  const stok = /\b(stok|stock|persediaan|cadangan|defisit|surplus)\b/.test(n)
  if (stok) {
    if (/\b(paling|ter)\s?(tipis|sedikit|kurang|rendah|parah|kritis)|terendah|\bdefisit\b.*\b(mana|dimana|apa saja)\b|\b(mana|dimana)\b.*\bdefisit\b|paling defisit/.test(n)) return { ukuran: "stok_cakupan", urutan: "terendah" }
    if (/\b(paling|ter)\s?(banyak|aman|longgar|tinggi|besar)|tertinggi|surplus\b.*\b(mana|dimana)\b/.test(n)) return { ukuran: "stok_cakupan", urutan: "tertinggi" }
    return null
  }
  const ukuran: UkuranPeringkat = /\bpremium\b/.test(n) ? "harga_premium" : "harga_medium"
  if (/\b(paling|ter)\s?murah|murah (banget |sendiri )?(di ?mana|mana)|\bharga terendah|paling rendah/.test(n)) return { ukuran, urutan: "terendah" }
  if (/\b(paling|ter)\s?mahal|mahal (banget |sendiri )?(di ?mana|mana)|\bharga tertinggi|paling tinggi/.test(n)) return { ukuran, urutan: "tertinggi" }
  return null
}

async function jawabPeringkat(ukuran: UkuranPeringkat, urutan: "terendah" | "tertinggi"): Promise<Balasan> {
  return { teks: teksPeringkat(await peringkatWilayah(ukuran, urutan, 5), ukuran, urutan), intent: "peringkat", wilayahId: null, topik: ukuran.startsWith("harga") ? "harga" : "stok" }
}

async function jalankan(p: Perintah, w: Wilayah | null, k: kontak.Kontak, arg: string): Promise<Balasan> {
  const wid = w?.id ?? null
  switch (p) {
    case "harga":
      return { teks: teksHarga(await infoHarga(w!)), intent: "harga", wilayahId: wid, topik: "harga" }
    case "stok":
      return { teks: teksStok(await infoStok(w!)), intent: "stok", wilayahId: wid, topik: "stok" }
    case "sphp":
      return { teks: teksBerasMurah(await infoBerasMurah(w!)), intent: "beras_murah", wilayahId: wid, topik: "beras murah/SPHP" }
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
    case "grafik":
      return buatGrafik(w, arg, k)
    case "bantuan":
      return { teks: BANTUAN, intent: "bantuan", wilayahId: null }
  }
}

// ---- grafik harga, stok, produksi (gambar PNG dari data, tanpa OpenAI)

// grafik terakhir per kontak (30 menit): pesan lanjutan "kalau setahun?" atau "premium aja" memakai wilayah/rentang/jenis ini
type KonteksGrafik = { wilayahId: number | null; topik: TopikGrafik; hari: number | null; jenis: Jenis; sampai: number }
const konteksGrafik = new Map<number, KonteksGrafik>()
function grafikAktif(kontakId: number): KonteksGrafik | null {
  const g = konteksGrafik.get(kontakId)
  return g && g.sampai > Date.now() ? g : null
}

async function buatGrafik(w: Wilayah | null, teks: string, k: kontak.Kontak, topikObrolan?: TopikGrafik): Promise<Balasan> {
  const n = normal(teks)
  const lalu = grafikAktif(k.id)
  const disebut = topikDisebut(teks)
  if (!disebut && POLA_GRAFIK_BELUM.test(n)) {
    return {
      teks: "Grafik untuk itu belum ada, maaf ya 🙏 Sejauh ini aku bisa bikin grafik *harga*, *stok*, dan *produksi* beras per kab/kota. Kalau mau angkanya dalam teks, tanya biasa aja.",
      intent: "grafik_belum", wilayahId: w?.id ?? null,
    }
  }
  const topik = disebut ?? topikObrolan ?? lalu?.topik ?? "harga"
  // rentang yang tidak disebut ikut grafik sebelumnya; jenis beras hanya untuk grafik harga
  const hariDisebut = rentangDisebut(teks)
  const hari = hariDisebut ?? (lalu && lalu.topik === topik ? lalu.hari : null)
  const ingat = (jenis: Jenis) => konteksGrafik.set(k.id, { wilayahId: w?.id ?? null, topik, hari, jenis, sampai: Date.now() + 30 * MENIT })
  if (topik === "harga") {
    const jenis = jenisDisebut(teks) ?? lalu?.jenis ?? "keduanya"
    const d = await dataGrafik(w, hari ?? 30, jenis)
    if (d.titik.length < 2) return { teks: `Data harga beras ${d.judul} belum cukup buat digambar grafiknya.`, intent: "grafik_kosong", wilayahId: d.wilayahId }
    ingat(jenis)
    return { teks: teksGrafik(d), intent: "grafik", wilayahId: d.wilayahId, topik: "harga", gambar: pngGrafik(svgGrafik(d)) }
  }
  const d = topik === "stok" ? await dataStok(w, bulanDariHari(hari)) : await dataProduksi(w, bulanDariHari(hari))
  if (d.titik.length < 2) {
    return { teks: `Data ${topik} beras ${d.judul} belum cukup buat digambar grafiknya. Coba tanya angkanya langsung, misalnya _${topik} ${w ? labelWilayah(w).toLowerCase() : "jember"}_.`, intent: "grafik_kosong", wilayahId: d.wilayahId }
  }
  ingat(lalu?.jenis ?? "keduanya")
  return { teks: teksBulanan(d), intent: `grafik_${topik}`, wilayahId: d.wilayahId, topik, gambar: pngGrafik(svgBulanan(d)) }
}

/** "grafik harga beras sebulan ini", "GRAFIK Malang 3 bulan", "bikinin chart harga di jember dong". */
async function grafikDariKalimat(nomor: string, k: kontak.Kontak, teks: string): Promise<Balasan> {
  const daftar = await semuaWilayah()
  const n = normal(teks)
  const seJatim = /\b(jatim|jawa timur|se ?jatim|seluruh|semua)\b/.test(n)
  const di = cariDiKalimat(teks.replace(/jawa timur|jatim/gi, ""), daftar)
  if (di.jenis === "pas") {
    await kontak.ingatWilayah(k.id, di.wilayah.id)
    return buatGrafik(di.wilayah, teks, k)
  }
  if (di.jenis === "ambigu") {
    tunda.set(nomor, { jenis: "pilih", perintah: "grafik", pilihan: di.pilihan, sampai: Date.now() + 10 * MENIT, sisa: teks })
    return { teks: teksPilihWilayah(di.pilihan, labelWilayah), intent: "pilih_wilayah", wilayahId: null }
  }
  if (seJatim) return buatGrafik(null, teks, k)
  // tanpa nama wilayah: wilayah yang paling akhir dibicarakan (30 menit), selain itu rata-rata Jawa Timur.
  // "kota probolinggo" lalu "grafiknya" harus Probolinggo walau grafik sebelumnya Jember.
  const g = grafikAktif(k.id)
  const kt0 = konteks.get(k.id)
  const kt = kt0 && kt0.sampai > Date.now() ? kt0 : null
  if (kt && (!g || kt.sampai > g.sampai)) {
    const topikObrolan = kt.topik === "harga" || kt.topik === "stok" ? kt.topik : undefined
    return buatGrafik(daftar.find((w) => w.id === kt.wilayahId) ?? null, teks, k, g && g.wilayahId === kt.wilayahId ? undefined : topikObrolan)
  }
  if (g) return buatGrafik(daftar.find((w) => w.id === g.wilayahId) ?? null, teks, k)
  return buatGrafik(null, teks, k)
}

/** Jawaban pilihan "kota", "kab", "kabupatennya", "yang kota" untuk Kab./Kota bernama sama. */
export function pilihJenis(teks: string, pilihan: Wilayah[]): Wilayah | undefined {
  const n = normal(teks).replace(/\b(yang|yg|itu|aja|saja|nya|dong|ya)\b/g, "").trim()
  // toleran salah ketik: "kabupatne", "kabupetan", "kotaa"
  const jenis = /^(kot[a-z]{0,5}|kt)$/.test(n) ? "KOTA" : /^(kab[a-z]{0,9}|kb)$/.test(n) ? "KABUPATEN" : null
  if (!jenis) return undefined
  const cocok = pilihan.filter((w) => w.jenis === jenis)
  return cocok.length === 1 ? cocok[0] : undefined
}

/** Pesan pendek setelah grafik yang hanya mengganti rentang/jenis/wilayah: "klo setahun?", "premium aja", "kalau jember?". */
export function lanjutanGrafik(teks: string, adaWilayah: boolean): boolean {
  const n = normal(teks)
  if (n.split(" ").length > 7) return false
  if (/\b(berapa|brp|sphp|lapor|prakiraan|prediksi|naik|turun|kenapa|mengapa|lagi|depan|kedepan|besok|aman|cukup)\b/.test(n)) return false
  if (rentangDisebut(teks) != null || jenisDisebut(teks) != null || topikDisebut(teks) != null) return true
  return adaWilayah && /\b(kalau|kalo|klo|kl|gimana|gmn|bagaimana|kalau di|terus|trs)\b/.test(n)
}

const BUTUH_WILAYAH: Perintah[] = ["harga", "stok", "sphp", "langganan"]

async function denganWilayah(nomor: string, k: kontak.Kontak, p: Perintah, arg: string, teksAsli = ""): Promise<Balasan> {
  const daftar = await semuaWilayah()
  const wajib = BUTUH_WILAYAH.includes(p)
  if (!arg) {
    if (p === "berhenti" || p === "peringatan" || p === "bantuan" || p === "lapor") return jalankan(p, null, k, arg)
    const ingat = daftar.find((w) => w.id === k.wilayah_id)
    if (ingat) return jalankan(p, ingat, k, arg)
    return { teks: `Wilayahnya mana nih? Misalnya _${p} jember_ atau _${p} kota surabaya_.`, intent: p, wilayahId: null }
  }
  // "HARGA seluruh", "cek seluruh kab jatim", "stok semua kabupaten": peringkat se-Jatim
  if ((p === "harga" || p === "stok") && POLA_SELURUH.test(normal(arg)) && cariDiKalimat(arg.replace(/jawa timur|jatim/gi, ""), daftar).jenis === "tidak_ada") {
    const pr = deteksiPeringkat(`${p} ${arg}`)
    if (pr) return jawabPeringkat(pr.ukuran, pr.urutan)
    if (p === "stok") return jawabPeringkat("stok_cakupan", "terendah")
    const [murah, mahal] = await Promise.all([jawabPeringkat("harga_medium", "terendah"), jawabPeringkat("harga_medium", "tertinggi")])
    return { ...murah, teks: `${murah.teks.split("\n\nKetik")[0]}\n\n${mahal.teks}` }
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
  // "harga beras bulan depan kira2 brp ya di malang": ini kalimat, bukan nama wilayah.
  // Kalimat panjang diteruskan ke jalur pesan bebas (OpenAI); tanpa LLM, cari wilayah di dalam kalimat.
  // "stok jember aman?", "harga di blitar dong": wilayah ada di dalam sisa kalimat
  const di = cariDiKalimat(arg, daftar)
  const panjang = normal(arg).split(" ").length > 4
  if (di.jenis === "pas" && (!panjang || !llmAktif())) {
    if (wajib) await kontak.ingatWilayah(k.id, di.wilayah.id)
    return jalankan(p, di.wilayah, k, arg)
  }
  if (di.jenis === "ambigu" && (!panjang || !llmAktif())) {
    tunda.set(nomor, { jenis: "pilih", perintah: p, pilihan: di.pilihan, sampai: Date.now() + 10 * MENIT })
    return { teks: teksPilihWilayah(di.pilihan, labelWilayah), intent: p, wilayahId: null }
  }
  if (teksAsli && normal(arg).split(" ").length > 2 && llmAktif()) return pesanBebas(k, teksAsli)
  return { teks: `Hmm, aku nggak nemu wilayah "${arg}". Aku bisa bantu 38 kab/kota di Jawa Timur, misalnya Jember, Kota Malang, atau Kota Surabaya.`, intent: p, wilayahId: null }
}

/** Selisih laporan terhadap panel, dihitung di sini (bukan oleh LLM): 15000 vs 12646 -> "+18,6%". */
export function teksSelisih(harga: number, panel: number): string {
  const v = Math.round(((harga / panel) - 1) * 1000) / 10
  return `${v > 0 ? "+" : ""}${nf(v)}%`
}

const NAMA_PERAN: Record<lapor.Peran, string> = { PENJUAL: "penjual", PEMBELI: "pembeli" }

function ringkasDraf(d: lapor.Draf): string {
  const bagian = [
    d.pasar,
    d.jenis || d.harga ? `beras ${d.jenis ?? ""}${d.harga ? ` ${rp(d.harga)}/kg` : ""}`.replace(/\s+/g, " ").trim() : "",
    d.peran ? `kamu ${NAMA_PERAN[d.peran]}` : "",
  ].filter(Boolean)
  return bagian.join(", ")
}

const TANYA: Record<lapor.Isian, string> = {
  harga: "Harganya berapa per kg? Misalnya _13800_ atau _14 rb_.",
  jenis: "Berasnya *medium* atau *premium*?",
  pasar: "Di mana tempatnya? Misalnya _Pasar Besar Malang_ atau _Toko Makmur Jember_.",
  peran: "Kamu di sana sebagai *penjual* atau *pembeli*?",
}

/**
 * Laporan harga warga: boleh bahasa bebas ("di pasar induk kota batu, beras medium 15000, aku pembeli")
 * maupun format lama "pasar, jenis, harga". Isian yang kurang ditanyakan satu per satu, lalu disimpan.
 */
async function laporHarga(k: kontak.Kontak, teks: string, awal?: Extract<Tunda, { jenis: "lapor" }>): Promise<Balasan> {
  const n = normal(teks)
  if (awal && lapor.BATAL.test(n)) {
    tunda.delete(k.nomor_wa)
    return { teks: "Oke, laporannya nggak jadi. Kalau mau lapor lagi, ketik aja _lapor_.", intent: "lapor_batal", wilayahId: null }
  }
  const daftar = await semuaWilayah()
  // jawaban atas "itu di kab/kota mana?" / "Blimbing itu di Kota Malang, ya?"
  if (awal?.tanya === "wilayah") {
    const calon = (awal.calon ?? []).map((id) => daftar.find((w) => w.id === id)).filter((w): w is Wilayah => Boolean(w))
    const i = Number(teks.trim()) - 1
    let pilih: Wilayah | undefined = calon[i] ?? pilihJenis(teks, calon)
    const usul = awal.usul
    if (!pilih && usul && lapor.POLA_YA.test(n)) pilih = daftar.find((w) => w.id === usul)
    if (!pilih) {
      const c = cocokkan(teks, daftar)
      const di = c.jenis === "pas" ? c : cariDiKalimat(teks, daftar)
      if (di.jenis === "pas") pilih = di.wilayah
      else if (di.jenis === "ambigu") {
        tunda.set(k.nomor_wa, { ...awal, sampai: Date.now() + 15 * MENIT, calon: di.pilihan.map((w) => w.id), usul: undefined })
        return { teks: `${di.pilihan.map(labelWilayah).join(" atau ")}? Balas _kab_ atau _kota_ aja.`, intent: "lapor", wilayahId: null }
      }
    }
    if (!pilih) {
      tunda.set(k.nomor_wa, { ...awal, sampai: Date.now() + 15 * MENIT, usul: undefined })
      return {
        teks: lapor.POLA_BUKAN.test(n) ? "Oke, kalau gitu tempatnya di kab/kota mana? Misalnya _Kota Malang_ atau _Kab. Jember_." : "Hmm, aku belum nemu kab/kota itu. Sebut nama kab/kota di Jawa Timur ya, misalnya _Kota Malang_ atau _Kab. Jember_.",
        intent: "lapor", wilayahId: null,
      }
    }
    awal = { ...awal, wilayahId: pilih.id, tanya: undefined }
    teks = ""
  }
  let baru = teks ? lapor.uraiLaporan(teks) : {}
  // jawaban pendek atas pertanyaan terakhir: "pasar tanjung" / "tanjung" untuk pasar, "jual" untuk peran
  if (awal?.tanya === "pasar" && !baru.pasar && !baru.harga && !baru.peran && !baru.jenis && n && n.split(" ").length <= 6 && !lapor.POLA_YA.test(n) && !lapor.POLA_BUKAN.test(n)) baru.pasar = teks.trim().replace(/^(di|dari)\s+/i, "").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 80)
  let d: lapor.Draf = { ...(awal?.draf ?? {}), ...baru }
  const gabung = `${awal?.teks ?? ""} ${teks}`.trim()
  if (teks && lapor.kurang(d).length && !awal?.tanya) d = await lapor.lengkapiDenganLLM(teks, d)
  else if (teks && lapor.kurang(d).length && awal && Object.keys(baru).length === 0) d = await lapor.lengkapiDenganLLM(teks, d)
  const sisa = lapor.kurang(d)
  if (sisa.length) {
    const tanya = sisa[0]
    tunda.set(k.nomor_wa, { jenis: "lapor", sampai: Date.now() + 15 * MENIT, draf: d, tanya, teks: gabung.slice(-600), wilayahId: awal?.wilayahId })
    const ada = ringkasDraf(d)
    if (!ada) {
      const aneh = lapor.adaAngkaAneh(teks)
      return {
        teks: aneh
          ? "Harganya sepertinya bukan per kg nih. Tulis harga per kg ya, misalnya _13800_ atau _14 rb_."
          : [
              "Boleh banget! Ceritain aja pakai bahasamu sendiri, misalnya:",
              "_aku beli beras medium di Pasar Besar Malang 13.800 sekilo_",
              "_aku jual premium 15 rb di Pasar Induk Kota Batu_",
              "",
              "Sebutin juga kamu *penjual* atau *pembeli* ya. Ketik _batal_ kalau nggak jadi.",
            ].join("\n"),
        intent: "lapor",
        wilayahId: null,
      }
    }
    const aneh = tanya === "harga" && lapor.adaAngkaAneh(teks) ? "Harganya sepertinya bukan per kg. " : ""
    return { teks: `${aneh}Oke, aku catat: ${ada}.\n${TANYA[tanya]}`, intent: "lapor", wilayahId: null }
  }
  // kab/kota pasar harus pasti: dari nama kab/kota di kalimat; kalau hanya kecamatan atau tidak disebut, tanya dulu
  let wilayahId = awal?.wilayahId
  if (!wilayahId) {
    const c = cariDiKalimat(`${d.pasar} ${gabung}`, daftar)
    if (c.jenis === "pas") wilayahId = c.wilayah.id
    else {
      const simpan = (x: Partial<Extract<Tunda, { jenis: "lapor" }>>) =>
        tunda.set(k.nomor_wa, { jenis: "lapor", sampai: Date.now() + 15 * MENIT, draf: d, tanya: "wilayah", teks: gabung.slice(-600), ...x })
      const kec = lapor.kecamatanDisebut(`${d.pasar} ${gabung}`, daftar)
      if (c.jenis === "ambigu") {
        simpan({ calon: c.pilihan.map((w) => w.id) })
        return { teks: `Oke, tinggal satu: ${d.pasar} itu di ${c.pilihan.map(labelWilayah).join(" atau ")}? Balas _kab_ atau _kota_ aja.`, intent: "lapor", wilayahId: null }
      }
      if (kec && kec.wilayah.length === 1) {
        simpan({ calon: kec.wilayah.map((w) => w.id), usul: kec.wilayah[0].id })
        return { teks: `Oke, tinggal satu: Kecamatan ${kec.kecamatan} itu di *${labelWilayah(kec.wilayah[0])}*, ya? Balas _ya_, atau sebut kab/kota-nya.`, intent: "lapor", wilayahId: null }
      }
      if (kec) {
        simpan({ calon: kec.wilayah.map((w) => w.id) })
        return { teks: `Oke, tinggal satu: Kecamatan ${kec.kecamatan} ada di beberapa tempat:\n${kec.wilayah.map((w, i) => `${i + 1}. ${labelWilayah(w)}`).join("\n")}\nYang mana? Balas angkanya.`, intent: "lapor", wilayahId: null }
      }
      const ingat = daftar.find((w) => w.id === k.wilayah_id)
      simpan({ usul: ingat?.id })
      return {
        teks: ingat
          ? `Oke, tinggal satu: ${d.pasar} itu di *${labelWilayah(ingat)}*, ya? Balas _ya_, atau sebut kab/kota-nya.`
          : `Oke, tinggal satu: ${d.pasar} itu di kab/kota mana? Misalnya _Kota Malang_ atau _Kab. Jember_.`,
        intent: "lapor", wilayahId: null,
      }
    }
  }
  const w = daftar.find((x) => x.id === wilayahId)
  const r = await kontak.simpanLaporan(k.id, wilayahId, `beras_${d.jenis}`, d.pasar!, d.harga!, d.peran!, gabung)
  tunda.delete(k.nomor_wa)
  if (r?.id) laporTerakhir.set(k.nomor_wa, { id: r.id, sampai: Date.now() + 10 * MENIT })
  return {
    teks: [
      "✓ *Laporan diterima, makasih ya!*",
      `Tempat: ${d.pasar}${w ? ` (${labelWilayah(w)})` : ""}`,
      `Beras ${d.jenis}: ${rp(d.harga!)}/kg`,
      `Sebagai: ${NAMA_PERAN[d.peran!]}`,
      r?.panel ? `Panel harga wilayah ini: ${rp(r.panel)}/kg (${teksSelisih(d.harga!, r.panel)} dari panel)` : "",
      "Status: menunggu dicek petugas",
      "",
      "Laporanmu bantu kami memantau harga beras di wilayah ini.",
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

async function pesanBebas(k: kontak.Kontak, teks: string, pilihan: Wilayah | null = null): Promise<Balasan> {
  const basa = pilihan ? null : jawabBasaBasi(teks)
  if (basa) return { teks: basa, intent: "salam", wilayahId: null }
  const daftar = await semuaWilayah()
  // pesan yang isinya hanya nama wilayah -> HARGA (tanpa LLM)
  const hanya = cocokkan(teks, daftar)
  if (hanya.jenis === "pas" && normal(teks).split(" ").length <= 3) {
    await kontak.ingatWilayah(k.id, hanya.wilayah.id)
    return jalankan("harga", hanya.wilayah, k, teks)
  }
  const istilah = jawabIstilah(teks)
  if (istilah) return { teks: istilah, intent: "istilah", wilayahId: null }
  if (!llmAktif()) return { teks: `Maaf, aku belum paham pesannya.\n\n${BANTUAN}`, intent: "tidak_dikenal", wilayahId: null }

  // guard rail sebelum OpenAI: panjang, injeksi prompt, topik
  const di = pilihan ? null : cariDiKalimat(teks, daftar)
  // "di malang" bisa Kabupaten atau Kota: tanya balik dulu tanpa memanggil OpenAI
  if (di?.jenis === "ambigu") {
    const perintah: Perintah = /\bstok\b/.test(normal(teks)) ? "stok" : "harga"
    tunda.set(k.nomor_wa, { jenis: "pilih", perintah, pilihan: di.pilihan, sampai: Date.now() + 10 * MENIT, sisa: teks })
    return { teks: teksPilihWilayah(di.pilihan, labelWilayah), intent: "pilih_wilayah", wilayahId: null }
  }
  if (pilihan) teks = `${teks} (wilayah: ${labelWilayah(pilihan)})`
  const sebut = Boolean(pilihan) || di?.jenis === "pas"
  const kt = konteks.get(k.id)
  const lanjut = kt && kt.sampai > Date.now() ? kt : null
  // pertanyaan lanjutan ("kalo 2 bulan lagi?") lolos cek topik karena masih dalam percakapan beras
  const tolak = pagar.cekMasukan(teks, sebut || Boolean(lanjut))
  let lolosPilah = false
  if (tolak?.alasan === "di_luar_topik") {
    // aturan tidak mengenali pesannya: tanya model termurah dulu sebelum menolak
    const sapa = { teks: `Halo! 👋 Aku bot *TERAWANG*, bantu info beras di Jawa Timur.\n\n${CONTOH}`, intent: "tidak_jelas", wilayahId: null }
    if (!config.openai.modelPilah || pagar.cekBatas(k.id, await kontak.jumlahLlmHariIni(k.id))) {
      return normal(teks).split(" ").length <= 3 ? sapa : { teks: tolak.teks, intent: `tolak_${tolak.alasan}`, wilayahId: null }
    }
    try {
      const p = await pilahNiat(teks)
      pagar.catatToken(p.token)
      console.log(`[llm] pilah kontak=${k.id} niat=${p.niat} token=${p.token}`)
      if (p.niat === "salam") return POLA_TERIMA_KASIH.test(normal(teks)) ? { teks: TERIMA_KASIH, intent: "salam_pilah", wilayahId: null } : { ...sapa, intent: "salam_pilah" }
      if (p.niat === "lain") return { teks: tolak.teks, intent: `tolak_${tolak.alasan}`, wilayahId: null }
      lolosPilah = true
    } catch (e) {
      console.error("[llm] pilah gagal:", e)
      return normal(teks).split(" ").length <= 3 ? sapa : { teks: tolak.teks, intent: `tolak_${tolak.alasan}`, wilayahId: null }
    }
  }
  if (tolak && !lolosPilah) return { teks: tolak.teks, intent: `tolak_${tolak.alasan}`, wilayahId: null }

  // cache: pertanyaan yang sama dalam 30 menit dijawab tanpa memanggil OpenAI lagi
  const kunci = pagar.kunciCache(lanjut && !sebut ? `${teks}|${lanjut.topik}` : teks, lanjut && !sebut ? lanjut.wilayahId : k.wilayah_id)
  const c = pagar.ambilCache(kunci)
  if (c) return { teks: c.jawaban, intent: "llm_cache", wilayahId: c.wilayahId ?? null, topik: lanjut?.topik }

  const batas = pagar.cekBatas(k.id, await kontak.jumlahLlmHariIni(k.id))
  if (batas) return { teks: `${batas.teks}\n\n${BANTUAN}`, intent: `tolak_${batas.alasan}`, wilayahId: null }

  const idIngat = lanjut && !sebut ? lanjut.wilayahId : k.wilayah_id
  const ingat = pilihan ?? daftar.find((w) => w.id === idIngat) ?? null
  try {
    const r = await jawabBebas(teks, await riwayat(k.id), ingat, sebut || Boolean(lanjut && ingat), sebut ? undefined : lanjut?.topik)
    pagar.catatToken(r.token)
    pantau.llm = { ...pantau.llm, terakhir: Date.now(), ok: true, galat: "", token: r.token }
    console.log(`[llm] kontak=${k.id} token=${r.token} alat=${r.pakaiAlat} hari_ini=${pagar.pemakaianHariIni().token}`)
    const jawaban = pagar.rapikanJawaban(r.jawaban)
    // LLM tidak bisa menyimpan laporan; jangan biarkan ia mengaku "laporan diterima". Alihkan ke alur lapor yang menyimpan ke DB.
    if (/laporan(mu|nya)?\s+(sudah\s+)?(di\s*terima|diterima|tercatat|dicatat|tersimpan|disimpan|masuk)/i.test(jawaban)) {
      console.warn(`[llm] kontak=${k.id} jawaban mengaku laporan diterima; dialihkan ke alur lapor`)
      return laporHarga(k, teks)
    }
    if (r.angkaAsing?.length) {
      return { teks: `Maaf, aku belum bisa menjawab itu dengan data yang ada. Coba perintah baku:\n\n${BANTUAN}`, intent: "llm_angka_asing", wilayahId: null }
    }
    if (!jawaban || pagar.angkaTanpaData(jawaban, r.pakaiAlat)) {
      return { teks: `Maaf, aku belum bisa menjawab itu dengan data yang ada. Coba perintah baku:\n\n${BANTUAN}`, intent: "llm_ditolak", wilayahId: null }
    }
    if (r.wilayahId) await kontak.ingatWilayah(k.id, r.wilayahId)
    // hanya jawaban berbasis data yang disimpan; penolakan/jawaban tanpa data tidak ikut cache
    if (r.pakaiAlat) pagar.simpanCache(kunci, jawaban, r.wilayahId)
    const topik = r.alat.map((a) => TOPIK_ALAT[a]).find(Boolean) ?? lanjut?.topik
    return { teks: jawaban, intent: "llm", wilayahId: r.wilayahId ?? null, topik }
  } catch (e) {
    console.error("[llm] gagal:", e)
    pantau.llm = { ...pantau.llm, terakhir: Date.now(), terakhirGagal: Date.now(), ok: false, galat: String((e as Error).message).slice(0, 300) }
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
  // jawaban bebas (LLM) tanpa topik tetap mencatat wilayahnya, supaya "grafiknya" berikutnya ikut wilayah ini
  if (b.wilayahId) konteks.set(k.id, { wilayahId: b.wilayahId, topik: b.topik ?? konteks.get(k.id)?.topik ?? "harga", sampai: Date.now() + 30 * MENIT })
  await kontak.catat(k.id, "KELUAR", b.teks, b.intent, b.wilayahId)
  return b
}

async function proses(nomor: string, k: kontak.Kontak, teks: string): Promise<Balasan> {
  // "halo, harga beras di jember berapa?" -> salamnya dibuang, sisanya diproses biasa
  teks = buangSalam(teks)
  // "sekarang harga beras paling murah dimana?" -> peringkat se-Jatim langsung dari data
  const pr = deteksiPeringkat(teks)
  if (pr && !tunda.get(nomor)) {
    const di = cariDiKalimat(teks.replace(/jawa timur|jatim/gi, ""), await semuaWilayah())
    if (di.jenis === "tidak_ada") return jawabPeringkat(pr.ukuran, pr.urutan)
  }
  const t = tunda.get(nomor)
  if (t && t.sampai < Date.now()) tunda.delete(nomor)
  const cmd = uraiPerintah(teks)

  if (t && t.sampai >= Date.now() && !cmd) {
    if (t.jenis === "pilih") {
      const i = Number(teks.trim()) - 1
      const w = t.pilihan[i] ?? pilihJenis(teks, t.pilihan) ?? (() => {
        const c = cocokkan(teks, t.pilihan)
        return c.jenis === "pas" ? c.wilayah : undefined
      })()
      if (w) {
        tunda.delete(nomor)
        if (BUTUH_WILAYAH.includes(t.perintah)) await kontak.ingatWilayah(k.id, w.id)
        if (t.perintah === "grafik") return buatGrafik(w, t.sisa ?? "", k)
        // pertanyaan bebas yang tadi ditunda: jawab ulang dengan wilayah yang dipilih
        if (t.sisa && llmAktif()) return pesanBebas(k, t.sisa, w)
        return jalankan(t.perintah, w, k, "")
      }
    }
  }
  // laporan yang sedang diisi: jawaban seperti "15000" atau "harga 15000" tetap masuk ke laporan
  if (t?.jenis === "lapor" && t.sampai >= Date.now() && (!cmd || cmd.perintah === "lapor" || Object.keys(lapor.uraiLaporan(teks)).length)) {
    return laporHarga(k, cmd?.perintah === "lapor" ? cmd.mentah || teks : teks, cmd?.perintah === "lapor" && cmd.mentah ? undefined : t)
  }
  // koreksi peran laporan yang baru disimpan: "eh aku pembeli", "pembeli kok"
  const akhir = laporTerakhir.get(nomor)
  const peranKoreksi = lapor.peranDisebut(teks)
  if (akhir && akhir.sampai >= Date.now() && !cmd && peranKoreksi && normal(teks).split(" ").length <= 5 && Object.keys(lapor.uraiLaporan(teks)).length === 1) {
    laporTerakhir.delete(nomor)
    await kontak.ubahPeranLaporan(akhir.id, k.id, peranKoreksi)
    return { teks: `Siap, laporan tadi aku ubah jadi sebagai *${NAMA_PERAN[peranKoreksi]}*. Makasih koreksinya!`, intent: "lapor_koreksi", wilayahId: null }
  }
  // "aku mau ngelaporin, di pasar induk kota batu ..." (tanpa perintah LAPOR di depan)
  if (cmd?.perintah !== "lapor" && lapor.niatLapor(teks)) {
    tunda.delete(nomor)
    return laporHarga(k, teks)
  }
  const lanjutGrafik = !cmd && grafikAktif(k.id) && lanjutanGrafik(teks, cariDiKalimat(teks, await semuaWilayah()).jenis !== "tidak_ada")
  if (cmd?.perintah === "grafik" || (!cmd && POLA_GRAFIK.test(normal(teks))) || lanjutGrafik) {
    tunda.delete(nomor)
    return grafikDariKalimat(nomor, k, teks)
  }
  if (cmd) {
    tunda.delete(nomor)
    if (cmd.perintah === "lapor") return laporHarga(k, cmd.mentah)
    return denganWilayah(nomor, k, cmd.perintah, cmd.arg, teks)
  }
  return pesanBebas(k, teks)
}
