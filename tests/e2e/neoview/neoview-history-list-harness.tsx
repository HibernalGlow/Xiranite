import { createRoot } from "react-dom/client"

import "../../../src/styles/tailwind.css"
import "../../../src/styles/themes/index.css"
import type { ReaderHttpClient, ReaderLibraryQueryDto, ReaderRecentDto } from "../../../src/nodes/neoview/adapters/reader-http-client"
import HistoryListCard from "../../../src/nodes/neoview/features/panels/cards/HistoryListCard"

const records: readonly ReaderRecentDto[] = [
  { bookId: "history-1", source: { kind: "archive", path: "D:/library/alpha.cbz" }, displayName: "Alpha", pageIndex: 12, pageCount: 80, updatedAt: Date.now() - 60_000 },
  { bookId: "history-2", source: { kind: "archive", path: "D:/library/beta.cbz" }, displayName: "Beta", pageIndex: 4, pageCount: 32, updatedAt: Date.now() - 3_600_000 },
  { bookId: "history-3", source: { kind: "directory", path: "D:/library/series" }, displayName: "Series", pageIndex: 1, pageCount: 16, updatedAt: Date.now() - 86_400_000 },
]

const client = {
  listRecent: async (offset: number, limit: number, _signal?: AbortSignal, query?: ReaderLibraryQueryDto) => libraryRecords(records, offset, limit, query),
} as ReaderHttpClient

createRoot(document.getElementById("root")!).render(
  <main className="grid h-screen overflow-hidden bg-neutral-950 text-foreground" style={{ gridTemplateColumns: "minmax(0, 1fr) 320px" }}>
    <section className="grid min-h-0 place-items-center bg-neutral-950 text-sm text-white/45" aria-label="阅读画面">
      打开历史记录中的项目后，阅读画面会在这里显示
    </section>
    <aside className="overflow-y-auto border-l border-border bg-background px-3 py-4" aria-label="历史面板">
      <header className="mb-3 border-b border-border pb-3">
        <p className="text-xs text-muted-foreground">历史</p>
        <h1 className="text-sm font-semibold">历史记录</h1>
      </header>
      <HistoryListCard
        client={client}
        disabled={false}
        onGoTo={() => undefined}
        onOpen={() => undefined}
        historyListPreferences={{ viewMode: "compact" }}
      />
    </aside>
  </main>,
)

function libraryRecords(items: readonly ReaderRecentDto[], offset: number, limit: number, query?: ReaderLibraryQueryDto): readonly ReaderRecentDto[] {
  const needle = query?.search?.toLocaleLowerCase()
  const filtered = needle ? items.filter((item) => `${item.displayName}\n${item.source.path}`.toLocaleLowerCase().includes(needle)) : items
  const ordered = [...filtered].sort((left, right) => libraryCompare(left.displayName, left.source.path, left.updatedAt, left.source.kind, right.displayName, right.source.path, right.updatedAt, right.source.kind, query))
  return ordered.slice(offset, offset + limit)
}

function libraryCompare(leftName: string, leftPath: string, leftDate: number, leftType: string, rightName: string, rightPath: string, rightDate: number, rightType: string, query?: ReaderLibraryQueryDto): number {
  const field = query?.sort?.field ?? "date"
  const order = query?.sort?.order === "asc" ? 1 : -1
  const left = field === "name" ? leftName : field === "path" ? leftPath : field === "type" ? leftType : leftDate
  const right = field === "name" ? rightName : field === "path" ? rightPath : field === "type" ? rightType : rightDate
  return (typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right))) * order
}
