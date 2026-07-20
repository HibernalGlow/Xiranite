import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_READER_PRESENTATION } from "@xiranite/node-neoview/ui-core"

import type { ReaderHttpClient, ReaderMetadataDto, ReaderPageDto, ReaderSessionDto } from "../../../adapters/reader-http-client"
import ImageInformationCard from "./ImageInformationCard"
import { formatMediaBitRate, formatMediaDuration, formatMediaFileSize, formatMediaFormat } from "./reader-metadata-format"

afterEach(cleanup)

describe("ImageInformationCard", () => {
  it("[neoview.image-information.image-fields] preserves legacy image rows without probing video metadata", async () => {
    const pageMediaInformation = vi.fn()
    const view = render(<ImageInformationCard
      client={client(vi.fn(async () => metadata("image")), pageMediaInformation)}
      session={session(page("image"))}
      disabled={false}
      onGoTo={vi.fn()}
      presentation={{ ...DEFAULT_READER_PRESENTATION, fitMode: "fit-width", manualScale: 1.25, rotation: 90 }}
    />)

    expect(await screen.findByText("001.png")).toBeTruthy()
    expect(view.container.textContent).toContain("图片")
    expect(view.container.textContent).toContain("1920 × 1080")
    expect(view.container.textContent).toContain("PNG")
    expect(view.container.textContent).toContain("2.00 MB")
    expect(view.container.textContent).toContain("1080 × 1920")
    expect(view.container.textContent).toContain("适应宽度")
    expect(view.container.textContent).toContain("125%")
    expect(pageMediaInformation).not.toHaveBeenCalled()
  })

  it("[neoview.image-information.video-fields] renders the complete optional video branch", async () => {
    const pageMediaInformation = vi.fn(async () => ({
      pageId: "page-1",
      contentVersion: "v1",
      mediaKind: "video" as const,
      durationSeconds: 3_661,
      frameRate: 29.97,
      bitRateBps: 2_000_000,
      videoCodec: "h264",
      audioCodec: "aac",
    }))
    render(<ImageInformationCard
      client={client(vi.fn(async () => metadata("video")), pageMediaInformation)}
      session={session(page("video"))}
      disabled={false}
      onGoTo={vi.fn()}
    />)

    expect(await screen.findByText("1:01:01")).toBeTruthy()
    expect(screen.getByText("30 fps")).toBeTruthy()
    expect(screen.getByText("2.0 Mbps")).toBeTruthy()
    expect(screen.getByText("h264")).toBeTruthy()
    expect(screen.getByText("aac")).toBeTruthy()
    expect(pageMediaInformation).toHaveBeenCalledOnce()
  })

  it("[neoview.image-information.probe-degradation] keeps base rows visible and retries only the failed probe", async () => {
    const pageMediaInformation = vi.fn()
      .mockRejectedValueOnce(new Error("ffprobe unavailable"))
      .mockResolvedValueOnce({ pageId: "page-1", contentVersion: "v1", mediaKind: "video", durationSeconds: 10 })
    render(<ImageInformationCard
      client={client(vi.fn(async () => metadata("video")), pageMediaInformation)}
      session={session(page("video"))}
      disabled={false}
      onGoTo={vi.fn()}
    />)

    expect(await screen.findByText("clip.mp4")).toBeTruthy()
    expect((await screen.findByRole("alert")).textContent).toContain("ffprobe unavailable")
    fireEvent.click(screen.getByRole("button", { name: "重试视频信息" }))
    expect(await screen.findByText("0:10")).toBeTruthy()
    expect(screen.getByText("clip.mp4")).toBeTruthy()
    expect(pageMediaInformation).toHaveBeenCalledTimes(2)
  })

  it("[neoview.image-information.metadata-retry] retries a failed base metadata request without probing twice", async () => {
    const metadataRequest = vi.fn()
      .mockRejectedValueOnce(new Error("metadata unavailable"))
      .mockResolvedValueOnce(metadata("image"))
    const pageMediaInformation = vi.fn()
    render(<ImageInformationCard
      client={client(metadataRequest, pageMediaInformation)}
      session={session(page("image"))}
      disabled={false}
      onGoTo={vi.fn()}
    />)

    expect((await screen.findByRole("alert")).textContent).toContain("metadata unavailable")
    expect(screen.getByRole("button", { name: "重试图像信息" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "重试图像信息" }))

    expect(await screen.findByText("001.png")).toBeTruthy()
    expect(metadataRequest).toHaveBeenCalledTimes(2)
    expect(pageMediaInformation).not.toHaveBeenCalled()
  })

  it("[neoview.image-information.navigation-cancel] aborts stale page probes and ignores their result", async () => {
    const first = Promise.withResolvers<{ pageId: string; contentVersion: string; mediaKind: "video"; videoCodec: string }>()
    const second = Promise.withResolvers<{ pageId: string; contentVersion: string; mediaKind: "video"; videoCodec: string }>()
    const signals: AbortSignal[] = []
    const pageMediaInformation = vi.fn((_sessionId: string, signal?: AbortSignal) => {
      signals.push(signal!)
      return signals.length === 1 ? first.promise : second.promise
    })
    const readerClient = client(vi.fn(async () => metadata("video")), pageMediaInformation)
    const firstPage = page("video")
    const view = render(<ImageInformationCard client={readerClient} session={session(firstPage)} disabled={false} onGoTo={vi.fn()} />)
    await waitFor(() => expect(pageMediaInformation).toHaveBeenCalledOnce())

    const nextPage = { ...firstPage, id: "page-2", index: 2, name: "next.mp4", contentVersion: "v2" }
    view.rerender(<ImageInformationCard client={readerClient} session={session(nextPage)} disabled={false} onGoTo={vi.fn()} />)
    await waitFor(() => expect(pageMediaInformation).toHaveBeenCalledTimes(2))
    expect(signals[0]?.aborted).toBe(true)
    first.resolve({ pageId: "page-1", contentVersion: "v1", mediaKind: "video", videoCodec: "stale" })
    second.resolve({ pageId: "page-2", contentVersion: "v2", mediaKind: "video", videoCodec: "fresh" })
    expect(await screen.findByText("fresh")).toBeTruthy()
    expect(screen.queryByText("stale")).toBeNull()
  })

  it("[neoview.image-information.card-hide] aborts active metadata and video probes when hidden", async () => {
    const metadataDeferred = Promise.withResolvers<ReaderMetadataDto>()
    const probeDeferred = Promise.withResolvers<{ pageId: string; contentVersion: string; mediaKind: "video"; videoCodec: string }>()
    let metadataSignal: AbortSignal | undefined
    let probeSignal: AbortSignal | undefined
    const metadataRequest = vi.fn((_sessionId: string, signal?: AbortSignal) => {
      metadataSignal = signal
      return metadataDeferred.promise
    })
    const pageMediaInformation = vi.fn((_sessionId: string, signal?: AbortSignal) => {
      probeSignal = signal
      return probeDeferred.promise
    })
    const readerClient = client(metadataRequest, pageMediaInformation)
    const view = render(<ImageInformationCard client={readerClient} session={session(page("video"))} disabled={false} onGoTo={vi.fn()} />)

    await waitFor(() => {
      expect(metadataRequest).toHaveBeenCalledOnce()
      expect(pageMediaInformation).toHaveBeenCalledOnce()
    })
    view.rerender(<ImageInformationCard client={readerClient} session={session(page("video"))} panelActive={false} disabled={false} onGoTo={vi.fn()} />)

    await waitFor(() => {
      expect(metadataSignal?.aborted).toBe(true)
      expect(probeSignal?.aborted).toBe(true)
    })
    metadataDeferred.resolve(metadata("video"))
    probeDeferred.resolve({ pageId: "page-1", contentVersion: "v1", mediaKind: "video", videoCodec: "late" })
    await Promise.resolve()
    expect(view.container.querySelector('[data-reader-card-empty="true"]')).toBeTruthy()
    expect(view.container.textContent).not.toContain("late")
  })

  it("[neoview.image-information.resident-empty] keeps the legacy empty shell without a session", () => {
    const metadataRequest = vi.fn()
    const pageMediaInformation = vi.fn()
    const view = render(<ImageInformationCard client={client(metadataRequest, pageMediaInformation)} disabled={false} onGoTo={vi.fn()} />)
    expect(view.container.querySelector('[data-neoview-card="image-information"]')).toBeTruthy()
    expect(view.container.querySelector('[data-image-information-state="empty"]')).toBeTruthy()
    expect(screen.getByText("暂无媒体信息")).toBeTruthy()
    expect(metadataRequest).not.toHaveBeenCalled()
    expect(pageMediaInformation).not.toHaveBeenCalled()
  })

  it("[neoview.image-information.inactive-zero-work] keeps the empty shell while hidden and resumes on activation", async () => {
    const metadataRequest = vi.fn(async () => metadata("video"))
    const pageMediaInformation = vi.fn(async () => ({
      pageId: "page-1",
      contentVersion: "v1",
      mediaKind: "video" as const,
      durationSeconds: 10,
    }))
    const readerClient = client(metadataRequest, pageMediaInformation)
    const currentSession = session(page("video"))
    const view = render(
      <ImageInformationCard
        client={readerClient}
        session={currentSession}
        panelActive={false}
        disabled={false}
        onGoTo={vi.fn()}
      />,
    )

    expect(view.container.querySelector('[data-reader-card-empty="true"]')).toBeTruthy()
    expect(view.container.querySelector('[data-image-information-state="empty"]')).toBeTruthy()
    expect(metadataRequest).not.toHaveBeenCalled()
    expect(pageMediaInformation).not.toHaveBeenCalled()

    view.rerender(
      <ImageInformationCard
        client={readerClient}
        session={currentSession}
        panelActive
        disabled={false}
        onGoTo={vi.fn()}
      />,
    )

    expect(await screen.findByText("clip.mp4")).toBeTruthy()
    await waitFor(() => expect(metadataRequest).toHaveBeenCalledOnce())
    await waitFor(() => expect(pageMediaInformation).toHaveBeenCalledOnce())
  })

  it("[neoview.image-information.formatting] freezes legacy duration, bitrate, byte and format boundaries", () => {
    expect([undefined, 0, Number.NaN, 59.9, 60, 3_600].map(formatMediaDuration)).toEqual(["—", "—", "—", "0:59", "1:00", "1:00:00"])
    expect([undefined, 0, 999, 1_000, 1_000_000].map(formatMediaBitRate)).toEqual(["—", "—", "999 bps", "1 Kbps", "1.0 Mbps"])
    expect([undefined, 0, 1_023, 1_024, 1_048_576, 1_073_741_824].map(formatMediaFileSize)).toEqual(["—", "—", "1023 B", "1.0 KB", "1.00 MB", "1.00 GB"])
    expect(formatMediaFormat("cover.avif", undefined)).toBe("AVIF")
    expect(formatMediaFormat("cover.bin", "image/webp")).toBe("WEBP")
  })
})

function client(metadataRequest: NonNullable<ReaderHttpClient["metadata"]>, pageMediaInformation: NonNullable<ReaderHttpClient["pageMediaInformation"]>): ReaderHttpClient {
  return {
    config: vi.fn(), updateSidebarLayout: vi.fn(), updateCardLayout: vi.fn(), updateBoardLayout: vi.fn(), updateViewDefaults: vi.fn(),
    updateSlideshow: vi.fn(), open: vi.fn(), listPages: vi.fn(), navigate: vi.fn(), goTo: vi.fn(), updateSessionOptions: vi.fn(), close: vi.fn(),
    metadata: metadataRequest, pageMediaInformation,
  }
}

function page(mediaKind: "image" | "video"): ReaderPageDto {
  return {
    id: "page-1",
    index: 1,
    name: mediaKind === "video" ? "clip.mp4" : "001.png",
    mediaKind,
    mimeType: mediaKind === "video" ? "video/mp4" : "image/png",
    byteLength: 2 * 1_048_576,
    dimensions: { width: 1920, height: 1080 },
    contentVersion: "v1",
    assetUrl: "http://127.0.0.1/asset",
  }
}

function session(activePage: ReaderPageDto): ReaderSessionDto {
  return {
    sessionId: "reader-1",
    book: { id: "book-1", displayName: "demo", pageCount: 3 },
    frame: {
      generation: activePage.index + 1,
      anchorPageIndex: activePage.index,
      direction: "left-to-right",
      layout: { pageMode: "single", panorama: false, singleFirstPage: true, singleLastPage: true, treatWidePageAsSingle: true },
      pages: [{ pageId: activePage.id, pageIndex: activePage.index, side: "single" }],
      pageCount: 3,
      atStart: activePage.index === 0,
      atEnd: activePage.index === 2,
    },
    visiblePages: [activePage],
  }
}

function metadata(mediaKind: "image" | "video"): ReaderMetadataDto {
  const activePage = page(mediaKind)
  return {
    book: { bookId: "book-1", displayName: "demo", sourceKind: "archive", sourcePath: "D:/demo.cbz", pageCount: 3, currentPage: 2 },
    page: {
      index: activePage.index,
      name: activePage.name,
      displayPath: activePage.name,
      mediaKind,
      mimeType: activePage.mimeType,
      byteLength: activePage.byteLength,
      dimensions: activePage.dimensions,
    },
  }
}
