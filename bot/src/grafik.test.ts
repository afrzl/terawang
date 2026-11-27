import assert from "node:assert/strict"
import { test } from "node:test"
import { POLA_GRAFIK, pngGrafik, rentangDisebut, svgGrafik, teksGrafik, uraiJenis, uraiRentang, type DataGrafik } from "./grafik.ts"
import { normal } from "./wilayah.ts"

test("rentang grafik dari kalimat", () => {
  assert.equal(uraiRentang("grafik harga beras sebulan ini"), 30)
  assert.equal(uraiRentang("grafik harga seminggu"), 7)
  assert.equal(uraiRentang("GRAFIK Malang 3 bulan"), 90)
  assert.equal(uraiRentang("chart 2 minggu terakhir"), 14)
  assert.equal(uraiRentang("grafik setahun"), 365)
  assert.equal(uraiRentang("grafik 2 tahun"), 365)
  assert.equal(uraiRentang("grafik jember"), 30)
  assert.equal(rentangDisebut("klo buat sathun gimana"), 365)
  assert.equal(rentangDisebut("kalau setaun?"), 365)
  assert.equal(rentangDisebut("6 bln aja"), 180)
  assert.equal(rentangDisebut("buatkan grafik hariannya"), null)
  assert.equal(rentangDisebut("grafik kota malang sethaun"), 365)
  assert.equal(rentangDisebut("grafik sebuln"), 30)
  assert.equal(rentangDisebut("grafik harian malang selama setahun"), 365)
  assert.equal(rentangDisebut("grafik harga sekarang"), null)
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

test("pesan lanjutan grafik", async () => {
  const { lanjutanGrafik } = await import("./bot.ts")
  assert.ok(lanjutanGrafik("klo buat sathun gimana", false))
  assert.ok(lanjutanGrafik("premium aja", false))
  assert.ok(lanjutanGrafik("kalau jember?", true))
  assert.ok(!lanjutanGrafik("harga beras di jember berapa", true))
  assert.ok(!lanjutanGrafik("makasih", false))
  assert.ok(!lanjutanGrafik("kalo 2 bulan lagi?", false))
  assert.ok(!lanjutanGrafik("bulan depan naik nggak 3 bulan lagi", false))
})

test("pilih Kab/Kota dengan kata", async () => {
  const { pilihJenis } = await import("./bot.ts")
  const p = [{ id: 1, kode: "3507", nama: "Kabupaten Malang", jenis: "KABUPATEN" as const, dasar: "malang" }, { id: 2, kode: "3573", nama: "Kota Malang", jenis: "KOTA" as const, dasar: "malang" }]
  assert.equal(pilihJenis("kota", p)?.id, 2)
  assert.equal(pilihJenis("yang kota", p)?.id, 2)
  assert.equal(pilihJenis("Kab", p)?.id, 1)
  assert.equal(pilihJenis("kabupatennya", p)?.id, 1)
  assert.equal(pilihJenis("jember", p), undefined)
})
