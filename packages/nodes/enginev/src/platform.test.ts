import type { FileOperationBatchResult, FileOperationRequest } from "@xiranite/file-operations"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test, vi } from "vitest"

import { createNodeEngineVRuntime } from "./platform.js"

describe("enginev platform runtime", () => {
  test("delegates deletion modes to the scoped project file-operation service", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-enginev-file-operations-"))
    const wallpaper = join(root, "wallpaper.pkg")
    await writeFile(wallpaper, "wallpaper", "utf8")
    const execute = vi.fn(async (request: FileOperationRequest): Promise<FileOperationBatchResult> => success(request))
    const runtime = createNodeEngineVRuntime({ fileOperations: { execute } })

    try {
      await runtime.removePath(wallpaper, { trash: false })

      expect(execute).toHaveBeenCalledWith({
        operations: [{ kind: "delete", sourcePath: wallpaper }],
        concurrency: 1,
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

function success(request: FileOperationRequest): FileOperationBatchResult {
  return {
    results: request.operations.map((operation, index) => ({ index, operation, status: "succeeded" })),
    succeeded: request.operations.length,
    failed: 0,
    cancelled: 0,
    undoable: 0,
  }
}
