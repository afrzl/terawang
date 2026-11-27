export interface NavItem {
  to: string
  label: string
  /** hak yang dibutuhkan (matriks peran di halaman admin "Akun & peran") */
  hak: string
}

export const navItems: NavItem[] = [
  { to: "/", label: "Peta Ringkasan", hak: "dasbor_ringkasan" },
  // Menu Ringkasan disembunyikan; halaman /ringkasan tetap ada.
  // { to: "/ringkasan", label: "Ringkasan" },
  { to: "/produksi", label: "Produksi", hak: "dasbor_produksi" },
  { to: "/stok", label: "Stok", hak: "dasbor_stok" },
  { to: "/arus", label: "Arus beras", hak: "dasbor_arus" },
  { to: "/harga", label: "Harga & SPHP", hak: "dasbor_harga" },
  { to: "/cerita", label: "Laporan pekan", hak: "dasbor_cerita" },
  // Kanal warga disembunyikan dari menu; halaman /whatsapp tetap ada.
  // { to: "/whatsapp", label: "Kanal warga", hak: "dasbor_whatsapp" },
]
