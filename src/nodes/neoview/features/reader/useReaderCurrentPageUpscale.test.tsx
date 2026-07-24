import { cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient, ReaderPageDto, ReaderSuperResolutionConfigDto } from "../../adapters/reader-http-client"
import { readerUpscaleArtifactSnapshot, setReaderUpscaleArtifact } from "./ReaderUpscaleArtifactStore"
import { useReaderCurrentPageUpscale } from "./useReaderCurrentPageUpscale"

afterEach(cleanup)

describe("useReaderCurrentPageUpscale", () => {
  it("[neoview.super-resolution.current-page-priority] keeps the running page and replaces queued jumps with the latest page", async () => {
    const first = deferred()
    const latest = deferred()
    const upscalePage = vi.fn(async (_sessionId: string, pageId: string) => {
      if (pageId === "page-1") await first.promise
      if (pageId === "page-3") await latest.promise
      return {
        status: "generated" as const,
        artifactUrl: `/reader/artifacts/${pageId}.png`,
        contentType: "image/png",
        bytes: 128,
        version: `${pageId}-v1`,
      }
    })
    const client = { upscalePage } as unknown as ReaderHttpClient
    const view = renderHook(({ pages }) => useReaderCurrentPageUpscale({
      client,
      sessionId: "reader-current-priority",
      pages,
      superResolution: enabledConfig(),
    }), { initialProps: { pages: [page(1)] } })

    await waitFor(() => expect(upscalePage).toHaveBeenCalledTimes(1))
    expect(readerUpscaleArtifactSnapshot("reader-current-priority", "page-1").state).toBe("processing")

    view.rerender({ pages: [page(2)] })
    expect(readerUpscaleArtifactSnapshot("reader-current-priority", "page-2").state).toBe("queued")
    view.rerender({ pages: [page(3)] })
    expect(readerUpscaleArtifactSnapshot("reader-current-priority", "page-2").state).toBe("idle")
    expect(readerUpscaleArtifactSnapshot("reader-current-priority", "page-3").state).toBe("queued")

    first.resolve()
    await waitFor(() => expect(upscalePage).toHaveBeenCalledTimes(2))
    expect(upscalePage.mock.calls.map((call) => call[1])).toEqual(["page-1", "page-3"])
    expect(readerUpscaleArtifactSnapshot("reader-current-priority", "page-3").state).toBe("processing")

    latest.resolve()
    await waitFor(() => expect(readerUpscaleArtifactSnapshot("reader-current-priority", "page-3").state).toBe("completed"))
  })

  it("[neoview.super-resolution.current-page-owner] shares a request already started by PageImage", async () => {
    const upscalePage = vi.fn()
    setReaderUpscaleArtifact("reader-current-owner", "page-1", { state: "processing", owner: "page-image:test" })

    renderHook(() => useReaderCurrentPageUpscale({
      client: { upscalePage } as unknown as ReaderHttpClient,
      sessionId: "reader-current-owner",
      pages: [page(1)],
      superResolution: enabledConfig(),
    }))

    await Promise.resolve()
    expect(upscalePage).not.toHaveBeenCalled()
    expect(readerUpscaleArtifactSnapshot("reader-current-owner", "page-1")).toMatchObject({
      state: "processing",
      owner: "page-image:test",
    })
  })
})

function page(index: number): ReaderPageDto {
  return {
    id: `page-${index}`,
    index,
    name: `${index}.png`,
    mediaKind: "image",
    mimeType: "image/png",
    assetUrl: `/reader/pages/${index}.png`,
    contentVersion: "v1",
  }
}

function enabledConfig(): ReaderSuperResolutionConfigDto {
  return {
    provider: "opencomic-system",
    preferences: {
      autoUpscaleEnabled: true,
      currentImageUpscaleEnabled: true,
    },
  }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((current) => { resolve = current })
  return { promise, resolve }
}
