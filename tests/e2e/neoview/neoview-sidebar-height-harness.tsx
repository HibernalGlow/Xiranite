import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"

import "../../../src/styles/tailwind.css"
import "../../../src/index.css"
import "../../../src/styles/themes/index.css"
import type { ReaderShellConfigDto, ReaderShellEdge } from "../../../src/nodes/neoview/adapters/reader-http-client"
import { SidebarHeightEditor } from "../../../src/nodes/neoview/features/panels/cards/SidebarHeightCard"

const initialShell: ReaderShellConfigDto = {
  revision: 1,
  showDelayMs: 80,
  hideDelayMs: 180,
  opacity: { top: 0.94, bottom: 0.94, sidebar: 0.94 },
  blur: { top: 16, bottom: 16, sidebar: 18 },
  edges: {
    top: edge(32),
    right: edge(32),
    bottom: edge(32),
    left: edge(32),
  },
  floatingControl: { enabled: true, position: { x: 50, y: 50 } },
  sidebars: {
    left: { width: 320, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
    right: { width: 320, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
  },
  sidebarInteraction: { showDragHandle: false, enableBlankAreaCollapse: true, blankAreaCollapseMode: "single" },
  panelLayout: {},
  cardLayout: {},
}

function edge(triggerSize: number) {
  return { enabled: true, initialVisible: true, pinned: true, triggerSize }
}

function Harness() {
  const [shell, setShell] = useState(initialShell)
  const [writes, setWrites] = useState(0)
  const updateShell = (next: ReaderShellConfigDto) => {
    setShell(next)
    setWrites((count) => count + 1)
    document.documentElement.dataset.sidebarHeightWrites = String(writes + 1)
  }
  const updateSidebar = (patch: { side: "left" | "right"; height?: ReaderShellConfigDto["sidebars"]["left"]["height"]; customHeight?: number; verticalAlign?: number; horizontalPosition?: number }) => {
    const { side, ...layoutPatch } = patch
    updateShell({ ...shell, sidebars: { ...shell.sidebars, [side]: { ...shell.sidebars[side], ...layoutPatch } } })
  }
  const updateTrigger = (edgeName: ReaderShellEdge, value: number) => updateShell({ ...shell, edges: { ...shell.edges, [edgeName]: { ...shell.edges[edgeName], triggerSize: value } } })
  const updateInteraction = (patch: Partial<NonNullable<ReaderShellConfigDto["sidebarInteraction"]>>) => updateShell({ ...shell, sidebarInteraction: { ...shell.sidebarInteraction!, ...patch } })

  return (
    <main className="min-h-screen bg-background px-3 py-4 text-foreground">
      <header className="mb-3 border-b border-border pb-3">
        <p className="text-xs text-muted-foreground">控制</p>
        <h1 className="text-sm font-semibold">侧边栏高度</h1>
      </header>
      <SidebarHeightEditor
        shell={shell}
        onSidebarLayout={updateSidebar}
        onTriggerSize={updateTrigger}
        onInteraction={updateInteraction}
      />
      <output className="sr-only" aria-label="配置写入次数">{writes}</output>
    </main>
  )
}

createRoot(document.getElementById("root")!).render(<StrictMode><Harness /></StrictMode>)
