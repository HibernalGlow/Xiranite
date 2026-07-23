import { GalleryHorizontalEnd, Grid2X2, MoreHorizontal, Rows3 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { ReaderFilePresentationOverridesDto } from "../../../../adapters/reader-http-client"
import {
  filePresentationSizeField,
  DEFAULT_READER_FILE_PRESENTATION,
  type ReaderFilePresentationConfig,
  type ReaderFilePresentationSizeField,
} from "../../readerFilePresentation"
import { ReaderFilePresentationSizeControl } from "./ReaderFilePresentationSizeControl"

interface ReaderFilePresentationMenuProps {
  presentation: ReaderFilePresentationConfig
  overrides?: ReaderFilePresentationOverridesDto
  disabled?: boolean
  onPreview(field: ReaderFilePresentationSizeField, value: number): void
  onCommit(field: ReaderFilePresentationSizeField, value: number): void
  onReset?(field: ReaderFilePresentationSizeField): void
  resetMode?: "inherit" | "default"
}

export function ReaderFilePresentationMoreMenu(props: ReaderFilePresentationMenuProps) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="icon-sm" variant="ghost" aria-label="更多" title="更多设置" disabled={props.disabled}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72" data-reader-file-presentation-menu="more">
        <ReaderFilePresentationMoreMenuItems {...props} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ReaderFilePresentationMoreMenuItems({
  presentation,
  overrides,
  disabled = false,
  onPreview,
  onCommit,
  onReset,
  resetMode = "inherit",
}: ReaderFilePresentationMenuProps) {
  const field = filePresentationSizeField(presentation.viewMode)
  if (!field) return null
  const Icon = field === "contentWidthPercent"
    ? Rows3
    : field === "bannerWidthPercent"
      ? GalleryHorizontalEnd
      : Grid2X2
  const handleReset = onReset ?? (resetMode === "default"
    ? (resetField: ReaderFilePresentationSizeField) => {
        const value = DEFAULT_READER_FILE_PRESENTATION[resetField]
        onPreview(resetField, value)
        onCommit(resetField, value)
      }
    : undefined)

  return (
    <>
      <DropdownMenuLabel className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-4" />
        项目尺寸
      </DropdownMenuLabel>
      <div className="px-2 pb-2" data-reader-file-presentation-menu="size">
        <ReaderFilePresentationSizeControl
          presentation={presentation}
          overrides={overrides}
          disabled={disabled}
          onPreview={onPreview}
          onCommit={onCommit}
          onReset={handleReset}
          resetMode={resetMode}
        />
      </div>
    </>
  )
}
