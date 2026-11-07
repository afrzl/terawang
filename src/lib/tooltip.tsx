import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from "react"

interface TipState {
  content: React.ReactNode
  x: number
  y: number
}

interface TooltipContextValue {
  show: (content: React.ReactNode, e: { clientX: number; clientY: number }) => void
  hide: () => void
}

const TooltipContext = createContext<TooltipContextValue | null>(null)

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  const [tip, setTip] = useState<TipState | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const show = useCallback<TooltipContextValue["show"]>((content, e) => setTip({ content, x: e.clientX, y: e.clientY }), [])
  const hide = useCallback(() => setTip(null), [])
  const value = useMemo(() => ({ show, hide }), [show, hide])

  // Posisikan agar tidak keluar dari layar.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !tip) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    let x = tip.x + 14
    let y = tip.y + 14
    if (x + w > innerWidth - 8) x = tip.x - w - 14
    if (y + h > innerHeight - 8) y = tip.y - h - 14
    el.style.left = x + "px"
    el.style.top = y + "px"
  }, [tip])

  return (
    <TooltipContext.Provider value={value}>
      {children}
      <div id="tip" ref={ref} role="tooltip" style={{ opacity: tip ? 1 : 0 }}>
        {tip?.content}
      </div>
    </TooltipContext.Provider>
  )
}

export function useTooltip() {
  const ctx = useContext(TooltipContext)
  if (!ctx) throw new Error("useTooltip harus dipakai di dalam TooltipProvider")
  return ctx
}
