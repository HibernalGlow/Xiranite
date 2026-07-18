import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"

import "../../../src/styles/tailwind.css"
import "../../../src/index.css"
import "../../../src/styles/themes/index.css"
import type { ReaderSessionDto } from "../../../src/nodes/neoview/adapters/reader-http-client"
import { SwitchToastCard } from "../../../src/nodes/neoview/features/panels/cards/SwitchToastCard"
import { PageImage } from "../../../src/nodes/neoview/features/reader/PageImage"
import { ReaderSwitchToastRuntime } from "../../../src/nodes/neoview/features/switch-toast/ReaderSwitchToastRuntime"
import { createReaderSwitchToastStore } from "../../../src/nodes/neoview/features/switch-toast/ReaderSwitchToastStore"

const source = `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
    <rect width="1200" height="800" fill="#111318"/>
    <rect x="70" y="60" width="1060" height="680" rx="8" fill="#355c7d" stroke="#f1eee8" stroke-width="10"/>
    <text x="600" y="420" text-anchor="middle" font-family="sans-serif" font-size="72" fill="#fff">NeoView Demo</text>
  </svg>
`)}`

const writes: unknown[] = []
const store = createReaderSwitchToastStore({
  async persist(settings, reset) {
    writes.push({ settings, reset })
    document.documentElement.dataset.switchToastWrites = String(writes.length)
    return settings
  },
})

function Harness() {
  const [pageIndex, setPageIndex] = useState(0)
  const [opened, setOpened] = useState(false)
  const session = opened ? sessionAt(pageIndex) : undefined
  return (
    <main className="grid h-screen overflow-hidden bg-neutral-950 text-foreground" style={{ gridTemplateColumns: "minmax(0, 1fr) 520px" }}>
      <section className="relative grid min-h-0 place-items-center overflow-hidden bg-neutral-950 p-8" aria-label="阅读画面">
        <PageImage
          page={{ id: "switch-toast-page", index: pageIndex, name: `00${pageIndex + 1}.jpg`, mediaKind: "image", contentVersion: "v1", assetUrl: source, dimensions: { width: 1200, height: 800 } }}
          scale={0.72}
        />
        <nav className="absolute bottom-5 left-1/2 flex -translate-x-1/2 gap-2" aria-label="测试会话">
          <button className="rounded border border-white/25 bg-black/70 px-3 py-1.5 text-xs text-white" onClick={() => setOpened(true)}>打开书本</button>
          <button className="rounded border border-white/25 bg-black/70 px-3 py-1.5 text-xs text-white" onClick={() => setPageIndex(1)}>下一页</button>
        </nav>
      </section>
      <aside className="overflow-y-auto border-l border-border bg-background px-3 py-4" aria-label="控制面板">
        <header className="mb-3 border-b border-border pb-3">
          <p className="text-xs text-muted-foreground">控制</p>
          <h1 className="text-sm font-semibold">切换提示</h1>
        </header>
        <SwitchToastCard
          port={store}
          onShowTest={(settings) => store.show({
            title: "切换提示测试",
            description: `X ${settings.positionX}px / Y ${settings.positionY}px / 透明度 ${Math.round(settings.opacity * 100)}%`,
            durationMs: 2_600,
          })}
        />
      </aside>
      <ReaderSwitchToastRuntime port={store} session={session} sourcePath="D:/Books/Demo.cbz" />
    </main>
  )
}

function sessionAt(index: number): ReaderSessionDto {
  return {
    sessionId: "session-1",
    book: { id: "book-1", displayName: "Demo", pageCount: 2 },
    frame: {
      generation: index + 1,
      anchorPageIndex: index,
      direction: "left-to-right",
      layout: { pageMode: "single", panorama: false, singleFirstPage: true, singleLastPage: true, treatWidePageAsSingle: true },
      pages: [{ pageId: `page-${index + 1}`, pageIndex: index, side: "single" }],
      pageCount: 2,
      atStart: index === 0,
      atEnd: index === 1,
    },
    visiblePages: [{
      id: `page-${index + 1}`,
      index,
      name: `00${index + 1}.jpg`,
      mediaKind: "image",
      byteLength: 2_048,
      dimensions: { width: 1_200, height: 1_800 },
      contentVersion: "v1",
      assetUrl: source,
    }],
  }
}

createRoot(document.getElementById("root")!).render(<StrictMode><Harness /></StrictMode>)
