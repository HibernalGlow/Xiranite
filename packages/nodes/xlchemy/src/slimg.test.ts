import { readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import { convertWithSlimgCffi, probeSlimgCffi } from "./slimg-cffi.js"

const ffiMocks = vi.hoisted(() => {
  const dlopen = vi.fn(() => ({
    symbols: {
      slimg_decode_file: vi.fn(() => 100),
      slimg_convert: vi.fn(() => 200),
      slimg_free_buffer_ptr: vi.fn(),
    },
    close: vi.fn(),
  }))
  return {
    dlopen,
    ptr: vi.fn(() => 1),
    read: {
      ptr: vi.fn((pointer: number) => pointer === 100 ? 101 : 201),
      u64: vi.fn((pointer: number) => pointer === 100 ? 4n : 3n),
      u32: vi.fn((_pointer: number, offset: number) => offset === 16 ? 1 : 1),
    },
    toArrayBuffer: vi.fn(() => Uint8Array.from([1, 2, 3]).buffer),
  }
})

vi.mock("bun:ffi", () => ffiMocks)

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

  test("reuses one DLL session across files and releases every native buffer", async () => {
    process.env.SLIMG_CFFI_PATH = join(tmpdir(), "slimg-cffi-test.dll")
    const first = join(tmpdir(), `xlchemy-slimg-${process.pid}-first.avif`)
    const second = join(tmpdir(), `xlchemy-slimg-${process.pid}-second.avif`)
    try {
      await convertWithSlimgCffi("D:/images/first.png", first, 64)
      await convertWithSlimgCffi("D:/images/second.png", second, 64)

      expect(ffiMocks.dlopen).toHaveBeenCalledTimes(1)
      const library = ffiMocks.dlopen.mock.results[0]!.value
      expect(library.symbols.slimg_decode_file).toHaveBeenCalledTimes(2)
      expect(library.symbols.slimg_convert).toHaveBeenCalledTimes(2)
      expect(library.symbols.slimg_free_buffer_ptr.mock.calls.map(([pointer]) => pointer)).toEqual([200, 100, 200, 100])
      expect(await readFile(first)).toEqual(Buffer.from([1, 2, 3]))
      expect(await readFile(second)).toEqual(Buffer.from([1, 2, 3]))
    } finally {
      await Promise.all([rm(first, { force: true }), rm(second, { force: true })])
    }
  })
})
