import { describe, expect, it, vi } from "vitest"

import type { ReaderFileMutationProvider } from "../../ports/ReaderFileMutationProvider.js"
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
})

function absolute(path: string): string {
  return process.platform === "win32" ? `C:\\reader-test\\${path.replaceAll("/", "\\")}` : `/reader-test/${path}`
}
