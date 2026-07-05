import type { ReactNode } from "react"

export function CardShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-[360px] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lg">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-semibold">{title}</span>
        <span className="rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground">demo</span>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}
