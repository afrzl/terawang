import { createContext, useContext, useState } from "react"
import { byName } from "@/lib/data"

interface SelectionContextValue {
  /** Nama wilayah yang sedang dipilih. */
  sel: string
  select: (n: string) => void
}

const SelectionContext = createContext<SelectionContextValue | null>(null)
const KEY = "terawang.sel"

function getInitial() {
  try {
    const s = localStorage.getItem(KEY)
    if (s && byName[s]) return s
  } catch {
    /* abaikan */
  }
  return "Lamongan"
}

export function SelectionProvider({ children }: { children: React.ReactNode }) {
  const [sel, setSel] = useState(getInitial)
  const select = (n: string) => {
    setSel(n)
    try {
      localStorage.setItem(KEY, n)
    } catch {
      /* abaikan */
    }
  }
  return <SelectionContext.Provider value={{ sel, select }}>{children}</SelectionContext.Provider>
}

export function useSelection() {
  const ctx = useContext(SelectionContext)
  if (!ctx) throw new Error("useSelection harus dipakai di dalam SelectionProvider")
  return ctx
}
