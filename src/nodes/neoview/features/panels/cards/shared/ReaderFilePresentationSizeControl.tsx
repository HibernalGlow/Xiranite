import { GalleryHorizontalEnd, Grid2X2, Rows3, Undo2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import type { ReaderFilePresentationOverridesDto, ReaderFolderViewMode } from "../../../../adapters/reader-http-client"
import {
  filePresentationSizeField,
  type ReaderFilePresentationSizeField,
} from "../../readerFilePresentation"

type SizePresentation = {
  viewMode: ReaderFolderViewMode
  contentWidthPercent: number
  thumbnailWidthPercent: number
  bannerWidthPercent: number
}

const FIELD_META = {
  contentWidthPercent: { label: "内容预览宽度", fallback: 35, min: 20, max: 70, Icon: Rows3 },
  thumbnailWidthPercent: { label: "缩略图宽度", fallback: 20, min: 10, max: 90, Icon: Grid2X2 },
  bannerWidthPercent: { label: "横幅宽度", fallback: 50, min: 20, max: 100, Icon: GalleryHorizontalEnd },
} satisfies Record<ReaderFilePresentationSizeField, unknown>

export function ReaderFilePresentationSizeControl({
  presentation,
  overrides,
  disabled = false,
  onPreview,
  onCommit,
  onReset,
}: {
  presentation: SizePresentation
  overrides?: ReaderFilePresentationOverridesDto
  disabled?: boolean
  onPreview(field: ReaderFilePresentationSizeField, value: number): void
  onCommit(field: ReaderFilePresentationSizeField, value: number): void
  onReset?(field: ReaderFilePresentationSizeField): void
}) {
  const field = filePresentationSizeField(presentation.viewMode)
  if (!field) return <div className="px-2 py-1 text-xs text-muted-foreground">当前视图没有项目尺寸设置</div>
  const meta = FIELD_META[field]
  const Icon = meta.Icon
  const value = presentation[field]
  const inherited = overrides?.[field] === undefined
  return (
    <div
      className="grid grid-cols-[1rem_minmax(5rem,1fr)_3rem_auto] items-center gap-2"
      data-file-presentation-size-field={field}
      data-file-presentation-inherited={inherited || undefined}
    >
      <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
      <Slider
        aria-label={meta.label}
        min={meta.min}
        max={meta.max}
        step={field === "bannerWidthPercent" ? 10 : 1}
        value={[value]}
        disabled={disabled}
        onValueChange={(next) => onPreview(field, next[0] ?? meta.fallback)}
        onValueCommit={(next) => onCommit(field, next[0] ?? meta.fallback)}
      />
      <span className="text-right text-[10px] tabular-nums text-muted-foreground">
        {field === "thumbnailWidthPercent" ? `${Math.round(48 + (value - 10) * 3)}px` : `${value}%`}
      </span>
      {onReset ? (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={`恢复继承的${meta.label}`}
          title={inherited ? "正在继承 File Card" : "恢复继承 File Card"}
          disabled={disabled || inherited}
          onClick={() => onReset(field)}
        >
          <Undo2 />
        </Button>
      ) : null}
    </div>
  )
}
