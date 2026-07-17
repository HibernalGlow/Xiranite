import { lazy, Suspense, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react"

import type {
  ReaderDirectoryPageDto,
  ReaderFolderPinnedTab,
  ReaderFolderViewConfig,
  ReaderFolderViewMode,
  ReaderFolderViewPatch,
} from "../../../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../../registry"
import type { FolderBrowserCloneProvider, FolderBrowserCloneSnapshot } from "../FolderMainCard"

const FolderTabBar = lazy(() => import("./FolderTabBar"))
const MAX_FOLDER_TABS = 8
const MAX_PINNED_FOLDER_TABS = 7

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
  initialClone?: FolderBrowserCloneSnapshot
}

export type FolderBrowserPaneProps = ReaderPanelContext & {
  active: boolean
  tabBar?: ReactNode
  initialClone?: FolderBrowserCloneSnapshot
  onCurrentPathChange(path: string): void
  onCloneProvider(provider?: FolderBrowserCloneProvider): void
}

export default function FolderTabsHost({ context, folderView, BrowserPane }: {
  context: ReaderPanelContext
  folderView: ReaderFolderViewConfig
  BrowserPane: ComponentType<FolderBrowserPaneProps>
}) {
  const initialRef = useRef<ReturnType<typeof initialFolderTabs> | null>(null)
  initialRef.current ??= initialFolderTabs(context.sourcePath ?? folderView.homePath, folderView)
  const tabSequenceRef = useRef(initialRef.current.sequence)
  const tabAccessHistoryRef = useRef<readonly string[]>([initialRef.current.activeTabId])
  const cloneProvidersRef = useRef(new Map<string, FolderBrowserCloneProvider>())
  const cloneRequestsRef = useRef(new Set<AbortController>())
  const mountedRef = useRef(true)
  const [tabs, setTabs] = useState<readonly FolderTabDescriptor[]>(initialRef.current.tabs)
  const [activeTabId, setActiveTabId] = useState(initialRef.current.activeTabId)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      for (const request of cloneRequestsRef.current) request.abort(new DOMException("Folder tabs closed", "AbortError"))
      cloneRequestsRef.current.clear()
    }
  }, [])

  useEffect(() => {
    if (!context.sourcePath) return
    setTabs((current) => current.map((tab) => tab.id === activeTabId && !tab.pinned && tab.sourcePath !== context.sourcePath
      ? { ...tab, sourcePath: context.sourcePath!, currentPath: context.sourcePath!, title: folderTabTitle(context.sourcePath!) }
      : tab))
  }, [context.sourcePath])

  useEffect(() => {
    setTabs((current) => current.map((tab) => tab.viewDirty
      ? tab
      : { ...tab, viewMode: folderView.viewMode, previewCount: folderView.previewCount }))
  }, [folderView.viewMode, folderView.previewCount])

  useEffect(() => {
    if (!folderView.tabs) return
    setTabs((current) => reconcilePinnedTabs(current, folderView.tabs!.pinned))
  }, [folderView.tabs])

  function createTab() {
    if (tabs.length >= MAX_FOLDER_TABS) return
    const id = `folder-tab-${++tabSequenceRef.current}`
    const path = folderView.homePath
    tabAccessHistoryRef.current = recordTabVisit(tabAccessHistoryRef.current, id)
    setTabs((current) => [...current, createFolderTab(id, path, folderView)])
    setActiveTabId(id)
  }

  async function duplicateTab(id: string) {
    if (tabs.length >= MAX_FOLDER_TABS || !context.client.cloneDirectoryBrowser) return
    const source = tabs.find((tab) => tab.id === id)
    const provider = cloneProvidersRef.current.get(id)
    if (!source || !provider) return
    const captured = await provider()
    if (!captured) return
    const request = new AbortController()
    cloneRequestsRef.current.add(request)
    let clonedPage: ReaderDirectoryPageDto
    try {
      clonedPage = await context.client.cloneDirectoryBrowser(captured.sourceSessionId, request.signal)
    } catch {
      return
    } finally {
      cloneRequestsRef.current.delete(request)
    }
    if (!mountedRef.current) {
      void context.client.closeDirectoryBrowser?.(clonedPage.sessionId).catch(() => undefined)
      return
    }
    const snapshot = structuredClone({ ...captured, clonedPage })
    const cloneId = `folder-tab-${++tabSequenceRef.current}`
    const pinned = source.pinned && tabs.filter((tab) => tab.pinned).length < MAX_PINNED_FOLDER_TABS
    const clone: FolderTabDescriptor = {
      ...source,
      id: cloneId,
      sourcePath: source.currentPath,
      title: uniqueFolderTabTitle(source.title, tabs),
      pinned,
      initialClone: snapshot,
    }
    const nextTabs = [...tabs, clone]
    tabAccessHistoryRef.current = recordTabVisit(tabAccessHistoryRef.current, cloneId)
    setTabs(nextTabs)
    setActiveTabId(cloneId)
    if (pinned) await persistPinnedTabs(nextTabs)
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
    const nextTabs = tabs.filter((candidate) => candidate.id !== id)
    cloneProvidersRef.current.delete(id)
    tabAccessHistoryRef.current = tabAccessHistoryRef.current.filter((visitedId) => visitedId !== id)
    setTabs(nextTabs)
    if (tab.pinned) void persistPinnedTabs(nextTabs)
    if (activeTabId === id) {
      const nextActiveId = findMostRecentTab(tabAccessHistoryRef.current, new Set(nextTabs.map((candidate) => candidate.id)))
        ?? nextTabs[Math.min(index, nextTabs.length - 1)]!.id
      tabAccessHistoryRef.current = recordTabVisit(tabAccessHistoryRef.current, nextActiveId)
      setActiveTabId(nextActiveId)
    }
  }

  function togglePinned(id: string) {
    const source = tabs.find((tab) => tab.id === id)
    if (!source || (!source.pinned && tabs.filter((tab) => tab.pinned).length >= MAX_PINNED_FOLDER_TABS)) return
    const previous = tabs
    const next = tabs.map((tab) => tab.id === id ? { ...tab, pinned: !tab.pinned } : tab)
    setTabs(next)
    void persistPinnedTabs(next).catch(() => setTabs(previous))
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
    for (const closedId of closeIds) cloneProvidersRef.current.delete(closedId)
    tabAccessHistoryRef.current = tabAccessHistoryRef.current.filter((visitedId) => !closeIds.has(visitedId))
    setTabs(nextTabs)
    if (closeIds.has(activeTabId)) {
      tabAccessHistoryRef.current = recordTabVisit(tabAccessHistoryRef.current, id)
      setActiveTabId(id)
    }
  }

  function updateTabPath(id: string, path: string) {
    const next = tabs.map((tab) => tab.id === id && tab.currentPath !== path
      ? { ...tab, currentPath: path, title: folderTabTitle(path) }
      : tab)
    if (next.every((tab, index) => tab === tabs[index])) return
    setTabs(next)
    if (next.some((tab) => tab.id === id && tab.pinned)) void persistPinnedTabs(next)
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

  async function persistPinnedTabs(nextTabs: readonly FolderTabDescriptor[]) {
    await context.onFolderView?.({ tabs: { pinned: pinnedTabConfig(nextTabs) } })
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
        onDuplicate={(id) => { void duplicateTab(id) }}
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
              initialClone={tab.initialClone}
              onCurrentPathChange={(path) => updateTabPath(tab.id, path)}
              onCloneProvider={(provider) => {
                if (provider) cloneProvidersRef.current.set(tab.id, provider)
                else cloneProvidersRef.current.delete(tab.id)
              }}
            />
          </div>
        )
      })}
    </div>
  )
}

function initialFolderTabs(path: string, folderView: ReaderFolderViewConfig) {
  const pinned = (folderView.tabs?.pinned ?? []).slice(0, MAX_PINNED_FOLDER_TABS)
  const tabs = pinned.map((tab, index) => ({
    ...createFolderTab(`folder-tab-${index + 1}`, tab.path, folderView),
    title: tab.title,
    pinned: true,
  }))
  const activeTabId = `folder-tab-${tabs.length + 1}`
  tabs.push(createFolderTab(activeTabId, path, folderView))
  return { tabs, activeTabId, sequence: tabs.length }
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

function pinnedTabConfig(tabs: readonly FolderTabDescriptor[]): ReaderFolderPinnedTab[] {
  return tabs.filter((tab) => tab.pinned).slice(0, MAX_PINNED_FOLDER_TABS).map((tab) => ({ path: tab.currentPath, title: tab.title }))
}

function reconcilePinnedTabs(tabs: readonly FolderTabDescriptor[], pinned: readonly ReaderFolderPinnedTab[]): readonly FolderTabDescriptor[] {
  const remaining = [...pinned]
  return tabs.map((tab) => {
    const index = remaining.findIndex((candidate) => candidate.path === tab.currentPath && candidate.title === tab.title)
    if (index < 0) return tab.pinned ? { ...tab, pinned: false } : tab
    remaining.splice(index, 1)
    return tab.pinned ? tab : { ...tab, pinned: true }
  })
}

function folderTabTitle(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "")
  return normalized.split(/[\\/]/).at(-1) || normalized || "新标签页"
}

function uniqueFolderTabTitle(title: string, tabs: readonly FolderTabDescriptor[]): string {
  const existing = new Set(tabs.map((tab) => tab.title))
  if (!existing.has(title)) return title
  for (let suffix = 2; suffix <= MAX_FOLDER_TABS; suffix += 1) {
    const candidate = `${title} (${suffix})`
    if (!existing.has(candidate)) return candidate
  }
  return `${title} copy`
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
