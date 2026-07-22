import { ChevronLeft, ChevronRight, Copy, EyeOff, Folder, History, MoreVertical, PanelBottom, PanelLeft, PanelRight, PanelTop, Pin, PinOff, Plus, Search, X } from "lucide-react"
import { useEffect, useRef, useState, type ComponentProps, type PointerEvent as ReactPointerEvent } from "react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { ReaderFolderRegionPosition, ReaderFolderTabsConfig } from "../../../../adapters/reader-http-client"

export interface FolderTabBarItem {
  id: string
  currentPath: string
  title: string
  pinned: boolean
  kind?: "directory" | "search"
}

export interface RecentlyClosedFolderTabItem {
  id: string
  currentPath: string
  title: string
  kind?: "directory" | "search"
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
  const effectiveLayout = layout.layout === "none" && tabs.length > 1 ? "top" : layout.layout
  const vertical = isVertical(effectiveLayout)

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

  // Host hides this component entirely for a single working tab. When rendered
  // with one tab (tests / layout none), keep a compact menu without a strip.
  if (tabs.length <= 1 || effectiveLayout === "none") {
    const tab = tabs.find((candidate) => candidate.id === activeTabId) ?? tabs[0]
    return (
      <div className="flex h-8 items-center gap-1" data-folder-tab-bar="false" data-folder-tab-layout="none">
        {tab ? (
          <FolderTabActionsMenu
            tab={tab}
            disabled={disabled}
            canDuplicate={tabs.length < maxTabs}
            canClose={false}
            canCloseOthers={false}
            canCloseLeft={false}
            canCloseRight={false}
            onDuplicate={onDuplicate}
            onClose={onClose}
            onTogglePinned={onTogglePinned}
            onCloseOthers={onCloseOthers}
            onCloseLeft={onCloseLeft}
            onCloseRight={onCloseRight}
          />
        ) : null}
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
      data-folder-tab-layout={effectiveLayout}
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
              <FolderTabActionsMenu
                tab={tab}
                disabled={disabled}
                canDuplicate={tabs.length < maxTabs}
                canClose={canClose}
                canCloseOthers={hasClosableOthers}
                canCloseLeft={hasClosableLeft}
                canCloseRight={hasClosableRight}
                onDuplicate={onDuplicate}
                onClose={onClose}
                onTogglePinned={onTogglePinned}
                onCloseOthers={onCloseOthers}
                onCloseLeft={onCloseLeft}
                onCloseRight={onCloseRight}
              />
              <button
                type="button"
                role="tab"
                aria-selected={active}
                data-folder-tab-kind={tab.kind ?? "directory"}
                className="flex min-w-0 flex-1 items-center gap-1 px-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title={tab.kind === "search" ? `${tab.title}\n${tab.currentPath}` : (tab.currentPath || tab.title)}
                disabled={disabled}
                onClick={() => onActivate(tab.id)}
                onAuxClick={(event) => {
                  if (event.button === 1 && canClose) {
                    event.preventDefault()
                    onClose(tab.id)
                  }
                }}
              >
                {tab.kind === "search"
                  ? <Search className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                  : null}
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
      <FolderTabActionPad
        disabled={disabled}
        tabCount={tabs.length}
        maxTabs={maxTabs}
        recentlyClosed={recentlyClosed}
        layout={layout}
        onCreate={onCreate}
        onReopen={onReopen}
        onLayoutChange={onLayoutChange}
      />
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

function FolderTabActionsMenu({ tab, disabled, canDuplicate, canClose, canCloseOthers, canCloseLeft, canCloseRight, onDuplicate, onClose, onTogglePinned, onCloseOthers, onCloseLeft, onCloseRight }: {
  tab: FolderTabBarItem
  disabled: boolean
  canDuplicate: boolean
  canClose: boolean
  canCloseOthers: boolean
  canCloseLeft: boolean
  canCloseRight: boolean
  onDuplicate(id: string): void
  onClose(id: string): void
  onTogglePinned(id: string): void
  onCloseOthers(id: string): void
  onCloseLeft(id: string): void
  onCloseRight(id: string): void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="ml-1 grid size-5 shrink-0 place-items-center rounded hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring" aria-label={`标签操作 ${tab.title}`} title="标签操作" disabled={disabled}>
          {tab.pinned
            ? <Pin className="size-3 text-primary" />
            : tab.kind === "search"
              ? <Search className="size-3.5 text-muted-foreground" />
              : <Folder className="size-3.5 text-amber-500" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuItem disabled={tab.kind === "search"} onSelect={() => onTogglePinned(tab.id)}>
          {tab.pinned ? <PinOff /> : <Pin />}{tab.kind === "search" ? "搜索标签不可固定" : tab.pinned ? "取消固定" : "固定标签"}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canDuplicate} onSelect={() => onDuplicate(tab.id)}><Copy />复制标签</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!canClose} onSelect={() => onClose(tab.id)}><X />关闭标签</DropdownMenuItem>
        <DropdownMenuItem disabled={!canCloseOthers} onSelect={() => onCloseOthers(tab.id)}><X />关闭其他标签</DropdownMenuItem>
        <DropdownMenuItem disabled={!canCloseLeft} onSelect={() => onCloseLeft(tab.id)}><ChevronLeft />关闭左侧标签</DropdownMenuItem>
        <DropdownMenuItem disabled={!canCloseRight} onSelect={() => onCloseRight(tab.id)}><ChevronRight />关闭右侧标签</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const POSITIONS: readonly ReaderFolderRegionPosition[] = ["none", "top", "bottom", "left", "right"]
const POSITION_LABELS: Record<ReaderFolderRegionPosition, string> = { none: "隐藏", top: "顶部", bottom: "底部", left: "左侧", right: "右侧" }
const POSITION_ICONS = {
  none: EyeOff,
  top: PanelTop,
  bottom: PanelBottom,
  left: PanelLeft,
  right: PanelRight,
} as const

/** Compact radio list — replaces the old 5-icon horizontal strip that inflated the menu. */
function PositionChoices({ label, value, onChange }: { label: string; value: ReaderFolderRegionPosition; onChange(value: ReaderFolderRegionPosition): void }) {
  return (
    <>
      <DropdownMenuLabel>{label}</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(next as ReaderFolderRegionPosition)}>
        {POSITIONS.map((position) => {
          const Icon = POSITION_ICONS[position]
          return (
            <DropdownMenuRadioItem
              key={position}
              value={position}
              aria-label={`${label}：${POSITION_LABELS[position]}`}
            >
              <Icon className="size-4" />
              {POSITION_LABELS[position]}
            </DropdownMenuRadioItem>
          )
        })}
      </DropdownMenuRadioGroup>
    </>
  )
}

/**
 * 3-in-1 pad for tab chrome actions — same interaction language as the
 * folder navigation 5-pad and breadcrumb 4-pad:
 *   top    = new tab
 *   left   = reopen closed tabs
 *   right  = layout / more settings
 */
function FolderTabActionPad({
  disabled,
  tabCount,
  maxTabs,
  recentlyClosed,
  layout,
  onCreate,
  onReopen,
  onLayoutChange,
}: {
  disabled: boolean
  tabCount: number
  maxTabs: number
  recentlyClosed: readonly RecentlyClosedFolderTabItem[]
  layout: ReaderFolderTabsConfig
  onCreate(): void
  onReopen(id: string): void
  onLayoutChange(patch: Partial<ReaderFolderTabsConfig>): void
}) {
  const canCreate = !disabled && tabCount < maxTabs
  const canReopen = !disabled && recentlyClosed.length > 0 && tabCount < maxTabs
  return (
    <div
      className="relative size-8 shrink-0 overflow-hidden rounded-md border border-border/70 bg-muted/30 shadow-xs focus-within:ring-2 focus-within:ring-ring/50"
      role="group"
      aria-label="标签页操作"
      data-folder-tab-action-pad="true"
    >
      <TabPadButton
        position="top"
        aria-label="新建文件夹标签"
        title="新建文件夹标签"
        disabled={!canCreate}
        onClick={onCreate}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <TabPadButton
            position="left"
            aria-label="重新打开关闭的页签"
            title="重新打开关闭的页签"
            disabled={!canReopen}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {recentlyClosed.length === 0 ? (
            <DropdownMenuItem disabled>暂无已关闭页签</DropdownMenuItem>
          ) : (
            [...recentlyClosed].reverse().map((tab) => (
              <DropdownMenuItem key={tab.id} title={tab.currentPath} onSelect={() => onReopen(tab.id)}>
                {tab.kind === "search" ? <Search /> : <History />}
                <span className="truncate">{tab.title}</span>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <LayoutSettingsButton pad disabled={disabled} layout={layout} onLayoutChange={onLayoutChange} />
      <div className="pointer-events-none absolute inset-0 z-[3] text-foreground" aria-hidden="true">
        <Plus className={`absolute left-1/2 top-0.5 size-2 -translate-x-1/2 ${canCreate ? "" : "opacity-25"}`} />
        <History className={`absolute left-0.5 top-1/2 size-2 -translate-y-1/2 ${canReopen ? "" : "opacity-25"}`} />
        <MoreVertical className={`absolute right-0.5 top-1/2 size-2 -translate-y-1/2 ${disabled ? "opacity-25" : ""}`} />
      </div>
    </div>
  )
}

const TAB_PAD_POSITION_CLASSES = {
  top: "[clip-path:polygon(0_0,100%_0,70%_40%,30%_40%)]",
  left: "[clip-path:polygon(0_0,40%_30%,40%_70%,0_100%)]",
  right: "[clip-path:polygon(100%_0,60%_30%,60%_70%,100%_100%)]",
  bottom: "[clip-path:polygon(30%_60%,70%_60%,100%_100%,0_100%)]",
} as const

function TabPadButton({
  position,
  active = false,
  className,
  ...props
}: ComponentProps<typeof Button> & {
  position: keyof typeof TAB_PAD_POSITION_CLASSES
  active?: boolean
}) {
  return (
    <Button
      type="button"
      size="icon-sm"
      variant={active ? "secondary" : "ghost"}
      className={`absolute inset-0 z-[1] size-full min-w-0 rounded-none p-0 ${TAB_PAD_POSITION_CLASSES[position]} ${className ?? ""}`}
      data-folder-tab-pad-position={position}
      {...props}
    />
  )
}

function LayoutSettingsButton({
  disabled,
  layout,
  onLayoutChange,
  pad = false,
}: {
  disabled: boolean
  layout: ReaderFolderTabsConfig
  onLayoutChange(patch: Partial<ReaderFolderTabsConfig>): void
  /** When true, render as the right slice of the 3-in-1 tab action pad. */
  pad?: boolean
}) {
  const [open, setOpen] = useState(false)
  const select = (patch: Partial<ReaderFolderTabsConfig>) => {
    onLayoutChange(patch)
    setOpen(false)
  }
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        {pad ? (
          <TabPadButton
            position="right"
            active={open}
            aria-label="标签栏布局设置"
            title="标签栏布局设置"
            disabled={disabled}
          />
        ) : (
          <Button type="button" size="icon-sm" variant="ghost" className="size-7 shrink-0" aria-label="标签栏布局设置" title="标签栏布局设置" disabled={disabled}>
            <MoreVertical />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44" data-folder-layout-settings="true">
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
