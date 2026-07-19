import { useState } from "react"
import { createRoot } from "react-dom/client"
import { DEFAULT_READER_PRESENTATION, type FramePage } from "@xiranite/node-neoview/ui-core"

import "../../../src/styles/tailwind.css"
import "../../../src/index.css"
import "../../../src/styles/themes/index.css"
import type { ReaderHttpClient, ReaderPageDto } from "../../../src/nodes/neoview/adapters/reader-http-client"
import { ReaderFrame } from "../../../src/nodes/neoview/features/reader/ReaderFrame"
import { ReaderVideoController } from "../../../src/nodes/neoview/features/video/ReaderVideoController"

const page: ReaderPageDto = {
  id: "split-wide-page",
  index: 0,
  name: "NeoView split wide fixture",
  mediaKind: "image",
  contentVersion: "v1",
  assetUrl: "/tests/e2e/neoview/neoview-image-trim-fixture.svg",
  dimensions: { width: 1200, height: 800 },
}
const videoController = new ReaderVideoController()

function Harness() {
  const [part, setPart] = useState<0 | 1>(0)
  const framePage: FramePage = part === 0
    ? { pageId: page.id, pageIndex: 0, side: "single", part, cropInsets: { top: 0, right: 50, bottom: 0, left: 0 } }
    : { pageId: page.id, pageIndex: 0, side: "single", part, cropInsets: { top: 0, right: 0, bottom: 0, left: 50 } }
  return (
    <main className="grid h-screen min-h-0 grid-rows-[auto_1fr] bg-black text-white" data-split-wide-part={part}>
      <nav className="z-10 flex items-center justify-center gap-2 border-b border-white/15 bg-zinc-950 p-2" aria-label="分割横向页控制">
        <button type="button" aria-pressed={part === 0} onClick={() => setPart(0)}>左半页</button>
        <button type="button" aria-pressed={part === 1} onClick={() => setPart(1)}>右半页</button>
      </nav>
      <ReaderFrame
        pages={[page]}
        framePages={[framePage]}
        presentation={DEFAULT_READER_PRESENTATION}
        pageMode="single"
        totalPages={1}
        anchorPageIndex={0}
        sessionId="split-wide-session"
        client={{} as ReaderHttpClient}
        videoController={videoController}
        onSubtitleConfigChange={async () => undefined}
        onVideoListEnded={() => undefined}
      />
    </main>
  )
}

createRoot(document.getElementById("root")!).render(<Harness />)
