import { describe, expect, it } from "vitest"

import { activateSwimlane, adjacentSwimlane, effectiveSwimlaneWidth, normalizeSwimlaneOrder, normalizeSwimlanePreferences, reorderSwimlanes } from "./model"

describe("swimlane model", () => {
  it("normalizes persisted order without losing known lanes", () => {
    expect(normalizeSwimlaneOrder(["right", "future", "right"], ["left", "reader", "right"])).toEqual(["right", "left", "reader"])
  })

  it("reorders lanes before the drop target", () => {
    expect(reorderSwimlanes(["left", "reader", "right"], "right", "left")).toEqual(["right", "left", "reader"])
  })

  it("resolves adjacent lanes", () => {
    expect(adjacentSwimlane(["left", "reader", "right"], "reader", "left")).toBe("left")
    expect(adjacentSwimlane(["left", "reader", "right"], "reader", "right")).toBe("right")
  })

  it("keeps solo preference while another lane is active", () => {
    const state = activateSwimlane({ laneOrder: ["reader", "right"], activeLaneId: "reader", soloLaneId: "reader" }, "right")
    expect(state).toEqual({ laneOrder: ["reader", "right"], activeLaneId: "right", soloLaneId: "reader" })
    expect(effectiveSwimlaneWidth(800, false, "reader", state, 1200)).toBe(1200)
    expect(effectiveSwimlaneWidth(800, false, "reader", { ...state, activeLaneId: "reader" }, 1200)).toBe(1200)
  })

  it("normalizes workspace interaction preferences", () => {
    expect(normalizeSwimlanePreferences({ focusOnHover: true, focusDelayMs: 10, edgeRevealDelayMs: 9000, barHandleStyle: "groove", barHandlePosition: "right" })).toMatchObject({
      focusOnHover: true,
      focusDelayMs: 200,
      edgeRevealDelayMs: 5000,
      barHandleStyle: "groove",
      barHandlePosition: "right",
    })
  })
})
