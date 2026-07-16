import { describe, expect, it } from "vitest"

import {
  createDirectorySelection,
  directorySelectionCount,
  extendDirectorySelection,
  isDirectoryIndexSelected,
  rebaseDirectorySelection,
  selectedLoadedDirectoryPaths,
  selectDirectorySingle,
  toggleDirectorySelection,
} from "./DirectorySelection"

describe("DirectorySelection", () => {
  it("[neoview.folder.selection-range-sparse] represents a 100K Shift range without materializing paths", () => {
    const anchored = selectDirectorySingle(7, "D:/library/item-10", 10)
    const selected = extendDirectorySelection(anchored, 7, 99_999, { additive: false, fallbackAnchor: 0 })

    expect(selected.ranges).toEqual([{ start: 10, end: 99_999 }])
    expect(selected.explicit.size).toBe(1)
    expect(directorySelectionCount(selected)).toBe(99_990)
    expect(isDirectoryIndexSelected(selected, 50_000)).toBe(true)
    expect(isDirectoryIndexSelected(selected, 9)).toBe(false)
  })

  it("[neoview.folder.selection-chain] merges additive ranges and toggles one index without scanning the range", () => {
    let selected = extendDirectorySelection(createDirectorySelection(3), 3, 20, { additive: false, fallbackAnchor: 10 })
    selected = extendDirectorySelection({ ...selected, anchorIndex: 30 }, 3, 40, { additive: true, fallbackAnchor: 0 })
    selected = toggleDirectorySelection(selected, 3, "D:/library/item-35", 35)

    expect(selected.ranges).toEqual([{ start: 10, end: 20 }, { start: 30, end: 34 }, { start: 36, end: 40 }])
    expect(directorySelectionCount(selected)).toBe(21)
    expect(isDirectoryIndexSelected(selected, 35, "D:/library/item-35")).toBe(false)
  })

  it("removes an explicit Shift endpoint when Ctrl toggles it off", () => {
    const anchored = selectDirectorySingle(4, "D:/library/item-10", 10)
    const ranged = extendDirectorySelection(anchored, 4, 20, {
      additive: false,
      fallbackAnchor: 0,
      endPath: "D:/library/item-20",
    })
    const selected = toggleDirectorySelection(ranged, 4, "D:/library/item-20", 20)

    expect(selected.ranges).toEqual([{ start: 10, end: 19 }])
    expect(selected.explicit.has("D:/library/item-20")).toBe(false)
    expect(directorySelectionCount(selected)).toBe(10)
    expect(isDirectoryIndexSelected(selected, 20, "D:/library/item-20")).toBe(false)
  })

  it("[neoview.folder.selection-loaded-pages] projects ranges only onto bounded loaded pages", () => {
    const selected = extendDirectorySelection(createDirectorySelection(1), 1, 9_999, { additive: false, fallbackAnchor: 0 })
    const loaded = selectedLoadedDirectoryPaths(selected, new Map([
      [0, [{ path: "item-0" }, { path: "item-1" }]],
      [9_998, [{ path: "item-9998" }, { path: "item-9999" }]],
    ]))

    expect([...loaded]).toEqual(["item-0", "item-1", "item-9998", "item-9999"])
    expect(loaded.size).toBe(4)
  })

  it("[neoview.folder.selection-generation] preserves explicit identity but drops unsafe ranges after reorder", () => {
    let selected = selectDirectorySingle(1, "D:/library/keep.cbz", 5)
    selected = extendDirectorySelection(selected, 1, 50, {
      additive: true,
      fallbackAnchor: 0,
      endPath: "D:/library/end.cbz",
    })
    const rebased = rebaseDirectorySelection(selected, 2)

    expect(rebased.ranges).toEqual([])
    expect(rebased.explicit).toEqual(new Map([
      ["D:/library/keep.cbz", undefined],
      ["D:/library/end.cbz", undefined],
    ]))
    expect(isDirectoryIndexSelected(rebased, 999, "D:/library/keep.cbz")).toBe(true)
    expect(isDirectoryIndexSelected(rebased, 0, "D:/library/end.cbz")).toBe(true)
  })
})
