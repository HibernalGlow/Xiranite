import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"

import "../../../src/styles/tailwind.css"
import "../../../src/index.css"
import "../../../src/styles/themes/index.css"
import { createReaderPageTransitionStore } from "../../../src/nodes/neoview/features/page-transition/ReaderPageTransitionStore"
import { PageTransitionCard } from "../../../src/nodes/neoview/features/panels/cards/PageTransitionCard"
import { ReaderFrame } from "../../../src/nodes/neoview/features/reader/ReaderFrame"

const sources = ["#c7353c", "#326a55"].map((color, index) => `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
    <rect width="1200" height="800" fill="#111318"/>
    <rect x="80" y="70" width="1040" height="660" rx="8" fill="${color}" stroke="#f1eee8" stroke-width="10"/>
    <text x="600" y="410" text-anchor="middle" font-family="sans-serif" font-size="72" fill="#fff">Page ${index + 1}</text>
  </svg>
`)}`)

const writes: unknown[] = []
const store = createReaderPageTransitionStore({
  async persist(settings, reset) {
    writes.push({ settings, reset })
    document.documentElement.dataset.pageTransitionWrites = String(writes.length)
    return settings
  },
})

function Harness() {
  const [pageIndex, setPageIndex] = useState(0)
  const page = {
    id: `page-${pageIndex}`,
    index: pageIndex,
    name: `page-${pageIndex + 1}.svg`,
    mediaKind: "image" as const,
    contentVersion: "v1",
    assetUrl: sources[pageIndex]!,
    dimensions: { width: 1200, height: 800 },
  }
  return (
    <main className="grid h-screen overflow-hidden bg-neutral-950 text-foreground" style={{ gridTemplateColumns: "minmax(0, 1fr) 320px" }}>
      <section className="relative min-h-0 overflow-hidden bg-neutral-950" aria-label="阅读画面">
        <ReaderFrame
          pages={[page]}
          presentation={{ fitMode: "fit", manualScale: 1, rotation: 0 }}
          pageTransition={store}
        />
        <nav className="absolute bottom-5 left-1/2 flex -translate-x-1/2 gap-2" aria-label="页面导航">
          <button className="rounded border border-white/25 bg-black/70 px-3 py-1.5 text-xs text-white" onClick={() => setPageIndex(0)}>上一页</button>
          <button className="rounded border border-white/25 bg-black/70 px-3 py-1.5 text-xs text-white" onClick={() => setPageIndex(1)}>下一页</button>
        </nav>
      </section>
      <aside className="overflow-y-auto border-l border-border bg-background px-3 py-4" aria-label="控制面板">
        <header className="mb-3 border-b border-border pb-3">
          <p className="text-xs text-muted-foreground">控制</p>
          <h1 className="text-sm font-semibold">翻页动画</h1>
        </header>
        <PageTransitionCard store={store} />
      </aside>
    </main>
  )
}

createRoot(document.getElementById("root")!).render(<StrictMode><Harness /></StrictMode>)
