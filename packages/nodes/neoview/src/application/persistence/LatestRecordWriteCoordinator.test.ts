import { describe, expect, it, vi } from "vitest"

import { LatestRecordWriteCoordinator } from "./LatestRecordWriteCoordinator.js"

describe("LatestRecordWriteCoordinator", () => {
  it("[neoview.persistence.latest-record-close] waits for an in-flight write and reports its failure when closing", async () => {
    const write = deferred<void>()
    const failure = new Error("database is unavailable")
    const save = vi.fn(() => write.promise)
    const coordinator = new LatestRecordWriteCoordinator(
      (record: { key: string }) => record.key,
      save,
      60_000,
    )
    coordinator.record({ key: "book-1" })
    const flushing = coordinator.flush("book-1")
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce())

    const firstClose = coordinator.close()
    const secondClose = coordinator.close()
    expect(secondClose).toBe(firstClose)

    let settled = false
    void secondClose.then(() => { settled = true }, () => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    write.reject(failure)
    await expect(flushing).rejects.toBe(failure)
    await expect(firstClose).rejects.toMatchObject({
      name: "AggregateError",
      errors: [failure],
    })
    await expect(secondClose).rejects.toMatchObject({
      name: "AggregateError",
      errors: [failure],
    })
  })
})

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T | PromiseLike<T>): void
  reject(reason?: unknown): void
} {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
