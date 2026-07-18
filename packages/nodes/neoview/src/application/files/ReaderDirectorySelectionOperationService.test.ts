import { describe, expect, it, vi } from "vitest"
import { join } from "node:path"

import { createReaderDirectorySelectionBatchSource } from "../browser/ReaderDirectorySelection.js"
import { ReaderDirectorySelectionOperationService } from "./ReaderDirectorySelectionOperationService.js"
import { ReaderFileOperationService } from "./ReaderFileOperationService.js"

describe("ReaderDirectorySelectionOperationService", () => {
  it("[neoview.folder.delete-batch-job] consumes a 100K-style selection in bounded operation batches", async () => {
    const execute = vi.fn(async () => undefined)
    const service = new ReaderDirectorySelectionOperationService(new ReaderFileOperationService({ execute }), () => 100)
    const source = selectedSource(1_001)
    const started = service.start(source, "trash")
    const completed = await service.wait(started.id)

    expect(started).toMatchObject({ status: "running", total: 1_001, processed: 0 })
    expect(completed).toMatchObject({
      status: "completed",
      total: 1_001,
      processed: 1_001,
      succeeded: 1_001,
      failed: 0,
      cancelled: 0,
      completedAt: 100,
    })
    expect(execute).toHaveBeenCalledTimes(1_001)
    await service.close()
  })

  it("[neoview.folder.delete-batch-partial] bounds partial-failure details while preserving exact totals", async () => {
    const service = new ReaderDirectorySelectionOperationService(new ReaderFileOperationService({
      async execute(operation) {
        if (Number(operation.sourcePath.split("-").at(-1)) % 2 === 0) throw new Error("locked")
      },
    }))
    const started = service.start(selectedSource(200), "delete")
    const completed = await service.wait(started.id)

    expect(completed).toMatchObject({
      status: "completed",
      processed: 200,
      succeeded: 100,
      failed: 100,
      failureSamplesTruncated: true,
    })
    expect(completed?.failureSamples).toHaveLength(64)
    expect(completed?.failureSamples.every((item) => item.status === "failed" && item.error === "locked")).toBe(true)
    await service.close()
  })

  it("[neoview.folder.clipboard-batch-job] maps a sparse source into bounded copy destinations", async () => {
    const execute = vi.fn(async () => undefined)
    const service = new ReaderDirectorySelectionOperationService(new ReaderFileOperationService({ execute }))
    const destination = absolute("destination")
    const started = service.start(selectedSource(513), "copy", destination)
    const completed = await service.wait(started.id)

    expect(completed).toMatchObject({ kind: "copy", destinationPath: destination, total: 513, succeeded: 513 })
    expect(execute).toHaveBeenCalledTimes(513)
    expect(execute).toHaveBeenNthCalledWith(1, {
      kind: "copy",
      sourcePath: absolute("item-0"),
      destinationPath: join(destination, "item-0"),
      overwrite: false,
    }, expect.any(AbortSignal))
    await service.close()
  })

  it("[neoview.folder.clipboard-destination] rejects copy and move jobs without an absolute destination", () => {
    const service = new ReaderDirectorySelectionOperationService(new ReaderFileOperationService({ execute: vi.fn() }))

    expect(() => service.start(selectedSource(1), "copy", "relative")).toThrow("absolute destinationPath")
    expect(() => service.start(selectedSource(1), "move")).toThrow("absolute destinationPath")
  })

  it("[neoview.folder.clipboard-conflict] keeps the batch running and reports non-overwriting conflicts", async () => {
    const service = new ReaderDirectorySelectionOperationService(new ReaderFileOperationService({
      async execute(operation) {
        if ("sourcePath" in operation && operation.sourcePath.endsWith("item-1")) {
          throw Object.assign(new Error("Destination already exists"), { code: "EEXIST" })
        }
      },
    }))
    const started = service.start(selectedSource(3), "copy", absolute("destination"))
    const completed = await service.wait(started.id)

    expect(completed).toMatchObject({ status: "completed", processed: 3, succeeded: 2, failed: 1 })
    expect(completed?.failureSamples).toMatchObject([{ status: "failed", errorCode: "EEXIST" }])
    await service.close()
  })

  it("[neoview.folder.delete-batch-cancel] aborts in-flight work and reports bounded progress", async () => {
    let startedOperation = false
    const service = new ReaderDirectorySelectionOperationService(new ReaderFileOperationService({
      execute(_operation, signal) {
        startedOperation = true
        return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true }))
      },
    }))
    const started = service.start(selectedSource(1_000), "trash")
    await vi.waitFor(() => expect(startedOperation).toBe(true))
    expect(service.cancel(started.id)).toBe(true)
    const cancelled = await service.wait(started.id)

    expect(cancelled).toMatchObject({ status: "cancelled", total: 1_000, succeeded: 0, failed: 0 })
    expect(cancelled!.processed).toBeLessThanOrEqual(256)
    expect(cancelled!.failureSamples.length).toBeLessThanOrEqual(64)
    await service.close()
  })
})

function selectedSource(count: number) {
  const entries = Array.from({ length: count }, (_, index) => ({
    name: `item-${index}`,
    path: absolute(`item-${index}`),
    kind: "file" as const,
    readerSupported: true,
  }))
  return createReaderDirectorySelectionBatchSource(entries, 1, {
    generation: 1,
    allSelected: true,
    ranges: [],
    explicit: [],
  })
}

function absolute(name: string): string {
  return process.platform === "win32" ? `C:\\reader-test\\${name}` : `/reader-test/${name}`
}
