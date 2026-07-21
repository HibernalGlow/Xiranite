import { createRoot } from "react-dom/client"
import type { ReactNode } from "react"
import type { ReaderHttpClient, ReaderSessionDto } from "../../../src/nodes/neoview/adapters/reader-http-client"
import EmmRawDataCard from "../../../src/nodes/neoview/features/panels/cards/EmmRawDataCard"
import EmmSyncCard from "../../../src/nodes/neoview/features/panels/cards/EmmSyncCard"
import FavoriteTagsCard from "../../../src/nodes/neoview/features/panels/cards/FavoriteTagsCard"
import FolderRatingsCard from "../../../src/nodes/neoview/features/panels/cards/FolderRatingsCard"
import "../../../src/styles/tailwind.css"
import "../../../src/styles/themes/index.css"

const metadata = { book: { bookId: "book-emm", displayName: "demo.cbz", sourceKind: "archive" as const, sourcePath: "D:/books/demo.cbz", pageCount: 12, currentPage: 2, emm: { translatedTitle: "演示书籍", tags: [{ namespace: "artist", tag: "Alice", translatedLabel: "爱丽丝" }, { namespace: "female", tag: "glasses" }] }, emmRaw: { schemaVersion: 1 as const, fields: [{ key: "filepath", type: "path" as const, value: "D:/books/demo.cbz" }, { key: "artist", type: "string" as const, value: "artist:Alice" }, { key: "url", type: "url" as const, value: "https://example.com/source" }] } } }
const client = {
  metadata: async () => metadata,
  openExternalUrl: async () => undefined,
  suggestDirectoryEmmTags: async () => [{ category: "artist", tag: "Alice", translatedTag: "爱丽丝", favorite: true }, { category: "female", tag: "glasses", favorite: false }],
  openDirectoryBrowser: async () => ({ sessionId: "ratings", entries: [], cursor: 0, total: 2 }),
  listDirectoryBrowser: async () => ({ sessionId: "ratings", entries: [{ path: "D:/books/a.cbz", name: "a.cbz", kind: "file", readerSupported: true, rating: 4 }, { path: "D:/books/b.cbz", name: "b.cbz", kind: "file", readerSupported: true, rating: 5 }], cursor: 0, total: 2 }),
  closeDirectoryBrowser: async () => undefined,
} as unknown as ReaderHttpClient
const session: ReaderSessionDto = { sessionId: "reader-emm-cards", book: { id: "book-emm", displayName: "demo.cbz", pageCount: 12 }, frame: { generation: 1, anchorPageIndex: 1, direction: "left-to-right", layout: { pageMode: "single", panorama: false, singleFirstPage: true, singleLastPage: true, treatWidePageAsSingle: true }, pages: [], pageCount: 12, atStart: false, atEnd: false }, visiblePages: [] }
const context = { client, session, disabled: false, panelActive: true, onGoTo: () => undefined }

function Harness() {
  return <main className="min-h-screen bg-background p-3 text-foreground"><div className="mx-auto grid max-w-3xl gap-3 sm:grid-cols-2" data-emm-card-board="true">
    <Card title="EMM 同步"><EmmSyncCard {...context} /></Card>
    <Card title="EMM 数据库记录"><EmmRawDataCard {...context} /></Card>
    <Card title="收藏标签快选"><FavoriteTagsCard {...context} /></Card>
    <Card title="文件夹平均评分"><FolderRatingsCard {...context} /></Card>
  </div></main>
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return <section className="min-w-0 rounded border bg-card p-3" data-reader-card={title}><h1 className="mb-3 text-sm font-semibold">{title}</h1>{children}</section>
}

createRoot(document.getElementById("root")!).render(<Harness />)
