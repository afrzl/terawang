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
import Masuk from "@/pages/Masuk"
import { PerluHak, WajibMasuk } from "@/components/layout/Akses"

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
              <Route path="/masuk" element={<Masuk />} />
              <Route element={<WajibMasuk />}>
              <Route element={<AppShell />}>
                <Route path="/" element={<PerluHak hak="dasbor_ringkasan"><Ringkasan /></PerluHak>} />
                {/* /ringkasan versi lama memakai riwayat stok simulasi; dialihkan ke Peta Ringkasan */}
                <Route path="/ringkasan" element={<Navigate to="/" replace />} />
                <Route path="/produksi" element={<PerluHak hak="dasbor_produksi"><Produksi /></PerluHak>} />
                <Route path="/stok" element={<PerluHak hak="dasbor_stok"><Stok /></PerluHak>} />
                <Route path="/arus" element={<PerluHak hak="dasbor_arus"><ArusBeras /></PerluHak>} />
                <Route path="/harga" element={<PerluHak hak="dasbor_harga"><Harga /></PerluHak>} />
                <Route path="/whatsapp" element={<PerluHak hak="dasbor_whatsapp"><Whatsapp /></PerluHak>} />
                <Route path="/cerita" element={<PerluHak hak="dasbor_cerita"><Cerita /></PerluHak>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
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
