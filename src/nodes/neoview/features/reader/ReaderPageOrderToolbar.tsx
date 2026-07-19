/**
 * @migrated-from src/lib/components/layout/TopToolbar/SortPanel.svelte
 * @source-hash sha256:3ebb2eb6cbbeaa3c30ba9ed68afa78c2c5b2ab744ba713e7e150c7b2a8eb269a
 * @prototype migration/neoview/frontend/tsx-scaffold/src/lib/components/layout/TopToolbar/SortPanel.tsx
 * @migration-status adapted
 */
import {
  ArrowDown,
  ArrowUp,
  Clock,
  FileText,
  HardDrive,
  Image,
  List,
  Lock,
  LockOpen,
  Shuffle,
  Video,
  type LucideIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import type {
  ReaderMediaPriorityModeDto,
  ReaderPageOrderDto,
  ReaderPageSortModeDto,
} from "../../adapters/reader-http-client"

const SORT_CATEGORIES: Array<{ value: SortCategory; label: string; icon: LucideIcon }> = [
  { value: "fileName", label: "文件名", icon: FileText },
  { value: "fileSize", label: "文件大小", icon: HardDrive },
  { value: "timeStamp", label: "修改时间", icon: Clock },
  { value: "entry", label: "Entry 顺序", icon: List },
  { value: "random", label: "随机", icon: Shuffle },
]

type SortCategory = "fileName" | "fileSize" | "timeStamp" | "entry" | "random"

export function ReaderPageOrderToolbar({
  disabled,
  order,
  lockedSortMode,
  lockedMediaPriority,
  onChange,
  onLockChange,
}: {
  disabled?: boolean
  order: ReaderPageOrderDto
  lockedSortMode?: ReaderPageSortModeDto | null
  lockedMediaPriority?: Exclude<ReaderMediaPriorityModeDto, "none"> | null
  onChange(patch: Partial<ReaderPageOrderDto>): void | Promise<void>
  onLockChange?(patch: { lockedSortMode: ReaderPageSortModeDto | null; lockedMediaPriority: Exclude<ReaderMediaPriorityModeDto, "none"> | null }): void | Promise<void>
}) {
  const category = sortCategory(order.sortMode)
  const descending = order.sortMode.endsWith("Descending")
  const anyLocked = lockedSortMode != null || lockedMediaPriority != null

  function changeSort(nextCategory: SortCategory) {
    if (nextCategory === "random") {
      if (order.sortMode !== "random") void onChange({ sortMode: "random", randomSeed: undefined })
      return
    }
    const next = category === nextCategory && !descending
      ? `${nextCategory}Descending` as ReaderPageSortModeDto
      : nextCategory
    void onChange({ sortMode: next })
  }

  function lockSort(nextCategory: SortCategory) {
    if (!onLockChange) return
    if (lockedSortMode && sortCategory(lockedSortMode) === nextCategory) {
      void onLockChange({ lockedSortMode: null, lockedMediaPriority: lockedMediaPriority ?? null })
      return
    }
    const mode = category === nextCategory ? order.sortMode : nextCategory
    void onLockChange({ lockedSortMode: mode, lockedMediaPriority: lockedMediaPriority ?? null })
  }

  function lockMedia(mode: Exclude<ReaderMediaPriorityModeDto, "none">) {
    if (!onLockChange) return
    void onLockChange({
      lockedSortMode: lockedSortMode ?? null,
      lockedMediaPriority: lockedMediaPriority === mode ? null : mode,
    })
  }

  return <div className="flex flex-wrap items-center justify-center gap-2" data-reader-page-order-panel="true">
    <Button
      title={anyLocked ? "点击解锁排序设置" : "点击锁定当前排序设置；打开新书时自动应用"}
      aria-label={anyLocked ? "解锁页面排序" : "锁定页面排序"}
      aria-pressed={anyLocked}
      type="button"
      size="icon-sm"
      className="rounded-full"
      variant={anyLocked ? "default" : "ghost"}
      disabled={disabled || !onLockChange}
      onClick={() => void onLockChange?.(anyLocked
        ? { lockedSortMode: null, lockedMediaPriority: null }
        : {
            lockedSortMode: order.sortMode,
            lockedMediaPriority: order.mediaPriority === "none" ? null : order.mediaPriority,
          })}
    >{anyLocked ? <Lock /> : <LockOpen />}</Button>
    <Separator />
    <div className="inline-flex items-center gap-0.5 rounded-full bg-muted/60 p-0.5 shadow-inner" aria-label="媒体优先">
      {([[
        "videoFirst", "视频优先", Video,
      ], ["imageFirst", "图片优先", Image]] as const).map(([mode, label, Icon]) => <Button
        key={mode}
        title={`${label}；${order.mediaPriority === mode ? "点击取消" : "点击启用"}；${lockedMediaPriority === mode ? "右键解锁" : "右键锁定"}`}
        aria-label={label}
        aria-pressed={order.mediaPriority === mode}
        type="button"
        size="icon-sm"
        className={`rounded-full ${lockedMediaPriority === mode ? "ring-2 ring-primary ring-offset-1" : ""}`}
        variant={order.mediaPriority === mode ? "default" : "ghost"}
        disabled={disabled}
        onClick={() => void onChange({ mediaPriority: order.mediaPriority === mode ? "none" : mode })}
        onContextMenu={(event) => { event.preventDefault(); lockMedia(mode) }}
      ><Icon /></Button>)}
    </div>
    <Separator />
    <div className="inline-flex items-center gap-0.5 rounded-full bg-muted/60 p-0.5 shadow-inner" aria-label="页面排序方式">
      {SORT_CATEGORIES.map(({ value, label, icon: Icon }) => {
        const selected = category === value
        const locked = lockedSortMode != null && sortCategory(lockedSortMode) === value
        return <Button
          key={value}
          title={`${label}；${selected && value !== "random" ? `${descending ? "降序" : "升序"}，点击切换` : "点击切换排序"}；${locked ? "右键解锁" : "右键锁定"}`}
          aria-label={label}
          aria-pressed={selected}
          type="button"
          size="icon-sm"
          className={`relative rounded-full ${locked ? "ring-2 ring-primary ring-offset-1" : ""}`}
          variant={selected ? "default" : "ghost"}
          disabled={disabled}
          onClick={() => changeSort(value)}
          onContextMenu={(event) => { event.preventDefault(); lockSort(value) }}
        >
          <Icon />
          {selected && value !== "random" ? descending
            ? <ArrowDown className="absolute -right-0.5 -bottom-0.5 size-2" />
            : <ArrowUp className="absolute -right-0.5 -bottom-0.5 size-2" /> : null}
        </Button>
      })}
    </div>
  </div>
}

function sortCategory(mode: ReaderPageSortModeDto): SortCategory {
  return mode.replace("Descending", "") as SortCategory
}

function Separator() {
  return <span className="h-5 w-px bg-border/50" aria-hidden="true" />
}
