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
    [Symbol.asyncDispose]: vi.fn(async () => undefined),
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
