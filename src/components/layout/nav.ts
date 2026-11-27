export interface NavItem {
  to: string
  label: string
  /** hak yang dibutuhkan (matriks peran di halaman admin "Akun & peran") */
  hak: string
}

/** Menu utama: satu halaman, atau grup dengan sub menu (tiap sub menu punya hak sendiri). */
export interface NavGrup {
  label: string
  anak: NavItem[]
}

export type NavEntri = NavItem | NavGrup

export const adalahGrup = (e: NavEntri): e is NavGrup => "anak" in e

export const navItems: NavEntri[] = [
  { to: "/", label: "Peta Ringkasan", hak: "dasbor_ringkasan" },
  // Menu Ringkasan disembunyikan; halaman /ringkasan tetap ada.
  // { to: "/ringkasan", label: "Ringkasan" },
  { to: "/produksi", label: "Produksi", hak: "dasbor_produksi" },
  { to: "/stok", label: "Stok", hak: "dasbor_stok" },
  { to: "/arus", label: "Arus beras", hak: "dasbor_arus" },
  {
    label: "Harga & SPHP",
    anak: [
      { to: "/harga", label: "Harga", hak: "dasbor_harga" },
      { to: "/sphp", label: "Rekomendasi SPHP", hak: "dasbor_sphp" },
    ],
  },
  { to: "/cerita", label: "Laporan pekan", hak: "dasbor_cerita" },
  // Kanal warga disembunyikan dari menu; halaman /whatsapp tetap ada.
  // { to: "/whatsapp", label: "Kanal warga", hak: "dasbor_whatsapp" },
]

/** Semua halaman menu (grup diratakan), urut seperti di menu. */
export const navHalaman: NavItem[] = navItems.flatMap((e) => (adalahGrup(e) ? e.anak : [e]))
