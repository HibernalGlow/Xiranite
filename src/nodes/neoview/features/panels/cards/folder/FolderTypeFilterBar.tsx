import { FileJson, Film, Filter, Folder, Image as ImageIcon, Library, Package, type LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { ReaderDirectoryFilterDto } from "../../../../adapters/reader-http-client"
import { cn } from "@/lib/utils"

const FILTER_GROUPS: readonly {
  id: string
  label: string
  options: readonly {
    value: ReaderDirectoryFilterDto
    label: string
    hint: string
    icon: LucideIcon
  }[]
}[] = [
  {
    id: "scope",
    label: "范围",
    options: [
      { value: "library", label: "可读内容", hint: "隐藏 JSON / 配置等其它文件", icon: Library },
      { value: "all", label: "全部类型", hint: "显示目录中的所有项目", icon: Filter },
    ],
  },
  {
    id: "kind",
    label: "按类型",
    options: [
      { value: "directory", label: "文件夹", hint: "仅子目录", icon: Folder },
      { value: "archive", label: "压缩包", hint: "cbz / zip / rar / 7z", icon: Package },
      { value: "video", label: "视频", hint: "mp4 / mkv / webm", icon: Film },
      { value: "image", label: "图片", hint: "jpg / png / webp / jxl", icon: ImageIcon },
      { value: "other", label: "其它文件", hint: "JSON · txt · 配置", icon: FileJson },
    ],
  },
]

const FALLBACK_OPTIONS = FILTER_GROUPS.flatMap((group) => group.options)

export function folderTypeFilterMeta(value: ReaderDirectoryFilterDto): {
  label: string
  hint: string
  icon: LucideIcon
} {
  return FALLBACK_OPTIONS.find((option) => option.value === value) ?? FALLBACK_OPTIONS[0]!
}

/** Hierarchical type filter control used inside the toolbar more-menu. */
export default function FolderTypeFilterPanel({ value, options, disabled, onChange }: {
  value: ReaderDirectoryFilterDto
  options?: readonly ReaderDirectoryFilterDto[]
  disabled?: boolean
  onChange(value: ReaderDirectoryFilterDto): void
}) {
  const allowed = options?.length ? new Set(options) : undefined
  return (
    <div className="w-64 space-y-3 p-1" data-folder-type-filter-panel="true" role="group" aria-label="文件夹显示类型">
      {FILTER_GROUPS.map((group) => {
        const visible = group.options.filter((option) => !allowed || allowed.has(option.value))
        if (!visible.length) return null
        return (
          <section key={group.id} className="space-y-1.5">
            <div className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{group.label}</div>
            <div className="grid gap-1">
              {visible.map((option) => {
                const Icon = option.icon
                const active = value === option.value
                return (
                  <Button
                    key={option.value}
                    type="button"
                    variant={active ? "secondary" : "ghost"}
                    size="sm"
                    className={cn(
                      "h-auto justify-start gap-2 px-2 py-1.5 text-left",
                      active && "ring-1 ring-border",
                    )}
                    aria-pressed={active}
                    title={option.hint}
                    disabled={disabled}
                    onClick={() => onChange(option.value)}
                  >
                    <span className={cn(
                      "grid size-7 shrink-0 place-items-center rounded-md border",
                      active ? "border-primary/40 bg-primary/10 text-primary" : "border-border/70 bg-muted/40 text-muted-foreground",
                    )}>
                      <Icon className="size-3.5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{option.label}</span>
                      <span className="block truncate text-[10px] font-normal text-muted-foreground">{option.hint}</span>
                    </span>
                  </Button>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/** @deprecated Prefer FolderTypeFilterPanel; kept for tests that still render a compact strip. */
export function FolderTypeFilterBar(props: {
  value: ReaderDirectoryFilterDto
  options: readonly ReaderDirectoryFilterDto[]
  disabled: boolean
  onChange(value: ReaderDirectoryFilterDto): void
}) {
  return (
    <div className="border-t border-border/50 px-1 py-1" data-folder-type-filter-bar="true">
      <FolderTypeFilterPanel {...props} />
    </div>
  )
}
