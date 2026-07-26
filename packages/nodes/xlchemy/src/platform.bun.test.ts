import { access, mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { FileOperationBatchResult, FileOperationRequest } from "@xiranite/file-operations"
import { expect, mock, test } from "bun:test"

import { createCachedCommandResolver, createNodeXlchemyRuntime, ensureDir } from "./platform.js"

test("resolves an encoder path once across concurrent file workers", async () => {
  let calls = 0
  const resolveCommand = createCachedCommandResolver(async () => {
    calls += 1
    await new Promise((resolve) => setTimeout(resolve, 10))
    return "/bin/avifenc"
  })

  expect(await Promise.all([
    resolveCommand(["avifenc"]),
    resolveCommand(["avifenc"]),
    resolveCommand(["avifenc"]),
  ])).toEqual(["/bin/avifenc", "/bin/avifenc", "/bin/avifenc"])
  expect(await resolveCommand(["avifenc"])).toBe("/bin/avifenc")
  expect(calls).toBe(1)
})

test("does not permanently cache a missing encoder", async () => {
  let calls = 0
  const resolveCommand = createCachedCommandResolver(async () => {
    calls += 1
    return calls === 1 ? undefined : "/bin/avifenc"
  })

  expect(await resolveCommand(["avifenc"])).toBeUndefined()
  expect(await resolveCommand(["avifenc"])).toBe("/bin/avifenc")
  expect(calls).toBe(2)
})

test("accepts an existing source-output directory on Bun/Windows", async () => {
  const root = await mkdtemp(join(tmpdir(), "xlchemy-existing-dir-"))
  const existing = join(root, "Downloads")
  await mkdir(existing)

  try {
    await expect(ensureDir(existing)).resolves.toBeUndefined()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("materializes and cleans up clipboard image bytes in a temporary workspace", async () => {
  const runtime = createNodeXlchemyRuntime()
  const path = await runtime.createTemporaryFile!(".png", "cG5nLWJ5dGVz")

  expect(path.endsWith("clipboard.png")).toBe(true)
  expect(await runtime.readFileBase64!(path)).toBe("cG5nLWJ5dGVz")
  await runtime.cleanupTemporaryFile!(path)
  await expect(access(path)).rejects.toBeTruthy()
})

test("delegates user-requested deletion modes to the scoped project file-operation service", async () => {
  const execute = mock(async (request: FileOperationRequest): Promise<FileOperationBatchResult> => ({
    results: request.operations.map((operation, index) => ({ index, operation, status: "succeeded" })),
    succeeded: request.operations.length,
    failed: 0,
    cancelled: 0,
    undoable: 0,
  }))
  const runtime = createNodeXlchemyRuntime({ fileOperations: { execute } })

  await runtime.deleteFile!("D:/images/original.png", "trash")
  await runtime.deleteFile!("D:/images/original.tmp", "permanent")

  expect(execute).toHaveBeenNthCalledWith(1, {
    operations: [{ kind: "trash", sourcePath: "D:/images/original.png" }],
    concurrency: 1,
  })
  expect(execute).toHaveBeenNthCalledWith(2, {
    operations: [{ kind: "delete", sourcePath: "D:/images/original.tmp" }],
    concurrency: 1,
  })
})

test("adapts the shared weighted scheduler to an XLchemy worker lease", async () => {
  let released = 0
  let request: unknown
  const runtime = createNodeXlchemyRuntime({
    resourceScheduler: {
      acquire: async (value) => {
        request = value
        return { weight: 3, release: () => { released += 1 } }
      },
    },
  })
  const lease = await runtime.acquireWorker!(8, 768)
  expect(request).toEqual({
    resource: "cpu",
    kind: "xlchemy.image-convert",
    priority: "background",
    ownerId: "xlchemy",
    weight: 8,
    minimumWeight: 1,
    memoryMiB: 768,
  })
  expect(lease.threads).toBe(3)
  lease.release()
  expect(released).toBe(1)
})
