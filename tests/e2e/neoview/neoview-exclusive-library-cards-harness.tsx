import { createRoot } from "react-dom/client"

import "../../../src/styles/tailwind.css"
import "../../../src/index.css"
import "../../../src/styles/themes/index.css"
import type { ReaderBookmarkDto, ReaderHttpClient, ReaderRecentDto, ReaderShellConfigDto } from "../../../src/nodes/neoview/adapters/reader-http-client"
import { ReaderSidebar } from "../../../src/nodes/neoview/features/panels/ReaderSidebar"
import type { ReaderPanelContext } from "../../../src/nodes/neoview/features/panels/registry"

const recent: ReaderRecentDto = {
  bookId: "history-1",
  source: { kind: "archive", path: "E:/Library/COMIC BAVEL 2026 02.cbz" },
  displayName: "COMIC BAVEL 2026 2月号",
  pageIndex: 6,
  pageCount: 19,
  updatedAt: 1_785_000_000_000,
}

const bookmark: ReaderBookmarkDto = {
  id: "bookmark-1",
  source: { kind: "archive", path: "E:/Library/COMIC BAVEL 2026 02.cbz" },
  name: "COMIC BAVEL 2026 2月号",
  kind: "file",
  starred: true,
  createdAt: 1_785_000_000_000,
  updatedAt: 1_785_000_000_000,
  listIds: ["favorites"],
}

const client = {
  listRecent: async () => [recent],
  listBookmarkLists: async () => [
    { id: "all", name: "全部", isFavorite: false, createdAt: 0, updatedAt: 0, system: true },
    { id: "favorites", name: "收藏", isFavorite: true, createdAt: 0, updatedAt: 0, system: true },
  ],
  listBookmarks: async () => [bookmark],
} as ReaderHttpClient

const shell = {
  showDelayMs: 0,
  hideDelayMs: 0,
  opacity: { top: 85, bottom: 85, sidebar: 85 },
  blur: { top: 12, bottom: 12, sidebar: 12 },
  edges: {
    top: { enabled: false, initialVisible: false, pinned: false, triggerSize: 0 },
    right: { enabled: false, initialVisible: false, pinned: false, triggerSize: 0 },
    bottom: { enabled: false, initialVisible: false, pinned: false, triggerSize: 0 },
    left: { enabled: true, initialVisible: true, pinned: true, triggerSize: 0 },
  },
  sidebars: {
    left: { width: 548, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
    right: { width: 320, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
  },
  panelLayout: {
    folder: { visible: false, order: 0, position: "left" },
    history: { visible: true, order: 0, position: "left" },
    bookmark: { visible: true, order: 1, position: "left" },
    pageList: { visible: false, order: 2, position: "left" },
    settings: { visible: false, order: 3, position: "left" },
  },
  cardLayout: {
    "history-list": { panelId: "history", visible: true, expanded: true, order: 0 },
    "bookmark-list": { panelId: "bookmark", visible: true, expanded: true, order: 0 },
  },
} satisfies ReaderShellConfigDto

const context: ReaderPanelContext = {
  client,
  disabled: false,
  onGoTo: () => undefined,
  onOpen: () => undefined,
  historyListPreferences: { viewMode: "compact" },
  bookmarkListPreferences: { activeListId: "all", viewMode: "compact" },
}

createRoot(document.getElementById("root")!).render(
  <main className="h-screen w-screen overflow-hidden bg-background text-foreground">
    <ReaderSidebar side="left" context={context} shell={shell} />
  </main>,
)
