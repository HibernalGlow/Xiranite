import { useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { DEFAULT_READER_LAYOUT, DEFAULT_READER_PRESENTATION, ReaderSlideshow } from "@xiranite/node-neoview/ui-core"

import "../../../src/styles/tailwind.css"
import "../../../src/index.css"
import "../../../src/styles/themes/index.css"
import type { ReaderHttpClient, ReaderPageDto } from "../../../src/nodes/neoview/adapters/reader-http-client"
import { ReaderFrame } from "../../../src/nodes/neoview/features/reader/ReaderFrame"
import { ReaderViewToolbar } from "../../../src/nodes/neoview/features/reader/ReaderViewToolbar"
import { ReaderVideoController } from "../../../src/nodes/neoview/features/video/ReaderVideoController"

const page: ReaderPageDto = {
  id: "hover-scroll-page",
  index: 0,
  name: "NeoView long page hover scroll fixture",
  mediaKind: "image",
  contentVersion: "v1",
  assetUrl: "/tests/e2e/neoview/neoview-image-trim-fixture.svg",
  dimensions: { width: 600, height: 1_800 },
}
const slideshow = new ReaderSlideshow({
  readPosition: () => ({ pageCount: 1, currentPageIndex: 0, atEnd: true }),
  nextPage: async () => true,
  goToPage: async () => true,
})
const videoController = new ReaderVideoController()

function Harness() {
  const renders = useRef(0)
  renders.current += 1
  const [hoverScroll, setHoverScroll] = useState({ enabled: true, speed: 2 })
  return <main className="grid h-screen min-h-0 grid-rows-[auto_1fr] overflow-hidden bg-black text-white" data-harness-renders={renders.current}>
    <section className="z-10 border-b border-white/15 bg-zinc-950">
      <ReaderViewToolbar
        layout={DEFAULT_READER_LAYOUT}
        direction="left-to-right"
        presentation={{ ...DEFAULT_READER_PRESENTATION, fitMode: "original" }}
        onChange={() => undefined}
        onLayoutChange={() => undefined}
        onDirectionChange={() => undefined}
        hoverScrollEnabled={hoverScroll.enabled}
        hoverScrollSpeed={hoverScroll.speed}
        onHoverScrollChange={(patch) => setHoverScroll((current) => ({ ...current, ...patch }))}
        slideshow={slideshow}
        onSlideshowChange={() => undefined}
      />
    </section>
    <ReaderFrame
      pages={[page]}
      presentation={{ ...DEFAULT_READER_PRESENTATION, fitMode: "original" }}
      pageMode="single"
      totalPages={1}
      anchorPageIndex={0}
      hoverScrollEnabled={hoverScroll.enabled}
      hoverScrollSpeed={hoverScroll.speed}
      sessionId="hover-scroll-session"
      client={{} as ReaderHttpClient}
      videoController={videoController}
      onSubtitleConfigChange={async () => undefined}
      onVideoListEnded={() => undefined}
    />
  </main>
}

createRoot(document.getElementById("root")!).render(<Harness />)
