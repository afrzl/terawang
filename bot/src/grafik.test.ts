import assert from "node:assert/strict"
import { test } from "node:test"
import { POLA_GRAFIK, pngGrafik, svgGrafik, teksGrafik, uraiJenis, uraiRentang, type DataGrafik } from "./grafik.ts"
import { normal } from "./wilayah.ts"

test("rentang grafik dari kalimat", () => {
  assert.equal(uraiRentang("grafik harga beras sebulan ini"), 30)
  assert.equal(uraiRentang("grafik harga seminggu"), 7)
  assert.equal(uraiRentang("GRAFIK Malang 3 bulan"), 90)
  assert.equal(uraiRentang("chart 2 minggu terakhir"), 14)
  assert.equal(uraiRentang("grafik setahun"), 365)
  assert.equal(uraiRentang("grafik 2 tahun"), 365)
  assert.equal(uraiRentang("grafik jember"), 30)
})

test("jenis beras dan pola grafik", () => {
  assert.equal(uraiJenis("grafik beras premium"), "premium")
  assert.equal(uraiJenis("grafik harga medium"), "medium")
  assert.equal(uraiJenis("grafik harga"), "keduanya")
  assert.ok(POLA_GRAFIK.test(normal("Bikinin grafiknya dong")))
  assert.ok(POLA_GRAFIK.test(normal("minta chart harga beras")))
  assert.ok(!POLA_GRAFIK.test(normal("harga beras di malang berapa")))
})

const contoh: DataGrafik = {
  judul: "Kota Malang", wilayahId: 1, hari: 30, het: 13500, jenis: "keduanya",
  titik: Array.from({ length: 30 }, (_, i) => ({
    tanggal: `2026-11-${String(i + 1).padStart(2, "0")}`,
    medium: i === 10 ? null : 12600 + i * 5,
    premium: 14800 + (i % 7) * 20,
  })),
}

test("keterangan grafik memakai angka data", () => {
  const t = teksGrafik(contoh)
  assert.match(t, /Beras medium\*: Rp12\.745\/kg \(30 Nov\), naik 1,2% dari Rp12\.600/)
  assert.match(t, /Tertinggi Rp14\.920/)
  assert.match(t, /HET beras medium: Rp13\.500/)
})

test("grafik menjadi PNG", () => {
  const svg = svgGrafik(contoh)
  assert.ok(svg.includes("Kota Malang") && svg.includes("HET medium"))
  const png = pngGrafik(svg)
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])
  assert.ok(png.length > 5000)
})
