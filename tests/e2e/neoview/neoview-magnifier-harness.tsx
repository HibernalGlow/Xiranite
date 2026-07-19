import { useState } from "react"
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
  id: "magnifier-page",
  index: 0,
  name: "NeoView rotated magnifier fixture",
  mediaKind: "image",
  contentVersion: "v1",
  assetUrl: new URLSearchParams(window.location.search).get("asset") ?? "/tests/e2e/neoview/neoview-image-trim-fixture.svg",
  dimensions: { width: 1_200, height: 800 },
}
const presentation = { ...DEFAULT_READER_PRESENTATION, rotation: 90 as const }
const slideshow = new ReaderSlideshow({ readPosition: () => ({ pageCount: 1, currentPageIndex: 0, atEnd: true }), nextPage: async () => true, goToPage: async () => true })
const videoController = new ReaderVideoController()

function Harness() {
  const [enabled, setEnabled] = useState(false)
  const [config, setConfig] = useState({ zoom: 2, size: 200 })
  return <main className="grid h-screen min-h-0 grid-rows-[auto_1fr] overflow-hidden bg-black text-white">
    <section className="z-10 border-b border-white/15 bg-zinc-950">
      <ReaderViewToolbar
        layout={DEFAULT_READER_LAYOUT}
        direction="left-to-right"
        presentation={presentation}
        onChange={() => undefined}
        onLayoutChange={() => undefined}
        onDirectionChange={() => undefined}
        magnifierEnabled={enabled}
        magnifierZoom={config.zoom}
        magnifierSize={config.size}
        onMagnifierEnabledChange={setEnabled}
        onMagnifierConfigChange={(patch) => setConfig((current) => ({ ...current, ...patch }))}
        slideshow={slideshow}
        onSlideshowChange={() => undefined}
      />
    </section>
    <ReaderFrame
      pages={[page]}
      presentation={presentation}
      pageMode="single"
      totalPages={1}
      anchorPageIndex={0}
      magnifierEnabled={enabled}
      magnifierZoom={config.zoom}
      magnifierSize={config.size}
      sessionId="magnifier-session"
      client={{} as ReaderHttpClient}
      videoController={videoController}
      onSubtitleConfigChange={async () => undefined}
      onVideoListEnded={() => undefined}
    />
  </main>
}

createRoot(document.getElementById("root")!).render(<Harness />)
