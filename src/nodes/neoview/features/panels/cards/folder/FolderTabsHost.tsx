import { lazy, Suspense, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react"

import type {
  ReaderFolderViewConfig,
  ReaderFolderViewMode,
  ReaderFolderViewPatch,
} from "../../../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../../registry"

const FolderTabBar = lazy(() => import("./FolderTabBar"))
const MAX_FOLDER_TABS = 8

type FolderPreviewCount = 4 | 9 | 16

interface FolderTabDescriptor {
  id: string
  sourcePath: string
  currentPath: string
  title: string
  viewMode: ReaderFolderViewMode
  previewCount: FolderPreviewCount
  viewDirty: boolean
  pinned: boolean
}

export type FolderBrowserPaneProps = ReaderPanelContext & {
  active: boolean
  tabBar?: ReactNode
  onCurrentPathChange(path: string): void
}

export default function FolderTabsHost({ context, folderView, BrowserPane }: {
  context: ReaderPanelContext
  folderView: ReaderFolderViewConfig
  BrowserPane: ComponentType<FolderBrowserPaneProps>
}) {
  const tabSequenceRef = useRef(1)
  const tabAccessHistoryRef = useRef<readonly string[]>(["folder-tab-1"])
  const [tabs, setTabs] = useState<readonly FolderTabDescriptor[]>(() => [createFolderTab("folder-tab-1", context.sourcePath ?? "", folderView)])
  const [activeTabId, setActiveTabId] = useState("folder-tab-1")

  useEffect(() => {
    if (!context.sourcePath) return
    setTabs((current) => current.map((tab) => tab.id === activeTabId && tab.sourcePath !== context.sourcePath
      ? { ...tab, sourcePath: context.sourcePath!, currentPath: context.sourcePath!, title: folderTabTitle(context.sourcePath!) }
      : tab))
  }, [context.sourcePath])

  useEffect(() => {
    setTabs((current) => current.map((tab) => tab.viewDirty
      ? tab
      : { ...tab, viewMode: folderView.viewMode, previewCount: folderView.previewCount }))
  }, [folderView.viewMode, folderView.previewCount])

  function createTab() {
    if (tabs.length >= MAX_FOLDER_TABS) return
    const id = `folder-tab-${++tabSequenceRef.current}`
    const path = folderView.homePath
    tabAccessHistoryRef.current = recordTabVisit(tabAccessHistoryRef.current, id)
    setTabs((current) => [...current, createFolderTab(id, path, folderView)])
    setActiveTabId(id)
  }

  function activateTab(id: string) {
    if (id === activeTabId || !tabs.some((tab) => tab.id === id)) return
    tabAccessHistoryRef.current = recordTabVisit(tabAccessHistoryRef.current, id)
    setActiveTabId(id)
  }

  function closeTab(id: string) {
    if (tabs.length <= 1) return
    const index = tabs.findIndex((tab) => tab.id === id)
    if (index < 0) return
    const tab = tabs[index]!
    if (!tab.pinned && tabs.filter((candidate) => !candidate.pinned).length <= 1) return
    const nextTabs = tabs.filter((tab) => tab.id !== id)
    const nextTabIds = new Set(nextTabs.map((tab) => tab.id))
    tabAccessHistoryRef.current = tabAccessHistoryRef.current.filter((visitedId) => visitedId !== id)
    setTabs(nextTabs)
    if (activeTabId === id) {
      const nextActiveId = findMostRecentTab(tabAccessHistoryRef.current, nextTabIds)
        ?? nextTabs[Math.min(index, nextTabs.length - 1)]!.id
      tabAccessHistoryRef.current = recordTabVisit(tabAccessHistoryRef.current, nextActiveId)
      setActiveTabId(nextActiveId)
    }
  }

  function togglePinned(id: string) {
    setTabs((current) => current.map((tab) => tab.id === id ? { ...tab, pinned: !tab.pinned } : tab))
  }

  function closeTabs(id: string, scope: "others" | "left" | "right") {
    const targetIndex = tabs.findIndex((tab) => tab.id === id)
    if (targetIndex < 0) return
    const closeIds = new Set(tabs.flatMap((tab, index) => {
      if (tab.pinned || tab.id === id) return []
      if (scope === "others") return [tab.id]
      if (scope === "left" && index < targetIndex) return [tab.id]
      if (scope === "right" && index > targetIndex) return [tab.id]
      return []
    }))
    if (!closeIds.size) return
    const nextTabs = tabs.filter((tab) => !closeIds.has(tab.id))
    tabAccessHistoryRef.current = tabAccessHistoryRef.current.filter((visitedId) => !closeIds.has(visitedId))
    setTabs(nextTabs)
    if (closeIds.has(activeTabId)) {
      tabAccessHistoryRef.current = recordTabVisit(tabAccessHistoryRef.current, id)
      setActiveTabId(id)
    }
  }

  function updateTabPath(id: string, path: string) {
    setTabs((current) => current.map((tab) => tab.id === id && tab.currentPath !== path
      ? { ...tab, currentPath: path, title: folderTabTitle(path) }
      : tab))
  }

  async function updateTabFolderView(id: string, patch: ReaderFolderViewPatch["folderView"]) {
    setTabs((current) => current.map((tab) => tab.id === id
      ? {
          ...tab,
          viewMode: patch.viewMode ?? tab.viewMode,
          previewCount: patch.previewCount ?? tab.previewCount,
          viewDirty: tab.viewDirty || patch.viewMode !== undefined || patch.previewCount !== undefined,
        }
      : tab))
    await context.onFolderView?.(patch)
  }

  const tabBar = (
    <Suspense fallback={<div className="h-8 rounded-md border bg-muted/30" aria-hidden="true" />}>
      <FolderTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        disabled={context.disabled}
        maxTabs={MAX_FOLDER_TABS}
        onActivate={activateTab}
        onCreate={createTab}
        onClose={closeTab}
        onTogglePinned={togglePinned}
        onCloseOthers={(id) => closeTabs(id, "others")}
        onCloseLeft={(id) => closeTabs(id, "left")}
        onCloseRight={(id) => closeTabs(id, "right")}
      />
    </Suspense>
  )

  return (
    <div className="relative min-h-0" data-folder-tab-count={tabs.length}>
      {tabs.map((tab) => {
        const active = tab.id === activeTabId
        return (
          <div key={tab.id} className={active ? "contents" : "pointer-events-none invisible absolute inset-0"} aria-hidden={!active || undefined} data-folder-tab-pane={tab.id}>
            <BrowserPane
              {...context}
              sourcePath={tab.sourcePath}
              folderView={{ ...folderView, viewMode: tab.viewMode, previewCount: tab.previewCount }}
              onFolderView={(patch) => updateTabFolderView(tab.id, patch)}
              active={active}
              tabBar={active ? tabBar : undefined}
              onCurrentPathChange={(path) => updateTabPath(tab.id, path)}
            />
          </div>
        )
      })}
    </div>
  )
}

function createFolderTab(id: string, path: string, folderView: ReaderFolderViewConfig): FolderTabDescriptor {
  return {
    id,
    sourcePath: path,
    currentPath: path,
    title: folderTabTitle(path),
    viewMode: folderView.viewMode,
    previewCount: folderView.previewCount,
    viewDirty: false,
    pinned: false,
  }
}

function folderTabTitle(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "")
  return normalized.split(/[\\/]/).at(-1) || normalized || "新标签页"
}

function recordTabVisit(history: readonly string[], id: string): readonly string[] {
  return [...history.filter((visitedId) => visitedId !== id), id]
}

function findMostRecentTab(history: readonly string[], availableIds: ReadonlySet<string>): string | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const id = history[index]!
    if (availableIds.has(id)) return id
  }
  return undefined
}
