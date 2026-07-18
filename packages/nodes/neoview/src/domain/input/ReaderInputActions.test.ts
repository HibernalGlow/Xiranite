import { describe, expect, it } from "vitest"
import {
  LEGACY_READER_INPUT_ACTION_MAP,
  READER_INPUT_ACTION_DEFINITIONS,
  READER_INPUT_ACTIONS,
  readerInputActionFromLegacyId,
} from "./ReaderInputActions.js"

describe("ReaderInputActions", () => {
  it("[neoview.bindings.action-catalog] freezes every legacy core and provider action", () => {
    expect(Object.keys(LEGACY_READER_INPUT_ACTION_MAP)).toHaveLength(61)
    expect(READER_INPUT_ACTION_DEFINITIONS).toHaveLength(63)
    expect(new Set(READER_INPUT_ACTIONS).size).toBe(READER_INPUT_ACTIONS.length)
    expect(readerInputActionFromLegacyId("nextPage")).toBe("reader.next-page")
    expect(readerInputActionFromLegacyId("viewer.toggleAutoRotate")).toBe("viewer.cycle-auto-rotate")
    expect(readerInputActionFromLegacyId("upscale.toggleTile")).toBe("upscale.toggle-tile")
  })
})
