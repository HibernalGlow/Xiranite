import { describe, expect, it, vi } from "vitest"

import type { ReaderSourceWatcher } from "../../ports/ReaderSourceWatcher.js"
import { ReaderSourceWatchService } from "./ReaderSourceWatchService.js"

describe("ReaderSourceWatchService", () => {
  it("[neoview.control.source-watch] coalesces a pathless source change and releases the native subscription", async () => {
    const close = vi.fn(async () => undefined)
    let publish: Parameters<ReaderSourceWatcher["subscribe"]>[1] | undefined
    const watcher: ReaderSourceWatcher = {
      subscribe: vi.fn(async (_source, onChanges) => {
        publish = onChanges
        return { close, [Symbol.asyncDispose]: close }
      }),
    }
    const service = new ReaderSourceWatchService(watcher, 5_000)
    const pending = service.waitForChange("reader-1", { kind: "archive", path: "D:/private/book.cbz" }, 0)
    await vi.waitFor(() => expect(publish).toBeTypeOf("function"))
    publish!([{ kind: "update" }, { kind: "create" }, { kind: "update" }])

    await expect(pending).resolves.toEqual({
      revision: 1,
      state: "changed",
      kinds: ["update", "create"],
      count: 3,
    })
    await service.release("reader-1")
    expect(close).toHaveBeenCalledOnce()
  })

  it("[neoview.control.source-watch-cancel] removes an aborted long poll without closing the shared watch", async () => {
    const close = vi.fn(async () => undefined)
    const watcher: ReaderSourceWatcher = {
      subscribe: vi.fn(async () => ({ close, [Symbol.asyncDispose]: close })),
    }
    const service = new ReaderSourceWatchService(watcher, 5_000)
    const controller = new AbortController()
    const pending = service.waitForChange("reader-1", { kind: "image", path: "D:/private/page.jxl" }, 0, controller.signal)
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(close).not.toHaveBeenCalled()
    await service[Symbol.asyncDispose]()
    expect(close).toHaveBeenCalledOnce()
  })

  it("[neoview.control.source-watch-release-opening] resolves an opening wait on release and closes a late subscription once", async () => {
    let resolveSubscription!: (subscription: Awaited<ReturnType<ReaderSourceWatcher["subscribe"]>>) => void
    const subscriptionOpening = new Promise<Awaited<ReturnType<ReaderSourceWatcher["subscribe"]>>>((resolve) => {
      resolveSubscription = resolve
    })
    const close = vi.fn(async () => undefined)
    const watcher: ReaderSourceWatcher = {
      subscribe: vi.fn(async () => subscriptionOpening),
    }
    const service = new ReaderSourceWatchService(watcher, 5_000)
    const controller = new AbortController()
    const pending = service.waitForChange(
      "reader-1",
      { kind: "archive", path: "D:/private/book.cbz" },
      0,
      controller.signal,
    )
    await vi.waitFor(() => expect(watcher.subscribe).toHaveBeenCalledOnce())

    const release = service.release("reader-1")
    const outcome = await Promise.race([
      pending.then(() => "resolved" as const),
      new Promise<"timed-out">((resolve) => setTimeout(() => resolve("timed-out"), 100)),
    ])
    expect(outcome).toBe("resolved")
    await expect(pending).resolves.toBeUndefined()
    expect(close).not.toHaveBeenCalled()

    resolveSubscription({ close, [Symbol.asyncDispose]: close })
    await release
    expect(close).toHaveBeenCalledOnce()

    await service.release("reader-1")
    expect(close).toHaveBeenCalledOnce()
  })

  it("[neoview.control.source-watch-release-repeat] closes an established subscription once across repeated release calls", async () => {
    const close = vi.fn(async () => undefined)
    const watcher: ReaderSourceWatcher = {
      subscribe: vi.fn(async () => ({ close, [Symbol.asyncDispose]: close })),
    }
    const service = new ReaderSourceWatchService(watcher, 5_000)
    const pending = service.waitForChange("reader-1", { kind: "image", path: "D:/private/page.jxl" }, 0)
    await vi.waitFor(() => expect(watcher.subscribe).toHaveBeenCalledOnce())

    await Promise.all([
      service.release("reader-1"),
      service.release("reader-1"),
      service.release("reader-1"),
    ])
    await expect(pending).resolves.toBeUndefined()
    expect(close).toHaveBeenCalledOnce()
  })

  it("[neoview.control.source-watch-error] reports watcher failure without exposing platform error details", async () => {
    let fail: (() => void) | undefined
    const close = vi.fn(async () => undefined)
    const watcher: ReaderSourceWatcher = {
      subscribe: vi.fn(async (_source, _onChanges, onError) => {
        fail = onError
        return { close, [Symbol.asyncDispose]: close }
      }),
    }
    const service = new ReaderSourceWatchService(watcher, 5_000)
    const pending = service.waitForChange("reader-1", { kind: "directory", path: "D:/private" }, 0)
    await vi.waitFor(() => expect(fail).toBeTypeOf("function"))
    fail!()

    await expect(pending).resolves.toEqual({ revision: 1, state: "unavailable", kinds: [], count: 0 })
    await service[Symbol.asyncDispose]()
  })
})
