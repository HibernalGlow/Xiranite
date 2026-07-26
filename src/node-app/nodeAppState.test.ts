import { z } from "zod"
import { describe, expect, it } from "vitest"
import { parseNodeAppState } from "./nodeAppState"

describe("parseNodeAppState", () => {
  const schema = z.object({ quality: z.number().min(0).max(100).optional() })

  it("keeps state accepted by the node's existing schema", () => {
    expect(parseNodeAppState({ quality: 90 }, schema)).toEqual({ data: { quality: 90 }, valid: true })
  })

  it("marks invalid inherited state for atomic replacement", () => {
    expect(parseNodeAppState({ quality: "invalid" }, schema)).toEqual({ data: {}, valid: false })
  })
})
