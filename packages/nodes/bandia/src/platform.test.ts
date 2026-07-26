import type { FileOperationBatchResult, FileOperationRequest } from "@xiranite/file-operations"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test, vi } from "vitest"

import { createNodeBandiaRuntime } from "./platform.js"

describe("bandia platform runtime", () => {
  test("delegates deletion modes to the scoped project file-operation service", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-bandia-file-operations-"))
    const archive = join(root, "source.zip")
    await writeFile(archive, "archive", "utf8")
    const execute = vi.fn(async (request: FileOperationRequest): Promise<FileOperationBatchResult> => success(request))
    const runtime = createNodeBandiaRuntime({ fileOperations: { execute } })

    try {
      await runtime.removePath(archive, { trash: true })

      expect(execute).toHaveBeenCalledWith({
        operations: [{ kind: "trash", sourcePath: archive }],
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
