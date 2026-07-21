import { useEffect } from "react"
import { render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderPageDto, ReaderPreloadEventDto } from "../../adapters/reader-http-client"
import { READER_PREFETCH_READY_MARK, resolveReaderPredecodePolicy, useReaderImagePreloader } from "./useReaderImagePreloader"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("useReaderImagePreloader", () => {
  it("[neoview.react.predecode-adaptive-policy] selects bounded concurrency from device and network hints", () => {
    expect(resolveReaderPredecodePolicy({ deviceMemoryGb: 16, hardwareConcurrency: 16, effectiveConnectionType: "4g" })).toMatchObject({ concurrency: 2, maxRetainedImages: 2 })
    expect(resolveReaderPredecodePolicy({ deviceMemoryGb: 16, hardwareConcurrency: 16, saveData: true })).toMatchObject({ concurrency: 1, maxRetainedImages: 1 })
    expect(resolveReaderPredecodePolicy({ deviceMemoryGb: 4, hardwareConcurrency: 4, effectiveConnectionType: "4g" })).toMatchObject({ concurrency: 1, maxRetainedImages: 1 })
  })

  it("[neoview.react.predecode] decodes once, bounds retained images and releases them with the session", async () => {
    const instances: FakeImage[] = []
    vi.stubGlobal("Image", class extends FakeImage {
      constructor() {
        super()
        instances.push(this)
      }
    })
    const mark = vi.spyOn(performance, "mark").mockImplementation(() => ({}) as PerformanceMark)
    const pages = Array.from({ length: 5 }, (_, index) => page(index))
    const controls: Array<ReturnType<typeof useReaderImagePreloader>> = []
    const view = render(<Fixture sessionId="reader-1" pages={pages.slice(0, 1)} onControl={(value) => { controls.push(value) }} />)

    await waitFor(() => expect(instances).toHaveLength(1))
    await waitFor(() => expect(mark).toHaveBeenCalledWith(READER_PREFETCH_READY_MARK, { detail: 0 }))
    expect(instances.every((image) => image.src.startsWith("http://127.0.0.1"))).toBe(true)
    expect(instances.every((image) => image.crossOrigin === "anonymous")).toBe(true)
    expect(instances[0]!.fetchPriority).toBe("high")

    view.rerender(<Fixture sessionId="reader-1" pages={pages.slice(1, 2)} />)
    await waitFor(() => expect(instances).toHaveLength(2))
    await waitFor(() => expect(mark).toHaveBeenCalledWith(READER_PREFETCH_READY_MARK, { detail: 1 }))
    expect(instances[0]!.src).toBe("")
    expect(instances).toHaveLength(2)
    view.rerender(<Fixture sessionId="reader-2" pages={[]} />)
    expect(instances.every((image) => image.src === "")).toBe(true)
  })

  it("[neoview.react.predecode-pixel-budget] admits only the nearest high-resolution pages", async () => {
    const instances: FakeImage[] = []
    vi.stubGlobal("Image", class extends FakeImage {
      constructor() {
        super()
        instances.push(this)
      }
    })
    vi.spyOn(performance, "mark").mockImplementation(() => ({}) as PerformanceMark)
    const pages = Array.from({ length: 4 }, (_, index) => ({ ...page(index), dimensions: { width: 4160, height: 6240 } }))
    render(<Fixture sessionId="reader-1" pages={pages} />)

    await waitFor(() => expect(instances).toHaveLength(1))
    await waitFor(() => expect(instances.map((image) => image.src)).toEqual([pages[0]!.assetUrl]))
  })

  it("[neoview.preload.cancel-session] releases speculative images without waiting for unmount", async () => {
    const instances: FakeImage[] = []
    vi.stubGlobal("Image", class extends FakeImage {
      constructor() {
        super()
        instances.push(this)
      }
    })
    let control: ReturnType<typeof useReaderImagePreloader> | undefined
    render(<Fixture sessionId="reader-1" pages={[page(1), page(2)]} onControl={(value) => { control = value }} />)
    await waitFor(() => expect(instances).toHaveLength(1))

    control!.cancel()

    expect(instances.every((image) => image.src === "")).toBe(true)
  })

  it("[neoview.react.predecode-cross-batch] keeps replacement batches behind an in-flight decode", async () => {
    const instances: BlockingImage[] = []
    vi.stubGlobal("Image", class extends BlockingImage {
      constructor() {
        super()
        instances.push(this)
      }
    })
    vi.spyOn(performance, "mark").mockImplementation(() => ({}) as PerformanceMark)
    const first = page(1)
    const second = page(2)
    const view = render(<Fixture sessionId="reader-1" pages={[first]} />)

    await waitFor(() => expect(instances[0]?.decode).toHaveBeenCalledOnce())
    view.rerender(<Fixture sessionId="reader-1" pages={[second]} />)
    await waitFor(() => expect(instances).toHaveLength(2))
    await new Promise((resolve) => setTimeout(resolve, 450))
    expect(instances[1]!.decode).not.toHaveBeenCalled()

    instances[0]!.finishDecode()
    await waitFor(() => expect(instances[1]!.decode).toHaveBeenCalledOnce())
    instances[1]!.finishDecode()
  })

  it("[neoview.preload.telemetry-react] reports generation-scoped lifecycle metrics without React state", async () => {
    vi.stubGlobal("Image", FakeImage)
    vi.spyOn(performance, "mark").mockImplementation(() => ({}) as PerformanceMark)
    const report = vi.fn()
    render(<TelemetryFixture page={page(1)} report={report} />)

    await waitFor(() => expect(report).toHaveBeenCalledOnce())
    expect(report.mock.calls[0]?.slice(0, 2)).toEqual(["reader-1", 9])
    expect(report.mock.calls[0]?.[2]).toEqual([
      expect.objectContaining({ pageId: "page-1", outcome: "started", metrics: { activeLeases: 1 } }),
      expect.objectContaining({
        pageId: "page-1",
        outcome: "ready",
        metrics: expect.objectContaining({ decodeMs: expect.any(Number), activeLeases: 1 }),
      }),
    ])
  })
})

function Fixture({ sessionId, pages, onControl }: { sessionId: string; pages: readonly ReaderPageDto[]; onControl?: (control: ReturnType<typeof useReaderImagePreloader>) => void }) {
  const control = useReaderImagePreloader(sessionId)
  useEffect(() => control.preload(pages), [control.preload, pages])
  useEffect(() => onControl?.(control), [control, onControl])
  return null
}

function TelemetryFixture({ page, report }: { page: ReaderPageDto; report: (sessionId: string, generation: number, events: readonly ReaderPreloadEventDto[]) => void }) {
  const control = useReaderImagePreloader("reader-1", report)
  useEffect(() => control.preload([page], 9), [control.preload, page])
  return null
}

class FakeImage {
  src = ""
  crossOrigin: string | null = null
  decoding: "async" | "sync" | "auto" = "auto"
  fetchPriority: "high" | "low" | "auto" = "auto"
  loading: "eager" | "lazy" = "eager"
  decode = vi.fn(async () => undefined)
}

class BlockingImage extends FakeImage {
  private finish!: () => void
  override decode = vi.fn(() => new Promise<void>((resolve) => { this.finish = resolve }))
  finishDecode() { this.finish() }
}

function page(index: number): ReaderPageDto {
  return {
    id: `page-${index}`,
    index,
    name: `${index + 1}.jpg`,
    mediaKind: "image",
    mimeType: "image/jpeg",
    contentVersion: "v1",
    assetUrl: `http://127.0.0.1:41000/reader/page-${index}`,
  }
}
