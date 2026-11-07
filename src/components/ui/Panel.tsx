import { cn } from "@/lib/utils"

interface PanelProps {
  title?: React.ReactNode
  note?: React.ReactNode
  actions?: React.ReactNode
  className?: string
  children: React.ReactNode
}

export function Panel({ title, note, actions, className, children }: PanelProps) {
  return (
    <div className={cn("panel", className)}>
      {(title || note || actions) && (
        <div className="ph">
          <h3>{title}</h3>
          {note && <span className="note">{note}</span>}
          {actions}
        </div>
      )}
      {children}
    </div>
  )
}

export function ViewHeader({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="vh">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h2>{title}</h2>
        {children && <p>{children}</p>}
      </div>
    </div>
  )
}
