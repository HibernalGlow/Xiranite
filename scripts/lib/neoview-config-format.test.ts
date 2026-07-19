import { describe, expect, it } from "bun:test"
import { inspectNeoviewConfigFormat } from "./neoview-config-format"

describe("NeoView config format audit", () => {
  it("accepts first-level sections with deeper inline values", () => {
    expect(inspectNeoviewConfigFormat('[nodes.neoview]\nschema_version = 1\n[nodes.neoview.reader]\ndouble_page_view = true\nsubtitle = { font_size = 24 }\n').format).toBe("optimized")
  })

  it("warns for compatible envelopes, deep legacy tables, and mixed inputs", () => {
    expect(inspectNeoviewConfigFormat('[nodes.neoview]\nconfig = { reader = { double_page_view = true } }\n').format).toBe("envelope")
    expect(inspectNeoviewConfigFormat("[nodes.neoview.reader.subtitle]\nfont_size = 24\n").format).toBe("legacy")
    expect(inspectNeoviewConfigFormat('[nodes.neoview]\nconfig = { reader = { double_page_view = true } }\n[nodes.neoview.reader]\nreading_direction = "right-to-left"\n').format).toBe("mixed")
  })

  it("rejects malformed envelopes", () => {
    expect(inspectNeoviewConfigFormat('[nodes.neoview]\nconfig = "bad"\n').format).toBe("invalid")
    expect(inspectNeoviewConfigFormat("[nodes.neoview\n").format).toBe("invalid")
  })
})
