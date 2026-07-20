import { createRoot } from "react-dom/client"

import "../../../src/styles/tailwind.css"
import "../../../src/styles/themes/index.css"
import type { ReaderBookmarkDto, ReaderBookmarkListDto, ReaderHttpClient, ReaderLibraryQueryDto } from "../../../src/nodes/neoview/adapters/reader-http-client"
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
  listBookmarks: async (offset: number, limit: number, _listId?: string, _signal?: AbortSignal, query?: ReaderLibraryQueryDto) => libraryBookmarks(offset, limit, query),
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

function libraryBookmarks(offset: number, limit: number, query?: ReaderLibraryQueryDto): readonly ReaderBookmarkDto[] {
  const needle = query?.search?.toLocaleLowerCase()
  const filtered = needle ? bookmarks.filter((item) => `${item.name}\n${item.source.path}`.toLocaleLowerCase().includes(needle)) : bookmarks
  const field = query?.sort?.field ?? "date"
  const direction = query?.sort?.order === "asc" ? 1 : -1
  return [...filtered]
    .sort((left, right) => {
      const a = field === "name" ? left.name : field === "path" ? left.source.path : field === "type" ? left.kind : left.updatedAt
      const b = field === "name" ? right.name : field === "path" ? right.source.path : field === "type" ? right.kind : right.updatedAt
      return (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b))) * direction
    })
    .slice(offset, offset + limit)
}
