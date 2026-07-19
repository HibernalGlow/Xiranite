import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "../../../src/styles/tailwind.css"
import "../../../src/index.css"
import "../../../src/styles/themes/index.css"
import type { ReaderBoardLayoutPatch, ReaderShellConfigDto } from "../../../src/nodes/neoview/adapters/reader-http-client"
import { BoardSwimlaneEditor } from "../../../src/nodes/neoview/features/settings/cards/BoardSwimlaneEditor"

const shell: ReaderShellConfigDto = {
  showDelayMs: 0,
  hideDelayMs: 0,
  opacity: { top: 85, bottom: 85, sidebar: 85 },
  blur: { top: 12, bottom: 12, sidebar: 12 },
  edges: {} as ReaderShellConfigDto["edges"],
  sidebars: {} as ReaderShellConfigDto["sidebars"],
  panelLayout: {
    pageList: { visible: true, order: 0, position: "left" },
    info: { visible: true, order: 0, position: "right" },
    settings: { visible: true, order: 1, position: "right" },
  },
  cardLayout: {
    "page-navigation": { panelId: "pageList", visible: true, expanded: true, order: 0 },
    "book-information": { panelId: "info", visible: true, expanded: true, order: 0 },
    "image-information": { panelId: "info", visible: true, expanded: true, order: 1 },
  },
}

async function save(patch: ReaderBoardLayoutPatch): Promise<void> {
  document.documentElement.dataset.boardPatch = JSON.stringify(patch)
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main className="min-h-screen bg-background p-6 text-foreground">
      <BoardSwimlaneEditor shell={shell} onSave={save} />
    </main>
  </StrictMode>,
)
