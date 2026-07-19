import { describe, expect, it } from "vitest"

import type { ReaderPage } from "../../domain/page/page.js"
import { normalizeReaderPageOrder, orderReaderPages } from "./ReaderPageOrder.js"

describe("ReaderPageOrder", () => {
  it("orders by all legacy fields without cloning page or content identities", () => {
    const pages = [
      page(0, "page10.jpg", 10, 30, "image"),
      page(1, "clip.mp4", 30, 10, "video"),
      page(2, "page2.jpg", 20, 20, "image"),
    ]

    const byName = orderReaderPages(pages, { sortMode: "fileName", mediaPriority: "none" })
    expect(byName.map((value) => value.name)).toEqual(["clip.mp4", "page2.jpg", "page10.jpg"])
    expect(byName[2]).toBe(pages[0])
    expect(byName[2]!.content).toBe(pages[0]!.content)
    expect(orderReaderPages(pages, { sortMode: "fileSizeDescending", mediaPriority: "none" }).map((value) => value.byteLength)).toEqual([30, 20, 10])
    expect(orderReaderPages(pages, { sortMode: "timeStamp", mediaPriority: "none" }).map((value) => value.timestamps!.modifiedAtMs)).toEqual([10, 20, 30])
    expect(orderReaderPages(pages, { sortMode: "entryDescending", mediaPriority: "none" }).map((value) => value.index)).toEqual([2, 1, 0])
  })

  it("applies stable media grouping after the selected order", () => {
    const pages = [
      page(0, "3.jpg", 3, 3, "image"),
      page(1, "2.mp4", 2, 2, "video"),
      page(2, "1.jpg", 1, 1, "image"),
      page(3, "4.mp4", 4, 4, "video"),
    ]
    expect(orderReaderPages(pages, { sortMode: "fileName", mediaPriority: "videoFirst" }).map((value) => value.name)).toEqual(["2.mp4", "4.mp4", "1.jpg", "3.jpg"])
    expect(orderReaderPages(pages, { sortMode: "fileName", mediaPriority: "imageFirst" }).map((value) => value.name)).toEqual(["1.jpg", "3.jpg", "2.mp4", "4.mp4"])
  })

  it("keeps a stable random permutation for a session seed", () => {
    const pages = Array.from({ length: 20 }, (_, index) => page(index, `${index}.jpg`, index, index, "image"))
    const order = normalizeReaderPageOrder({ sortMode: "random", randomSeed: "session-seed" })
    const first = orderReaderPages(pages, order).map((value) => value.id)
    const second = orderReaderPages([...pages].reverse(), order).map((value) => value.id)
    expect(second).toEqual(first)
    expect(first).not.toEqual(pages.map((value) => value.id))
  })
})

function page(index: number, name: string, byteLength: number, modifiedAtMs: number, mediaKind: "image" | "video"): ReaderPage {
  const content = { load: async () => ({ stream: new ReadableStream(), byteLength, contentType: "application/octet-stream" }) }
  return {
    id: `page-${index}`,
    index,
    name,
    sourcePath: name,
    mediaKind,
    byteLength,
    timestamps: { source: "filesystem", modifiedAtMs },
    contentVersion: "v1",
    content,
  }
}
