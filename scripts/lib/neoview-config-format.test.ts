import { describe, expect, it } from "bun:test"
import { inspectNeoviewConfigFormat } from "./neoview-config-format"

describe("NeoView config format audit", () => {
  it("accepts the canonical inline config envelope", () => {
    expect(inspectNeoviewConfigFormat('[nodes.neoview]\nconfig = { reader = { double_page_view = true } }\n').format).toBe("optimized")
  })

  it("warns for compatible legacy and mixed inputs", () => {
    expect(inspectNeoviewConfigFormat("[nodes.neoview.reader]\ndouble_page_view = true\n").format).toBe("legacy")
    expect(inspectNeoviewConfigFormat('[nodes.neoview]\nconfig = { reader = { double_page_view = true } }\n[nodes.neoview.reader]\nreading_direction = "right-to-left"\n').format).toBe("mixed")
  })

  it("rejects malformed envelopes", () => {
    expect(inspectNeoviewConfigFormat('[nodes.neoview]\nconfig = "bad"\n').format).toBe("invalid")
    expect(inspectNeoviewConfigFormat("[nodes.neoview\n").format).toBe("invalid")
  })
})
