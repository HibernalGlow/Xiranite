import { describe, expect, it } from "vitest"

import { parseNeoviewRuntimeConfig, parseNeoviewViewDefaultsPatch } from "./ReaderRuntimeConfig.js"

describe("NeoView mouse cursor configuration", () => {
  it("[neoview.viewer.cursor-auto-hide-config] reads migration defaults and the legacy reader.view mouseCursor shape", () => {
    expect(parseNeoviewRuntimeConfig(undefined).viewDefaults.mouseCursor).toEqual({
      autoHide: true,
      hideDelay: 0.8,
      showMovementThreshold: 26,
      showOnButtonClick: false,
      showOnKeyDown: false,
      showOnWheel: false,
    })
    expect(parseNeoviewRuntimeConfig({ reader: { view: { mouseCursor: {
      autoHide: false,
      hideDelay: 1.4,
      showMovementThreshold: 34,
      showOnButtonClick: true,
      showOnKeyDown: true,
      showOnWheel: true,
    } } } }).viewDefaults.mouseCursor).toEqual({
      autoHide: false,
      hideDelay: 1.4,
      showMovementThreshold: 34,
      showOnButtonClick: true,
      showOnKeyDown: true,
      showOnWheel: true,
    })
  })

  it("writes a bounded canonical mouse_cursor patch", () => {
    expect(parseNeoviewViewDefaultsPatch({ viewDefaults: { mouseCursor: {
      autoHide: false,
      hideDelay: 1.2,
      showMovementThreshold: 42,
      showOnButtonClick: true,
      showOnKeyDown: false,
      showOnWheel: true,
    } } })).toEqual({
      patch: { viewDefaults: { mouseCursor: {
        autoHide: false,
        hideDelay: 1.2,
        showMovementThreshold: 42,
        showOnButtonClick: true,
        showOnKeyDown: false,
        showOnWheel: true,
      } } },
      tomlPatch: { view: { mouse_cursor: {
        auto_hide: false,
        hide_delay: 1.2,
        show_movement_threshold: 42,
        show_on_button_click: true,
        show_on_key_down: false,
        show_on_wheel: true,
      } } },
    })
    expect(() => parseNeoviewViewDefaultsPatch({ viewDefaults: { mouseCursor: { showMovementThreshold: 1_001 } } })).toThrow("mouseCursor.showMovementThreshold")
    expect(() => parseNeoviewViewDefaultsPatch({ viewDefaults: { mouseCursor: {} } })).toThrow("must change at least one")
  })
})
