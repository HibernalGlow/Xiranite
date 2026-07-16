import { ChevronLeft, ChevronRight, Folder, Pin, PinOff, Plus, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export interface FolderTabBarItem {
  id: string
  currentPath: string
  title: string
  pinned: boolean
}

export default function FolderTabBar({ tabs, activeTabId, disabled, maxTabs, onActivate, onCreate, onClose, onTogglePinned, onCloseOthers, onCloseLeft, onCloseRight }: {
  tabs: readonly FolderTabBarItem[]
  activeTabId: string
  disabled: boolean
  maxTabs: number
  onActivate(id: string): void
  onCreate(): void
  onClose(id: string): void
  onTogglePinned(id: string): void
  onCloseOthers(id: string): void
  onCloseLeft(id: string): void
  onCloseRight(id: string): void
}) {
  const unpinnedCount = tabs.reduce((count, tab) => count + (tab.pinned ? 0 : 1), 0)
  return (
    <div className="flex h-8 min-w-0 items-center gap-1 overflow-x-auto rounded-md border bg-muted/30 p-0.5" data-folder-tab-bar="true">
      <div className="flex min-w-0 flex-1 items-center gap-1" role="tablist" aria-label="文件夹标签">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId
          const tabIndex = tabs.indexOf(tab)
          const canClose = tabs.length > 1 && (tab.pinned || unpinnedCount > 1)
          const hasClosableOthers = tabs.some((candidate) => candidate.id !== tab.id && !candidate.pinned)
          const hasClosableLeft = tabs.slice(0, tabIndex).some((candidate) => !candidate.pinned)
          const hasClosableRight = tabs.slice(tabIndex + 1).some((candidate) => !candidate.pinned)
          return (
            <span key={tab.id} className="group flex h-7 min-w-20 max-w-44 shrink items-center rounded-md border border-transparent bg-background/60 data-[active=true]:border-border data-[active=true]:bg-background" data-active={active || undefined} data-pinned={tab.pinned || undefined}>
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
      <Button type="button" size="icon-sm" variant="ghost" className="size-7 shrink-0" aria-label="新建文件夹标签" title="新建文件夹标签" disabled={disabled || tabs.length >= maxTabs} onClick={onCreate}>
        <Plus />
      </Button>
    </div>
  )
}
