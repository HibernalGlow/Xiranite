import { describe, expect, test } from "vitest"

import {
  createCzkawkaImageComparison,
  czkawkaImageComparisonPreferences,
  getCzkawkaImageComparisonEntries,
  openCzkawkaImageComparison,
  setCzkawkaImageComparisonColorCoding,
  setCzkawkaImageComparisonMode,
  setCzkawkaImageComparisonOpacity,
  setCzkawkaImageComparisonSwipe,
  setCzkawkaImageComparisonTarget,
} from "./image-comparison.js"

const groups = [{
  id: 4,
  totalBytes: 60,
  reclaimableBytes: 20,
  entries: [
    { id: "a", groupId: 4, path: "D:/a.jpg", name: "a.jpg", size: 10, modifiedDate: 1, width: 100, height: 80 },
    { id: "b", groupId: 4, path: "D:/b.jpg", name: "b.jpg", size: 20, modifiedDate: 2, width: 80, height: 100 },
    { id: "c", groupId: 4, path: "D:/c.jpg", name: "c.jpg", size: 30, modifiedDate: 3, width: 100, height: 100 },
  ],
}]

describe("Czkawka image comparison state", () => {
  test("opens against another image from the same result group", () => {
    const state = openCzkawkaImageComparison(createCzkawkaImageComparison(), groups, "D:/b.jpg")

    expect(state).toMatchObject({ activePath: "D:/b.jpg", targetPath: "D:/a.jpg", mode: "single", swipePercent: 50, onionOpacity: 50 })
    expect(getCzkawkaImageComparisonEntries(state, groups)).toMatchObject({
      active: { path: "D:/b.jpg" },
      target: { path: "D:/a.jpg" },
      group: expect.arrayContaining([expect.objectContaining({ path: "D:/c.jpg" })]),
    })
  })

  test("resets comparison controls when the source or target changes", () => {
    let state = openCzkawkaImageComparison(createCzkawkaImageComparison(), groups, "D:/a.jpg")
    state = setCzkawkaImageComparisonSwipe(state, 72)
    state = setCzkawkaImageComparisonOpacity(state, 24)
    state = setCzkawkaImageComparisonTarget(state, groups, "D:/c.jpg")
    expect(state).toMatchObject({ activePath: "D:/a.jpg", targetPath: "D:/c.jpg", swipePercent: 50, onionOpacity: 50 })

    state = openCzkawkaImageComparison({ ...state, swipePercent: 10, onionOpacity: 90 }, groups, "D:/b.jpg")
    expect(state).toMatchObject({ activePath: "D:/b.jpg", targetPath: "D:/a.jpg", swipePercent: 50, onionOpacity: 50 })
  })

  test("keeps only valid group targets and clamps accessible slider values", () => {
    let state = openCzkawkaImageComparison(createCzkawkaImageComparison(), groups, "D:/a.jpg")
    state = setCzkawkaImageComparisonTarget(state, groups, "D:/a.jpg")
    expect(state.targetPath).toBe("D:/b.jpg")
    state = setCzkawkaImageComparisonTarget(state, groups, "D:/missing.jpg")
    expect(state.targetPath).toBe("D:/b.jpg")
    state = setCzkawkaImageComparisonSwipe(state, 110.4)
    state = setCzkawkaImageComparisonOpacity(state, -4)
    expect(state).toMatchObject({ swipePercent: 100, onionOpacity: 0 })
  })

  test("persists only the durable view preferences", () => {
    let state = createCzkawkaImageComparison()
    state = setCzkawkaImageComparisonMode(state, "onion-skin")
    state = setCzkawkaImageComparisonColorCoding(state, true)

    expect(czkawkaImageComparisonPreferences(state)).toEqual({ mode: "onion-skin", colorCoding: true })
  })
})
