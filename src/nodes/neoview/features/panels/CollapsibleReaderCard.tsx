/**
 * @migrated-from src/lib/components/cards/CollapsibleCard.svelte
 * @source-hash sha256:517de356df45c43dc30c31f9b4bd2ef63a32dfc60cdf41063ab1bb062aa2ff04
 * @features card-windows-tabs
 * @migration-status adapted
 */
import { useState, type ReactNode } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"

import { Button } from "@/components/ui/button"

export function CollapsibleReaderCard({ title, children }: { title: string; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <section className="overflow-hidden rounded-md border border-border/70 bg-card/80 shadow-sm" data-reader-card={title}>
      <header className="flex min-h-9 items-center justify-between gap-2 border-b border-border/60 px-2.5 py-1.5">
        <h3 className="truncate text-xs font-medium">{title}</h3>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={collapsed ? `展开${title}` : `折叠${title}`}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? <ChevronDown /> : <ChevronUp />}
        </Button>
      </header>
      {collapsed ? null : <div className="p-3">{children}</div>}
    </section>
  )
}
