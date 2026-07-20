import { useEffect } from "react"
import { render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderPageDto, ReaderPreloadEventDto } from "../../adapters/reader-http-client"
import { READER_PREFETCH_READY_MARK, useReaderImagePreloader } from "./useReaderImagePreloader"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("useReaderImagePreloader", () => {
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
    const view = render(<Fixture sessionId="reader-1" pages={pages} onControl={(value) => { controls.push(value) }} />)

    await waitFor(() => expect(instances).toHaveLength(5))
    await waitFor(() => expect(mark).toHaveBeenCalledWith(READER_PREFETCH_READY_MARK, { detail: 4 }))
    expect(instances[0]!.src).toBe("")
    expect(instances.slice(1).every((image) => image.src.startsWith("http://127.0.0.1"))).toBe(true)

    view.rerender(<Fixture sessionId="reader-1" pages={pages} />)
    expect(instances).toHaveLength(5)
    view.rerender(<Fixture sessionId="reader-2" pages={[]} />)
    expect(instances.every((image) => image.src === "")).toBe(true)
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
    await waitFor(() => expect(instances).toHaveLength(2))

    control!.cancel()

    expect(instances.every((image) => image.src === "")).toBe(true)
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
  decoding: "async" | "sync" | "auto" = "auto"
  fetchPriority: "high" | "low" | "auto" = "auto"
  decode = vi.fn(async () => undefined)
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
