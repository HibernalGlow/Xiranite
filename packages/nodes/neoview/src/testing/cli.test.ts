import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { CliHost } from "@xiranite/cli-runtime"
import type {
  HeadlessPageStream,
  HeadlessReaderPageSnapshot,
  HeadlessReaderSnapshot,
  OpenHeadlessReaderInput,
  ReaderHeadlessController,
} from "../core.js"
import { runProgram } from "../cli.js"

describe("NeoView CLI", () => {
  it("[neoview.cli.inspect] prints sanitized JSON and clears environment password bytes", async () => {
    const output: unknown[] = []
    const opened: OpenHeadlessReaderInput[] = []
    let passwordReference: Uint8Array | undefined
    const reader = fakeReader({
      open: async (input) => {
        opened.push(input)
        passwordReference = input.archivePasswords?.[0]?.rawPassword
        return snapshot(0)
      },
    })
    await runProgram(
      ["inspect", "private/book.cbz", "--password-env", "BOOK_PASSWORD", "--json"],
      host(output, { BOOK_PASSWORD: "unique-secret-421" }),
      { createController: async () => reader },
    )
    const json = output.join("")
    expect(JSON.parse(json)).toMatchObject({ book: { displayName: "book.cbz", pageCount: 3 } })
    expect(json).not.toContain("private/book.cbz")
    expect(json).not.toContain("unique-secret-421")
    expect(opened[0]?.path.replace(/\\/g, "/")).toMatch(/private\/book\.cbz$/)
    expect([...passwordReference ?? []]).toEqual(new Array(17).fill(0))
    expect(reader[Symbol.asyncDispose]).toHaveBeenCalledTimes(1)
  })

  it("[neoview.cli.pages] lists a bounded page window", async () => {
    const output: unknown[] = []
    const reader = fakeReader()
    await runProgram(
      ["pages", "book.cbz", "--cursor", "1", "--limit", "1", "--json"],
      host(output),
      { createController: async () => reader },
    )
    expect(JSON.parse(output.join(""))).toMatchObject({
      cursor: 1,
      nextCursor: 2,
      total: 3,
      pages: [{ index: 1, name: "002.png" }],
    })
    expect(reader.listPages).toHaveBeenCalledWith(1, 1)
  })

  it("[neoview.cli.frame] opens directly at the requested frame", async () => {
    const output: unknown[] = []
    const reader = fakeReader({ open: async () => snapshot(2) })
    await runProgram(["frame", "book.cbz", "--index", "2", "--json"], host(output), {
      createController: async () => reader,
    })
    expect(JSON.parse(output.join(""))).toMatchObject({ frame: { anchorPageIndex: 2 }, visiblePages: [{ index: 2 }] })
  })

  it("[neoview.cli.extract-page] writes only original page bytes to stdout", async () => {
    const output: unknown[] = []
    const close = vi.fn(async () => undefined)
    const reader = fakeReader({
      openPageStream: async () => ({
        page: pages[1]!,
        byteLength: 4,
        contentType: "image/png",
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue(Uint8Array.of(0x89, 0x50))
            controller.enqueue(Uint8Array.of(0x4e, 0x47))
            controller.close()
          },
        }),
        close,
        [Symbol.asyncDispose]: close,
      }),
    })
    await runProgram(["extract-page", "book.cbz", "--index", "1", "--output", "-"], host(output), {
      createController: async () => reader,
    })
    expect(Buffer.concat(output.map((chunk) => Buffer.from(chunk as Uint8Array)))).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    expect(close).toHaveBeenCalledTimes(1)
  })

  it("rejects plaintext password argv and malformed commands", async () => {
    const reader = fakeReader()
    await expect(runProgram(["inspect", "book.cbz", "--password", "secret"], host([]), {
      createController: async () => reader,
    })).rejects.toThrow("Unknown NeoView option")
    expect(reader.open).not.toHaveBeenCalled()
  })

  it("clears password bytes when controller creation fails", async () => {
    const originalEncode = TextEncoder.prototype.encode
    let encoded: Uint8Array | undefined
    const spy = vi.spyOn(TextEncoder.prototype, "encode").mockImplementation(function (value?: string) {
      encoded = originalEncode.call(this, value)
      return encoded
    })
    try {
      await expect(runProgram(
        ["inspect", "book.cbz", "--password-env", "BOOK_PASSWORD"],
        host([], { BOOK_PASSWORD: "ephemeral-secret" }),
        { createController: async () => { throw new Error("platform unavailable") } },
      )).rejects.toThrow("platform unavailable")
      expect([...encoded ?? []]).toEqual(new Array(16).fill(0))
    } finally {
      spy.mockRestore()
    }
  })

  it("[neoview.cli.reader-e2e] opens, probes and streams a real image through platform composition", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-cli-"))
    const path = join(directory, "page.png")
    const bytes = pngHeader(37, 53)
    await writeFile(path, bytes)
    try {
      const metadataOutput: unknown[] = []
      await runProgram(["inspect", path, "--json"], host(metadataOutput))
      expect(JSON.parse(metadataOutput.join(""))).toMatchObject({
        book: { displayName: "page.png", pageCount: 1 },
        visiblePages: [{ index: 0, dimensions: { width: 37, height: 53 } }],
      })

      const binaryOutput: unknown[] = []
      await runProgram(["extract-page", path, "--index", "0", "--output", "-"], host(binaryOutput))
      expect(Buffer.concat(binaryOutput.map((chunk) => Buffer.from(chunk as Uint8Array)))).toEqual(Buffer.from(bytes))
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("[neoview.settings.runtime-cli] applies the shared TOML defaults in the real headless composition", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-cli-config-"))
    const bookPath = join(directory, "book")
    const configPath = join(directory, "xiranite.config.toml")
    await mkdir(bookPath)
    await Promise.all(Array.from({ length: 4 }, (_, index) => writeFile(
      join(bookPath, `${String(index + 1).padStart(3, "0")}.png`),
      pngHeader(40 + index, 60 + index),
    )))
    await writeFile(configPath, [
      "[nodes.neoview]",
      "schema_version = 1",
      "[nodes.neoview.reader]",
      "reading_direction = \"right-to-left\"",
      "double_page_view = true",
      "",
    ].join("\n"), "utf8")
    try {
      const output: unknown[] = []
      await runProgram(["inspect", bookPath, "--index", "1", "--config", configPath, "--json"], host(output))
      expect(JSON.parse(output.join(""))).toMatchObject({
        frame: { direction: "right-to-left", layout: { pageMode: "double" } },
        visiblePages: [{ index: 2 }, { index: 1 }],
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("[neoview.settings.inspect] previews legacy settings without writing TOML or exposing secrets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-settings-inspect-"))
    const inputPath = join(directory, "backup.json")
    await writeFile(inputPath, JSON.stringify({
      version: "2.0.0",
      backupType: "manual",
      nativeSettings: { system: { language: "zh-CN" }, view: { defaultZoomMode: "fit" } },
      rawLocalStorage: { "neoview-gist-sync": JSON.stringify({ token: "must-not-leak" }) },
    }))
    try {
      const output: unknown[] = []
      await runProgram(["settings-inspect", inputPath, "--json"], host(output))
      const text = output.join("")
      expect(text).not.toContain("must-not-leak")
      expect(JSON.parse(text)).toMatchObject({
        report: { sourceKind: "backup", summary: { "rejected-sensitive": 1 } },
        configPatch: { schema_version: 1, system: { language: "zh-CN" } },
      })
      await expect(readFile(join(directory, "xiranite.config.toml"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("[neoview.settings.import] requires confirmation and idempotently writes [nodes.neoview]", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-settings-import-"))
    const inputPath = join(directory, "settings.json")
    const configPath = join(directory, "xiranite.config.toml")
    await writeFile(inputPath, JSON.stringify({
      format: "NeoView/1.0",
      config: {
        system: { language: "en", thumbnailDirectory: "D:/thumbs" },
        view: { defaultZoomMode: "fitWidth" },
        book: { readingDirection: "right-to-left", doublePageView: true },
      },
    }))
    try {
      await expect(runProgram(["settings-import", inputPath, "--config", configPath], host([])))
        .rejects.toThrow("requires --yes")

      const firstOutput: unknown[] = []
      await runProgram([
        "settings-import", inputPath, "--config", configPath, "--strategy", "merge", "--modules", "native-settings", "--yes", "--json",
      ], host(firstOutput))
      expect(JSON.parse(firstOutput.join(""))).toMatchObject({ changed: true, strategy: "merge" })
      const toml = await readFile(configPath, "utf8")
      expect(toml).toContain("[nodes.neoview.reader]")
      expect(toml).toContain('reading_direction = "right-to-left"')

      const secondOutput: unknown[] = []
      await runProgram([
        "settings-import", inputPath, "--config", configPath, "--strategy", "merge", "--modules", "native-settings", "--yes", "--json",
      ], host(secondOutput))
      expect(JSON.parse(secondOutput.join(""))).toMatchObject({ changed: false })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

const pages: readonly HeadlessReaderPageSnapshot[] = [0, 1, 2].map((index) => ({
  id: `p${index}`,
  index,
  name: `${String(index + 1).padStart(3, "0")}.png`,
  mediaKind: "image",
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
    visiblePages: [pages[index]!],
  }
}

function fakeReader(overrides: Partial<{
  open: (input: OpenHeadlessReaderInput) => Promise<HeadlessReaderSnapshot>
  openPageStream: (index: number) => Promise<HeadlessPageStream>
}> = {}): ReaderHeadlessController {
  let current = 0
  const dispose = vi.fn(async () => undefined)
  return {
    isOpen: true,
    open: vi.fn(overrides.open ?? (async (input) => {
      current = input.initialPage ?? 0
      return snapshot(current)
    })),
    inspect: vi.fn(() => snapshot(current)),
    listPages: vi.fn((cursor = 0, limit = 100) => pages.slice(cursor, cursor + limit)),
    next: vi.fn(async () => snapshot(current = Math.min(2, current + 1))),
    previous: vi.fn(async () => snapshot(current = Math.max(0, current - 1))),
    goTo: vi.fn(async (index: number) => snapshot(current = index)),
    openPageStream: vi.fn(overrides.openPageStream ?? (async () => { throw new Error("not configured") })),
    closeBook: vi.fn(async () => undefined),
    [Symbol.asyncDispose]: dispose,
  } as unknown as ReaderHeadlessController
}

function host(stdout: unknown[], env: Record<string, string | undefined> = {}): CliHost {
  return {
    cwd: process.cwd(),
    env,
    stdin: { isTTY: true },
    stdout: { isTTY: false, write: (chunk: unknown) => { stdout.push(chunk); return true } },
    stderr: { isTTY: false, write: () => true },
  } as unknown as CliHost
}

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  for (let offset = 0; offset < 4; offset += 1) {
    bytes[16 + offset] = (width >>> ((3 - offset) * 8)) & 0xff
    bytes[20 + offset] = (height >>> ((3 - offset) * 8)) & 0xff
  }
  return bytes
}
