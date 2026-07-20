import { cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient, ReaderSuperResolutionConfigDto, ReaderUpscalePreloadSnapshotDto } from "../../adapters/reader-http-client"
import { useReaderUpscalePreload } from "./useReaderUpscalePreload"

afterEach(cleanup)

describe("useReaderUpscalePreload", () => {
  it("[neoview.super-resolution.gui-preload-coalescing] coalesces layout generations before submitting work", async () => {
    const startUpscalePreload = vi.fn(async (_sessionId: string, mode: "nearby" | "progressive") => [snapshot(mode)])
    const client = { startUpscalePreload, upscalePreloadSnapshots: vi.fn(async () => []) } as unknown as ReaderHttpClient
    const { rerender } = renderHook(({ generation }) => useReaderUpscalePreload({
      client,
      sessionId: "reader-1",
      preloadGeneration: generation,
      currentPageIndex: 1,
      superResolution: enabledConfig(),
    }), { initialProps: { generation: 1 } })

    rerender({ generation: 2 })
    await waitFor(() => expect(startUpscalePreload).toHaveBeenCalledTimes(2))
    expect(startUpscalePreload.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ["reader-1", "nearby"],
      ["reader-1", "progressive"],
    ])
  })

  it("[neoview.super-resolution.gui-auto-preload] submits progressive work only after nearby admission", async () => {
    let resolveNearby!: () => void
    const nearbyAccepted = new Promise<void>((resolve) => { resolveNearby = resolve })
    const startUpscalePreload = vi.fn(async (_sessionId: string, mode: "nearby" | "progressive") => {
      if (mode === "nearby") await nearbyAccepted
      return [snapshot(mode)]
    })
    const upscalePreloadSnapshots = vi.fn(async () => [] as readonly ReaderUpscalePreloadSnapshotDto[])
    const client = { startUpscalePreload, upscalePreloadSnapshots } as unknown as ReaderHttpClient
    const { rerender } = renderHook(({ generation, pageIndex }) => useReaderUpscalePreload({
      client,
      sessionId: "reader-1",
      preloadGeneration: generation,
      currentPageIndex: pageIndex,
      superResolution: enabledConfig(),
    }), { initialProps: { generation: 4, pageIndex: 1 } })

    await waitFor(() => expect(startUpscalePreload).toHaveBeenCalledTimes(1))
    expect(startUpscalePreload.mock.calls.map((call) => call.slice(0, 2))).toEqual([["reader-1", "nearby"]])
    resolveNearby()
    await waitFor(() => expect(startUpscalePreload).toHaveBeenCalledTimes(2))
    expect(startUpscalePreload.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ["reader-1", "nearby"],
      ["reader-1", "progressive"],
    ])

    rerender({ generation: 5, pageIndex: 2 })
    await waitFor(() => expect(startUpscalePreload).toHaveBeenCalledTimes(4))
    expect(startUpscalePreload.mock.calls.slice(2).map((call) => call.slice(0, 2))).toEqual([
      ["reader-1", "nearby"],
      ["reader-1", "progressive"],
    ])
  })

  it("[neoview.super-resolution.gui-auto-preload-disabled] does not create background work when automatic upscale is off", async () => {
    const startUpscalePreload = vi.fn()
    const client = { startUpscalePreload, upscalePreloadSnapshots: vi.fn() } as unknown as ReaderHttpClient
    renderHook(() => useReaderUpscalePreload({
      client,
      sessionId: "reader-1",
      preloadGeneration: 1,
      currentPageIndex: 0,
      superResolution: { ...enabledConfig(), preferences: { ...enabledConfig().preferences, autoUpscaleEnabled: false } },
    }))

    await Promise.resolve()
    expect(startUpscalePreload).not.toHaveBeenCalled()
  })
})

function enabledConfig(): ReaderSuperResolutionConfigDto {
  return {
    provider: "opencomic-system",
    preferences: {
      autoUpscaleEnabled: true,
      preUpscaleEnabled: true,
      progressiveEnabled: true,
      progressiveDwellTimeMs: 3_000,
      progressiveMaxPages: 20,
    },
  }
}

function snapshot(mode: "nearby" | "progressive"): ReaderUpscalePreloadSnapshotDto {
  return {
    contextId: "reader:reader-1:super-resolution",
    generation: 4,
    mode,
    state: mode === "nearby" ? "running" : "countdown",
    planned: mode === "nearby" ? 3 : 0,
    settled: 0,
    failed: 0,
    cancelled: 0,
    pending: mode === "nearby" ? 3 : 0,
    progress: 0,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  }
}
