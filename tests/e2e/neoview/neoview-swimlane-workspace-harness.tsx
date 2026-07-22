import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"

import "../../../src/styles/tailwind.css"
import "../../../src/index.css"
import "../../../src/styles/themes/index.css"
import { FloatingWindowCaptionControls, FloatingWindowFrameProvider } from "../../../src/components/workspace/FloatingWindowFrame"
import type { ReaderShellConfigDto, ReaderSwimlaneLaneDto } from "../../../src/nodes/neoview/adapters/reader-http-client"
import { ReaderPanelBar } from "../../../src/nodes/neoview/features/panels/ReaderPanelBar"
import { ReaderWindowBar } from "../../../src/nodes/neoview/features/shell/ReaderWindowBar"
import { ReaderEdgeShell } from "../../../src/nodes/neoview/features/shell/ReaderEdgeShell"
import type { ReaderShellControlPort } from "../../../src/nodes/neoview/features/shell/ReaderShellControlPort"
import { createReaderShellControlStore } from "../../../src/nodes/neoview/features/shell/ReaderShellControlStore"
import { ReaderSwimlaneWorkspace } from "../../../src/nodes/neoview/features/workspace/ReaderSwimlaneWorkspace"
import {
  applyReaderWorkspacePatch,
  readerWorkspaceConfig,
  type ReaderWorkspacePatch,
} from "../../../src/nodes/neoview/features/workspace/ReaderWorkspaceLayout"

const INITIAL_SHELL: ReaderShellConfigDto = {
  showDelayMs: 0,
  hideDelayMs: 360,
  opacity: { top: 94, bottom: 92, sidebar: 96 },
  blur: { top: 12, bottom: 12, sidebar: 10 },
  edges: {
    top: { enabled: true, initialVisible: true, pinned: false, triggerSize: 28 },
    right: { enabled: true, initialVisible: false, pinned: false, triggerSize: 24 },
    bottom: { enabled: true, initialVisible: false, pinned: false, triggerSize: 24 },
    left: { enabled: true, initialVisible: false, pinned: false, triggerSize: 24 },
  },
  sidebars: {
    left: { width: 340, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
    right: { width: 380, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
  },
  sidebarInteraction: { showDragHandle: false, enableBlankAreaCollapse: true, blankAreaCollapseMode: "single" },
  workspace: {
    mode: "edges",
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
        left: { width: 340, collapsed: false, activePanelId: "folder" },
        reader: { width: 960, collapsed: false },
        right: { width: 380, collapsed: false, activePanelId: "info" },
      },
    },
  },
  panelLayout: {},
  cardLayout: {},
}

function Harness() {
  const [shell, setShell] = useState(INITIAL_SHELL)
  const [readerActions, setReaderActions] = useState(0)
  const [control] = useState<ReaderShellControlPort>(() => {
    const store = createReaderShellControlStore()
    return {
      store,
      requestOpen: store.requestOpen,
      setPinned: store.setPinned,
      cycleLock: store.cycleLock,
      setLock: store.setLock,
      setFloating: store.setFloating,
      setTriggerSize: () => undefined,
      reset: () => undefined,
      persist: () => undefined,
    }
  })
  const workspace = readerWorkspaceConfig(shell)
  const solo = workspace.swimlane.readerSolo
  const readerSoloActive = solo && workspace.swimlane.activeLane === "reader"

  function patchWorkspace(patch: ReaderWorkspacePatch) {
    setShell((current) => applyReaderWorkspacePatch(current, patch))
  }

  const reader = (
    <ReaderSurface
      control={control}
      shell={shell}
      includeWindowControls={workspace.mode === "edges" || readerSoloActive}
      readerSoloActive={readerSoloActive}
      readerActions={readerActions}
      onReaderAction={() => setReaderActions((count) => count + 1)}
      onWorkspaceChange={patchWorkspace}
    />
  )

  return (
    <main className="xiranite-floating-window relative h-screen w-screen overflow-hidden bg-background text-foreground" data-swimlane-harness="true">
      {workspace.mode === "swimlane" ? (
        <ReaderSwimlaneWorkspace
          shell={shell}
          workspace={workspace}
          reader={reader}
          left={<PanelLane side="left" lane={workspace.swimlane.lanes.left} onChange={(patch) => patchWorkspace({ lanes: { left: patch } })} />}
          right={<PanelLane side="right" lane={workspace.swimlane.lanes.right} onChange={(patch) => patchWorkspace({ lanes: { right: patch } })} />}
          windowChrome={!readerSoloActive ? {
            controls: <FloatingWindowCaptionControls integrated density="compact" />,
            onTitlebarDoubleClick: frame.handleTitlebarDoubleClick,
          } : undefined}
          onWorkspaceChange={patchWorkspace}
        />
      ) : (
        <div className="h-full" data-neoview-workspace-mode="edges">{reader}</div>
      )}
    </main>
  )
}

function ReaderSurface({ control, shell, includeWindowControls, readerSoloActive, readerActions, onReaderAction, onWorkspaceChange }: {
  control: ReaderShellControlPort
  shell: ReaderShellConfigDto
  includeWindowControls: boolean
  readerSoloActive: boolean
  readerActions: number
  onReaderAction(): void
  onWorkspaceChange(patch: ReaderWorkspacePatch): void
}) {
  const workspace = readerWorkspaceConfig(shell)
  const [edgeOpen, setEdgeOpen] = useState({ top: false, bottom: false })
  const edgeSlot = (edge: "top" | "bottom") => ({
    ariaLabel: edge === "top" ? "Reader 顶栏" : "Reader 底栏",
    open: edgeOpen[edge],
    interaction: "auto" as const,
    triggerSize: 24,
    triggerRect: edge === "top"
      ? { x: 45, y: 5, width: 10, height: 2 }
      : { x: 2, y: 98, width: 4, height: 2 },
    className: "pointer-events-none",
    showDelayMs: 0,
    hideDelayMs: 240,
    render: () => <div className="grid h-10 place-items-center border-y border-border/50 bg-background/94 text-xs">{edge === "top" ? "Reader 顶栏" : "Reader 底栏"}</div>,
  })
  return (
    <ReaderEdgeShell edges={{ top: edgeSlot("top"), bottom: edgeSlot("bottom") }} onEdgeOpenRequest={(edge, open) => {
      if (edge === "top" || edge === "bottom") setEdgeOpen((current) => ({ ...current, [edge]: open }))
    }}>
      <section className="relative flex h-full min-h-0 flex-col overflow-hidden bg-neutral-950" data-reader-harness-surface="true">
      <div className="xiranite-app-region-drag flex min-h-11 shrink-0 select-none items-stretch border-b border-white/10 bg-background/94 pl-2 backdrop-blur-xl" data-reader-breadcrumb-bar="true">
        <ReaderWindowBar
          control={control}
          mode={workspace.mode}
          readerSolo={readerSoloActive}
          onModeChange={(mode) => onWorkspaceChange({ mode })}
          onReaderSoloChange={(readerSolo) => onWorkspaceChange(readerSolo ? { activeLane: "reader", readerSolo: true } : { readerSolo: false })}
          onOpenSettings={() => undefined}
          part="leading"
        />
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          <span className="truncate text-xs text-muted-foreground">D:/NeoView/泳道界面基准.cbz</span>
          <span className="hidden text-[11px] text-muted-foreground sm:inline">18 / 84</span>
        </div>
        <ReaderWindowBar
          control={control}
          mode={workspace.mode}
          readerSolo={readerSoloActive}
          onModeChange={(mode) => onWorkspaceChange({ mode })}
          onReaderSoloChange={(readerSolo) => onWorkspaceChange(readerSolo ? { activeLane: "reader", readerSolo: true } : { readerSolo: false })}
          onOpenSettings={() => undefined}
          windowControls={includeWindowControls ? <FloatingWindowCaptionControls integrated /> : undefined}
          part="trailing"
        />
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
        <img className="h-full w-full object-cover opacity-80" src="/migration/neoview/image.png" alt="NeoView 阅读器基准" />
        <button
          type="button"
          className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-md border border-white/25 bg-black/65 px-3 py-2 text-xs text-white backdrop-blur"
          data-reader-action-count={readerActions}
          onClick={onReaderAction}
        >
          Reader 操作 {readerActions}
        </button>
      </div>
      </section>
    </ReaderEdgeShell>
  )
}

function PanelLane({ side, lane, onChange }: {
  side: "left" | "right"
  lane: ReaderSwimlaneLaneDto
  onChange(patch: Partial<ReaderSwimlaneLaneDto>): void
}) {
  const [owner, setOwner] = useState<HTMLElement | null>(null)
  const rows = side === "left" ? ["文件夹", "历史记录", "书签"] : ["书籍信息", "页面属性", "图像设置"]
  return (
    <div ref={setOwner} className="relative flex h-full flex-col bg-background" data-harness-panel-lane={side}>
      <ReaderPanelBar side={side} lane={lane} owner={owner} setRailRef={() => undefined} onChange={onChange}>
        {rows.map((row) => <button key={row} type="button" aria-label={row} className="grid size-8 shrink-0 place-items-center rounded text-[10px] text-muted-foreground hover:bg-muted">{row.slice(0, 1)}</button>)}
      </ReaderPanelBar>
      <div className="flex h-10 items-center border-b px-3 text-xs font-semibold">{side === "left" ? "浏览" : "属性"}</div>
      <div className="grid gap-px bg-border/45">
        {rows.map((row) => <div key={row} className="bg-background px-3 py-3 text-left text-xs">{row}</div>)}
      </div>
    </div>
  )
}

const frame = {
  isMaximized: false,
  pending: false,
  control: () => undefined,
  handleTitlebarDoubleClick: () => undefined,
  registerIntegratedTitlebar: () => () => undefined,
}

document.documentElement.classList.add("dark")

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <FloatingWindowFrameProvider value={frame}>
      <Harness />
    </FloatingWindowFrameProvider>
  </StrictMode>,
)
