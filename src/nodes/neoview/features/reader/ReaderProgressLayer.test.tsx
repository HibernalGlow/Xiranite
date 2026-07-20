import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import type { ReaderUpscalePreloadSnapshotDto } from "../../adapters/reader-http-client"
import { ReaderViewerToggleStore } from "../viewer/ReaderViewerToggleStore"
import { setReaderUpscaleArtifact } from "./ReaderUpscaleArtifactStore"
import { ReaderProgressLayer } from "./ReaderProgressLayer"

afterEach(cleanup)

describe("ReaderProgressLayer", () => {
  it("[neoview.reader.progress-layer] renders reading and real upscale progress at the viewport bottom", () => {
    const viewerToggles = new ReaderViewerToggleStore()
    setReaderUpscaleArtifact("reader-progress", "page-4", { state: "processing" })
    render(<ReaderProgressLayer
      sessionId="reader-progress"
      currentPageId="page-4"
      currentPageIndex={3}
      totalPages={8}
      direction="left-to-right"
      superResolutionEnabled
      snapshots={[snapshot("nearby", 4, 2), snapshot("progressive", 6, 3)]}
      viewerToggles={viewerToggles}
    />)

    expect(screen.getByRole("progressbar", { name: "翻页进度" }).getAttribute("aria-valuenow")).toBe("4")
    expect(screen.getByRole("progressbar", { name: "超分进度" }).getAttribute("aria-valuenow")).toBe("50")
    expect(document.querySelector<HTMLElement>("[data-reader-reading-progress]")?.style.width).toBe("50%")
    expect(document.querySelector("[data-reader-reading-progress]")?.className).toContain("animate-pulse")
    expect(document.querySelector<HTMLElement>("[data-reader-pre-upscale-progress]")?.style.width).toBe("50%")
  })

  it("[neoview.reader.progress-layer-controls] follows RTL, glow and visibility controls", () => {
    const viewerToggles = new ReaderViewerToggleStore()
    render(<ReaderProgressLayer
      sessionId="reader-rtl"
      currentPageId="page-2"
      currentPageIndex={1}
      totalPages={4}
      direction="right-to-left"
      superResolutionEnabled={false}
      snapshots={[]}
      viewerToggles={viewerToggles}
    />)

    const progress = document.querySelector<HTMLElement>("[data-reader-reading-progress]")!
    expect(progress.style.right).toBe("0px")
    expect(progress.style.boxShadow).not.toBe("")
    act(() => viewerToggles.toggleProgressBarGlow())
    expect(document.querySelector<HTMLElement>("[data-reader-reading-progress]")!.style.boxShadow).toBe("")
    act(() => viewerToggles.toggleProgressBar())
    expect(screen.queryByRole("progressbar", { name: "翻页进度" })).toBeNull()
  })

  it("[neoview.reader.upscale-coverage-progress] uses unique successful book coverage instead of terminal batch outcomes", () => {
    render(<ReaderProgressLayer
      sessionId="reader-coverage"
      currentPageId="page-3"
      currentPageIndex={2}
      totalPages={100}
      direction="left-to-right"
      superResolutionEnabled
      snapshots={[{
        ...snapshot("nearby", 3, 1),
        failed: 1,
        cancelled: 1,
        pending: 0,
        totalPages: 100,
        scheduledPages: 23,
        upscaledPages: 4,
      }]}
    />)

    expect(screen.getByRole("progressbar", { name: "超分进度" }).getAttribute("aria-valuenow")).toBe("4")
    expect(document.querySelector<HTMLElement>("[data-reader-pre-upscale-progress]")?.style.width).toBe("23%")
    expect(document.querySelector<HTMLElement>("[data-reader-upscale-progress]")?.style.width).toBe("4%")
  })
})

function snapshot(mode: "nearby" | "progressive", planned: number, settled: number): ReaderUpscalePreloadSnapshotDto {
  return {
    contextId: "reader:reader-progress:super-resolution",
    generation: 1,
    mode,
    state: "running",
    planned,
    settled,
    failed: 0,
    cancelled: 0,
    pending: planned - settled,
    progress: settled / planned,
    startedAt: 1,
    updatedAt: 2,
  }
}
