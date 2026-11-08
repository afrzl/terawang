import { createContext, useContext, useEffect, useState } from "react"

export type Theme = "light" | "dark"

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)
const KEY = "terawang.theme"

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(KEY)
    if (stored === "light" || stored === "dark") return stored
  } catch {
    /* penyimpanan tidak tersedia */
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // Simpan hanya pilihan eksplisit pengguna, supaya tanpa pilihan tetap mengikuti tema sistem.
  const toggleTheme = () =>
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark"
      try {
        localStorage.setItem(KEY, next)
      } catch {
        /* abaikan */
      }
      return next
    })

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme harus dipakai di dalam ThemeProvider")
  return ctx
}
