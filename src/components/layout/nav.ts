export interface NavItem {
  to: string
  label: string
}

export const navItems: NavItem[] = [
  { to: "/", label: "Peta Ringkasan" },
  // Menu Ringkasan disembunyikan; halaman /ringkasan tetap ada.
  // { to: "/ringkasan", label: "Ringkasan" },
  { to: "/produksi", label: "Produksi" },
  { to: "/stok", label: "Stok" },
  { to: "/arus", label: "Arus beras" },
  { to: "/harga", label: "Harga & SPHP" },
  { to: "/cerita", label: "Laporan pekan" },
  // Kanal warga disembunyikan dari menu; halaman /whatsapp tetap ada.
  // { to: "/whatsapp", label: "Kanal warga" },
]
