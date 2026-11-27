import { test } from "node:test"
import assert from "node:assert/strict"
import { aturHak, HAK_TAMU_BAWAAN, mintaPrakiraan } from "./hak.ts"
import { bantuan, teksHarga } from "./format.ts"
import { normal } from "./wilayah.ts"
import { jawabIstilah } from "./istilah.ts"

const harga = {
  wilayah: "Kota Malang", tanggal_data: "2026-11-27", medium_rp_kg: 12550, premium_rp_kg: 16100, het_medium_rp_kg: 13500, het_resmi: true, selisih_het_pct: -7,
  prediksi: [{ horizon_hari: 14, tanggal_acuan: "2026-11-27", harga_rp_kg: 12600, batas_bawah: null, batas_atas: null, status: null }], status_harga: "AMAN" as const,
}

test("pertanyaan prakiraan dikenali", () => {
  for (const t of ["prediksi harga beras sebulan kedepan di kota malang", "beras di Surabaya naik nggak bulan depan?", "harga 2 minggu lagi berapa", "stok jember bakal habis?", "prakiraan harga malang"]) {
    assert.ok(mintaPrakiraan(normal(t)), t)
  }
  for (const t of ["harga beras kota malang", "grafik harga jember 6 bulan terakhir", "lapor beras medium 13000 di pasar tanjung", "stok jember", "harga kemarin berapa"]) {
    assert.ok(!mintaPrakiraan(normal(t)), t)
  }
})

test("hak Tamu: tanpa prakiraan, status, SPHP, langganan", () => {
  aturHak(HAK_TAMU_BAWAAN)
  const h = teksHarga(harga)
  assert.ok(!/pekan lagi|Status|SPHP|LANGGANAN/.test(h), h)
  assert.match(h, /Rp12\.550/)
  const b = bantuan()
  assert.ok(!/SPHP|PERINGATAN|LANGGANAN|prakiraan|bulan depan/.test(b), b)
  assert.match(b, /LAPOR/)
})

test("hak lengkap: prakiraan dan SPHP tampil", () => {
  aturHak([...HAK_TAMU_BAWAAN, "dasbor_harga", "dasbor_sphp", "dasbor_estimasi"])
  assert.match(teksHarga(harga), /2 pekan lagi/)
  assert.match(bantuan(), /SPHP/)
  aturHak(HAK_TAMU_BAWAAN)
})

test("hak Tamu: istilah SPHP tanpa ajakan perintah SPHP", () => {
  aturHak(HAK_TAMU_BAWAAN)
  const t = jawabIstilah("apa itu SPHP?") ?? ""
  assert.match(t, /Stabilisasi/)
  assert.ok(!t.includes("Ketik *SPHP"), t)
})
