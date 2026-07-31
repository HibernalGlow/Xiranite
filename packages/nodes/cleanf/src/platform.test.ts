import { describe, expect, test, vi } from "vitest"
import type { FileOperationBatchResult } from "@xiranite/file-operations"
import { createNodeCleanfRuntime, type CleanfFileOperations } from "./platform.js"

describe("cleanf platform file operations", () => {
  test("moves deepest targets to the recycle bin through the shared executor", async () => {
    const execute = vi.fn(async (request): Promise<FileOperationBatchResult> => ({
      results: request.operations.map((operation, index) => ({ index, operation, status: "succeeded" as const })),
      succeeded: request.operations.length,
      failed: 0,
      cancelled: 0,
      undoable: request.operations.length,
      undoId: "undo-cleanf-1",
      undoPersisted: true,
      deletionHistoryPersisted: true,
    }))
    const runtime = createNodeCleanfRuntime({
      fileOperations: {
        execute,
        undoState: () => undoState({ available: false, count: 0 }),
      },
    })

    const result = await runtime.removeTargets([
      target("D:/library/parent", 1),
      target("D:/library/parent/child", 2),
    ])

    expect(execute).toHaveBeenCalledWith({
      operations: [
        { kind: "trash", sourcePath: "D:/library/parent/child" },
        { kind: "trash", sourcePath: "D:/library/parent" },
      ],
      concurrency: 1,
    })
    expect(result).toEqual({ removed: 2, skipped: 0, undoable: 2, undoBatchCount: 1, undoPersistent: true })
  })

  test("delegates undo to the same shared Cleanf scope", async () => {
    const undoLatest = vi.fn(async () => ({ results: [], succeeded: 3, failed: 0, remaining: 0 }))
    const fileOperations: CleanfFileOperations = {
      execute: vi.fn(),
      undoLatest,
      undoState: () => undoState({ available: false, count: 0 }),
    }
    const runtime = createNodeCleanfRuntime({ fileOperations })

    await expect(runtime.undoLatest?.()).resolves.toEqual({ succeeded: 3, failed: 0 })
    expect(undoLatest).toHaveBeenCalledOnce()
  })

  test("refuses live cleanup when recycle-bin restore is unavailable", async () => {
    const execute = vi.fn()
    const runtime = createNodeCleanfRuntime({
      fileOperations: {
        execute,
        undoState: () => undoState({ available: false, count: 0, trashRestore: false }),
      },
    })

    await expect(runtime.removeTargets([target("D:/library/empty", 1)])).rejects.toMatchObject({ code: "ENOTSUP" })
    expect(execute).not.toHaveBeenCalled()
  })
})

function target(path: string, depth: number) {
  return { path, name: path.split("/").at(-1)!, type: "dir" as const, preset: "empty_folders", reason: "Empty folder", depth }
}

function undoState(overrides: Partial<ReturnType<NonNullable<CleanfFileOperations["undoState"]>>>) {
  return {
    available: true,
    count: 1,
    supportedKinds: ["trash" as const],
    trashRestore: true,
    persistent: true,
    ...overrides,
  }
}
