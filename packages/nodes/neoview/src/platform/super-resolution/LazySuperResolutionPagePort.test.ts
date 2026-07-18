import { describe, expect, it, vi } from "vitest"

import { LazySuperResolutionPagePort } from "./LazySuperResolutionPagePort.js"

describe("LazySuperResolutionPagePort", () => {
  it("[neoview.super-resolution.headless-lazy] loads once on first execution and disposes the capability", async () => {
    const run = vi.fn(async () => ({ decision: { kind: "skip" as const, reason: "test" } }))
    const dispose = vi.fn(async () => undefined)
    const load = vi.fn(async () => ({ pages: { run }, dispose }))
    const port = new LazySuperResolutionPagePort(load)

    expect(load).not.toHaveBeenCalled()
    await port.run(pageInput())
    await port.run(pageInput())
    expect(load).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledTimes(2)

    await port[Symbol.asyncDispose]()
    await port[Symbol.asyncDispose]()
    expect(dispose).toHaveBeenCalledOnce()
    await expect(port.run(pageInput())).rejects.toThrow("disposed")
  })

  it("[neoview.super-resolution.headless-unavailable] reports a missing optional runtime without executing", async () => {
    const port = new LazySuperResolutionPagePort(async () => undefined)
    await expect(port.run(pageInput())).rejects.toThrow("runtime is unavailable")
    await port[Symbol.asyncDispose]()
  })

  it("[neoview.super-resolution.headless-cancel] cancels one waiter without poisoning the shared load", async () => {
    let resolveLoad!: (value: { pages: { run: typeof run }; dispose: () => Promise<void> }) => void
    const run = vi.fn(async () => ({ decision: { kind: "skip" as const, reason: "test" } }))
    const load = new Promise<{ pages: { run: typeof run }; dispose: () => Promise<void> }>((resolve) => { resolveLoad = resolve })
    const port = new LazySuperResolutionPagePort(() => load)
    const abort = new AbortController()
    const cancelled = port.run(pageInput(), { signal: abort.signal })
    abort.abort(new Error("cancelled"))
    await expect(cancelled).rejects.toThrow("cancelled")

    resolveLoad({ pages: { run }, dispose: async () => undefined })
    await expect(port.run(pageInput())).resolves.toMatchObject({ decision: { kind: "skip" } })
    expect(run).toHaveBeenCalledOnce()
    await port[Symbol.asyncDispose]()
  })
})

function pageInput() {
  return {
    page: {
      id: "page-0",
      index: 0,
      name: "page.png",
      sourcePath: "D:/page.png",
      mediaKind: "image" as const,
      contentVersion: "v1",
      dimensions: { width: 100, height: 100 },
      content: { load: async () => { throw new Error("unused") } },
    },
    destinationPath: "D:/output.png",
    trigger: "manual" as const,
  }
}
