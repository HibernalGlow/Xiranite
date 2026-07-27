import { describe, expect, it, vi } from "vitest"
import { readFindzNativeResponse } from "./native-response.js"

describe("readFindzNativeResponse", () => {
  it("decodes a native response and releases its buffer once", () => {
    const pointer = { address: 12 }
    const release = vi.fn()
    const bytes = new TextEncoder().encode('{"ok":true}')

    const result = readFindzNativeResponse(
      { toArrayBuffer: vi.fn(() => bytes.buffer) },
      { findz_free: release },
      pointer,
      new BigUint64Array([BigInt(bytes.byteLength)]),
    )

    expect(result).toBe('{"ok":true}')
    expect(release).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledWith(pointer)
  })

  it("releases a non-null native buffer when the declared response length is invalid", () => {
    const pointer = { address: 24 }
    const release = vi.fn()

    expect(() => readFindzNativeResponse(
      { toArrayBuffer: vi.fn() },
      { findz_free: release },
      pointer,
      new BigUint64Array([0n]),
    )).toThrow("invalid response length")

    expect(release).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledWith(pointer)
  })
})
