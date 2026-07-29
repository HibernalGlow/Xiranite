import { z } from "zod"
import { describe, expect, it } from "vitest"
import { NODE_APP_HOST_CAPABILITIES, nodeAppHostHasCapability } from "./nodeAppHostContract"
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

describe("node app host capability reporting", () => {
  it("accepts only capabilities implemented by the shared node host", () => {
    expect(NODE_APP_HOST_CAPABILITIES).toContain("config")
    expect(nodeAppHostHasCapability("localFiles")).toBe(true)
    expect(nodeAppHostHasCapability("workspace")).toBe(false)
  })
})
