import { describe, expect, test, vi } from "vitest"
import { inspectXlchemyInputPaths } from "./input-source-inspection"
import { XLCHEMY_INPUT_SIZE_CACHE_LIMIT } from "./input-source-model"

describe("XLchemy dropped input inspection", () => {
  test("inspects large drops in batches of at most 16 and bounds retained sizes", async () => {
    const paths = Array.from({ length: 2_000 }, (_, index) => `D:/images/${index}.png`)
    let active = 0
    let peakActive = 0
    const listPath = vi.fn(async (path: string) => {
      active += 1
      peakActive = Math.max(peakActive, active)
      await Promise.resolve()
      active -= 1
      return [{ path, isDirectory: false, sizeBytes: 2_048 }]
    })

    const result = await inspectXlchemyInputPaths(paths, listPath)

    expect(listPath).toHaveBeenCalledTimes(paths.length)
    expect(peakActive).toBe(16)
    expect(result.directoryPaths).toEqual([])
    expect(result.fileSizes).toHaveLength(XLCHEMY_INPUT_SIZE_CACHE_LIMIT)
  })

  test("treats unresolved dropped roots as directories without expanding them", async () => {
    await expect(inspectXlchemyInputPaths(["D:/images"], async () => [])).resolves.toEqual({
      directoryPaths: ["D:/images"],
      fileSizes: [],
    })
  })
})
