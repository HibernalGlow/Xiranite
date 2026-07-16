import { resolve } from "node:path"
import { describe, expect, it, vi } from "vitest"

import type { ReaderFileOperationService } from "../core.js"
import { createNeoviewFileOperationTuiDefinition } from "../interaction.js"

describe("NeoView file-operation terminal interaction", () => {
  it("[neoview.file-operations.tui] delegates to the shared service and marks destructive actions dangerous", async () => {
    const execute = vi.fn(async ({ operations }: Parameters<ReaderFileOperationService["execute"]>[0]) => ({
      results: [{ index: 0, operation: operations[0]!, status: "succeeded" as const }],
      succeeded: 1,
      failed: 0,
      cancelled: 0,
    }))
    const definition = createNeoviewFileOperationTuiDefinition("en", async () => ({ execute }) as unknown as ReaderFileOperationService)

    await expect(definition.run({ action: "move", sourcePath: "source.jpg", destinationPath: "target.jpg" }, () => undefined)).resolves.toMatchObject({
      success: true,
      message: "move completed.",
    })
    expect(execute).toHaveBeenCalledWith({ operations: [{
      kind: "move",
      sourcePath: resolve("source.jpg"),
      destinationPath: resolve("target.jpg"),
      overwrite: false,
    }], concurrency: 1 })
    expect(definition.schema.isDangerous({ action: "delete", sourcePath: "source.jpg" })).toBe(true)
    expect(definition.schema.isDangerous({ action: "trash", sourcePath: "source.jpg" })).toBe(true)
    expect(definition.schema.isDangerous({ action: "copy", sourcePath: "source.jpg", destinationPath: "target.jpg" })).toBe(false)
  })
})
