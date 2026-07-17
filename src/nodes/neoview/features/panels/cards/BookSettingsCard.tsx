/**
 * @migrated-from src/lib/cards/properties/BookSettingsCard.svelte
 * @source-hash sha256:7034b5cf6da4a88be90a5cfd1d7b0bd1e4cf296429a5aad9bb30fec9379a9e22
 * @migration-status partial
 */
import { ArrowLeft, ArrowRight, Columns2, Square } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import type { ReaderPanelContext } from "../registry"

export type BookPageMode = "single" | "double"

export interface BookSettingsCardProps {
  bookName: string
  pageMode: BookPageMode
  readingDirection: "left-to-right" | "right-to-left"
  disabled?: boolean
  onPageModeChange(pageMode: BookPageMode): void | Promise<void>
  onReadingDirectionChange(direction: "left-to-right" | "right-to-left"): void | Promise<void>
}

export const BOOK_SETTINGS_CAPABILITY_AUDIT = [
  { id: "favorite", status: "blocked", blocker: "No per-book favorite read/write contract." },
  { id: "rating", status: "blocked", blocker: "No per-book rating read/write contract." },
  { id: "reading-direction", status: "supported-session", blocker: "Canonical per-book persistence is not available yet." },
  { id: "page-mode", status: "supported", blocker: undefined },
  { id: "horizontal-book", status: "blocked", blocker: "Reader session options do not define horizontal-book behavior." },
] as const

export default function BookSettingsPanelCard(context: ReaderPanelContext) {
  if (!context.session || !context.onPageModeChange || !context.onReadingDirectionChange) return null
  return (
    <BookSettingsCard
      bookName={context.session.book.displayName}
      pageMode={context.session.frame.layout.pageMode}
      readingDirection={context.session.frame.direction}
      disabled={context.disabled}
      onPageModeChange={context.onPageModeChange}
      onReadingDirectionChange={context.onReadingDirectionChange}
    />
  )
}

export function BookSettingsCard({
  bookName,
  pageMode,
  readingDirection,
  disabled = false,
  onPageModeChange,
  onReadingDirectionChange,
}: BookSettingsCardProps) {
  const [pending, setPending] = useState<"direction" | "page-mode">()
  const [error, setError] = useState<string>()

  async function commit(kind: "direction" | "page-mode", operation: () => void | Promise<void>) {
    if (pending) return
    setPending(kind)
    setError(undefined)
    try {
      await operation()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(undefined)
    }
  }

  return (
    <section className="grid gap-3 text-xs" data-neoview-book-settings-card="true">
      <p className="truncate text-muted-foreground" title={bookName}>{bookName}</p>
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">阅读方向</span>
        <div className="flex shrink-0 items-center rounded-md border border-border bg-muted/45 p-0.5" aria-label="阅读方向">
          <Button
            type="button"
            size="sm"
            variant={readingDirection === "left-to-right" ? "default" : "ghost"}
            aria-pressed={readingDirection === "left-to-right"}
            disabled={disabled || Boolean(pending)}
            onClick={() => void commit("direction", () => onReadingDirectionChange("left-to-right"))}
          >
            <ArrowRight />左→右
          </Button>
          <Button
            type="button"
            size="sm"
            variant={readingDirection === "right-to-left" ? "default" : "ghost"}
            aria-pressed={readingDirection === "right-to-left"}
            disabled={disabled || Boolean(pending)}
            onClick={() => void commit("direction", () => onReadingDirectionChange("right-to-left"))}
          >
            <ArrowLeft />右→左
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">显示模式</span>
        <div className="flex shrink-0 items-center rounded-md border border-border bg-muted/45 p-0.5" aria-label="显示模式">
          <Button
            type="button"
            size="sm"
            variant={pageMode === "single" ? "default" : "ghost"}
            aria-pressed={pageMode === "single"}
            disabled={disabled || Boolean(pending)}
            onClick={() => void commit("page-mode", () => onPageModeChange("single"))}
          >
            <Square />单页
          </Button>
          <Button
            type="button"
            size="sm"
            variant={pageMode === "double" ? "default" : "ghost"}
            aria-pressed={pageMode === "double"}
            disabled={disabled || Boolean(pending)}
            onClick={() => void commit("page-mode", () => onPageModeChange("double"))}
          >
            <Columns2 />双页
          </Button>
        </div>
      </div>
      {error ? <div role="alert" className="text-[10px] text-destructive">{error}</div> : null}
    </section>
  )
}
