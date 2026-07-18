import { createRoot } from "react-dom/client"

import "../../../src/styles/tailwind.css"
import "../../../src/styles/themes/index.css"
import type { ReaderBookmarkDto, ReaderBookmarkListDto, ReaderHttpClient } from "../../../src/nodes/neoview/adapters/reader-http-client"
import BookmarkListCard from "../../../src/nodes/neoview/features/panels/cards/BookmarkListCard"

const lists: readonly ReaderBookmarkListDto[] = [
  { id: "all", name: "全部", isFavorite: false, createdAt: 0, updatedAt: 0, system: true },
  { id: "favorites", name: "收藏", isFavorite: true, createdAt: 0, updatedAt: 0, system: true },
]
const bookmarks: readonly ReaderBookmarkDto[] = [
  { id: "bookmark-1", source: { kind: "archive", path: "D:/library/alpha.cbz" }, name: "Alpha", kind: "file", starred: true, createdAt: Date.now() - 60_000, updatedAt: Date.now() - 60_000, listIds: ["favorites"] },
  { id: "bookmark-2", source: { kind: "archive", path: "D:/library/beta.cbz" }, name: "Beta", kind: "file", starred: false, createdAt: Date.now() - 3_600_000, updatedAt: Date.now() - 3_600_000, listIds: [] },
  { id: "bookmark-3", source: { kind: "directory", path: "D:/library/series" }, name: "Series", kind: "folder", starred: false, createdAt: Date.now() - 86_400_000, updatedAt: Date.now() - 86_400_000, listIds: [] },
]

const client = {
  listBookmarkLists: async () => lists,
  listBookmarks: async (offset: number, limit: number) => bookmarks.slice(offset, offset + limit),
} as ReaderHttpClient

createRoot(document.getElementById("root")!).render(
  <main className="grid h-screen overflow-hidden bg-neutral-950 text-foreground" style={{ gridTemplateColumns: "minmax(0, 1fr) 320px" }}>
    <section className="grid min-h-0 place-items-center bg-neutral-950 text-sm text-white/45" aria-label="阅读画面">
      打开书签中的项目后，阅读画面会在这里显示
    </section>
    <aside className="overflow-y-auto border-l border-border bg-background px-3 py-4" aria-label="书签面板">
      <header className="mb-3 border-b border-border pb-3">
        <p className="text-xs text-muted-foreground">书签</p>
        <h1 className="text-sm font-semibold">书签列表</h1>
      </header>
      <BookmarkListCard
        client={client}
        disabled={false}
        onGoTo={() => undefined}
        onOpen={() => undefined}
        bookmarkListPreferences={{ activeListId: "all" }}
      />
    </aside>
  </main>,
)
