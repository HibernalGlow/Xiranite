import { describe, expect, it } from "vitest"
import { convertLegacyReaderInputBindings } from "./ReaderLegacyInputBindings.js"

describe("ReaderLegacyInputBindings", () => {
  it("[neoview.bindings.legacy-action-conversion] preserves every binding and context for one action", () => {
    const result = convertLegacyReaderInputBindings([{
      action: "nextPage",
      bindings: [
        { type: "keyboard", key: "Ctrl+ArrowRight" },
        { type: "mouse", gesture: "click", button: "right", action: "click" },
        { type: "touch", gesture: "swipe-left" },
      ],
      contextBindings: [{ context: "videoPlayer", input: { type: "keyboard", key: "Space" } }],
    }])
    expect(result.bindings).toHaveLength(4)
    expect(result.bindings.map((binding) => binding.action)).toEqual(Array(4).fill("reader.next-page"))
    expect(result.bindings[0]?.input).toMatchObject({ device: "keyboard", code: "ArrowRight", ctrl: true })
    expect(result.bindings[3]?.context).toBe("video")
    expect(result.report.every((entry) => entry.status === "converted")).toBe(true)
  })

  it("[neoview.bindings.legacy-action-report] reports unknown actions and inputs without inventing behavior", () => {
    const result = convertLegacyReaderInputBindings([
      { action: "plugin.unknown", bindings: [{ type: "keyboard", key: "K" }] },
      { action: "nextPage", bindings: [{ type: "touch", gesture: "pinch-out" }] },
    ])
    expect(result.bindings).toEqual([])
    expect(result.report.map((entry) => entry.status)).toEqual(["skipped", "skipped"])
  })

  it("[neoview.bindings.legacy-conflicts] preserves multiple bindings and disables only ambiguous legacy collisions", () => {
    const result = convertLegacyReaderInputBindings([
      { action: "nextPage", bindings: [{ type: "keyboard", key: "ArrowRight" }, { type: "keyboard", key: "Space" }] },
      { action: "prevPage", bindings: [{ type: "keyboard", key: "ArrowRight" }] },
    ])

    expect(result.bindings).toHaveLength(3)
    expect(result.bindings.filter((binding) => binding.action === "reader.next-page")).toHaveLength(2)
    expect(result.bindings[2]).toMatchObject({ action: "reader.previous-page", enabled: false })
    expect(result.report).toContainEqual(expect.objectContaining({ bindingId: result.bindings[2]?.id, status: "converted", message: expect.stringContaining("conflicting") }))
  })
})
