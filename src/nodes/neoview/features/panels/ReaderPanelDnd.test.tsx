import { describe, expect, it } from "vitest"

import { READER_PANEL_POINTER_ACTIVATION } from "./ReaderPanelDnd"

describe("ReaderPanelDnd", () => {
  it("[neoview.panel-rail.click-before-drag] requires a deliberate pointer move before a rail drag starts", () => {
    expect(READER_PANEL_POINTER_ACTIVATION).toEqual({ distance: 14 })
  })
})
