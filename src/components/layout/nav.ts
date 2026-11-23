export interface NavItem {
  to: string
  label: string
}

export const navItems: NavItem[] = [
  { to: "/cerita", label: "Alur" },
  { to: "/", label: "Ringkasan" },
  { to: "/produksi", label: "Produksi pra-panen" },
  { to: "/stok", label: "Stok beredar" },
  { to: "/arus", label: "Arus beras" },
  { to: "/harga", label: "Harga & SPHP" },
  { to: "/whatsapp", label: "Kanal warga" },
]
