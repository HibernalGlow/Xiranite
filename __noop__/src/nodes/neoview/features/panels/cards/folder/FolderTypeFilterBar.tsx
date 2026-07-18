import { Film, Filter, Folder, Package, type LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { ReaderDirectoryFilterDto } from "../../../../adapters/reader-http-client"

const FILTER_OPTIONS: Readonly<Record<ReaderDirectoryFilterDto, { label: string; icon: LucideIcon }>> = {
  all: { label: "全部", icon: Filter },
  archive: { label: "压缩包", icon: Package },
  directory: { label: "文件夹", icon: Folder },
  video: { label: "视频", icon: Film },
}

export default function FolderTypeFilterBar({ value, options, disabled, onChange }: {
  value: ReaderDirectoryFilterDto
  options: readonly ReaderDirectoryFilterDto[]
  disabled: boolean
  onChange(value: ReaderDirectoryFilterDto): void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-t border-border/50 px-2 py-1" data-folder-type-filter-bar="true">
      <span className="mr-1 text-xs text-muted-foreground">类型筛选</span>
      <div className="inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-muted/60 p-0.5 shadow-inner" role="group" aria-label="类型筛选">
        {options.map((filter) => {
          const option = FILTER_OPTIONS[filter]
          const Icon = option.icon
          return (
            <Button
              key={filter}
              type="button"
              variant={value === filter ? "default" : "ghost"}
              size="sm"
              className="h-6 shrink-0 rounded-full px-2 text-xs"
              aria-pressed={value === filter}
              title={`仅显示${filter === "all" ? "全部类型" : option.label}`}
              disabled={disabled}
              onClick={() => onChange(filter)}
            >
              <Icon className="mr-1 size-3" aria-hidden="true" />
              {option.label}
            </Button>
          )
        })}
      </div>
    </div>
  )
}
