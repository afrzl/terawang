import assert from "node:assert/strict"
import { test } from "node:test"
import { angkaDariTeks, angkaTakCocok } from "./angka.ts"

test("angka format Indonesia", () => {
  assert.deepEqual(angkaDariTeks("Rp12.550/kg, cukup 1,3 bulan, naik 0,5%"), [12550, 1.3, 0.5])
})

test("angka jawaban harus dari data", () => {
  const data = [{ medium_rp_kg: 12550, premium_rp_kg: 15933, prediksi: [{ batas_atas: 12616 }], tanggal_data: "2026-11-25" }]
  assert.deepEqual(angkaTakCocok("Harga medium Rp12.550/kg (25 Nov 2026), prakiraan 2 pekan sampai Rp12.616.", data, "harga malang"), [])
  assert.deepEqual(angkaTakCocok("Selisih premium dan medium Rp3.383/kg.", data, ""), []) // selisih dua angka data
  assert.deepEqual(angkaTakCocok("Harga medium Rp13.200/kg.", data, ""), [13200])
})
