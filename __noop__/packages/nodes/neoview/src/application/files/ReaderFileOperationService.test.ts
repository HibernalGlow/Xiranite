import { describe, expect, it, vi } from "vitest"

import type { ReaderFileMutationProvider, ReaderFileUndoReceipt } from "../../ports/ReaderFileMutationProvider.js"
import { ReaderFileOperationService } from "./ReaderFileOperationService.js"

describe("ReaderFileOperationService", () => {
  it("[neoview.file-operations.results] reports every success and failure in request order", async () => {
    const provider: ReaderFileMutationProvider = {
      execute: vi.fn(async (operation) => {
        if ("sourcePath" in operation && operation.sourcePath.endsWith("bad.jpg")) {
          throw Object.assign(new Error("destination exists"), { code: "EEXIST" })
        }
      }),
    }
    const result = await new ReaderFileOperationService(provider).execute({ operations: [
      { kind: "copy", sourcePath: absolute("one.jpg"), destinationPath: absolute("out/one.jpg") },
      { kind: "move", sourcePath: absolute("bad.jpg"), destinationPath: absolute("out/bad.jpg") },
      { kind: "create-directory", destinationPath: absolute("new") },
    ], concurrency: 2 })

    expect(result).toMatchObject({ succeeded: 2, failed: 1, cancelled: 0 })
    expect(result.results.map((item) => [item.index, item.status, item.errorCode])).toEqual([
      [0, "succeeded", undefined],
      [1, "failed", "EEXIST"],
      [2, "succeeded", undefined],
    ])
  })

  it("[neoview.file-operations.cancel] does not start work admitted after cancellation", async () => {
    const abort = new AbortController()
    let calls = 0
    const provider: ReaderFileMutationProvider = {
      async execute() {
        calls += 1
        abort.abort()
      },
    }
    const result = await new ReaderFileOperationService(provider).execute({
      operations: [1, 2, 3].map((value) => ({ kind: "delete" as const, sourcePath: absolute(`${value}.jpg`) })),
      concurrency: 1,
      signal: abort.signal,
    })
    expect(calls).toBe(1)
    expect(result.results.map((item) => item.status)).toEqual(["succeeded", "cancelled", "cancelled"])
  })

  it("[neoview.file-operations.validation] rejects unsafe or unbounded requests before mutation", async () => {
    const provider = { execute: vi.fn(async () => undefined) }
    const service = new ReaderFileOperationService(provider)
    await expect(service.execute({ operations: [{ kind: "delete", sourcePath: "relative.jpg" }] })).rejects.toThrow("absolute path")
    await expect(service.execute({ operations: [{ kind: "move", sourcePath: absolute("same"), destinationPath: absolute("same") }] })).rejects.toThrow("must differ")
    await expect(service.execute({ operations: [], concurrency: 9 })).rejects.toThrow("concurrency")
    expect(provider.execute).not.toHaveBeenCalled()
  })

  it("[neoview.folder.rename-case] allows a rename that only changes path casing", async () => {
    const provider = { execute: vi.fn(async () => undefined) }
    const sourcePath = absolute("book.cbz")
    const destinationPath = absolute("Book.cbz")
    const service = new ReaderFileOperationService(provider)

    await expect(service.execute({ operations: [{ kind: "rename", sourcePath, destinationPath }] })).resolves.toMatchObject({ succeeded: 1 })
    expect(provider.execute).toHaveBeenCalledWith({ kind: "rename", sourcePath, destinationPath }, undefined)
  })

  it("[neoview.file-operations.undo-journal] records reversible receipts and undoes a batch in reverse order", async () => {
    const undone: string[] = []
    const provider: ReaderFileMutationProvider = {
      async execute(operation) {
        if (!("destinationPath" in operation)) return undefined
        return undoReceipt(operation, operation.destinationPath)
      },
      async undo(receipt) { undone.push(receipt.guard.path) },
    }
    const service = new ReaderFileOperationService(provider)
    const result = await service.execute({ operations: [
      { kind: "copy", sourcePath: absolute("a"), destinationPath: absolute("out/a") },
      { kind: "create-directory", destinationPath: absolute("out/folder") },
    ], concurrency: 2 })

    expect(result).toMatchObject({ succeeded: 2, undoable: 2 })
    expect(result.undoId).toEqual(expect.any(String))
    expect(service.undoState()).toMatchObject({ available: true, count: 1, latestId: result.undoId, trashRestore: false })
    await expect(service.undoLatest()).resolves.toMatchObject({ undoId: result.undoId, succeeded: 2, failed: 0, remaining: 0 })
    expect(undone).toEqual([absolute("out/folder"), absolute("out/a")])
    expect(service.undoState()).toMatchObject({ available: false, count: 0 })
  })

  it("[neoview.file-operations.undo-partial] retains the failed and unattempted receipts for a safe retry", async () => {
    const provider: ReaderFileMutationProvider = {
      async execute(operation) {
        return "destinationPath" in operation ? undoReceipt(operation, operation.destinationPath) : undefined
      },
      async undo(receipt) {
        if (receipt.guard.path.endsWith("a")) throw Object.assign(new Error("changed"), { code: "ESTALE" })
      },
    }
    const service = new ReaderFileOperationService(provider)
    await service.execute({ operations: [
      { kind: "copy", sourcePath: absolute("source-a"), destinationPath: absolute("a") },
      { kind: "copy", sourcePath: absolute("source-b"), destinationPath: absolute("b") },
    ], concurrency: 1 })

    await expect(service.undoLatest()).resolves.toMatchObject({ succeeded: 1, failed: 1, remaining: 1 })
    expect(service.undoState()).toMatchObject({ available: true, count: 1 })
  })

  it("[neoview.file-operations.undo-bounded] evicts the oldest transaction at the configured hard limit", async () => {
    const undone: string[] = []
    const provider: ReaderFileMutationProvider = {
      async execute(operation) {
        return "destinationPath" in operation ? undoReceipt(operation, operation.destinationPath) : undefined
      },
      async undo(receipt) { undone.push(receipt.guard.path) },
    }
    const service = new ReaderFileOperationService(provider, { undoLimit: 1 })
    const first = await service.execute({ operations: [{ kind: "create-directory", destinationPath: absolute("first") }] })
    const second = await service.execute({ operations: [{ kind: "create-directory", destinationPath: absolute("second") }] })

    expect(service.undoState()).toMatchObject({ count: 1, latestId: second.undoId })
    expect(service.undoState().latestId).not.toBe(first.undoId)
    await service.undoLatest()
    expect(undone).toEqual([absolute("second")])
  })

  it("[neoview.file-operations.undo-discard] explicitly removes a stale transaction without running its inverse", async () => {
    const undo = vi.fn(async () => undefined)
    const provider: ReaderFileMutationProvider = {
      async execute(operation) {
        return "destinationPath" in operation ? undoReceipt(operation, operation.destinationPath) : undefined
      },
      undo,
    }
    const service = new ReaderFileOperationService(provider)
    const operation = await service.execute({ operations: [{ kind: "create-directory", destinationPath: absolute("stale") }] })

    await expect(service.discardLatest()).resolves.toMatchObject({ undoId: operation.undoId, discarded: true, remaining: 0 })
    expect(undo).not.toHaveBeenCalled()
    await expect(service.discardLatest()).resolves.toEqual({ discarded: false, remaining: 0 })
  })
})

function undoReceipt(original: ReaderFileUndoReceipt["original"], path: string): ReaderFileUndoReceipt {
  return {
    original,
    inverse: { kind: "delete", sourcePath: path },
    guard: { path, kind: "file", size: 1, mtimeMs: 1, ctimeMs: 1, device: 1, inode: 1 },
  }
}

function absolute(path: string): string {
  return process.platform === "win32" ? `C:\\reader-test\\${path.replaceAll("/", "\\")}` : `/reader-test/${path}`
}
