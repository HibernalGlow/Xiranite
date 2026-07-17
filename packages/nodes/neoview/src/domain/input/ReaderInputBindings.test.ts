import { describe, expect, it } from "vitest"
import {
  DEFAULT_READER_INPUT_BINDINGS,
  matchingReaderInputBinding,
  readerInputConflicts,
  readerInputDescriptorKey,
  type ReaderInputBinding,
} from "./ReaderInputBindings.js"

describe("ReaderInputBindings", () => {
  it("[neoview.bindings.context-routing] prefers the most specific active context", () => {
    const bindings: ReaderInputBinding[] = [
      { id: "global", action: "reader.open-settings", context: "global", enabled: true, input: { device: "keyboard", code: "KeyK" } },
      { id: "reader", action: "reader.next-page", context: "reader", enabled: true, input: { device: "keyboard", code: "KeyK" } },
      { id: "panel", action: "reader.previous-page", context: "panel", enabled: true, input: { device: "keyboard", code: "KeyK" } },
    ]
    expect(matchingReaderInputBinding(bindings, { device: "keyboard", code: "KeyK" }, ["reader", "panel"])?.id).toBe("panel")
    expect(matchingReaderInputBinding(bindings, { device: "keyboard", code: "KeyK" }, ["reader"])?.id).toBe("reader")
    expect(matchingReaderInputBinding(bindings, { device: "keyboard", code: "KeyK" }, [])?.id).toBe("global")
    expect(matchingReaderInputBinding(bindings, { device: "keyboard", code: "KeyK" }, ["editor"])).toBeUndefined()
    expect(matchingReaderInputBinding(bindings, { device: "keyboard", code: "KeyK" }, ["modal"])).toBeUndefined()
  })

  it("[neoview.bindings.conflicts] detects enabled collisions only inside one context", () => {
    const bindings: ReaderInputBinding[] = [
      { id: "one", action: "reader.next-page", context: "reader", enabled: true, input: { device: "gamepad", button: 5 } },
      { id: "two", action: "reader.previous-page", context: "reader", enabled: true, input: { device: "gamepad", button: 5 } },
      { id: "panel", action: "reader.previous-page", context: "panel", enabled: true, input: { device: "gamepad", button: 5 } },
      { id: "off", action: "reader.zoom-in", context: "reader", enabled: false, input: { device: "gamepad", button: 5 } },
    ]
    expect(readerInputConflicts(bindings)).toEqual([{ key: "reader:gamepad:5", bindingIds: ["one", "two"] }])
  })

  it("[neoview.bindings.devices] normalizes keyboard, mouse, wheel, touch and gamepad inputs", () => {
    expect(readerInputDescriptorKey({ device: "keyboard", code: "KeyR", ctrl: true })).toBe("keyboard:C---:KeyR")
    expect(readerInputDescriptorKey({ device: "mouse", button: 3, click: "single" })).toBe("mouse:3:single")
    expect(readerInputDescriptorKey({ device: "wheel", direction: "down", shift: true })).toBe("wheel:--S-:down")
    expect(readerInputDescriptorKey({ device: "touch", gesture: "swipe-left", fingers: 2 })).toBe("touch:2:swipe-left")
    expect(readerInputDescriptorKey({ device: "gamepad", button: 5 })).toBe("gamepad:5")
    expect(DEFAULT_READER_INPUT_BINDINGS.bindings.some((current) => current.input.device === "touch")).toBe(true)
    expect(DEFAULT_READER_INPUT_BINDINGS.bindings.some((current) => current.input.device === "gamepad")).toBe(true)
  })
})
