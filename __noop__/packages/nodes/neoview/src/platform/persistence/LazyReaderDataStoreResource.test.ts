import { describe, expect, it, vi } from "vitest"

import { LazyReaderDataStoreResource } from "./LazyReaderDataStoreResource.js"

describe("LazyReaderDataStoreResource", () => {
  it("[neoview.reader-data.lazy-headless] stays idle, singleflights load and closes the owned store once", async () => {
    const close = vi.fn(async () => undefined)
    const load = vi.fn(async () => ({ close }))
    const resource = new LazyReaderDataStoreResource(load)

    expect(load).not.toHaveBeenCalled()
    const [left, right] = await Promise.all([resource.get(), resource.get()])
    expect(left).toBe(right)
    expect(load).toHaveBeenCalledOnce()
    await resource.close()
    await resource.close()
    expect(close).toHaveBeenCalledOnce()
    await expect(resource.get()).rejects.toThrow("closed")
  })

  it("[neoview.reader-data.lazy-headless-retry] permits retry after a failed open", async () => {
    const close = vi.fn(async () => undefined)
    const load = vi.fn().mockRejectedValueOnce(new Error("locked")).mockResolvedValue({ close })
    const resource = new LazyReaderDataStoreResource(load)

    await expect(resource.get()).rejects.toThrow("locked")
    await expect(resource.get()).resolves.toMatchObject({ close })
    expect(load).toHaveBeenCalledTimes(2)
    await resource.close()
  })
})
