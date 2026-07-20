import { ALargeSmall, ArrowDown, ArrowUp, Calendar, FileType, FolderTree, GalleryHorizontalEnd, Grid2X2, List, Search, Rows3, type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import type { ReaderLibraryViewMode } from "./readerLibraryEntryLayout"

export type ReaderLibrarySortField = "name" | "path" | "date" | "type"
export type ReaderLibrarySortOrder = "asc" | "desc"

export interface ReaderLibrarySort {
  field: ReaderLibrarySortField
  order: ReaderLibrarySortOrder
}

const VIEW_OPTIONS: ReadonlyArray<{ mode: ReaderLibraryViewMode; label: string; icon: LucideIcon }> = [
  { mode: "compact", label: "紧凑列表", icon: List },
  { mode: "cover-list", label: "封面列表", icon: Rows3 },
  { mode: "mosaic-list", label: "横幅", icon: GalleryHorizontalEnd },
  { mode: "cover-grid", label: "封面网格", icon: Grid2X2 },
]

const SORT_OPTIONS: ReadonlyArray<{ field: ReaderLibrarySortField; label: string; icon: LucideIcon }> = [
  { field: "name", label: "名称", icon: ALargeSmall },
  { field: "path", label: "路径", icon: FolderTree },
  { field: "date", label: "时间", icon: Calendar },
  { field: "type", label: "类型", icon: FileType },
]

export function ReaderLibraryViewToolbar({ label, value, disabled = false, onValueChange, search, onSearchChange, sort, onSortChange, trailing }: {
  label: string
  value: ReaderLibraryViewMode
  disabled?: boolean
  onValueChange(value: ReaderLibraryViewMode): void
  search: string
  onSearchChange(value: string): void
  sort: ReaderLibrarySort
  onSortChange(value: ReaderLibrarySort): void
  trailing?: ReactNode
}) {
  const currentView = VIEW_OPTIONS.find((option) => option.mode === value) ?? VIEW_OPTIONS[0]!
  const currentSort = SORT_OPTIONS.find((option) => option.field === sort.field) ?? SORT_OPTIONS[0]!
  const CurrentViewIcon = currentView.icon
  const CurrentSortIcon = currentSort.icon
  const orderLabel = sort.order === "asc" ? "升序" : "降序"
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1" role="group" aria-label={label}>
      <label className="relative min-w-20 flex-1">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="搜索名称或路径"
          aria-label={`搜索${label}`}
          disabled={disabled}
          className="h-7 min-w-0 pl-7 text-xs"
        />
      </label>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="icon-sm" variant="ghost" aria-label={`视图：${currentView.label}`} title={`视图：${currentView.label}`} disabled={disabled}>
            <CurrentViewIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44" data-reader-library-menu="view">
          <DropdownMenuRadioGroup value={value} onValueChange={(next) => onValueChange(next as ReaderLibraryViewMode)}>
            {VIEW_OPTIONS.map(({ mode, label: optionLabel, icon: Icon }) => (
              <DropdownMenuRadioItem key={mode} value={mode}>
                <Icon className="size-4" />
                {optionLabel}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="icon-sm" variant="ghost" aria-label={`排序：${currentSort.label} · ${orderLabel}`} title={`排序：${currentSort.label} · ${orderLabel}`} disabled={disabled}>
            <span className="relative inline-flex size-4">
              <CurrentSortIcon className="size-4" data-reader-library-sort-field={sort.field} />
              {sort.order === "asc"
                ? <ArrowUp className="absolute -bottom-1 -right-1 size-2.5 rounded-full bg-background p-px" data-reader-library-sort-order="asc" />
                : <ArrowDown className="absolute -bottom-1 -right-1 size-2.5 rounded-full bg-background p-px" data-reader-library-sort-order="desc" />}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44" data-reader-library-menu="sort">
          <DropdownMenuRadioGroup value={sort.field} onValueChange={(field) => onSortChange({ ...sort, field: field as ReaderLibrarySortField })}>
            {SORT_OPTIONS.map(({ field, label: optionLabel, icon: Icon }) => (
              <DropdownMenuRadioItem key={field} value={field}>
                <Icon className="size-4" />
                {optionLabel}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onSortChange({ ...sort, order: sort.order === "asc" ? "desc" : "asc" })}>
            {sort.order === "asc" ? <ArrowDown /> : <ArrowUp />}
            {sort.order === "asc" ? "切换为降序" : "切换为升序"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {trailing}
    </div>
  )
}
