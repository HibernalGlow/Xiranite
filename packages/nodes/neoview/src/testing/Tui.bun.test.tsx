/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { act } from "react"
import { expect, test } from "bun:test"
import sharp from "sharp"
import type { HeadlessReaderSnapshot } from "../core.js"
import { createNeoviewTuiDefinition } from "../interaction.js"
import { createNeoviewTuiScreen } from "../Tui.js"
import { ResourceSchedulerService } from "@xiranite/services"

async function verifyPersistentReaderLifecycle() {
  let current = 0
  let pageOrder: HeadlessReaderSnapshot["pageOrder"] = { sortMode: "fileName", mediaPriority: "none" }
  let opens = 0
  let nextCalls = 0
  let previousCalls = 0
  let nextBookCalls = 0
  let previousBookCalls = 0
  let pageOrderUpdates = 0
  let pageStreamOpens = 0
  let pageStreamCloses = 0
  let disposed = 0
  const pageBytes = await sharp({
    create: { width: 4, height: 6, channels: 4, background: "#4c8f6b" },
  }).png().toBuffer()
  const port = {
    async open() { opens += 1; return snapshot(current = 0, pageOrder) },
    listPages: async () => pageList,
    async next() { nextCalls += 1; return snapshot(current = Math.min(2, current + 1), pageOrder) },
    async previous() { previousCalls += 1; return snapshot(current = Math.max(0, current - 1), pageOrder) },
    async openAdjacent(direction: "next" | "previous") {
      if (direction === "next") {
        nextBookCalls += 1
        return snapshot(current = 2, pageOrder)
      }
      previousBookCalls += 1
      return snapshot(current = 0, pageOrder)
    },
    async goTo(index: number) { return snapshot(current = index, pageOrder) },
    async updatePageOrder(patch: Partial<HeadlessReaderSnapshot["pageOrder"]>) {
      pageOrderUpdates += 1
      pageOrder = { ...pageOrder, ...patch }
      return snapshot(current, pageOrder)
    },
    async openPageStream() {
      pageStreamOpens += 1
      let closed = false
      const close = async () => {
        if (closed) return
        closed = true
        pageStreamCloses += 1
      }
      return {
        page: pageList[current]!,
        stream: new Blob([pageBytes]).stream() as ReadableStream<Uint8Array>,
        byteLength: pageBytes.length,
        contentType: "image/png",
        close,
        async [Symbol.asyncDispose]() { await close() },
      }
    },
    async closeBook() { current = 0 },
    async [Symbol.asyncDispose]() { disposed += 1 },
  }
  const definition = createNeoviewTuiDefinition("zh")
  definition.schema.initialValues.path = "D:/books/book.cbz"
  const resources = new ResourceSchedulerService()
  const ConnectedNeoviewTui = createNeoviewTuiScreen(async () => port)
  let screen: Awaited<ReturnType<typeof testRender>>
  await act(async () => {
    screen = await testRender(
      <ConnectedNeoviewTui definition={definition} language="zh" onExit={() => undefined} resourceScheduler={resources} />,
      { width: 132, height: 34, useMouse: true },
    )
  })
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
    expect(screen.captureCharFrame()).toContain("译名 · 压缩包 · 1 / 3 · 33.3%")
    expect(screen.captureCharFrame()).toContain("文件系统")
    await act(async () => waitUntil(
      () => pageStreamOpens >= 1 && pageStreamCloses === pageStreamOpens,
      () => `opens=${pageStreamOpens} closes=${pageStreamCloses}`,
    ))
    await screen.flush()
    expect(screen.captureCharFrame()).toContain("当前画面")
    expect(screen.captureCharFrame()).toContain("S:name")
    expect(screen.captureCharFrame()).toContain("M:none")
    await click("page-sort")
    await screen.waitFor(() => pageOrderUpdates === 1)
    await screen.waitFor(() => screen.captureCharFrame().includes("name desc"))
    expect(screen.captureCharFrame()).toContain("001.png")
    await click("media-priority")
    await screen.waitFor(() => pageOrderUpdates === 2)
    await screen.waitFor(() => screen.captureCharFrame().includes("video first"))
    await click("next")
    await screen.waitFor(() => nextCalls === 1)
    await screen.waitFor(() => screen.captureCharFrame().includes("2 / 3"))
    expect(screen.captureCharFrame()).toContain("002.png")
    await act(async () => waitUntil(
      () => pageStreamCloses === pageStreamOpens,
      () => `opens=${pageStreamOpens} closes=${pageStreamCloses}`,
    ))
    const streamsAfterForward = pageStreamOpens
    await click("previous")
    await screen.waitFor(() => previousCalls === 1)
    await screen.waitFor(() => screen.captureCharFrame().includes("1 / 3"))
    expect(pageStreamOpens).toBe(streamsAfterForward)

    await click("next-book")
    await screen.waitFor(() => nextBookCalls === 1)
    await screen.waitFor(() => screen.captureCharFrame().includes("3 / 3"))
    expect(screen.captureCharFrame()).toContain("003.png")

    await click("previous-book")
    await screen.waitFor(() => previousBookCalls === 1)
    await screen.waitFor(() => screen.captureCharFrame().includes("1 / 3"))

    await click("close")
    await click("open")
    await screen.waitFor(() => opens === 2)
    await act(async () => waitUntil(
      () => pageStreamOpens > streamsAfterForward,
      () => `opens=${pageStreamOpens} beforeClose=${streamsAfterForward}`,
    ))
    await act(async () => waitUntil(
      () => pageStreamCloses === pageStreamOpens,
      () => `opens=${pageStreamOpens} closes=${pageStreamCloses}`,
    ))
    await act(async () => screen.flush())
  } finally {
    await act(async () => screen.renderer.destroy())
  }
  expect(pageStreamOpens).toBeGreaterThanOrEqual(2)
  expect(pageStreamCloses).toBe(pageStreamOpens)
  expect(disposed).toBe(1)
  const resourceSnapshot = resources.snapshot()
  expect(resourceSnapshot).toMatchObject({
    cpu: { active: 0, queued: 0, queuedByPriority: { interactive: 0, view: 0, ahead: 0, background: 0 } },
    io: { active: 0, queued: 0, queuedByPriority: { interactive: 0, view: 0, ahead: 0, background: 0 } },
    gpu: { active: 0, queued: 0, queuedByPriority: { interactive: 0, view: 0, ahead: 0, background: 0 } },
  })
  for (const pool of Object.values(resourceSnapshot)) expect(pool.released).toBe(pool.granted)
}

test(
  "[neoview.tui.reader] [neoview.tui.navigation] [neoview.tui.decode-cache] [neoview.tui.connect] opens a persistent reader through an injected async controller",
  verifyPersistentReaderLifecycle,
)

async function waitUntil(predicate: () => boolean, describe: () => string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for the TUI condition: ${describe()}`)
    await Bun.sleep(10)
  }
}

const pageList = [0, 1, 2].map((index) => ({
  id: `p${index}`,
  index,
  name: `${String(index + 1).padStart(3, "0")}.png`,
  mediaKind: "image" as const,
  mimeType: "image/png",
  byteLength: 4,
  contentVersion: `v${index}`,
  timestamps: { source: "filesystem" as const, createdAtMs: 1_700_000_000_000, modifiedAtMs: 1_700_000_100_000, accessedAtMs: 1_700_000_200_000 },
}))

function snapshot(index: number, pageOrder: HeadlessReaderSnapshot["pageOrder"] = { sortMode: "fileName", mediaPriority: "none" }): HeadlessReaderSnapshot {
  return {
    book: { displayName: "book.cbz", translatedTitle: "译名", sourceKind: "archive", pageCount: 3 },
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
    pageOrder,
  }
}
