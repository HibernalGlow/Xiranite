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
import { searchTabTitle, type FolderSearchTabSnapshot } from "./search/folderSearchModel"

const FolderTabBar = lazy(() => import("./FolderTabBar"))
const MAX_FOLDER_TABS = 8
const MAX_PINNED_FOLDER_TABS = 7
const MAX_RECENTLY_CLOSED_TABS = 10

type FolderPreviewCount = 4 | 9 | 16
type FolderTabKind = "directory" | "search"

interface FolderTabDescriptor {
  id: string
  kind: FolderTabKind
  sourcePath: string
  currentPath: string
  title: string
  viewMode: ReaderFolderViewMode
  previewCount: FolderPreviewCount
  viewDirty: boolean
  pinned: boolean
  initialClone?: FolderBrowserCloneSnapshot
  /** Session-only search workspace restored when this tab activates. */
  searchSnapshot?: FolderSearchTabSnapshot
}

interface RecentlyClosedFolderTab {
  id: string
  source: Omit<FolderTabDescriptor, "id" | "pinned" | "initialClone">
  snapshot: FolderBrowserCloneSnapshot
}

export type FolderBrowserPaneProps = ReaderPanelContext & {
  active: boolean
  /** True for the selected tab even when the File Card panel is hidden (History/Bookmark reuse). */
  navigationActive?: boolean
  browserPath: string
  tabBar?: ReactNode
  folderTabCount: number
  maxFolderTabs: number
  onCreateTab(): void
  currentFolderTabPinned: boolean
  canReopenFolderTab: boolean
  onDuplicateCurrentTab(): void
  onToggleCurrentTabPinned(): void
  onReopenFolderTab(): void
  initialClone?: FolderBrowserCloneSnapshot
  onCurrentPathChange(path: string): void
  onOpenInNewTab(path: string): void
  onOpenSearchInNewTab?(snapshot: FolderSearchTabSnapshot): void
  initialSearchSnapshot?: FolderSearchTabSnapshot
  onCloneProvider(provider?: FolderBrowserCloneProvider): void
}

export default function FolderTabsHost({ context, folderView, BrowserPane }: {
  context: ReaderPanelContext
  folderView: ReaderFolderViewConfig
  BrowserPane: ComponentType<FolderBrowserPaneProps>
}) {
  const initialRef = useRef<ReturnType<typeof initialFolderTabs> | null>(null)
  initialRef.current ??= initialFolderTabs(
    resolveFolderStartupPath(context.browserOriginPath ?? context.sourcePath, folderView.homePath),
    folderView,
    context.sourcePath,
  )
  const tabSequenceRef = useRef(initialRef.current.sequence)
  const tabAccessHistoryRef = useRef<readonly string[]>([initialRef.current.activeTabId])
  const cloneProvidersRef = useRef(new Map<string, FolderBrowserCloneProvider>())
  const cloneRequestsRef = useRef(new Set<AbortController>())
  const closingTabsRef = useRef(new Set<string>())
  const mountedRef = useRef(true)
  const [tabs, setTabs] = useState<readonly FolderTabDescriptor[]>(initialRef.current.tabs)
  const [activeTabId, setActiveTabId] = useState(initialRef.current.activeTabId)
  const tabsRef = useRef(tabs)
  const activeTabIdRef = useRef(activeTabId)
  const recentlyClosedRef = useRef<readonly RecentlyClosedFolderTab[]>([])
  const [recentlyClosed, setRecentlyClosed] = useState<readonly RecentlyClosedFolderTab[]>([])
  tabsRef.current = tabs
  activeTabIdRef.current = activeTabId

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      for (const request of cloneRequestsRef.current) request.abort(new DOMException("Folder tabs closed", "AbortError"))
      cloneRequestsRef.current.clear()
    }
  }, [])

  useEffect(() => {
    const reopenLatest = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.key.toLowerCase() !== "t") return
      const latest = recentlyClosedRef.current.at(-1)
      if (!latest || tabsRef.current.length >= MAX_FOLDER_TABS) return
      event.preventDefault()
      void reopenTab(latest.id)
    }
    window.addEventListener("keydown", reopenLatest)
    return () => window.removeEventListener("keydown", reopenLatest)
  }, [])

  useEffect(() => {
    if (!context.sourcePath) return
    setTabs((current) => current.map((tab) => {
      if (tab.id !== activeTabId || tab.pinned || tab.sourcePath === context.sourcePath) return tab
      return { ...tab, sourcePath: context.sourcePath! }
    }))
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

  function openPathInNewTab(path: string) {
    if (tabsRef.current.length >= MAX_FOLDER_TABS) return
    const id = `folder-tab-${++tabSequenceRef.current}`
    const next = createFolderTab(id, path, folderView)
    tabAccessHistoryRef.current = recordTabVisit(tabAccessHistoryRef.current, id)
    setTabs((current) => [...current, next])
    setActiveTabId(id)
  }

  function openSearchInNewTab(snapshot: FolderSearchTabSnapshot) {
    if (tabsRef.current.length >= MAX_FOLDER_TABS) return
    const id = `folder-tab-${++tabSequenceRef.current}`
    const title = uniqueFolderTabTitle(searchTabTitle(snapshot.criteria), tabsRef.current)
    const next: FolderTabDescriptor = {
      ...createFolderTab(id, snapshot.rootPath, folderView),
      kind: "search",
      title,
      searchSnapshot: structuredClone(snapshot),
    }
    tabAccessHistoryRef.current = recordTabVisit(tabAccessHistoryRef.current, id)
    setTabs((current) => [...current, next])
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

  async function closeTab(id: string) {
    if (tabs.length <= 1) return
    const index = tabs.findIndex((tab) => tab.id === id)
    if (index < 0) return
    const tab = tabs[index]!
    if (!tab.pinned && tabs.filter((candidate) => !candidate.pinned).length <= 1) return
    await closeTabDescriptors([tab], activeTabId === id ? { index } : undefined)
  }

  function togglePinned(id: string) {
    const source = tabs.find((tab) => tab.id === id)
    // Search result tabs are session workspaces; pinning only persists path+title.
    if (!source || source.kind === "search") return
    if (!source.pinned && tabs.filter((tab) => tab.pinned).length >= MAX_PINNED_FOLDER_TABS) return
    const previous = tabs
    const next = tabs.map((tab) => tab.id === id ? { ...tab, pinned: !tab.pinned } : tab)
    setTabs(next)
    void persistPinnedTabs(next).catch(() => setTabs(previous))
  }

  async function closeTabs(id: string, scope: "others" | "left" | "right") {
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
    await closeTabDescriptors(tabs.filter((tab) => closeIds.has(tab.id)), closeIds.has(activeTabId) ? { preferredId: id } : undefined)
  }

  async function closeTabDescriptors(
    descriptors: readonly FolderTabDescriptor[],
    activeFallback?: { index?: number; preferredId?: string },
  ) {
    const closable = descriptors.filter((tab) => !closingTabsRef.current.has(tab.id) && cloneProvidersRef.current.has(tab.id))
    if (!closable.length) return
    for (const tab of closable) closingTabsRef.current.add(tab.id)
    const captured = await Promise.all(closable.map(async (tab) => {
      try {
        const snapshot = await cloneProvidersRef.current.get(tab.id)?.(true)
        return snapshot ? { tab, snapshot } : undefined
      } catch {
        return undefined
      } finally {
        closingTabsRef.current.delete(tab.id)
      }
    }))
    if (!mountedRef.current) return
    const closed = captured.filter((value): value is { tab: FolderTabDescriptor; snapshot: FolderBrowserCloneSnapshot } => Boolean(value))
    if (!closed.length) return
    const closedIds = new Set(closed.map(({ tab }) => tab.id))
    const currentTabs = tabsRef.current
    const nextTabs = currentTabs.filter((tab) => !closedIds.has(tab.id))
    rememberClosedTabs(closed)
    for (const closedId of closedIds) {
      cloneProvidersRef.current.delete(closedId)
    }
    tabAccessHistoryRef.current = tabAccessHistoryRef.current.filter((visitedId) => !closedIds.has(visitedId))
    setTabs(nextTabs)
    if (closed.some(({ tab }) => tab.pinned)) void persistPinnedTabs(nextTabs)
    if (closedIds.has(activeTabIdRef.current)) {
      const nextActiveId = activeFallback?.preferredId && nextTabs.some((tab) => tab.id === activeFallback.preferredId)
        ? activeFallback.preferredId
        : findMostRecentTab(tabAccessHistoryRef.current, new Set(nextTabs.map((tab) => tab.id)))
          ?? nextTabs[Math.min(activeFallback?.index ?? 0, nextTabs.length - 1)]?.id
      if (nextActiveId) {
        tabAccessHistoryRef.current = recordTabVisit(tabAccessHistoryRef.current, nextActiveId)
        setActiveTabId(nextActiveId)
      }
    }
  }

  function rememberClosedTabs(closed: readonly { tab: FolderTabDescriptor; snapshot: FolderBrowserCloneSnapshot }[]) {
    setRecentlyClosed((current) => {
      const additions = closed.map(({ tab, snapshot }) => ({
        id: snapshot.sourceSessionId,
        source: {
          kind: tab.kind,
          sourcePath: tab.currentPath,
          currentPath: tab.currentPath,
          title: tab.title,
          viewMode: tab.viewMode,
          previewCount: tab.previewCount,
          viewDirty: tab.viewDirty,
          searchSnapshot: tab.searchSnapshot,
        },
        snapshot: structuredClone(snapshot),
      }))
      const next = [...current.filter((item) => !additions.some((addition) => addition.id === item.id)), ...additions]
        .slice(-MAX_RECENTLY_CLOSED_TABS)
      recentlyClosedRef.current = next
      return next
    })
  }

  async function reopenTab(id: string) {
    if (tabsRef.current.length >= MAX_FOLDER_TABS || !context.client.reopenDirectoryBrowser) return
    const closed = recentlyClosedRef.current.find((item) => item.id === id)
    if (!closed || cloneRequestsRef.current.size) return
    const request = new AbortController()
    cloneRequestsRef.current.add(request)
    let reopenedPage: ReaderDirectoryPageDto
    try {
      reopenedPage = await context.client.reopenDirectoryBrowser(closed.snapshot.sourceSessionId, request.signal)
    } catch {
      return
    } finally {
      cloneRequestsRef.current.delete(request)
    }
    if (!mountedRef.current || tabsRef.current.length >= MAX_FOLDER_TABS) {
      void context.client.closeDirectoryBrowser?.(reopenedPage.sessionId).catch(() => undefined)
      return
    }
    const restoredId = `folder-tab-${++tabSequenceRef.current}`
    const restored: FolderTabDescriptor = {
      ...closed.source,
      kind: closed.source.kind ?? "directory",
      id: restoredId,
      pinned: false,
      initialClone: structuredClone({ ...closed.snapshot, clonedPage: reopenedPage }),
      searchSnapshot: closed.source.searchSnapshot,
    }
    recentlyClosedRef.current = recentlyClosedRef.current.filter((item) => item.id !== closed.id)
    setRecentlyClosed(recentlyClosedRef.current)
    tabAccessHistoryRef.current = recordTabVisit(tabAccessHistoryRef.current, restoredId)
    setTabs((current) => [...current, restored])
    setActiveTabId(restoredId)
  }

  function updateTabPath(id: string, path: string) {
    const next = tabs.map((tab) => {
      if (tab.id !== id || tab.currentPath === path) return tab
      // Navigating away from a search workspace converts it back to a directory tab.
      return {
        ...tab,
        kind: "directory" as const,
        currentPath: path,
        title: folderTabTitle(path),
        searchSnapshot: undefined,
      }
    })
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

  const tabBar = tabs.length > 1 ? (
    <Suspense fallback={<div className="h-8 rounded-md border bg-muted/30" aria-hidden="true" />}>
      <FolderTabBar
        tabs={tabs.map((tab) => ({
          id: tab.id,
          currentPath: tab.currentPath,
          title: tab.title,
          pinned: tab.pinned,
          kind: tab.kind,
        }))}
        activeTabId={activeTabId}
        disabled={context.disabled}
        maxTabs={MAX_FOLDER_TABS}
        layout={folderView.tabs!}
        onActivate={activateTab}
        onCreate={createTab}
        onDuplicate={(id) => { void duplicateTab(id) }}
        onClose={(id) => { void closeTab(id) }}
        onTogglePinned={togglePinned}
        onCloseOthers={(id) => { void closeTabs(id, "others") }}
        onCloseLeft={(id) => { void closeTabs(id, "left") }}
        onCloseRight={(id) => { void closeTabs(id, "right") }}
        recentlyClosed={recentlyClosed.map((item) => ({
          id: item.id,
          title: item.source.title,
          currentPath: item.source.currentPath,
          kind: item.source.kind ?? "directory",
        }))}
        onReopen={(id) => { void reopenTab(id) }}
        onLayoutChange={(tabs) => { void context.onFolderView?.({ tabs }) }}
      />
    </Suspense>
  ) : undefined

  return (
    <div
      className="grid min-h-0 min-w-0 w-full flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]"
      data-folder-tab-count={tabs.length}
    >
      {tabs.map((tab) => {
        const active = tab.id === activeTabId
        const browserActive = active && context.panelActive !== false
        return (
          <div
            key={tab.id}
            className={`col-start-1 row-start-1 flex min-h-0 min-w-0 overflow-hidden ${active ? "" : "pointer-events-none invisible"}`}
            aria-hidden={!active || undefined}
            data-folder-tab-pane={tab.id}
            data-folder-tab-pane-active={active || undefined}
          >
            <BrowserPane
              {...context}
              sourcePath={tab.sourcePath}
              browserPath={tab.currentPath}
              folderView={{ ...folderView, viewMode: tab.viewMode, previewCount: tab.previewCount }}
              onFolderView={(patch) => updateTabFolderView(tab.id, patch)}
              active={browserActive}
              navigationActive={active}
              tabBar={tabBar}
              folderTabCount={tabs.length}
              maxFolderTabs={MAX_FOLDER_TABS}
              onCreateTab={createTab}
              currentFolderTabPinned={tab.pinned}
              canReopenFolderTab={recentlyClosed.length > 0}
              onDuplicateCurrentTab={() => { void duplicateTab(tab.id) }}
              onToggleCurrentTabPinned={() => togglePinned(tab.id)}
              onReopenFolderTab={() => {
                const latest = recentlyClosedRef.current.at(-1)
                if (latest) void reopenTab(latest.id)
              }}
              initialClone={tab.initialClone}
              initialSearchSnapshot={tab.searchSnapshot}
              onCurrentPathChange={(path) => updateTabPath(tab.id, path)}
              onOpenInNewTab={openPathInNewTab}
              onOpenSearchInNewTab={openSearchInNewTab}
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

function initialFolderTabs(path: string, folderView: ReaderFolderViewConfig, sourcePath = path) {
  const pinned = (folderView.tabs?.pinned ?? []).slice(0, MAX_PINNED_FOLDER_TABS)
  const tabs = pinned.map((tab, index) => ({
    ...createFolderTab(`folder-tab-${index + 1}`, tab.path, folderView),
    title: tab.title,
    pinned: true,
  }))
  const activeTabId = `folder-tab-${tabs.length + 1}`
  tabs.push({ ...createFolderTab(activeTabId, path, folderView), sourcePath })
  return { tabs, activeTabId, sequence: tabs.length }
}

function createFolderTab(id: string, path: string, folderView: ReaderFolderViewConfig): FolderTabDescriptor {
  const startupPath = resolveFolderStartupPath(path, folderView.homePath)
  return {
    id,
    kind: "directory",
    sourcePath: startupPath,
    currentPath: startupPath,
    title: folderTabTitle(startupPath),
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

function resolveFolderStartupPath(sourcePath: string | undefined, homePath: string | undefined): string {
  const source = sourcePath?.trim()
  if (source) return source
  const home = homePath?.trim()
  if (home) return home
  return ""
}
