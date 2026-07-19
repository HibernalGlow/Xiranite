import { useState } from "react"
import { createRoot } from "react-dom/client"
import {
  DEFAULT_READER_LAYOUT,
  DEFAULT_READER_PRESENTATION,
  ReaderSlideshow,
  type ReaderLayout,
  type ReaderPresentation,
  type ReadingDirection,
} from "@xiranite/node-neoview/ui-core"

import "../../../src/styles/tailwind.css"
import "../../../src/index.css"
import "../../../src/styles/themes/index.css"
import { ReaderViewToolbar } from "../../../src/nodes/neoview/features/reader/ReaderViewToolbar"

const slideshow = new ReaderSlideshow({
  readPosition: () => ({ pageCount: 128, currentPageIndex: 23, atEnd: false }),
  nextPage: async () => true,
  goToPage: async () => true,
})

function Harness() {
  const [layout, setLayout] = useState<ReaderLayout>({ ...DEFAULT_READER_LAYOUT, pageMode: "double" })
  const [direction, setDirection] = useState<ReadingDirection>("left-to-right")
  const [presentation, setPresentation] = useState<ReaderPresentation>(DEFAULT_READER_PRESENTATION)
  const [hoverScroll, setHoverScroll] = useState({ enabled: true, speed: 2 })
  return <main className="h-screen overflow-hidden bg-neutral-950 text-foreground">
    <div className="h-14 bg-[linear-gradient(90deg,#171717,#0a0a0a)]" />
    <section className="border-y border-border/60 bg-background/95 shadow-xl" data-toolbar-harness="true">
      <div className="grid min-h-11 grid-cols-[1fr_auto_1fr] items-center border-b border-border/50 px-3 text-xs">
        <span className="truncate text-muted-foreground">D:/漫画/旧版顶栏/NeoView 顶栏布局基准.cbz</span>
        <strong>NeoView 顶部工具栏</strong>
        <span className="justify-self-end tabular-nums text-muted-foreground">24 / 128</span>
      </div>
      <ReaderViewToolbar
        layout={layout}
        direction={direction}
        presentation={presentation}
        onChange={setPresentation}
        onLayoutChange={(patch) => setLayout((current) => ({ ...current, ...patch }))}
        onDirectionChange={setDirection}
        hoverScrollEnabled={hoverScroll.enabled}
        hoverScrollSpeed={hoverScroll.speed}
        onHoverScrollChange={(patch) => setHoverScroll((current) => ({ ...current, ...patch }))}
        slideshow={slideshow}
        onSlideshowChange={() => undefined}
      />
    </section>
    <section className="grid h-[calc(100vh-10rem)] place-items-center text-sm text-white/25">1920 × 1080 characterization</section>
  </main>
}

createRoot(document.getElementById("root")!).render(<Harness />)
