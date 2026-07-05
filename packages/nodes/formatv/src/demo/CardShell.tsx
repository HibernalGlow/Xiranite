import type { ReactNode } from "react"

export function CardShell({ children }: { children: ReactNode }) {
  return (
    <div className="h-[320px] w-[384px] overflow-hidden rounded border border-border bg-card text-card-foreground shadow-sm">
      {children}
    </div>
  )
}
