import { describe, expect, it } from "vitest"

import {
  chainDirectorySelection,
  createDirectorySelection,
  directorySelectionDescriptor,
  directorySelectionCount,
  extendDirectorySelection,
  invertDirectorySelection,
  isDirectoryIndexSelected,
  rebaseDirectorySelection,
  selectedLoadedDirectoryPaths,
  selectAllDirectoryEntries,
  selectDirectorySingle,
  toggleDirectorySelection,
} from "./DirectorySelection"

describe("DirectorySelection", () => {
  it("[neoview.folder.selection-range-sparse] represents a 100K Shift range without materializing paths", () => {
    const anchored = selectDirectorySingle(7, "D:/library/item-10", 10)
    const selected = extendDirectorySelection(anchored, 7, 99_999, { additive: false, fallbackAnchor: 0 })

    expect(selected.ranges).toEqual([{ start: 10, end: 99_999 }])
    expect(selected.explicit.size).toBe(1)
    expect(directorySelectionCount(selected, 100_000)).toBe(99_990)
    expect(isDirectoryIndexSelected(selected, 50_000)).toBe(true)
    expect(isDirectoryIndexSelected(selected, 9)).toBe(false)
  })

  it("[neoview.folder.selection-chain] merges additive ranges and toggles one index without scanning the range", () => {
    let selected = extendDirectorySelection(createDirectorySelection(3), 3, 20, { additive: false, fallbackAnchor: 10 })
    selected = extendDirectorySelection({ ...selected, anchorIndex: 30 }, 3, 40, { additive: true, fallbackAnchor: 0 })
    selected = toggleDirectorySelection(selected, 3, "D:/library/item-35", 35)

    expect(selected.ranges).toEqual([{ start: 10, end: 20 }, { start: 30, end: 34 }, { start: 36, end: 40 }])
    expect(directorySelectionCount(selected, 100)).toBe(21)
    expect(isDirectoryIndexSelected(selected, 35, "D:/library/item-35")).toBe(false)
  })

  it("[neoview.folder.selection-chain-mode] advances an independent chain anchor with sparse ranges", () => {
    let selected = selectDirectorySingle(15, "item-10", 10)
    selected = chainDirectorySelection(selected, 15, 20, {
      anchorIndex: 10,
      anchorPath: "item-10",
      endPath: "item-20",
    })
    selected = chainDirectorySelection(selected, 15, 30, {
      anchorIndex: 20,
      anchorPath: "item-20",
      endPath: "item-30",
    })

    expect(selected.ranges).toEqual([{ start: 10, end: 30 }])
    expect(selected.anchorIndex).toBe(30)
    expect(directorySelectionCount(selected, 100_000)).toBe(21)
  })

  it("toggles the first chain item and establishes its anchor", () => {
    const selected = chainDirectorySelection(createDirectorySelection(16), 16, 40, {
      endPath: "item-40",
    })

    expect(selected.anchorIndex).toBe(40)
    expect(isDirectoryIndexSelected(selected, 40, "item-40")).toBe(true)
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
    expect(directorySelectionCount(selected, 100)).toBe(10)
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

  it("[neoview.folder.selection-bulk-sparse] selects and inverts 100K entries in constant model space", () => {
    const all = selectAllDirectoryEntries(8)
    const exceptOne = toggleDirectorySelection(all, 8, "item-50", 50)
    const inverted = invertDirectorySelection(exceptOne, 8)

    expect(all.allSelected).toBe(true)
    expect(all.ranges).toEqual([])
    expect(all.explicit.size).toBe(0)
    expect(directorySelectionCount(all, 100_000)).toBe(100_000)
    expect(directorySelectionCount(exceptOne, 100_000)).toBe(99_999)
    expect(isDirectoryIndexSelected(exceptOne, 50, "item-50")).toBe(false)
    expect(directorySelectionCount(inverted, 100_000)).toBe(1)
    expect(isDirectoryIndexSelected(inverted, 50, "item-50")).toBe(true)
    expect(isDirectoryIndexSelected(inverted, 51, "item-51")).toBe(false)
  })

  it("selects an additive range by removing all-selected exceptions", () => {
    let selected = selectAllDirectoryEntries(9)
    selected = toggleDirectorySelection(selected, 9, "item-20", 20)
    selected = toggleDirectorySelection(selected, 9, "item-21", 21)
    selected = extendDirectorySelection({ ...selected, anchorIndex: 20 }, 9, 21, {
      additive: true,
      fallbackAnchor: 0,
      endPath: "item-21",
    })

    expect(selected.allSelected).toBe(true)
    expect(selected.explicit.size).toBe(0)
    expect(directorySelectionCount(selected, 100)).toBe(100)
  })

  it("keeps both Shift endpoint identities when selecting a range from all-selected state", () => {
    const ranged = extendDirectorySelection(selectAllDirectoryEntries(13), 13, 20, {
      additive: false,
      fallbackAnchor: 10,
      anchorPath: "item-10",
      endPath: "item-20",
    })
    const rebased = rebaseDirectorySelection(ranged, 14)

    expect(ranged.allSelected).toBe(false)
    expect(directorySelectionCount(ranged, 100)).toBe(11)
    expect(rebased.explicit).toEqual(new Map([
      ["item-10", undefined],
      ["item-20", undefined],
    ]))
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

  it("[neoview.folder.selection-bulk-rebase] preserves all-selected path exceptions across reorder", () => {
    let selected = selectAllDirectoryEntries(4)
    selected = toggleDirectorySelection(selected, 4, "D:/library/excluded.cbz", 12)
    const rebased = rebaseDirectorySelection(selected, 5)

    expect(rebased.allSelected).toBe(true)
    expect(rebased.ranges).toEqual([])
    expect(rebased.explicit).toEqual(new Map([["D:/library/excluded.cbz", undefined]]))
    expect(isDirectoryIndexSelected(rebased, 40, "D:/library/excluded.cbz")).toBe(false)
    expect(isDirectoryIndexSelected(rebased, 12, "D:/library/other.cbz")).toBe(true)
  })

  it("[neoview.folder.selection-transport] serializes sparse selection without materializing selected paths", () => {
    let selected = selectAllDirectoryEntries(21)
    selected = toggleDirectorySelection(selected, 21, "D:/library/excluded.cbz", 50_000)
    const descriptor = directorySelectionDescriptor(selected)

    expect(descriptor).toEqual({
      generation: 21,
      allSelected: true,
      ranges: [],
      explicit: [{ path: "D:/library/excluded.cbz", index: 50_000 }],
    })
    expect(JSON.stringify(descriptor).length).toBeLessThan(200)
  })
})
