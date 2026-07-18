import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "../../../src/styles/tailwind.css"
import "../../../src/index.css"
import "../../../src/styles/themes/index.css"
import { createReaderColorFilterStore } from "../../../src/nodes/neoview/features/color-filter/ReaderColorFilterStore"
import { ColorFilterCard } from "../../../src/nodes/neoview/features/panels/cards/ColorFilterCard"
import { PageImage } from "../../../src/nodes/neoview/features/reader/PageImage"

const source = `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
    <rect width="1200" height="800" fill="#f2f2f2"/>
    <rect x="80" y="70" width="1040" height="660" fill="#d7d7d7" stroke="#171717" stroke-width="12"/>
    <circle cx="390" cy="350" r="190" fill="#6f6f6f"/>
    <path d="M610 590 L780 180 L1020 590 Z" fill="#a8a8a8" stroke="#303030" stroke-width="10"/>
    <text x="600" y="690" text-anchor="middle" font-family="sans-serif" font-size="54" fill="#252525">NeoView grayscale page</text>
  </svg>
`)}`

const writes: unknown[] = []
const store = createReaderColorFilterStore({
  async persist(settings, reset) {
    writes.push({ settings, reset })
    document.documentElement.dataset.colorFilterWrites = String(writes.length)
    return settings
  },
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main
      className="bg-neutral-950 text-foreground"
      style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", height: "100vh", overflow: "hidden" }}
    >
      <section
        className="bg-neutral-950"
        style={{ display: "grid", minHeight: 0, placeItems: "center", overflow: "hidden", padding: 32 }}
        aria-label="阅读画面"
      >
        <PageImage
          page={{ id: "gray-page", index: 0, name: "gray-page.svg", mediaKind: "image", contentVersion: "v1", assetUrl: source, dimensions: { width: 1200, height: 800 } }}
          scale={0.72}
          colorFilter={store}
        />
      </section>
      <aside
        className="border-l border-border bg-background"
        style={{ overflowY: "auto", padding: "16px 12px" }}
        aria-label="控制面板"
      >
        <header className="mb-3 border-b border-border pb-3">
          <p className="text-xs text-muted-foreground">控制</p>
          <h1 className="text-sm font-semibold">颜色滤镜</h1>
        </header>
        <ColorFilterCard store={store} />
      </aside>
    </main>
  </StrictMode>,
)
