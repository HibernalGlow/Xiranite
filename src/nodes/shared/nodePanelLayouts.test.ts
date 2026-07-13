import { describe, expect, test } from "vitest"
import { readNodePanelLayout, updateNodePanelLayout } from "./nodePanelLayouts"

describe("nodePanelLayouts", () => {
  test("restores a valid percentage layout in panel order", () => {
    const layouts = { main: { extra: 5, right: 40, left: 60 } }

    expect(readNodePanelLayout(layouts, "main", ["left", "right"])).toEqual({ left: 60, right: 40 })
  })

  test("ignores incomplete or invalid persisted layouts", () => {
    expect(readNodePanelLayout({ main: { left: 60 } }, "main", ["left", "right"])).toBeUndefined()
    expect(readNodePanelLayout({ main: { left: 120, right: -20 } }, "main", ["left", "right"])).toBeUndefined()
    expect(readNodePanelLayout({ main: { left: 55, right: 40 } }, "main", ["left", "right"])).toBeUndefined()
  })

  test("updates one group without discarding sibling layouts", () => {
    const layouts = { vertical: { top: 70, bottom: 30 } }

    expect(updateNodePanelLayout(layouts, "horizontal", { left: 30, right: 70 })).toEqual({
      vertical: { top: 70, bottom: 30 },
      horizontal: { left: 30, right: 70 },
    })
  })
})
