import { describe, expect, it } from "vitest"

import { READER_PANEL_POINTER_ACTIVATION } from "./ReaderPanelDnd"

describe("ReaderPanelDnd", () => {
  it("[neoview.panel-rail.click-before-drag] reserves a short click for switching and requires a deliberate hold to drag", () => {
    expect(READER_PANEL_POINTER_ACTIVATION).toEqual({ delay: 500, tolerance: 8 })
  })
})
