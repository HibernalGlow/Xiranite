import { describe, expect, test } from "vitest"
import type { CzkawkaEntry, CzkawkaGroup } from "@xiranite/node-czkawka/core"
import { applyResultSelection, calculateVirtualWindow, CZKAWKA_RESULT_COLUMNS, filterAndSortResultGroups } from "./result-table"

const entries = [entry("a", 30), entry("b", 10), entry("c", 20)]
const group: CzkawkaGroup = { id: 0, entries, totalBytes: 60, reclaimableBytes: 30 }

describe("Czkawka result table model", () => {
  test("defines fork-specific columns for every tool", () => {
    expect(Object.keys(CZKAWKA_RESULT_COLUMNS)).toHaveLength(11)
    expect(CZKAWKA_RESULT_COLUMNS["similar-images"].map((item) => item.id)).toEqual(expect.arrayContaining(["similarity", "dimensions", "groupSize"]))
    expect(CZKAWKA_RESULT_COLUMNS["duplicate-music"].map((item) => item.id)).toEqual(expect.arrayContaining(["title", "artist", "year", "bitrate", "length"]))
    expect(CZKAWKA_RESULT_COLUMNS["invalid-symlinks"].map((item) => item.id)).toEqual(expect.arrayContaining(["target", "error"]))
    expect(CZKAWKA_RESULT_COLUMNS["bad-extensions"].map((item) => item.id)).toEqual(expect.arrayContaining(["currentExtension", "properExtension"]))
  })

  test("sorts through the active tool column definition", () => {
    const result = filterAndSortResultGroups([group], CZKAWKA_RESULT_COLUMNS["big-files"], "", { id: "size", descending: true })
    expect(result[0]?.entries.map((item) => item.path)).toEqual(["a", "c", "b"])
  })

  test("supports replace, ctrl toggle, and shift range selection", () => {
    expect(applyResultSelection(["a"], entries, "b", true, "replace")).toEqual(["b"])
    expect(applyResultSelection(["a"], entries, "b", true, "toggle")).toEqual(["a", "b"])
    expect(applyResultSelection(["a"], entries, "c", true, "range", "a")).toEqual(["a", "b", "c"])
  })

  test("calculates a bounded overscanned window for ten thousand rows", () => {
    expect(calculateVirtualWindow(10_000, 0, 520, 52, 8)).toEqual({ start: 0, end: 18 })
    expect(calculateVirtualWindow(10_000, 4_236, 520, 52, 8)).toEqual({ start: 73, end: 100 })
  })
})

function entry(path: string, size: number): CzkawkaEntry { return { id: path, groupId: 0, path, name: `${path}.jpg`, size, modifiedDate: size } }
