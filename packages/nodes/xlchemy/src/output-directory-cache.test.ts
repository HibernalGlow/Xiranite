import { describe, expect, test, vi } from "vitest"
import { createBoundedDirectoryEnsurer } from "./output-directory-cache.js"

describe("bounded output directory cache", () => {
  test("shares one in-flight directory creation across equivalent Windows paths", async () => {
    let complete: (() => void) | undefined
    const ensureDirectory = vi.fn(() => new Promise<void>((resolve) => { complete = resolve }))
    const ensure = createBoundedDirectoryEnsurer(ensureDirectory)

    const first = ensure("D:\\Output\\Batch")
    const second = ensure("d:/output/batch")

    expect(first).toBe(second)
    expect(ensureDirectory).toHaveBeenCalledOnce()
    complete?.()
    await Promise.all([first, second])
  })

  test("removes failed entries so a later call can retry", async () => {
    let attempt = 0
    const ensureDirectory = vi.fn(async () => {
      attempt += 1
      if (attempt === 1) throw new Error("directory unavailable")
    })
    const ensure = createBoundedDirectoryEnsurer(ensureDirectory)

    await expect(ensure("D:/output")).rejects.toThrow("directory unavailable")
    await expect(ensure("D:/output")).resolves.toBeUndefined()
    expect(ensureDirectory).toHaveBeenCalledTimes(2)
  })
})
