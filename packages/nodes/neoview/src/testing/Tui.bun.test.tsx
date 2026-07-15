/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { act } from "react"
import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import sharp from "sharp"
import type { HeadlessReaderSnapshot } from "../core.js"
import { createNeoviewTuiDefinition } from "../interaction.js"
import { NeoviewTui } from "../Tui.js"
import { createZipFixture } from "../../test/fixture-builders/create-zip-fixture.js"
import { createReaderHeadlessController } from "../platform.js"

test("[neoview.tui.reader] [neoview.tui.navigation] opens a persistent reader and navigates with shared controller methods", async () => {
  let current = 0
  let opens = 0
  let nextCalls = 0
  let pageStreamOpens = 0
  let pageStreamCloses = 0
  let disposed = 0
  const pageBytes = await sharp({
    create: { width: 4, height: 6, channels: 4, background: "#4c8f6b" },
  }).png().toBuffer()
  const port = {
    async open() { opens += 1; return snapshot(current = 0) },
    listPages: () => pageList,
    async next() { nextCalls += 1; return snapshot(current = Math.min(2, current + 1)) },
    async previous() { return snapshot(current = Math.max(0, current - 1)) },
    async goTo(index: number) { return snapshot(current = index) },
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
    await act(async () => waitUntil(
      () => pageStreamOpens >= 1 && pageStreamCloses === pageStreamOpens,
      () => `opens=${pageStreamOpens} closes=${pageStreamCloses}`,
    ))
    await screen.flush()
    expect(screen.captureCharFrame()).toContain("当前画面")
    await click("next")
    await screen.waitFor(() => nextCalls === 1)
    await screen.waitFor(() => screen.captureCharFrame().includes("2 / 3"))
    expect(screen.captureCharFrame()).toContain("002.png")
  } finally {
    await act(async () => screen.renderer.destroy())
  }
  expect(pageStreamOpens).toBeGreaterThanOrEqual(2)
  expect(pageStreamCloses).toBe(pageStreamOpens)
  expect(disposed).toBe(1)
})

test("[neoview.tui.image] renders a real directory page through the shared terminal image surface", async () => {
  const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-tui-"))
  const pageBytes = await sharp({
    create: { width: 8, height: 12, channels: 4, background: "#d45d4c" },
  }).png().toBuffer()
  await writeFile(join(root, "001.png"), pageBytes)
  try {
    await expectRealSourceRenders(root, "001.png")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("[neoview.tui.archive] renders a real CBZ page through the existing archive provider", async () => {
  const pageBytes = await sharp({
    create: { width: 8, height: 12, channels: 4, background: "#4f6fc4" },
  }).png().toBuffer()
  const fixture = await createZipFixture({
    name: "prototype.cbz",
    entries: [{ path: "pages/001.png", bytes: pageBytes, level: 6 }],
  })
  try {
    await expectRealSourceRenders(fixture.path, "001.png")
  } finally {
    await fixture.cleanup()
  }
})

async function expectRealSourceRenders(path: string, pageName: string): Promise<void> {
  const definition = createNeoviewTuiDefinition("zh")
  definition.schema.initialValues.path = path
  const screen = await testRender(
    <NeoviewTui
      definition={definition}
      language="zh"
      onExit={() => undefined}
      imageBackend="half-block"
      createController={() => createReaderHeadlessController({ progressStore: false })}
    />,
    { width: 132, height: 34, useMouse: true },
  )
  try {
    await act(async () => screen.renderOnce())
    const open = screen.renderer.root.findDescendantById("open")
    expect(open).toBeDefined()
    await act(async () => screen.mockMouse.click(open!.x + 1, open!.y + Math.max(0, Math.floor(open!.height / 2))))
    await act(async () => screen.flush())
    await act(async () => waitUntil(
      () => screen.captureCharFrame().includes(pageName),
      () => screen.captureCharFrame(),
      5_000,
    ))
    await act(async () => waitUntil(
      () => screen.captureCharFrame().includes("▀"),
      () => screen.captureCharFrame(),
      5_000,
    ))
    await screen.flush()
    expect(screen.captureCharFrame()).toContain("1 / 1")
  } finally {
    await act(async () => screen.renderer.destroy())
  }
}

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
