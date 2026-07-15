import { useEffect } from "react"
import { render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderPageDto } from "../../adapters/reader-http-client"
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
    const view = render(<Fixture sessionId="reader-1" pages={pages} />)

    await waitFor(() => expect(instances).toHaveLength(5))
    await waitFor(() => expect(mark).toHaveBeenCalledWith(READER_PREFETCH_READY_MARK, { detail: 4 }))
    expect(instances[0]!.src).toBe("")
    expect(instances.slice(1).every((image) => image.src.startsWith("http://127.0.0.1"))).toBe(true)

    view.rerender(<Fixture sessionId="reader-1" pages={pages} />)
    expect(instances).toHaveLength(5)
    view.rerender(<Fixture sessionId="reader-2" pages={[]} />)
    expect(instances.every((image) => image.src === "")).toBe(true)
  })
})

function Fixture({ sessionId, pages }: { sessionId: string; pages: readonly ReaderPageDto[] }) {
  const prefetch = useReaderImagePreloader(sessionId)
  useEffect(() => prefetch(pages), [pages, prefetch])
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
