import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import { DEFAULT_READER_PRESENTATION, type FrameSnapshot } from "@xiranite/node-neoview/ui-core"

import "../../../src/styles/tailwind.css"
import "../../../src/index.css"
import type { ReaderFrameWindowDto, ReaderHttpClient, ReaderPageDto } from "../../../src/nodes/neoview/adapters/reader-http-client"
import { ReaderFrame } from "../../../src/nodes/neoview/features/reader/ReaderFrame"
import { ReaderVideoController } from "../../../src/nodes/neoview/features/video/ReaderVideoController"

const pages = Array.from({ length: 12 }, (_, index): ReaderPageDto => ({
  id: `page-${index}`,
  index,
  name: `page-${index + 1}.svg`,
  mediaKind: "image",
  contentVersion: "v1",
  assetUrl: `/__neoview-panorama/page-${index}.svg`,
  dimensions: { width: 1200, height: 800 },
}))

const client = {
  async listPages(_sessionId: string, cursor: number, limit: number) {
    return { pages: pages.slice(cursor, cursor + limit), total: pages.length }
  },
  async frameWindow(_sessionId: string, centerPageIndex: number, radius: number): Promise<ReaderFrameWindowDto> {
    const start = Math.max(0, centerPageIndex - radius)
    const end = Math.min(pages.length - 1, centerPageIndex + radius)
    const visiblePages = pages.slice(start, end + 1)
    const frames: FrameSnapshot[] = visiblePages.map((page) => ({
      generation: 1,
      anchorPageIndex: page.index,
      direction: "left-to-right",
      layout: { pageMode: "single", panorama: true, singleFirstPage: true, singleLastPage: true, treatWidePageAsSingle: true },
      pages: [{ pageId: page.id, pageIndex: page.index, side: "single" }],
      pageCount: pages.length,
      atStart: page.index === 0,
      atEnd: page.index === pages.length - 1,
    }))
    return { frames, centerIndex: centerPageIndex, radius, visiblePages }
  },
} as ReaderHttpClient

const videoController = new ReaderVideoController()

function Harness() {
  const [panorama, setPanorama] = useState(false)
  return (
    <main className="flex h-screen min-h-0 flex-col overflow-hidden bg-neutral-950">
      <button className="m-2 w-fit border border-white/30 px-3 py-1 text-white" type="button" aria-pressed={panorama} onClick={() => setPanorama((current) => !current)}>Toggle panorama</button>
      <section className="relative min-h-0 flex-1 overflow-hidden" aria-label="Reader viewport">
        <ReaderFrame
          pages={[pages[0]!]}
          presentation={DEFAULT_READER_PRESENTATION}
          panorama={panorama}
          direction="left-to-right"
          pageMode="single"
          totalPages={pages.length}
          anchorPageIndex={0}
          sessionId="panorama-harness"
          client={client}
          videoController={videoController}
          onSubtitleConfigChange={async () => undefined}
          onVideoListEnded={() => undefined}
        />
      </section>
    </main>
  )
}

createRoot(document.getElementById("root")!).render(<StrictMode><Harness /></StrictMode>)
