import { describe, expect, test } from "vitest"
import { czkawkaScanPresetFromValues, czkawkaScanPresetToValues, deleteCzkawkaScanPreset, exportCzkawkaScanPresets, importCzkawkaScanPresets, saveCzkawkaScanPreset } from "./scan-presets.js"

describe("shared Czkawka scan presets", () => {
  test("creates and overwrites a canonical preset without operation fields", () => {
    const created = saveCzkawkaScanPreset([], { name: "Photos", input: { tool: "similar-images", includedDirectories: ["D:/Photos"], similarity: 8, selectedPaths: ["no"], dryRun: false }, now: 10, createId: () => "photo" })
    expect(created.preset).toMatchObject({ id: "photo", name: "Photos", tool: "similar-images", createdAt: 10, updatedAt: 10, input: { action: "scan", includedDirectories: ["D:/Photos"], similarity: 8 } })
    expect(created.preset.input).not.toHaveProperty("selectedPaths")
    const updated = saveCzkawkaScanPreset(created.presets, { id: "photo", name: "Photos HQ", input: { tool: "similar-images", similarity: 3 }, now: 20 })
    expect(updated.presets).toHaveLength(1)
    expect(updated.preset).toMatchObject({ id: "photo", name: "Photos HQ", createdAt: 10, updatedAt: 20, input: { similarity: 3 } })
  })

  test("round trips every surface through canonical input", () => {
    const { preset } = czkawkaScanPresetFromValues("Videos", { tool: "similar-videos", includedDirectoriesText: "D:/Videos\nE:/Archive", excludedItemsText: "*.part; */cache/*", similarity: "6", similarVideosHashDuration: "24", recursive: false }, { now: 1, createId: () => "videos" })
    expect(preset.input).toMatchObject({ tool: "similar-videos", includedDirectories: ["D:/Videos", "E:/Archive"], excludedItems: ["*.part", "*/cache/*"], similarity: 6, similarVideosHashDuration: 24, recursive: false })
    expect(czkawkaScanPresetToValues(preset)).toMatchObject({ tool: "similar-videos", includedDirectoriesText: "D:/Videos\nE:/Archive", excludedItemsText: "*.part; */cache/*", similarity: "6", similarVideosHashDuration: "24", recursive: false })
  })

  test("exports, merges, replaces, and deletes versioned documents", () => {
    const first = czkawkaScanPresetFromValues("One", { tool: "empty-files" }, { now: 1, createId: () => "one" }).preset
    const second = czkawkaScanPresetFromValues("Two", { tool: "big-files" }, { now: 2, createId: () => "two" }).preset
    const text = exportCzkawkaScanPresets([second])
    expect(importCzkawkaScanPresets(text, [first], "merge").map((preset) => preset.id)).toEqual(["one", "two"])
    expect(importCzkawkaScanPresets(text, [first], "replace").map((preset) => preset.id)).toEqual(["two"])
    expect(deleteCzkawkaScanPreset([first, second], "one")).toEqual([second])
  })

  test("rejects unknown or malformed documents", () => {
    expect(() => importCzkawkaScanPresets('{"version":2,"presets":[]}')).toThrow("Unsupported")
    expect(() => importCzkawkaScanPresets(JSON.stringify({ schema: "xiranite.czkawka.scan-presets", version: 1, presets: [{}] }))).toThrow("Invalid")
  })
})
