import { Moon, Sun } from "lucide-react"
import { useTheme } from "@/lib/theme"

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()

  return (
    <button type="button" className="icon-btn" onClick={toggleTheme} aria-label="Ganti tema">
      {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  )
}
