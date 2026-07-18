import { describe, expect, it, vi } from "vitest"

import { ReaderFileOperationService } from "../../application/files/ReaderFileOperationService.js"
import { ReaderFileOperationHttpController } from "./ReaderFileOperationHttpController.js"
import { createReaderDirectorySelectionBatchSource, ReaderDirectorySelectionStaleError } from "../../application/browser/ReaderDirectorySelection.js"

describe("ReaderFileOperationHttpController", () => {
  it("[neoview.file-operations.http] lazily executes a validated batch", async () => {
    const execute = vi.fn(async () => undefined)
    const load = vi.fn(async () => new ReaderFileOperationService({ execute }))
    const controller = new ReaderFileOperationHttpController(load)
    const path = absolute("source.jpg")
    const response = await controller.handle(jsonRequest({ operations: [{ kind: "trash", sourcePath: path }], confirmed: true }))

    expect(response?.status).toBe(200)
    expect(await response?.json()).toMatchObject({ succeeded: 1, failed: 0, cancelled: 0 })
    expect(load).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledWith({ kind: "trash", sourcePath: path }, expect.any(AbortSignal))
  })

  it("[neoview.file-operations.confirmation] rejects destructive work before loading the platform adapter", async () => {
    const load = vi.fn(async () => new ReaderFileOperationService({ execute: vi.fn() }))
    const controller = new ReaderFileOperationHttpController(load)
    const response = await controller.handle(jsonRequest({ operations: [{ kind: "delete", sourcePath: absolute("source.jpg") }] }))

    expect(response?.status).toBe(409)
    expect(load).not.toHaveBeenCalled()
  })

  it("[neoview.file-operations.http-validation] rejects invalid kinds and methods", async () => {
    const controller = new ReaderFileOperationHttpController(async () => new ReaderFileOperationService({ execute: vi.fn() }))
    const invalid = await controller.handle(jsonRequest({ operations: [{ kind: "unknown", sourcePath: absolute("source.jpg") }] }))
    const method = await controller.handle(new Request("http://127.0.0.1/reader/files/operations", { method: "PUT" }))

    expect(invalid?.status).toBe(400)
    expect(method?.status).toBe(405)
    expect(method?.headers.get("allow")).toBe("POST")
  })

  it("[neoview.file-operations.undo-http] exposes capability and confirmed session undo", async () => {
    const service = new ReaderFileOperationService({
      async execute(operation) {
        return {
          original: operation,
          inverse: { kind: "delete", sourcePath: "destinationPath" in operation ? operation.destinationPath : absolute("fallback") },
          guard: { path: absolute("target"), kind: "file", size: 1, mtimeMs: 1, ctimeMs: 1, device: 1, inode: 1 },
        }
      },
      undo: vi.fn(async () => undefined),
    })
    const controller = new ReaderFileOperationHttpController(async () => service)
    await controller.handle(jsonRequest({ operations: [{ kind: "copy", sourcePath: absolute("source"), destinationPath: absolute("target") }] }))

    const state = await controller.handle(new Request("http://127.0.0.1/reader/files/operations"))
    expect(await state?.json()).toMatchObject({ available: true, count: 1, trashRestore: false })
    const rejected = await controller.handle(jsonRequest({}, "/reader/files/undo"))
    expect(rejected?.status).toBe(409)
    const undone = await controller.handle(jsonRequest({ confirmed: true }, "/reader/files/undo"))
    expect(await undone?.json()).toMatchObject({ succeeded: 1, failed: 0, remaining: 0 })

    await controller.handle(jsonRequest({ operations: [{ kind: "copy", sourcePath: absolute("source-2"), destinationPath: absolute("target-2") }] }))
    const rejectedDiscard = await controller.handle(jsonRequest({}, "/reader/files/undo/discard"))
    expect(rejectedDiscard?.status).toBe(409)
    const discarded = await controller.handle(jsonRequest({ confirmed: true }, "/reader/files/undo/discard"))
    expect(await discarded?.json()).toMatchObject({ discarded: true, remaining: 0 })
  })

  it("[neoview.folder.delete-batch-http] starts and polls a bounded selection operation", async () => {
    const execute = vi.fn(async () => undefined)
    const source = createReaderDirectorySelectionBatchSource(directoryEntries(600), 4, {
      generation: 4,
      allSelected: true,
      ranges: [],
      explicit: [],
    })
    const resolveSelection = vi.fn(async () => source)
    const controller = new ReaderFileOperationHttpController(
      async () => new ReaderFileOperationService({ execute }),
      resolveSelection,
    )
    const started = (await controller.handle(jsonRequest({
      sessionId: "browser-1",
      selection: { generation: 4, allSelected: true, ranges: [], explicit: [] },
      kind: "trash",
      confirmed: true,
    }, "/reader/files/selection-operations")))!
    const initial = await started.json() as { id: string; status: string; total: number }

    expect(started.status).toBe(202)
    expect(initial).toMatchObject({ status: "running", total: 600 })
    expect(resolveSelection).toHaveBeenCalledWith("browser-1", expect.objectContaining({ generation: 4 }), expect.any(AbortSignal))
    let completed: Record<string, unknown> | undefined
    await vi.waitFor(async () => {
      const response = (await controller.handle(new Request(`http://127.0.0.1/reader/files/selection-operations/${initial.id}`)))!
      completed = await response.json() as Record<string, unknown>
      expect(completed.status).toBe("completed")
    })
    expect(completed).toMatchObject({ processed: 600, succeeded: 600, failed: 0 })
    expect(execute).toHaveBeenCalledTimes(600)
    await controller.close()
  })

  it("[neoview.folder.delete-batch-stale-http] rejects stale selection before loading file adapters", async () => {
    const load = vi.fn(async () => new ReaderFileOperationService({ execute: vi.fn() }))
    const controller = new ReaderFileOperationHttpController(load, async () => {
      throw new ReaderDirectorySelectionStaleError(2)
    })
    const response = await controller.handle(jsonRequest({
      sessionId: "browser-1",
      selection: { generation: 2, allSelected: false, ranges: [], explicit: [] },
      kind: "delete",
      confirmed: true,
    }, "/reader/files/selection-operations"))

    expect(response?.status).toBe(409)
    expect(load).not.toHaveBeenCalled()
  })

  it("[neoview.folder.clipboard-http] captures an immutable sparse source and pastes copy or consumes move", async () => {
    const execute = vi.fn(async () => undefined)
    const source = createReaderDirectorySelectionBatchSource(directoryEntries(3), 7, {
      generation: 7,
      allSelected: true,
      ranges: [],
      explicit: [],
    })
    const controller = new ReaderFileOperationHttpController(
      async () => new ReaderFileOperationService({ execute }),
      vi.fn(async () => source),
    )
    const selection = { generation: 7, allSelected: true, ranges: [], explicit: [] }

    const copied = await controller.handle(jsonRequest({ sessionId: "browser-1", selection, mode: "copy" }, "/reader/files/clipboard"))
    expect(copied?.status).toBe(201)
    expect(await copied?.json()).toMatchObject({ available: true, mode: "copy", total: 3, generation: 7 })
    const copyPaste = await controller.handle(jsonRequest({ destinationPath: absolute("copy-target") }, "/reader/files/clipboard/paste"))
    expect(copyPaste?.status).toBe(202)
    const copyJob = await copyPaste?.json() as { id: string }
    await vi.waitFor(async () => {
      const response = await controller.handle(new Request(`http://127.0.0.1/reader/files/selection-operations/${copyJob.id}`))
      expect(await response?.json()).toMatchObject({ status: "completed", succeeded: 3 })
    })
    expect(await (await controller.handle(new Request("http://127.0.0.1/reader/files/clipboard")))?.json()).toMatchObject({ available: true, mode: "copy" })

    await controller.handle(jsonRequest({ sessionId: "browser-1", selection, mode: "move" }, "/reader/files/clipboard"))
    const movePaste = await controller.handle(jsonRequest({ destinationPath: absolute("move-target") }, "/reader/files/clipboard/paste"))
    expect(movePaste?.status).toBe(202)
    expect(await (await controller.handle(new Request("http://127.0.0.1/reader/files/clipboard")))?.json()).toEqual({ available: false })
    await controller.close()
  })
})

function jsonRequest(body: unknown, path = "/reader/files/operations"): Request {
  return new Request(`http://127.0.0.1${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function absolute(path: string): string {
  return process.platform === "win32" ? `C:\\reader-test\\${path}` : `/reader-test/${path}`
}

function directoryEntries(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    name: `item-${index}`,
    path: absolute(`item-${index}`),
    kind: "file" as const,
    readerSupported: true,
  }))
}
