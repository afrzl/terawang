import assert from "node:assert/strict"
import { test } from "node:test"
import { hargaDisebut, kurang, niatLapor, pasarDisebut, peranDisebut, uraiLaporan } from "./lapor.ts"

test("laporan bahasa bebas dari tangkapan layar", () => {
  const t = "aku mau ngelaporin, di pasar induk kota batu, beras medium harganya 15000 bukan 14000"
  assert.ok(niatLapor(t))
  assert.deepEqual(uraiLaporan(t), { pasar: "Pasar Induk Kota Batu", jenis: "medium", harga: 15000 })
  assert.deepEqual(kurang(uraiLaporan(t)), ["peran"])
})

test("format lama tetap jalan", () => {
  assert.deepEqual(uraiLaporan("Pasar Besar Malang, medium, 13800"), { pasar: "Pasar Besar Malang", jenis: "medium", harga: 13800 })
  assert.deepEqual(uraiLaporan("pasar induk kota batu, medium, 15000"), { pasar: "Pasar Induk Kota Batu", jenis: "medium", harga: 15000 })
  assert.equal(uraiLaporan("Tanjung, premium, 15.500").pasar, "Tanjung")
})

test("harga dalam berbagai tulisan", () => {
  assert.equal(hargaDisebut("15.000"), 15000)
  assert.equal(hargaDisebut("Rp14.500/kg"), 14500)
  assert.equal(hargaDisebut("14 rb sekilo"), 14000)
  assert.equal(hargaDisebut("14,5rb"), 14500)
  assert.equal(hargaDisebut("15k"), 15000)
  assert.equal(hargaDisebut("sekarang 15000, kemarin 14000"), 15000)
  assert.equal(hargaDisebut("kemarin 14000 sekarang 15000"), 15000)
  assert.equal(hargaDisebut("karung 5 kg 70000"), 14000)
  assert.equal(hargaDisebut("beras 250000"), undefined)
  assert.equal(hargaDisebut("beras medium"), undefined)
})

test("peran penjual atau pembeli", () => {
  assert.equal(peranDisebut("aku pembeli"), "PEMBELI")
  assert.equal(peranDisebut("tadi beli di pasar"), "PEMBELI")
  assert.equal(peranDisebut("aku jual premium 15rb"), "PENJUAL")
  assert.equal(peranDisebut("saya pedagang beras"), "PENJUAL")
  assert.equal(peranDisebut("penjual"), "PENJUAL")
  assert.equal(peranDisebut("beras medium 15000"), undefined)
})

test("nama pasar dari kalimat", () => {
  assert.equal(pasarDisebut("aku beli beras medium di Pasar Besar Malang 13.800 sekilo"), "Pasar Besar Malang")
  assert.equal(pasarDisebut("di psr tanjung jember harganya 14rb"), "Pasar Tanjung Jember")
  assert.equal(pasarDisebut("beli di indomaret 15rb premium"), "Indomaret")
  assert.equal(pasarDisebut("harga di pasar berapa"), undefined)
  assert.deepEqual(uraiLaporan("aku jual premium 15 rb di Pasar Induk Kota Batu"), { pasar: "Pasar Induk Kota Batu", jenis: "premium", harga: 15000, peran: "PENJUAL" })
})

test("niat lapor", () => {
  assert.ok(niatLapor("lapor dong"))
  assert.ok(niatLapor("aku beli beras medium di pasar tanjung 14rb"))
  assert.ok(!niatLapor("harga beras medium di pasar tanjung berapa?"))
  assert.ok(!niatLapor("harga jember"))
  assert.ok(!niatLapor("laporan stok jatim"))
})
