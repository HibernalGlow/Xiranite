import { describe, expect, it, vi } from "vitest"
import type { CliHost } from "@xiranite/cli-runtime"

import { parseReaderUiConnectionArgs, runProgram, type CliReaderController } from "../cli.js"
import type { HeadlessReaderSnapshot } from "../application/headless/ReaderHeadlessController.js"

describe("NeoView CLI remote Reader", () => {
  it("[neoview.tui.connect] separates connection credentials from OpenTUI flags", () => {
    expect(parseReaderUiConnectionArgs([
      "--lang", "en", "--connect", "http://127.0.0.1:41000", "--theme", "nord", "--token-env", "READER_TOKEN",
    ])).toEqual({
      terminalArgs: ["--lang", "en", "--theme", "nord"],
      credentialArgs: [],
      baseUrl: "http://127.0.0.1:41000",
      tokenVariable: "READER_TOKEN",
    })
    expect(() => parseReaderUiConnectionArgs(["--token-env", "TOKEN"])).toThrow("requires --connect")
    expect(() => parseReaderUiConnectionArgs(["--connect", "one", "--connect", "two"])).toThrow("only be specified once")
  })

  it("[neoview.tui.archive-password-env] separates archive credential references from renderer flags", () => {
    expect(parseReaderUiConnectionArgs([
      "--password-env", "BOOK_PASSWORD",
      "--archive-password-env", "inner.cb7=INNER_PASSWORD",
      "--lang", "zh",
    ])).toEqual({
      terminalArgs: ["--lang", "zh"],
      credentialArgs: [
        "--password-env", "BOOK_PASSWORD",
        "--archive-password-env", "inner.cb7=INNER_PASSWORD",
      ],
      baseUrl: undefined,
      tokenVariable: undefined,
    })
  })

  it("[neoview.cli.connect] selects the remote adapter and reads its token only from the environment", async () => {
    const output: unknown[] = []
    const controller = fakeRemoteReader()
    const createRemoteController = vi.fn(async () => controller)
    const createController = vi.fn(async () => { throw new Error("local controller must stay lazy") })
    await runProgram(
      ["pages", "book.cbz", "--connect", "http://127.0.0.1:41000", "--cursor", "0", "--limit", "1", "--json"],
      host(output, { XIRANITE_BACKEND_TOKEN: "runtime-token" }),
      { createController, createRemoteController },
    )
    expect(createRemoteController).toHaveBeenCalledWith({ baseUrl: "http://127.0.0.1:41000", token: "runtime-token" })
    expect(createController).not.toHaveBeenCalled()
    expect(JSON.parse(output.join(""))).toMatchObject({ total: 1, pages: [{ name: "1.jpg" }] })
    expect(controller[Symbol.asyncDispose]).toHaveBeenCalledOnce()
  })

  it("[neoview.cli.connect-security] rejects missing tokens and remote/local configuration mixing", async () => {
    const dependencies = { createController: vi.fn(async () => fakeRemoteReader()), createRemoteController: vi.fn(async () => fakeRemoteReader()) }
    await expect(runProgram(
      ["inspect", "book.cbz", "--connect", "http://127.0.0.1:41000"],
      host([]),
      dependencies,
    )).rejects.toThrow("XIRANITE_BACKEND_TOKEN")
    await expect(runProgram(
      ["inspect", "book.cbz", "--connect", "http://127.0.0.1:41000", "--config", "xiranite.config.toml"],
      host([], { XIRANITE_BACKEND_TOKEN: "token" }),
      dependencies,
    )).rejects.toThrow("cannot be combined")
    expect(dependencies.createRemoteController).not.toHaveBeenCalled()
  })

  it("[neoview.diagnostics.cli-connect] reports the running backend without constructing local diagnostics resources", async () => {
    const output: unknown[] = []
    const fetchRemoteDiagnostics = vi.fn(async () => diagnosticsSnapshot())
    const createDiagnosticsService = vi.fn(async () => { throw new Error("local diagnostics must stay lazy") })
    await runProgram(
      ["diagnostics", "--connect", "http://127.0.0.1:41000", "--json"],
      host(output, { XIRANITE_BACKEND_TOKEN: "runtime-token" }),
      { createController: async () => fakeRemoteReader(), fetchRemoteDiagnostics, createDiagnosticsService },
    )
    expect(fetchRemoteDiagnostics).toHaveBeenCalledWith({ baseUrl: "http://127.0.0.1:41000", token: "runtime-token" })
    expect(createDiagnosticsService).not.toHaveBeenCalled()
    expect(JSON.parse(output.join(""))).toMatchObject({ reader: { activeSessions: 3 }, process: { rssBytes: 8 } })
  })

  it("[neoview.progressive-upscale.cli-connect] exposes structured remote preload start and text status", async () => {
    const jsonOutput: unknown[] = []
    const started = fakeRemoteReader()
    await runProgram(
      ["upscale-preload-start", "book.cbz", "--connect", "http://127.0.0.1:41000", "--mode", "progressive", "--json"],
      host(jsonOutput, { XIRANITE_BACKEND_TOKEN: "runtime-token" }),
      { createController: async () => { throw new Error("local must stay lazy") }, createRemoteController: async () => started },
    )
    expect(started.startUpscalePreload).toHaveBeenCalledWith("progressive")
    expect(JSON.parse(jsonOutput.join(""))).toMatchObject({ snapshots: [{ mode: "progressive", state: "running", progress: 0.25 }] })
    expect(started[Symbol.asyncDispose]).toHaveBeenCalledOnce()

    const textOutput: unknown[] = []
    const status = fakeRemoteReader()
    await runProgram(
      ["upscale-preload-status", "book.cbz", "--connect", "http://127.0.0.1:41000"],
      host(textOutput, { XIRANITE_BACKEND_TOKEN: "runtime-token" }),
      { createController: async () => { throw new Error("local must stay lazy") }, createRemoteController: async () => status },
    )
    expect(textOutput.join("")).toContain("nearby: running 1/4 (25%) failed=0 cancelled=0")
    expect(status[Symbol.asyncDispose]).toHaveBeenCalledOnce()
  })

  it("[neoview.progressive-upscale.cli-mode] validates explicit modes and transport capability", async () => {
    const dependencies = { createController: vi.fn(async () => fakeRemoteReader()) }
    await expect(runProgram(
      ["upscale-preload-retry", "book.cbz", "--mode", "invalid"],
      host([]),
      dependencies,
    )).rejects.toThrow("--mode must be nearby or progressive")
    const local = fakeRemoteReader()
    delete local.pauseUpscalePreload
    await expect(runProgram(
      ["upscale-preload-pause", "book.cbz"],
      host([]),
      { createController: async () => local },
    )).rejects.toThrow("unavailable for this transport")
    expect(local[Symbol.asyncDispose]).toHaveBeenCalledOnce()
  })

  it("[neoview.super-resolution.cache-controls-cli] maintains only the connected backend cache with explicit confirmation", async () => {
    const output: unknown[] = []
    const controller = fakeRemoteReader()
    const dependencies = {
      createController: vi.fn(async () => { throw new Error("local must stay lazy") }),
      createRemoteController: vi.fn(async () => controller),
    }
    await runProgram(
      ["upscale-cache-stats", "book.cbz", "--connect", "http://127.0.0.1:41000", "--json"],
      host(output, { XIRANITE_BACKEND_TOKEN: "runtime-token" }),
      dependencies,
    )
    expect(JSON.parse(output.join(""))).toMatchObject({ entries: 3, bytes: 300, maxBytes: 1024 })
    expect(controller.getUpscaleArtifactCache).toHaveBeenCalledOnce()
    await expect(runProgram(
      ["upscale-cache-cleanup", "book.cbz", "--connect", "http://127.0.0.1:41000", "--kind", "book"],
      host([], { XIRANITE_BACKEND_TOKEN: "runtime-token" }),
      dependencies,
    )).rejects.toThrow("requires --yes")
    await runProgram(
      ["upscale-cache-cleanup", "book.cbz", "--connect", "http://127.0.0.1:41000", "--kind", "book", "--yes"],
      host([], { XIRANITE_BACKEND_TOKEN: "runtime-token" }),
      dependencies,
    )
    expect(controller.cleanupUpscaleArtifactCache).toHaveBeenCalledWith("book")
    await expect(runProgram(
      ["upscale-cache-stats", "book.cbz"], host([]), dependencies,
    )).rejects.toThrow("requires --connect")
    await expect(runProgram(
      ["upscale-cache-cleanup", "book.cbz", "--connect", "http://127.0.0.1:41000", "--kind", "invalid", "--yes"],
      host([], { XIRANITE_BACKEND_TOKEN: "runtime-token" }),
      dependencies,
    )).rejects.toThrow("--kind must be age, book or all")
    expect(dependencies.createController).not.toHaveBeenCalled()
    expect(dependencies.createRemoteController).toHaveBeenCalledTimes(2)
    expect(controller[Symbol.asyncDispose]).toHaveBeenCalledTimes(2)
  })

  it("[neoview.super-resolution.cache-controls.tui.launch] requires a connected backend before loading OpenTUI", async () => {
    const interactive = host([])
    ;(interactive.stdin as { isTTY: boolean }).isTTY = true
    ;(interactive.stdout as { isTTY: boolean }).isTTY = true
    await expect(runProgram(["upscale-cache-ui"], interactive, {
      createController: vi.fn(async () => fakeRemoteReader()),
    })).rejects.toThrow("requires --connect")
  })
})

function fakeRemoteReader(): CliReaderController {
  const snapshot: HeadlessReaderSnapshot = {
    book: { displayName: "book.cbz", pageCount: 1 },
    frame: {
      generation: 0,
      anchorPageIndex: 0,
      direction: "left-to-right",
      layout: { pageMode: "single", widePageMode: "single", firstPageMode: "normal" },
      pages: [{ pageId: "page-1", pageIndex: 0, role: "primary" }],
      atStart: true,
      atEnd: true,
    },
    visiblePages: [{ id: "page-1", index: 0, name: "1.jpg", mediaKind: "image", contentVersion: "v1" }],
  }
  return {
    open: vi.fn(async () => snapshot),
    listPages: vi.fn(async () => snapshot.visiblePages),
    openPageStream: vi.fn(async () => { throw new Error("not used") }),
    getUpscalePreload: vi.fn(async () => [preloadSnapshot("nearby")]),
    startUpscalePreload: vi.fn(async (mode) => [preloadSnapshot(mode)]),
    pauseUpscalePreload: vi.fn(async () => [preloadSnapshot("nearby")]),
    retryUpscalePreload: vi.fn(async (mode) => [preloadSnapshot(mode)]),
    getUpscaleArtifactCache: vi.fn(async () => artifactCacheSnapshot()),
    cleanupUpscaleArtifactCache: vi.fn(async (kind) => ({
      ...artifactCacheSnapshot(), reason: kind === "book" ? "book" as const : "explicit" as const, removedEntries: 2, removedBytes: 20,
    })),
    [Symbol.asyncDispose]: vi.fn(async () => undefined),
  }
}

function artifactCacheSnapshot() {
  return {
    entries: 3, bytes: 300, maxBytes: 1_024, maxEntryBytes: 512, activeLeases: 0,
    hits: 2, misses: 1, writes: 3, rejectedWrites: 0, evictions: 0, integrityFailures: 0,
  }
}

function preloadSnapshot(mode: "nearby" | "progressive") {
  return {
    contextId: "reader:1:upscale",
    generation: 1,
    mode,
    state: "running" as const,
    planned: 4,
    settled: 1,
    failed: 0,
    cancelled: 0,
    pending: 3,
    progress: 0.25,
    startedAt: 10,
    updatedAt: 20,
  }
}

function host(output: unknown[], env: Record<string, string> = {}): CliHost {
  return {
    cwd: "D:/workspace",
    env,
    stdin: { isTTY: false, read: async () => null },
    stdout: { isTTY: false, write: (value: unknown) => { output.push(value); return true } },
    stderr: { isTTY: false, write: (value: unknown) => { output.push(value); return true } },
    exitCode: 0,
  } as unknown as CliHost
}

function diagnosticsSnapshot() {
  return {
    schemaVersion: 1 as const,
    sampledAtMs: 10,
    uptimeSeconds: 5,
    process: { rssBytes: 8, heapTotalBytes: 7, heapUsedBytes: 6, externalBytes: 5, arrayBuffersBytes: 4, cpuUserMicros: 3, cpuSystemMicros: 2 },
    reader: { activeSessions: 3 },
    assets: { activeTransformFlights: 0, presentation: null, thumbnails: null },
    presentationDiskCache: { enabled: false as const },
    solidArchiveCache: { entries: 0, retainedBytes: 0, maxBytes: 0 },
    scheduler: null,
  }
}
