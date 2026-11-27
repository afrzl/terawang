import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import { AppShell } from "@/components/layout/AppShell"
import { FilterProvider } from "@/lib/filter"
import { PetaProvider } from "@/lib/peta"
import { SelectionProvider } from "@/lib/selection"
import { SesiProvider } from "@/lib/sesi"
import { ThemeProvider } from "@/lib/theme"
import { TooltipProvider } from "@/lib/tooltip"
import Ringkasan from "@/pages/Ringkasan"
import Produksi from "@/pages/Produksi"
import Stok from "@/pages/Stok"
import ArusBeras from "@/pages/ArusBeras"
import Harga from "@/pages/Harga"
import Whatsapp from "@/pages/Whatsapp"
import Cerita from "@/pages/Cerita"

export default function App() {
  return (
    <ThemeProvider>
      <SesiProvider>
      <SelectionProvider>
        <TooltipProvider>
          <BrowserRouter>
            <FilterProvider>
              <PetaProvider>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="/" element={<Ringkasan />} />
                {/* /ringkasan versi lama memakai riwayat stok simulasi; dialihkan ke Peta Ringkasan */}
                <Route path="/ringkasan" element={<Navigate to="/" replace />} />
                <Route path="/produksi" element={<Produksi />} />
                <Route path="/stok" element={<Stok />} />
                <Route path="/arus" element={<ArusBeras />} />
                <Route path="/harga" element={<Harga />} />
                <Route path="/whatsapp" element={<Whatsapp />} />
                <Route path="/cerita" element={<Cerita />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
            </PetaProvider>
            </FilterProvider>
          </BrowserRouter>
        </TooltipProvider>
      </SelectionProvider>
      </SesiProvider>
    </ThemeProvider>
  )
}
