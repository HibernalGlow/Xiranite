/**
 * @migrated-from src/lib/cards/properties/BookSettingsCard.svelte
 * @source-hash sha256:7034b5cf6da4a88be90a5cfd1d7b0bd1e4cf296429a5aad9bb30fec9379a9e22
 * @migration-status partial
 */
import { Columns2, Square } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { ReaderPanelContext } from "../registry"

export type BookPageMode = "single" | "double"

export interface BookSettingsCardProps {
  bookName: string
  pageMode: BookPageMode
  disabled?: boolean
  onPageModeChange(pageMode: BookPageMode): void | Promise<void>
}

export const BOOK_SETTINGS_CAPABILITY_AUDIT = [
  { id: "favorite", status: "blocked", blocker: "No per-book favorite read/write contract." },
  { id: "rating", status: "blocked", blocker: "No per-book rating read/write contract." },
  { id: "reading-direction", status: "blocked", blocker: "Reader session options do not accept reading direction updates." },
  { id: "page-mode", status: "supported", blocker: undefined },
  { id: "horizontal-book", status: "blocked", blocker: "Reader session options do not define horizontal-book behavior." },
] as const

export default function BookSettingsPanelCard(context: ReaderPanelContext) {
  if (!context.session || !context.onPageModeChange) return null
  return (
    <BookSettingsCard
      bookName={context.session.book.displayName}
      pageMode={context.session.frame.layout.pageMode}
      disabled={context.disabled}
      onPageModeChange={context.onPageModeChange}
    />
  )
}

export function BookSettingsCard({
  bookName,
  pageMode,
  disabled = false,
  onPageModeChange,
}: BookSettingsCardProps) {
  return (
    <section className="grid gap-3 text-xs" data-neoview-book-settings-card="true">
      <p className="truncate text-muted-foreground" title={bookName}>{bookName}</p>
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">显示模式</span>
        <div className="flex shrink-0 items-center rounded-md border border-border bg-muted/45 p-0.5" aria-label="显示模式">
          <Button
            type="button"
            size="sm"
            variant={pageMode === "single" ? "default" : "ghost"}
            aria-pressed={pageMode === "single"}
            disabled={disabled}
            onClick={() => void onPageModeChange("single")}
          >
            <Square />单页
          </Button>
          <Button
            type="button"
            size="sm"
            variant={pageMode === "double" ? "default" : "ghost"}
            aria-pressed={pageMode === "double"}
            disabled={disabled}
            onClick={() => void onPageModeChange("double")}
          >
            <Columns2 />双页
          </Button>
        </div>
      </div>
    </section>
  )
}
