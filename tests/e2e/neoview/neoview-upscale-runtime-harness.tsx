import { useState } from "react"
import { createRoot } from "react-dom/client"
import { DEFAULT_READER_PRESENTATION } from "@xiranite/node-neoview/ui-core"

import "../../../src/styles/tailwind.css"
import "../../../src/index.css"
import "../../../src/styles/themes/index.css"
import type { ReaderHttpClient, ReaderUpscalePreloadSnapshotDto } from "../../../src/nodes/neoview/adapters/reader-http-client"
import { ReaderFrame } from "../../../src/nodes/neoview/features/reader/ReaderFrame"
import { ReaderVideoController } from "../../../src/nodes/neoview/features/video/ReaderVideoController"
import { ReaderViewerToggleStore } from "../../../src/nodes/neoview/features/viewer/ReaderViewerToggleStore"

const videoController = new ReaderVideoController()
const viewerToggles = new ReaderViewerToggleStore()
const events: string[] = []
let renderedPageIndex = 1
let snapshots: readonly ReaderUpscalePreloadSnapshotDto[] = []

const client = {
  async startUpscalePreload(_sessionId: string, mode: "nearby" | "progressive") {
    record(`start:${mode}:page-${renderedPageIndex + 1}`)
    const next = mode === "nearby"
      ? preloadSnapshot(mode, 4, 2)
      : preloadSnapshot(mode, 6, 3)
    snapshots = [...snapshots.filter((snapshot) => snapshot.mode !== mode), next]
    return snapshots
  },
  async upscalePreloadSnapshots() {
    return snapshots
  },
  async upscalePage(_sessionId: string, pageId: string) {
    record(`current:${pageId}`)
    return { status: "bypassed", decision: { kind: "skip", reason: "harness" } }
  },
} as unknown as ReaderHttpClient

function Harness() {
  const [pageIndex, setPageIndex] = useState(1)
  const [preloadGeneration, setPreloadGeneration] = useState(1)
  const [direction, setDirection] = useState<"left-to-right" | "right-to-left">("left-to-right")
  renderedPageIndex = pageIndex
  const page = {
    id: `page-${pageIndex + 1}`,
    index: pageIndex,
    name: `${String(pageIndex + 1).padStart(3, "0")}.svg`,
    mediaKind: "image" as const,
    contentVersion: "v1",
    assetUrl: pageAsset(pageIndex),
    dimensions: { width: 900, height: 1_300 },
  }
  return (
    <main className="relative h-screen min-h-0 overflow-hidden bg-neutral-950 text-white" style={{ background: "#09090b", color: "#fafafa" }}>
      <ReaderFrame
        pages={[page]}
        presentation={DEFAULT_READER_PRESENTATION}
        direction={direction}
        pageMode="single"
        totalPages={8}
        anchorPageIndex={pageIndex}
        preloadGeneration={preloadGeneration}
        sessionId="upscale-runtime-session"
        client={client}
        videoController={videoController}
        superResolution={{
          provider: "opencomic-system",
          preferences: {
            autoUpscaleEnabled: true,
            preUpscaleEnabled: true,
            progressiveEnabled: true,
            progressiveDwellTimeMs: 3_000,
            progressiveMaxPages: 20,
          },
        }}
        viewerToggles={viewerToggles}
        onSubtitleConfigChange={async () => undefined}
        onVideoListEnded={() => undefined}
      />
      <nav className="absolute right-4 top-4 z-20 flex gap-2 rounded bg-black/75 p-2" aria-label="测试控制">
        <button className="rounded border border-white/30 px-3 py-1.5 text-xs" onClick={() => {
          setPageIndex((value) => Math.min(7, value + 1))
          setPreloadGeneration((value) => value + 1)
        }}>下一页</button>
        <button className="rounded border border-white/30 px-3 py-1.5 text-xs" onClick={() => setDirection((value) => value === "left-to-right" ? "right-to-left" : "left-to-right")}>切换方向</button>
        <button className="rounded border border-white/30 px-3 py-1.5 text-xs" onClick={() => viewerToggles.toggleProgressBar()}>切换进度条</button>
      </nav>
    </main>
  )
}

function preloadSnapshot(mode: "nearby" | "progressive", planned: number, settled: number): ReaderUpscalePreloadSnapshotDto {
  return {
    contextId: "reader:upscale-runtime-session:super-resolution",
    generation: 1,
    mode,
    state: "running",
    planned,
    settled,
    failed: 0,
    cancelled: 0,
    pending: planned - settled,
    progress: settled / planned,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  }
}

function record(event: string) {
  events.push(event)
  document.documentElement.dataset.upscaleRuntimeEvents = events.join(",")
}

function pageAsset(index: number): string {
  const hue = 170 + index * 12
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1300"><rect width="900" height="1300" fill="hsl(${hue} 35% 15%)"/><rect x="80" y="80" width="740" height="1140" rx="12" fill="hsl(${hue} 50% 26%)"/><text x="450" y="650" text-anchor="middle" dominant-baseline="middle" fill="white" font-family="sans-serif" font-size="96">${index + 1} / 8</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

createRoot(document.getElementById("root")!).render(<Harness />)
