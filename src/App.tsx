import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import { AppShell } from "@/components/layout/AppShell"
import { SelectionProvider } from "@/lib/selection"
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
      <SelectionProvider>
        <TooltipProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="/" element={<Ringkasan />} />
                <Route path="/produksi" element={<Produksi />} />
                <Route path="/stok" element={<Stok />} />
                <Route path="/arus" element={<ArusBeras />} />
                <Route path="/harga" element={<Harga />} />
                <Route path="/whatsapp" element={<Whatsapp />} />
                <Route path="/cerita" element={<Cerita />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </SelectionProvider>
    </ThemeProvider>
  )
}
