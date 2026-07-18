import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"

import "../../../src/styles/tailwind.css"
import "../../../src/index.css"
import "../../../src/styles/themes/index.css"
import type { ReaderSessionDto } from "../../../src/nodes/neoview/adapters/reader-http-client"
import { InfoOverlayCard } from "../../../src/nodes/neoview/features/panels/cards/InfoOverlayCard"
import { PageImage } from "../../../src/nodes/neoview/features/reader/PageImage"
import { ReaderInfoOverlayRuntime } from "../../../src/nodes/neoview/features/info-overlay/ReaderInfoOverlayRuntime"
import { createReaderInfoOverlayStore } from "../../../src/nodes/neoview/features/info-overlay/ReaderInfoOverlayStore"

const source = `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
    <rect width="1200" height="800" fill="#101318"/>
    <rect x="80" y="70" width="1040" height="660" rx="8" fill="#315b72" stroke="#f1eee8" stroke-width="10"/>
    <text x="600" y="420" text-anchor="middle" font-family="sans-serif" font-size="72" fill="#fff">NeoView Demo</text>
  </svg>
`)}`

const store = createReaderInfoOverlayStore({
  async persist(settings) {
    document.documentElement.dataset.infoOverlayWrites = String(Number(document.documentElement.dataset.infoOverlayWrites ?? "0") + 1)
    return settings
  },
})
store.hydrate({ enabled: false, opacity: 0.85, showBorder: false })

function Harness() {
  const [opened, setOpened] = useState(false)
  const session = opened ? sessionAt() : undefined
  return (
    <main className="grid h-screen overflow-hidden bg-neutral-950 text-foreground" style={{ gridTemplateColumns: "minmax(0, 1fr) 520px" }}>
      <section className="relative grid min-h-0 place-items-center overflow-hidden bg-neutral-950 p-8" aria-label="阅读画面">
        <PageImage
          page={{ id: "info-overlay-page", index: 0, name: "001.jpg", mediaKind: "image", contentVersion: "v1", assetUrl: source, dimensions: { width: 1200, height: 800 } }}
          scale={0.72}
        />
        <nav className="absolute bottom-5 left-1/2 flex -translate-x-1/2 gap-2" aria-label="测试会话">
          <button className="rounded border border-white/25 bg-black/70 px-3 py-1.5 text-xs text-white" onClick={() => setOpened(true)}>打开书本</button>
        </nav>
      </section>
      <aside className="overflow-y-auto border-l border-border bg-background px-3 py-4" aria-label="控制面板">
        <header className="mb-3 border-b border-border pb-3">
          <p className="text-xs text-muted-foreground">信息</p>
          <h1 className="text-sm font-semibold">信息悬浮窗</h1>
        </header>
        <InfoOverlayCard port={store} />
      </aside>
      <ReaderInfoOverlayRuntime port={store} session={session} sourcePath="D:/Books/Demo.cbz" />
    </main>
  )
}

function sessionAt(): ReaderSessionDto {
  return {
    sessionId: "info-overlay-session",
    book: { id: "book-1", displayName: "Demo", pageCount: 1 },
    frame: {
      generation: 1,
      anchorPageIndex: 0,
      direction: "left-to-right",
      layout: { pageMode: "single", panorama: false, singleFirstPage: true, singleLastPage: true, treatWidePageAsSingle: true },
      pages: [{ pageId: "info-overlay-page", pageIndex: 0, side: "single" }],
      pageCount: 1,
      atStart: true,
      atEnd: true,
    },
    visiblePages: [{
      id: "info-overlay-page",
      index: 0,
      name: "001.jpg",
      mediaKind: "image",
      byteLength: 2_048,
      dimensions: { width: 1_200, height: 1_800 },
      contentVersion: "v1",
      assetUrl: source,
    }],
  }
}

createRoot(document.getElementById("root")!).render(<StrictMode><Harness /></StrictMode>)
