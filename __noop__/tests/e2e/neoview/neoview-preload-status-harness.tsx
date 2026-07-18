import { StrictMode, useMemo, useState } from "react"
import { createRoot } from "react-dom/client"

import "../../../src/styles/tailwind.css"
import "../../../src/index.css"
import "../../../src/styles/themes/index.css"
import type { ReaderHttpClient, ReaderSessionDto, ReaderStorageDiagnosticsDto } from "../../../src/nodes/neoview/adapters/reader-http-client"
import type { ReaderPanelContext } from "../../../src/nodes/neoview/features/panels/registry"
import PreloadStatusCard from "../../../src/nodes/neoview/features/panels/cards/PreloadStatusCard"

const diagnostics: ReaderStorageDiagnosticsDto = {
  schemaVersion: 1,
  reader: {
    activeSessions: 1,
    preload: {
      sessions: 1,
      candidates: { near: 3, ahead: 5, background: 1 },
      active: 1,
      plannedCandidates: 9,
      started: 4,
      ready: 2,
      failed: 1,
      cancelled: 0,
      evicted: 0,
    },
    sessionPreload: {
      generation: 3,
      pages: [
        { pageIndex: 2, outcome: "ready" },
        { pageIndex: 3, outcome: "started" },
        { pageIndex: 4, outcome: "failed" },
      ],
    },
  },
  assets: {
    presentation: { entries: 12, bytes: 64 * 1_048_576, maxBytes: 256 * 1_048_576, activeLeases: 1 },
    thumbnails: null,
  },
  presentationDiskCache: { enabled: false },
  solidArchiveCache: { retainedBytes: 0 },
}

const session: ReaderSessionDto = {
  sessionId: "preload-harness-session",
  book: { id: "book-1", displayName: "demo.cbz", pageCount: 20 },
  frame: {
    generation: 3,
    anchorPageIndex: 3,
    direction: "left-to-right",
    layout: { pageMode: "single", panorama: false, singleFirstPage: true, singleLastPage: true, treatWidePageAsSingle: true },
    pages: [{ pageId: "page-4", pageIndex: 3, side: "single" }],
    pageCount: 20,
    atStart: false,
    atEnd: false,
  },
  visiblePages: [],
}

function Harness() {
  const [opened, setOpened] = useState(false)
  const client = useMemo(() => ({
    diagnostics: async () => diagnostics,
  } as unknown as ReaderHttpClient), [])
  const context: ReaderPanelContext = {
    session: opened ? session : undefined,
    client,
    disabled: false,
    onGoTo: () => undefined,
  }

  return (
    <main className="grid h-screen overflow-hidden bg-neutral-950 text-foreground" style={{ gridTemplateColumns: "minmax(0, 1fr) 420px" }}>
      <section className="relative grid min-h-0 place-items-center overflow-hidden bg-neutral-950" aria-label="阅读页面">
        <div className="max-w-md space-y-3 text-center text-sm text-white/75">
          <p>预加载状态 Card 的会话前后对照</p>
          <button type="button" className="rounded border border-white/25 bg-black/70 px-3 py-1.5 text-xs text-white" onClick={() => setOpened((value) => !value)}>
            {opened ? "关闭书本" : "打开书本"}
          </button>
        </div>
        <div className="pointer-events-none absolute left-5 top-5 rounded bg-black/60 px-2 py-1 text-xs text-white" data-preload-book-state={opened ? "open" : "closed"}>
          {opened ? "书本已打开" : "未打开书本"}
        </div>
      </section>
      <aside className="overflow-y-auto border-l border-border bg-background px-3 py-4" aria-label="控制面板">
        <header className="mb-3 border-b border-border pb-3">
          <p className="text-xs text-muted-foreground">性能</p>
          <h1 className="text-sm font-semibold">预加载状态</h1>
        </header>
        <PreloadStatusCard {...context} />
      </aside>
    </main>
  )
}

createRoot(document.getElementById("root")!).render(<StrictMode><Harness /></StrictMode>)
