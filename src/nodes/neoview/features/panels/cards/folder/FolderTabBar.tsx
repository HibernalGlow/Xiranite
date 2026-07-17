import { ChevronLeft, ChevronRight, Copy, EyeOff, Folder, History, MoreVertical, PanelBottom, PanelLeft, PanelRight, PanelTop, Pin, PinOff, Plus, X } from "lucide-react"
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { ReaderFolderRegionPosition, ReaderFolderTabsConfig } from "../../../../adapters/reader-http-client"

export interface FolderTabBarItem {
  id: string
  currentPath: string
  title: string
  pinned: boolean
}

export interface RecentlyClosedFolderTabItem {
  id: string
  currentPath: string
  title: string
}

export default function FolderTabBar({ tabs, activeTabId, disabled, maxTabs, recentlyClosed, layout, onActivate, onCreate, onDuplicate, onClose, onTogglePinned, onCloseOthers, onCloseLeft, onCloseRight, onReopen, onLayoutChange }: {
  tabs: readonly FolderTabBarItem[]
  activeTabId: string
  disabled: boolean
  maxTabs: number
  recentlyClosed: readonly RecentlyClosedFolderTabItem[]
  layout: ReaderFolderTabsConfig
  onActivate(id: string): void
  onCreate(): void
  onDuplicate(id: string): void
  onClose(id: string): void
  onTogglePinned(id: string): void
  onCloseOthers(id: string): void
  onCloseLeft(id: string): void
  onCloseRight(id: string): void
  onReopen(id: string): void
  onLayoutChange(patch: Partial<ReaderFolderTabsConfig>): void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const widthRef = useRef(layout.width)
  const resizeRef = useRef<{ pointerId: number; startX: number; startWidth: number; direction: number }>()
  useEffect(() => {
    widthRef.current = layout.width
    if (rootRef.current) rootRef.current.style.width = isVertical(layout.layout) ? `${layout.width}px` : ""
  }, [layout.layout, layout.width])
  const unpinnedCount = tabs.reduce((count, tab) => count + (tab.pinned ? 0 : 1), 0)
  const vertical = isVertical(layout.layout)

  function beginWidthResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const root = rootRef.current
    if (!root || !vertical) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: widthRef.current,
      direction: layout.layout === "right" ? -1 : 1,
    }
  }

  function moveWidthResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const resize = resizeRef.current
    const root = rootRef.current
    if (!resize || resize.pointerId !== event.pointerId || !root) return
    const width = Math.min(400, Math.max(100, Math.round(resize.startWidth + (event.clientX - resize.startX) * resize.direction)))
    widthRef.current = width
    root.style.width = `${width}px`
  }

  function finishWidthResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (resizeRef.current?.pointerId !== event.pointerId) return
    resizeRef.current = undefined
    if (widthRef.current !== layout.width) onLayoutChange({ width: widthRef.current })
  }

  function cancelWidthResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (resizeRef.current?.pointerId !== event.pointerId) return
    resizeRef.current = undefined
    widthRef.current = layout.width
    if (rootRef.current) rootRef.current.style.width = `${layout.width}px`
  }

  if (layout.layout === "none") {
    return (
      <div className="flex h-8 items-center" data-folder-tab-bar="false" data-folder-tab-layout="none">
        <LayoutSettingsButton disabled={disabled} layout={layout} onLayoutChange={onLayoutChange} />
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className={vertical
        ? "relative flex h-full min-h-0 min-w-24 flex-col items-stretch gap-1 overflow-y-auto rounded-md border bg-muted/30 p-0.5"
        : "flex h-8 min-w-0 items-center gap-1 overflow-x-auto rounded-md border bg-muted/30 p-0.5"}
      style={vertical ? { width: layout.width } : undefined}
      data-folder-tab-bar="true"
      data-folder-tab-layout={layout.layout}
    >
      <div className={vertical ? "flex min-h-0 min-w-0 flex-1 flex-col items-stretch gap-1" : "flex min-w-0 flex-1 items-center gap-1"} role="tablist" aria-label="文件夹标签">
        {tabs.map((tab, tabIndex) => {
          const active = tab.id === activeTabId
          const canClose = tabs.length > 1 && (tab.pinned || unpinnedCount > 1)
          const hasClosableOthers = tabs.some((candidate) => candidate.id !== tab.id && !candidate.pinned)
          const hasClosableLeft = tabs.slice(0, tabIndex).some((candidate) => !candidate.pinned)
          const hasClosableRight = tabs.slice(tabIndex + 1).some((candidate) => !candidate.pinned)
          return (
            <span key={tab.id} className={`group flex h-7 min-w-20 shrink items-center rounded-md border border-transparent bg-background/60 data-[active=true]:border-border data-[active=true]:bg-background ${vertical ? "w-full" : "max-w-44"}`} data-active={active || undefined} data-pinned={tab.pinned || undefined}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="ml-1 grid size-5 shrink-0 place-items-center rounded hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring" aria-label={`标签操作 ${tab.title}`} title="标签操作" disabled={disabled}>
                    {tab.pinned ? <Pin className="size-3 text-primary" /> : <Folder className="size-3.5 text-amber-500" />}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-44">
                  <DropdownMenuItem onSelect={() => onTogglePinned(tab.id)}>
                    {tab.pinned ? <PinOff /> : <Pin />}{tab.pinned ? "取消固定" : "固定标签"}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={tabs.length >= maxTabs} onSelect={() => onDuplicate(tab.id)}><Copy />复制标签</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled={!canClose} onSelect={() => onClose(tab.id)}><X />关闭标签</DropdownMenuItem>
                  <DropdownMenuItem disabled={!hasClosableOthers} onSelect={() => onCloseOthers(tab.id)}><X />关闭其他标签</DropdownMenuItem>
                  <DropdownMenuItem disabled={!hasClosableLeft} onSelect={() => onCloseLeft(tab.id)}><ChevronLeft />关闭左侧标签</DropdownMenuItem>
                  <DropdownMenuItem disabled={!hasClosableRight} onSelect={() => onCloseRight(tab.id)}><ChevronRight />关闭右侧标签</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <button
                type="button"
                role="tab"
                aria-selected={active}
                className="flex min-w-0 flex-1 items-center px-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title={tab.currentPath || tab.title}
                disabled={disabled}
                onClick={() => onActivate(tab.id)}
                onAuxClick={(event) => {
                  if (event.button === 1 && canClose) {
                    event.preventDefault()
                    onClose(tab.id)
                  }
                }}
              >
                <span className="truncate">{tab.title}</span>
              </button>
              {canClose ? (
                <button
                  type="button"
                  className="mr-0.5 grid size-5 shrink-0 place-items-center rounded opacity-60 hover:bg-destructive/15 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`关闭标签 ${tab.title}`}
                  title="关闭标签"
                  disabled={disabled}
                  onClick={() => onClose(tab.id)}
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </span>
          )
        })}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="icon-sm" variant="ghost" className="size-7 shrink-0" aria-label="重新打开关闭的页签" title="重新打开关闭的页签" disabled={disabled || !recentlyClosed.length || tabs.length >= maxTabs}>
            <History />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {[...recentlyClosed].reverse().map((tab) => (
            <DropdownMenuItem key={tab.id} title={tab.currentPath} onSelect={() => onReopen(tab.id)}>
              <History /><span className="truncate">{tab.title}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <LayoutSettingsButton disabled={disabled} layout={layout} onLayoutChange={onLayoutChange} />
      <Button type="button" size="icon-sm" variant="ghost" className="size-7 shrink-0" aria-label="新建文件夹标签" title="新建文件夹标签" disabled={disabled || tabs.length >= maxTabs} onClick={onCreate}>
        <Plus />
      </Button>
      {vertical ? (
        <button
          type="button"
          className={`absolute inset-y-0 z-10 w-2 cursor-col-resize touch-none hover:bg-primary/30 ${layout.layout === "left" ? "right-0" : "left-0"}`}
          aria-label="调整标签栏宽度"
          aria-valuemin={100}
          aria-valuemax={400}
          aria-valuenow={layout.width}
          role="separator"
          onPointerDown={beginWidthResize}
          onPointerMove={moveWidthResize}
          onPointerUp={finishWidthResize}
          onPointerCancel={cancelWidthResize}
          onDoubleClick={() => onLayoutChange({ width: 160 })}
        />
      ) : null}
    </div>
  )
}

const POSITIONS: readonly ReaderFolderRegionPosition[] = ["none", "top", "bottom", "left", "right"]
const POSITION_LABELS: Record<ReaderFolderRegionPosition, string> = { none: "隐藏", top: "顶部", bottom: "底部", left: "左侧", right: "右侧" }

function PositionChoices({ label, value, onChange }: { label: string; value: ReaderFolderRegionPosition; onChange(value: ReaderFolderRegionPosition): void }) {
  return (
    <>
      <DropdownMenuLabel>{label}</DropdownMenuLabel>
      <div className="flex justify-center gap-1 px-2 py-1">
        {POSITIONS.map((position) => {
          const Icon = position === "none" ? EyeOff : position === "top" ? PanelTop : position === "bottom" ? PanelBottom : position === "left" ? PanelLeft : PanelRight
          return (
            <Button
              key={position}
              type="button"
              size="icon-sm"
              variant={value === position ? "default" : "ghost"}
              aria-label={`${label}：${POSITION_LABELS[position]}`}
              aria-pressed={value === position}
              title={POSITION_LABELS[position]}
              onClick={() => onChange(position)}
            >
              <Icon />
            </Button>
          )
        })}
      </div>
    </>
  )
}

function LayoutSettingsButton({ disabled, layout, onLayoutChange }: { disabled: boolean; layout: ReaderFolderTabsConfig; onLayoutChange(patch: Partial<ReaderFolderTabsConfig>): void }) {
  const [open, setOpen] = useState(false)
  const select = (patch: Partial<ReaderFolderTabsConfig>) => {
    onLayoutChange(patch)
    setOpen(false)
  }
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="icon-sm" variant="ghost" className="size-7 shrink-0" aria-label="标签栏布局设置" title="标签栏布局设置" disabled={disabled}>
          <MoreVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[calc(100vh-1rem)] w-52 overflow-y-auto">
        <PositionChoices label="标签栏位置" value={layout.layout} onChange={(value) => select({ layout: value })} />
        <DropdownMenuSeparator />
        <PositionChoices label="面包屑位置" value={layout.breadcrumbPosition} onChange={(value) => select({ breadcrumbPosition: value })} />
        <DropdownMenuSeparator />
        <PositionChoices label="工具栏位置" value={layout.toolbarPosition} onChange={(value) => select({ toolbarPosition: value })} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function isVertical(position: ReaderFolderRegionPosition): boolean {
  return position === "left" || position === "right"
}
