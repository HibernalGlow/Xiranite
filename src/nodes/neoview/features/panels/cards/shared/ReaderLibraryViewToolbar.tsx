import { GalleryHorizontalEnd, Grid2X2, List, Rows3 } from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import type { ReaderLibraryViewMode } from "./readerLibraryEntryLayout"

const VIEW_OPTIONS: ReadonlyArray<{ mode: ReaderLibraryViewMode; label: string; icon: typeof List }> = [
  { mode: "compact", label: "列表", icon: List },
  { mode: "content", label: "内容", icon: Rows3 },
  { mode: "banner", label: "横幅", icon: GalleryHorizontalEnd },
  { mode: "thumbnail", label: "缩略图", icon: Grid2X2 },
]

export function ReaderLibraryViewToolbar({ label, value, disabled = false, onValueChange, trailing }: {
  label: string
  value: ReaderLibraryViewMode
  disabled?: boolean
  onValueChange(value: ReaderLibraryViewMode): void
  trailing?: ReactNode
}) {
  return (
    <div className="flex min-w-0 items-center gap-1" role="group" aria-label={label}>
      {VIEW_OPTIONS.map(({ mode, label: optionLabel, icon: Icon }) => (
        <Button
          key={mode}
          type="button"
          size="icon-sm"
          variant={mode === value ? "default" : "ghost"}
          aria-label={optionLabel}
          title={optionLabel}
          aria-pressed={mode === value}
          disabled={disabled}
          onClick={() => onValueChange(mode)}
        >
          <Icon />
        </Button>
      ))}
      {trailing}
    </div>
  )
}
