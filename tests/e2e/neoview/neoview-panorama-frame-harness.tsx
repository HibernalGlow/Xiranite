import { StrictMode, useMemo, useState } from "react"
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

const videoController = new ReaderVideoController()

function Harness() {
  const [panorama, setPanorama] = useState(false)
  const [pageMode, setPageMode] = useState<"single" | "double">("single")
  const client = useMemo(() => createClient(pageMode), [pageMode])
  return (
    <main className="flex h-screen min-h-0 flex-col overflow-hidden bg-neutral-950">
      <nav className="flex gap-2 p-2">
        <button className="border border-white/30 px-3 py-1 text-white" type="button" aria-pressed={panorama} onClick={() => setPanorama((current) => !current)}>Toggle panorama</button>
        <button className="border border-white/30 px-3 py-1 text-white" type="button" aria-pressed={pageMode === "double"} onClick={() => setPageMode((current) => current === "single" ? "double" : "single")}>Toggle page mode</button>
      </nav>
      <section className="relative min-h-0 flex-1 overflow-hidden" aria-label="Reader viewport">
        <ReaderFrame
          pages={pageMode === "double" ? [pages[0]!, pages[1]!] : [pages[0]!]}
          presentation={DEFAULT_READER_PRESENTATION}
          panorama={panorama}
          direction="left-to-right"
          pageMode={pageMode}
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

function createClient(pageMode: "single" | "double"): ReaderHttpClient {
  return {
    async listPages(_sessionId: string, cursor: number, limit: number) {
      return { pages: pages.slice(cursor, cursor + limit), total: pages.length }
    },
    async frameWindow(_sessionId: string, centerPageIndex: number, radius: number): Promise<ReaderFrameWindowDto> {
      const start = Math.max(0, centerPageIndex - radius)
      const end = Math.min(pages.length - 1, centerPageIndex + radius)
      const visiblePages = pages.slice(start, end + 1)
      const anchors = pageMode === "double"
        ? Array.from({ length: Math.ceil(visiblePages.length / 2) }, (_, index) => start + index * 2).filter((index) => index <= end)
        : visiblePages.map((page) => page.index)
      const frames: FrameSnapshot[] = anchors.map((anchor) => ({
        generation: pageMode === "double" ? 2 : 1,
        anchorPageIndex: anchor,
        direction: "left-to-right",
        layout: { pageMode, panorama: true, singleFirstPage: true, singleLastPage: true, treatWidePageAsSingle: true },
        pages: pageMode === "double" && pages[anchor + 1]
          ? [{ pageId: pages[anchor]!.id, pageIndex: anchor, side: "left" }, { pageId: pages[anchor + 1]!.id, pageIndex: anchor + 1, side: "right" }]
          : [{ pageId: pages[anchor]!.id, pageIndex: anchor, side: "single" }],
        pageCount: pages.length,
        atStart: anchor === 0,
        atEnd: anchor >= pages.length - (pageMode === "double" ? 2 : 1),
      }))
      return { frames, centerIndex: centerPageIndex, radius, visiblePages }
    },
  } as ReaderHttpClient
}

createRoot(document.getElementById("root")!).render(<StrictMode><Harness /></StrictMode>)
