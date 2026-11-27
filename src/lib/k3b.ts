/** Rekomendasi penyaluran SPHP dari K3b (LP stokastik): `dari` = kabupaten lokasi cabang Bulog, `ke` = kabupaten penerima, per bulan (Nov 2026–Jan 2027).
 *  Sumber: data/satelit/k3b_rekomendasi_sphp.csv di branch danang-dev. Status di K3b: DUMMY (stok Bulog per cabang Nov 2026 sebagian dari berita, sisanya taksiran; pemetaan cabang ke kabupaten asumsi). */
export interface K3bRute {
  /** Indeks bulan, 0 = Jan 2026 (10 = Nov 2026, 12 = Jan 2027). */
  bulan: number
  dari: string
  ke: string
  ton: number
  km: number
}

export const K3B_RUTE: K3bRute[] = [
  { bulan: 10, dari: "Bojonegoro", ke: "Bojonegoro", ton: 7583.0, km: 0.0 },
  { bulan: 10, dari: "Bondowoso", ke: "Situbondo", ton: 408.2, km: 34.1 },
  { bulan: 10, dari: "Jember", ke: "Jember", ton: 4261.6, km: 0.0 },
  { bulan: 10, dari: "Kota Madiun", ke: "Kota Madiun", ton: 543.5, km: 0.0 },
  { bulan: 10, dari: "Kota Madiun", ke: "Magetan", ton: 891.2, km: 26.2 },
  { bulan: 10, dari: "Kota Madiun", ke: "Tuban", ton: 6317.5, km: 117.0 },
  { bulan: 10, dari: "Kota Malang", ke: "Batu", ton: 194.8, km: 25.9 },
  { bulan: 10, dari: "Kota Surabaya", ke: "Tuban", ton: 7009.7, km: 122.6 },
  { bulan: 11, dari: "Banyuwangi", ke: "Kota Probolinggo", ton: 510.3, km: 172.2 },
  { bulan: 11, dari: "Banyuwangi", ke: "Probolinggo", ton: 1133.9, km: 167.5 },
  { bulan: 11, dari: "Banyuwangi", ke: "Sampang", ton: 5417.2, km: 365.7 },
  { bulan: 11, dari: "Bojonegoro", ke: "Bojonegoro", ton: 2047.0, km: 0.0 },
  { bulan: 11, dari: "Bondowoso", ke: "Bondowoso", ton: 1924.1, km: 0.0 },
  { bulan: 11, dari: "Bondowoso", ke: "Sampang", ton: 2123.0, km: 307.3 },
  { bulan: 11, dari: "Bondowoso", ke: "Situbondo", ton: 3637.1, km: 34.1 },
  { bulan: 11, dari: "Jember", ke: "Jember", ton: 10378.6, km: 0.0 },
  { bulan: 11, dari: "Jember", ke: "Jombang", ton: 922.8, km: 220.5 },
  { bulan: 11, dari: "Kota Kediri", ke: "Bojonegoro", ton: 69.2, km: 91.5 },
  { bulan: 11, dari: "Kota Kediri", ke: "Jombang", ton: 1133.2, km: 51.7 },
  { bulan: 11, dari: "Kota Kediri", ke: "Kediri", ton: 3629.1, km: 10.4 },
  { bulan: 11, dari: "Kota Kediri", ke: "Nganjuk", ton: 3282.8, km: 31.8 },
  { bulan: 11, dari: "Kota Madiun", ke: "Magetan", ton: 1305.6, km: 26.2 },
  { bulan: 11, dari: "Kota Madiun", ke: "Ngawi", ton: 2580.5, km: 44.6 },
  { bulan: 11, dari: "Kota Malang", ke: "Batu", ton: 108.2, km: 25.9 },
  { bulan: 11, dari: "Kota Malang", ke: "Kota Malang", ton: 409.6, km: 0.0 },
  { bulan: 11, dari: "Kota Malang", ke: "Mojokerto", ton: 7500.1, km: 86.9 },
  { bulan: 11, dari: "Kota Probolinggo", ke: "Bangkalan", ton: 10234.7, km: 145.1 },
  { bulan: 11, dari: "Kota Probolinggo", ke: "Pamekasan", ton: 4253.6, km: 229.7 },
  { bulan: 11, dari: "Kota Surabaya", ke: "Lamongan", ton: 3918.4, km: 60.4 },
  { bulan: 11, dari: "Kota Surabaya", ke: "Sampang", ton: 1862.8, km: 98.6 },
  { bulan: 11, dari: "Kota Surabaya", ke: "Tuban", ton: 2449.5, km: 122.6 },
  { bulan: 11, dari: "Pamekasan", ke: "Pamekasan", ton: 229.5, km: 0.0 },
  { bulan: 11, dari: "Ponorogo", ke: "Magetan", ton: 3257.6, km: 52.9 },
  { bulan: 11, dari: "Ponorogo", ke: "Pacitan", ton: 5357.5, km: 72.5 },
  { bulan: 11, dari: "Ponorogo", ke: "Ponorogo", ton: 2678.7, km: 0.0 },
  { bulan: 11, dari: "Tulungagung", ke: "Bojonegoro", ton: 8318.8, km: 127.1 },
  { bulan: 12, dari: "Banyuwangi", ke: "Mojokerto", ton: 1534.7, km: 272.3 },
  { bulan: 12, dari: "Banyuwangi", ke: "Probolinggo", ton: 1710.7, km: 167.5 },
  { bulan: 12, dari: "Bondowoso", ke: "Bangkalan", ton: 472.8, km: 259.8 },
  { bulan: 12, dari: "Jember", ke: "Bangkalan", ton: 2042.9, km: 243.4 },
  { bulan: 12, dari: "Kota Kediri", ke: "Kediri", ton: 1944.3, km: 10.4 },
  { bulan: 12, dari: "Kota Malang", ke: "Mojokerto", ton: 3968.3, km: 86.9 },
  { bulan: 12, dari: "Kota Probolinggo", ke: "Bangkalan", ton: 923.6, km: 145.1 },
  { bulan: 12, dari: "Kota Surabaya", ke: "Gresik", ton: 3632.4, km: 29.6 },
  { bulan: 12, dari: "Kota Surabaya", ke: "Sampang", ton: 1520.8, km: 98.6 },
  { bulan: 12, dari: "Ponorogo", ke: "Pacitan", ton: 352.8, km: 72.5 },
]
