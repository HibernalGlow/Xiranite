import { Folder, Plus, X } from "lucide-react"

import { Button } from "@/components/ui/button"

export interface FolderTabBarItem {
  id: string
  currentPath: string
  title: string
}

export default function FolderTabBar({ tabs, activeTabId, disabled, maxTabs, onActivate, onCreate, onClose }: {
  tabs: readonly FolderTabBarItem[]
  activeTabId: string
  disabled: boolean
  maxTabs: number
  onActivate(id: string): void
  onCreate(): void
  onClose(id: string): void
}) {
  return (
    <div className="flex h-8 min-w-0 items-center gap-1 overflow-x-auto rounded-md border bg-muted/30 p-0.5" data-folder-tab-bar="true">
      <div className="flex min-w-0 flex-1 items-center gap-1" role="tablist" aria-label="文件夹标签">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId
          return (
            <span key={tab.id} className="group flex h-7 min-w-20 max-w-44 shrink items-center rounded-md border border-transparent bg-background/60 data-[active=true]:border-border data-[active=true]:bg-background" data-active={active || undefined}>
              <button
                type="button"
                role="tab"
                aria-selected={active}
                className="flex min-w-0 flex-1 items-center gap-1 px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title={tab.currentPath || tab.title}
                disabled={disabled}
                onClick={() => onActivate(tab.id)}
                onAuxClick={(event) => {
                  if (event.button === 1 && tabs.length > 1) {
                    event.preventDefault()
                    onClose(tab.id)
                  }
                }}
              >
                <Folder className="size-3.5 shrink-0 text-amber-500" />
                <span className="truncate">{tab.title}</span>
              </button>
              {tabs.length > 1 ? (
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
