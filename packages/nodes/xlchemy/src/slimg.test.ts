import { afterEach, describe, expect, test } from "vitest"
import { probeSlimgCffi } from "./slimg-cffi.js"

const originalPath = process.env.SLIMG_CFFI_PATH

afterEach(() => {
  if (originalPath === undefined) delete process.env.SLIMG_CFFI_PATH
  else process.env.SLIMG_CFFI_PATH = originalPath
})

describe("slimg CFFI", () => {
  test("reports a missing configured DLL without trying to load it", async () => {
    process.env.SLIMG_CFFI_PATH = "Z:\\missing\\slimg_cffi.dll"
    await expect(probeSlimgCffi()).resolves.toMatchObject({
      id: "slimg-cffi",
      available: false,
      runnable: false,
      detail: "DLL not found.",
    })
  })
})
