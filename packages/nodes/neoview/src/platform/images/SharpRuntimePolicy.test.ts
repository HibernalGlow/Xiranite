import { describe, expect, it } from "vitest"

import { isNeoViewSharpEnabled } from "./SharpRuntimePolicy.js"

describe("SharpRuntimePolicy", () => {
  it("keeps Sharp opt-in while accepting conventional explicit enable values", () => {
    expect(isNeoViewSharpEnabled(undefined)).toBe(false)
    expect(isNeoViewSharpEnabled("0")).toBe(false)
    expect(isNeoViewSharpEnabled("false")).toBe(false)
    expect(isNeoViewSharpEnabled("1")).toBe(true)
    expect(isNeoViewSharpEnabled(" ON ")).toBe(true)
  })
})
