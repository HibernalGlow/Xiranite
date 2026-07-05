import type { ReactNode } from "react"

export function CardShell({ children }: { children: ReactNode }) {
  return <div className="h-[320px] w-[384px] rounded border bg-background shadow-sm">{children}</div>
}
