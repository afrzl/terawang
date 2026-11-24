/** Stok beras Bulog Jawa Timur per bulan, 2025 (ribu ton). ASLI: BPS, Provinsi Jawa Timur Dalam Angka 2026, Tabel 10.1.3 (sumber asli Kanwil Perum Bulog Jatim). Hanya tingkat provinsi. */
export interface StokBulogBulan {
  bulan: number
  awal: number
  masuk: number
  keluar: number
  akhir: number
}

export const STOK_BULOG_2025: StokBulogBulan[] = [
  { bulan: 1, awal: 250.4, masuk: 88.0, keluar: 16.2, akhir: 322.2 },
  { bulan: 2, awal: 322.2, masuk: 131.9, keluar: 9.9, akhir: 444.2 },
  { bulan: 3, awal: 444.2, masuk: 123.3, keluar: 28.8, akhir: 538.7 },
  { bulan: 4, awal: 538.7, masuk: 257.2, keluar: 57.9, akhir: 738.1 },
  { bulan: 5, awal: 738.1, masuk: 288.0, keluar: 108.8, akhir: 917.4 },
  { bulan: 6, awal: 917.4, masuk: 162.0, keluar: 95.4, akhir: 984.0 },
  { bulan: 7, awal: 984.0, masuk: 167.9, keluar: 189.1, akhir: 962.8 },
  { bulan: 8, awal: 962.8, masuk: 100.8, keluar: 108.0, akhir: 955.6 },
  { bulan: 9, awal: 955.6, masuk: 62.0, keluar: 82.5, akhir: 935.1 },
  { bulan: 10, awal: 935.1, masuk: 30.4, keluar: 58.6, akhir: 907.0 },
  { bulan: 11, awal: 907.0, masuk: 69.2, keluar: 111.4, akhir: 864.8 },
  { bulan: 12, awal: 864.8, masuk: 51.8, keluar: 120.2, akhir: 796.4 },
]

/** Pengadaan beras 2025 per kantor cabang Bulog Jatim (ribu ton). ASLI: BPS, Jawa Timur Dalam Angka 2026, Tabel 10.1.6 (KUD + non-KUD/KTNA + Satgas/UPGB/Draying). */
export const PENGADAAN_CABANG_2025: { cabang: string; ton: number }[] = [
  { cabang: "Surabaya Utara", ton: 42.8 },
  { cabang: "Surabaya Selatan", ton: 60.4 },
  { cabang: "Bojonegoro", ton: 48.7 },
  { cabang: "Madiun", ton: 58.9 },
  { cabang: "Kediri", ton: 50.9 },
  { cabang: "Bondowoso", ton: 43.3 },
  { cabang: "Malang", ton: 61.6 },
  { cabang: "Probolinggo", ton: 78.0 },
  { cabang: "Banyuwangi", ton: 52.2 },
  { cabang: "Tulungagung", ton: 42.4 },
  { cabang: "Jember", ton: 89.1 },
  { cabang: "Madura", ton: 1.2 },
  { cabang: "Ponorogo", ton: 58.9 },
]

/** Stok Bulog Jatim per bulan, 2026 (ribu ton), sampai Okt 2026 (bulan terakhir yang sudah selesai). DUMMY: dilanjutkan dari persediaan akhir Des 2025, pemasukan 85% dan pengeluaran 105% dari pola 2025. Ganti dengan data Kanwil Bulog Jatim 2026. */
export const STOK_BULOG_2026: StokBulogBulan[] = (() => {
  let awal = STOK_BULOG_2025[STOK_BULOG_2025.length - 1].akhir
  return STOK_BULOG_2025.slice(0, 10).map((r) => {
    const masuk = Math.round(r.masuk * 0.85 * 10) / 10
    const keluar = Math.round(r.keluar * 1.05 * 10) / 10
    const akhir = Math.round((awal + masuk - keluar) * 10) / 10
    const out = { bulan: r.bulan, awal, masuk, keluar, akhir }
    awal = akhir
    return out
  })
})()

/** Persediaan akhir bulan `i` (0 = Jan 2026) per kantor cabang (ribu ton). DUMMY: data stok per cabang belum ada, stok provinsi dibagi menurut porsi pengadaan 2025. */
export function stokPerCabang(i: number) {
  const total = PENGADAAN_CABANG_2025.reduce((a, c) => a + c.ton, 0)
  const stokProv = STOK_BULOG_2026[Math.min(STOK_BULOG_2026.length - 1, Math.max(0, i))].akhir
  return PENGADAAN_CABANG_2025.map((c) => ({ ...c, porsi: c.ton / total, stok: (c.ton / total) * stokProv }))
}

/** Indeks bulan terakhir yang punya data Bulog 2026 (0 = Jan). */
export const BULOG_BULAN_TERAKHIR = STOK_BULOG_2026.length - 1
