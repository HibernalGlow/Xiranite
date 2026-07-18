import { describe, expect, it } from "vitest"
import { parseNeoviewInputBindingsConfig, parseNeoviewInputBindingsPatch } from "./ReaderInputBindingsConfig.js"

describe("ReaderInputBindingsConfig", () => {
  it("[neoview.bindings.config] parses all supported device descriptors", () => {
    const bindings = [
      { id: "key", action: "reader.next-page", context: "reader", enabled: true, input: { device: "keyboard", code: "KeyN", ctrl: true } },
      { id: "mouse", action: "reader.previous-page", context: "reader", enabled: true, input: { device: "mouse", button: 3, action: "hold", durationMs: 650, moveTolerancePx: 14 } },
      { id: "gesture", action: "reader.previous-page", context: "reader", enabled: true, input: { device: "mouse-gesture", button: 2, directions: ["left", "down"], trigger: "instant" } },
      { id: "wheel", action: "reader.zoom-in", context: "reader", enabled: true, input: { device: "wheel", direction: "up" } },
      { id: "touch", action: "reader.next-page", context: "reader", enabled: true, input: { device: "touch", gesture: "long-press", fingers: 1, durationMs: 700, moveTolerancePx: 10 } },
      { id: "pad", action: "reader.next-page", context: "reader", enabled: true, input: { device: "gamepad", button: 5 } },
      { id: "area", action: "reader.open-settings", context: "reader", enabled: true, input: { device: "area", area: "bottom-right", button: 2, action: "double-click" } },
    ]
    expect(parseNeoviewInputBindingsConfig({ items: bindings }).bindings).toHaveLength(7)
    expect(parseNeoviewInputBindingsPatch({ inputBindings: { bindings } })).toEqual({
      patch: { inputBindings: { bindings } },
      tomlPatch: { bindings: { items: bindings } },
    })
  })

  it("[neoview.bindings.multiple-inputs] preserves multiple devices for one operation and normalizes legacy mouse clicks", () => {
    const bindings = [
      { id: "key", action: "reader.next-page", context: "reader", enabled: true, input: { device: "keyboard", code: "ArrowRight" } },
      { id: "mouse", action: "reader.next-page", context: "reader", enabled: true, input: { device: "mouse", button: 3, click: "single" } },
      { id: "touch", action: "reader.next-page", context: "reader", enabled: true, input: { device: "touch", gesture: "swipe-left", fingers: 1 } },
      { id: "pad", action: "reader.next-page", context: "reader", enabled: true, input: { device: "gamepad", button: 5 } },
    ]
    const parsed = parseNeoviewInputBindingsPatch({ inputBindings: { bindings } })
    expect(parsed.patch.inputBindings.bindings).toHaveLength(4)
    expect(parsed.patch.inputBindings.bindings?.map((binding) => binding.action)).toEqual(Array(4).fill("reader.next-page"))
    expect(parsed.patch.inputBindings.bindings?.[1]?.input).toEqual({ device: "mouse", button: 3, action: "click" })
  })

  it("[neoview.bindings.keyboard-hold] persists hold timing independently from key-down", () => {
    const bindings = [
      { id: "enter-down", action: "reader.next-page", context: "reader", enabled: true, input: { device: "keyboard", code: "Enter" } },
      { id: "enter-hold", action: "radial.open-default", context: "reader", enabled: true, input: { device: "keyboard", code: "Enter", trigger: "hold", durationMs: 450 } },
    ]
    const parsed = parseNeoviewInputBindingsPatch({ inputBindings: { bindings } })
    expect(parsed.patch.inputBindings.bindings).toEqual(bindings)
  })

  it("[neoview.bindings.validation] rejects ambiguous or executable input", () => {
    const same = { device: "keyboard", code: "KeyX" }
    expect(() => parseNeoviewInputBindingsPatch({ inputBindings: { bindings: [
      { id: "one", action: "reader.next-page", context: "reader", enabled: true, input: same },
      { id: "two", action: "reader.previous-page", context: "reader", enabled: true, input: same },
    ] } })).toThrow("conflicting")
    expect(() => parseNeoviewInputBindingsPatch({ inputBindings: { bindings: [
      { id: "bad", action: "system.delete-files", context: "reader", enabled: true, input: same },
    ] } })).toThrow("action")
    expect(() => parseNeoviewInputBindingsPatch({ inputBindings: { bindings: [], command: "rm" } })).toThrow("unsupported")
  })

  it("[neoview.bindings.reset] emits one canonical defaults patch and tolerates opaque legacy keys on read", () => {
    expect(parseNeoviewInputBindingsConfig({ keybindings: { next: ["ArrowRight"] }, radial_menus: { reader: ["next"] } }).bindings.length).toBeGreaterThan(0)
    const reset = parseNeoviewInputBindingsPatch({ inputBindings: { reset: "defaults" } })
    expect(reset.patch).toEqual({ inputBindings: { reset: "defaults" } })
    expect((reset.tomlPatch.bindings as { items: unknown[] }).items.length).toBeGreaterThan(0)
  })
})
