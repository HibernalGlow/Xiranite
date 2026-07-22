import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"

import "../../../src/styles/tailwind.css"
import "../../../src/styles/themes/index.css"
import type { ReaderShellConfigDto } from "../../../src/nodes/neoview/adapters/reader-http-client"
import { BoardLayoutSettingsCard } from "../../../src/nodes/neoview/features/settings/cards/BoardLayoutSettingsCard"
import { applyReaderWorkspacePatch, type ReaderWorkspacePatch } from "../../../src/nodes/neoview/features/workspace/ReaderWorkspaceLayout"

const INITIAL_SHELL: ReaderShellConfigDto = {
  revision: 1,
  showDelayMs: 0,
  hideDelayMs: 320,
  opacity: { top: 90, bottom: 90, sidebar: 90 },
  blur: { top: 12, bottom: 12, sidebar: 12 },
  edges: {
    top: { enabled: true, initialVisible: true, pinned: false, triggerSize: 28 },
    right: { enabled: true, initialVisible: false, pinned: false, triggerSize: 24 },
    bottom: { enabled: true, initialVisible: false, pinned: false, triggerSize: 24 },
    left: { enabled: true, initialVisible: false, pinned: false, triggerSize: 24 },
  },
  sidebars: {
    left: { width: 320, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
    right: { width: 280, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
  },
  workspace: {
    mode: "swimlane",
    swimlane: {
      laneOrder: ["left", "reader", "right"],
      activeLane: "reader",
      readerSolo: true,
      readerSoloOnFocus: true,
      readerWidthRatio: 0.5,
      edgeRevealDelayMs: 180,
      readerFocusOnHover: true,
      readerFocusHoverDelayMs: 650,
      showLaneNavigatorInReaderSolo: false,
      lanes: {
        left: { width: 320, collapsed: false },
        reader: { width: 960, collapsed: false },
        right: { width: 280, collapsed: false },
      },
    },
  },
  panelLayout: {},
  cardLayout: {},
}

function Harness() {
  const [shell, setShell] = useState(INITIAL_SHELL)
  function patchWorkspace(patch: ReaderWorkspacePatch) {
    setShell((current) => ({
      ...current,
      workspace: applyReaderWorkspacePatch(current.workspace!, patch),
    }))
  }
  return <main className="min-h-screen bg-background p-4 text-foreground">
    <div className="mx-auto w-full max-w-2xl">
      <BoardLayoutSettingsCard shell={shell} onSave={async () => undefined} onWorkspace={patchWorkspace} />
    </div>
  </main>
}

createRoot(document.getElementById("root")!).render(<StrictMode><Harness /></StrictMode>)
