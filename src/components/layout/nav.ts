export interface NavItem {
  to: string
  k: string
  label: string
}

export const navItems: NavItem[] = [
  { to: "/", k: "00", label: "Ringkasan" },
  { to: "/produksi", k: "K1", label: "Produksi pra-panen" },
  { to: "/stok", k: "K2", label: "Stok beredar" },
  { to: "/harga", k: "K3", label: "Harga & SPHP" },
  { to: "/whatsapp", k: "WA", label: "Kanal warga" },
]
