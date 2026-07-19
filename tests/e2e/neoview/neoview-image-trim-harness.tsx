import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"

import "../../../src/styles/tailwind.css"
import "../../../src/index.css"
import "../../../src/styles/themes/index.css"
import ImageTrimCard from "../../../src/nodes/neoview/features/panels/cards/ImageTrimCard"
import { createReaderImageTrimStore } from "../../../src/nodes/neoview/features/image-trim/ReaderImageTrimStore"
import { PageImage } from "../../../src/nodes/neoview/features/reader/PageImage"

const source = "/tests/e2e/neoview/neoview-image-trim-fixture.svg"

const writes: unknown[] = []
const store = createReaderImageTrimStore({
  async persist(settings, reset) {
    writes.push({ settings, reset })
    document.documentElement.dataset.imageTrimWrites = String(writes.length)
    return settings
  },
})
store.hydrate({
  enabled: false,
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
  linkVertical: false,
  linkHorizontal: false,
  autoTrimThreshold: 30,
  autoTrimTarget: "auto",
})

function Harness() {
  const [opened, setOpened] = useState(false)
  const doublePage = new URLSearchParams(window.location.search).has("double")
  return (
    <main className="grid h-screen overflow-hidden bg-neutral-950 text-foreground" style={{ gridTemplateColumns: "minmax(0, 1fr) 420px" }}>
      <section className="relative grid min-h-0 place-items-center overflow-hidden bg-neutral-950 p-8" aria-label="阅读页面">
        <div className="flex items-center justify-center gap-1" data-image-trim-frame={doublePage ? "double" : "single"}>
          <PageImage
            page={{ id: "image-trim-page", index: 0, name: "001.jpg", mediaKind: "image", contentVersion: "v1", assetUrl: source, dimensions: { width: 1200, height: 800 } }}
            scale={doublePage ? 0.38 : 0.78}
            imageTrim={store}
            imageTrimDetectionActive
          />
          {doublePage ? <PageImage
            page={{ id: "image-trim-page-2", index: 1, name: "002.jpg", mediaKind: "image", contentVersion: "v1", assetUrl: `${source}#page-2`, dimensions: { width: 1200, height: 800 } }}
            scale={0.38}
            imageTrim={store}
            imageTrimDetectionActive={false}
          /> : null}
        </div>
        <nav className="absolute bottom-5 left-1/2 flex -translate-x-1/2 gap-2" aria-label="测试会话">
          <button className="rounded border border-white/25 bg-black/70 px-3 py-1.5 text-xs text-white" onClick={() => setOpened((value) => !value)}>
            {opened ? "关闭书本" : "打开书本"}
          </button>
        </nav>
        <div className="pointer-events-none absolute left-5 top-5 rounded bg-black/60 px-2 py-1 text-xs text-white" data-reader-book-state={opened ? "open" : "closed"}>
          {opened ? "书本已打开" : "未打开书本"}
        </div>
      </section>
      <aside className="overflow-y-auto border-l border-border bg-background px-3 py-4" aria-label="控制面板">
        <header className="mb-3 border-b border-border pb-3">
          <p className="text-xs text-muted-foreground">图像</p>
          <h1 className="text-sm font-semibold">图像裁剪</h1>
        </header>
        <ImageTrimCard port={store} />
      </aside>
    </main>
  )
}

createRoot(document.getElementById("root")!).render(<StrictMode><Harness /></StrictMode>)
