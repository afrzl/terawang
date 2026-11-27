import assert from "node:assert/strict"
import { test } from "node:test"
import { uraiPerintah } from "./bot.ts"
import { uraiWebhook } from "./gowa.ts"
import { cariDiKalimat, cocokkan, namaDasar, type Wilayah } from "./wilayah.ts"

const kab = (id: number, nama: string): Wilayah => ({ id, kode: String(3500 + id), nama, jenis: "KABUPATEN", dasar: namaDasar(nama) })
const kota = (id: number, nama: string): Wilayah => ({ id, kode: String(3570 + id), nama, jenis: "KOTA", dasar: namaDasar(nama) })
const W = [kab(7, "Malang"), kab(10, "Banyuwangi"), kab(9, "Jember"), kab(20, "Bojonegoro"), kota(73, "Kota Malang"), kota(78, "Kota Surabaya"), kota(79, "Kota Batu")]

test("cocokkan wilayah", () => {
  assert.deepEqual(cocokkan("jember", W), { jenis: "pas", wilayah: W[2] })
  assert.equal(cocokkan("Kab. Malang", W).jenis, "pas")
  assert.equal((cocokkan("Kab. Malang", W) as any).wilayah.jenis, "KABUPATEN")
  assert.equal((cocokkan("kota malang", W) as any).wilayah.jenis, "KOTA")
  assert.equal(cocokkan("malang", W).jenis, "ambigu")
  assert.equal((cocokkan("surabaya", W) as any).wilayah.nama, "Kota Surabaya")
  assert.equal((cocokkan("banyuwangy", W) as any).wilayah.nama, "Banyuwangi")
  assert.equal((cocokkan("bojonegor", W) as any).wilayah.nama, "Bojonegoro")
  assert.equal((cocokkan("batu", W) as any).wilayah.nama, "Kota Batu")
  assert.equal(cocokkan("jakarta", W).jenis, "tidak_ada")
})

test("cari wilayah di kalimat", () => {
  assert.equal((cariDiKalimat("Pasar Besar Kota Malang", W) as any).wilayah.jenis, "KOTA")
  assert.equal((cariDiKalimat("pasar tanjung jember", W) as any).wilayah.nama, "Jember")
})

test("urai perintah", () => {
  assert.deepEqual(uraiPerintah("HARGA MALANG")?.perintah, "harga")
  assert.equal(uraiPerintah("cek harga beras kota malang")?.arg, "kota malang")
  assert.equal(uraiPerintah("beras murah jember")?.perintah, "sphp")
  assert.equal(uraiPerintah("beras murah jember")?.arg, "jember")
  assert.equal(uraiPerintah("LAPOR Pasar Besar, medium, 13.800")?.mentah, "Pasar Besar, medium, 13.800")
  assert.equal(uraiPerintah("apakah harga naik?"), null)
})

test("urai webhook GoWA bentuk baru dan lama", () => {
  const baru = uraiWebhook({ event: "message", device_id: "x", payload: { id: "A1", chat_id: "6281234@s.whatsapp.net", from: "6281234@s.whatsapp.net", from_name: "Budi", body: "harga malang", is_from_me: false } })
  assert.deepEqual(baru, { id: "A1", jid: "6281234@s.whatsapp.net", nomor: "6281234", nama: "Budi", teks: "harga malang" })
  const lama = uraiWebhook({ sender_id: "6281234", chat_id: "6281234", from: "6281234@s.whatsapp.net", pushname: "Budi", message: { text: "stok", id: "B2" } })
  assert.equal(lama?.teks, "stok")
  assert.equal(lama?.jid, "6281234@s.whatsapp.net")
  assert.equal(uraiWebhook({ event: "message", payload: { chat_id: "120363@g.us", from: "62812@s.whatsapp.net", body: "x" } }), null)
  assert.equal(uraiWebhook({ event: "message", payload: { chat_id: "62812@s.whatsapp.net", body: "x", is_from_me: true } }), null)
  assert.equal(uraiWebhook({ event: "message.ack", payload: {} }), null)
})

import { jawabIstilah } from "./istilah.ts"
test("jawaban istilah tanpa LLM", () => {
  assert.match(jawabIstilah("apa itu SPHP?") ?? "", /Stabilisasi/)
  assert.match(jawabIstilah("HET itu apa ya") ?? "", /Harga Eceran Tertinggi/)
  assert.match(jawabIstilah("datanya dari mana?") ?? "", /Sumber data/)
  assert.equal(jawabIstilah("beras SPHP di jember ada di mana"), null)
  assert.equal(jawabIstilah("harga di malang naik?"), null)
})

test("pertanyaan peringkat se-Jatim dikenali", async () => {
  const { deteksiPeringkat } = await import("./bot.ts")
  assert.deepEqual(deteksiPeringkat("sekarnag harga beras paling murah dimana ?"), { ukuran: "harga_medium", urutan: "terendah" })
  assert.deepEqual(deteksiPeringkat("beras premium termahal di jatim"), { ukuran: "harga_premium", urutan: "tertinggi" })
  assert.deepEqual(deteksiPeringkat("kabupaten mana yang stoknya defisit?"), { ukuran: "stok_cakupan", urutan: "terendah" })
  assert.equal(deteksiPeringkat("harga beras di jember berapa"), null)
})

test("format peringkat", async () => {
  const { teksPeringkat } = await import("./format.ts")
  const t = teksPeringkat([{ wilayah: "Kab. Ngawi", nilai: 11800, tanggal: "2026-11-26", status: null }, { wilayah: "Kab. Jember", nilai: 12060, tanggal: "2026-11-26", status: null }], "harga_medium", "terendah")
  assert.match(t, /termurah di Jawa Timur\* \(26 Nov 2026\)/)
  assert.match(t, /1\. Kab\. Ngawi: Rp11\.800\/kg/)
  assert.match(t, /Ketik \*HARGA <wilayah>\*/)
})
