/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { act } from "react"
import { expect, test } from "bun:test"
import type { HeadlessReaderSnapshot } from "../core.js"
import { createNeoviewTuiDefinition } from "../interaction.js"
import { NeoviewTui } from "../Tui.js"

test("[neoview.tui.reader] [neoview.tui.navigation] opens a persistent reader and navigates with shared controller methods", async () => {
  let current = 0
  let opens = 0
  let nextCalls = 0
  let disposed = 0
  const port = {
    async open() { opens += 1; return snapshot(current = 0) },
    listPages: () => pageList,
    async next() { nextCalls += 1; return snapshot(current = Math.min(2, current + 1)) },
    async previous() { return snapshot(current = Math.max(0, current - 1)) },
    async goTo(index: number) { return snapshot(current = index) },
    async openPageStream() { throw new Error("not used") },
    async closeBook() { current = 0 },
    async [Symbol.asyncDispose]() { disposed += 1 },
  }
  const definition = createNeoviewTuiDefinition("zh")
  definition.schema.initialValues.path = "D:/books/book.cbz"
  const screen = await testRender(
    <NeoviewTui definition={definition} language="zh" onExit={() => undefined} createController={async () => port} />,
    { width: 132, height: 34, useMouse: true },
  )
  const click = async (id: string) => {
    const target = screen.renderer.root.findDescendantById(id)
    expect(target).toBeDefined()
    await act(async () => screen.mockMouse.click(target!.x + 1, target!.y + Math.max(0, Math.floor(target!.height / 2))))
    await act(async () => screen.flush())
  }
  try {
    await act(async () => screen.renderOnce())
    expect(screen.captureCharFrame()).toContain("NEOVIEW // READER")
    await click("open")
    await screen.waitFor(() => opens === 1)
    await screen.waitFor(() => screen.captureCharFrame().includes("001.png"))
    expect(screen.captureCharFrame()).toContain("页面元数据")
    await click("next")
    await screen.waitFor(() => nextCalls === 1)
    await screen.waitFor(() => screen.captureCharFrame().includes("2 / 3"))
    expect(screen.captureCharFrame()).toContain("002.png")
  } finally {
    await act(async () => screen.renderer.destroy())
  }
  expect(disposed).toBe(1)
})

const pageList = [0, 1, 2].map((index) => ({
  id: `p${index}`,
  index,
  name: `${String(index + 1).padStart(3, "0")}.png`,
  mediaKind: "image" as const,
  mimeType: "image/png",
  byteLength: 4,
  contentVersion: `v${index}`,
}))

function snapshot(index: number): HeadlessReaderSnapshot {
  return {
    book: { displayName: "book.cbz", pageCount: 3 },
    frame: {
      generation: index,
      anchorPageIndex: index,
      direction: "left-to-right",
      layout: { pageMode: "single", panorama: false, singleFirstPage: true, singleLastPage: true, treatWidePageAsSingle: true },
      pages: [{ pageId: `p${index}`, pageIndex: index, side: "single" }],
      pageCount: 3,
      atStart: index === 0,
      atEnd: index === 2,
    },
    visiblePages: [pageList[index]!],
  }
}
