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
      { id: "radial", action: "reader.next-page", context: "reader", enabled: true, input: { device: "radial", menuId: "default", itemId: "next" } },
      { id: "shell", action: "shell.toggle-top-toolbar-pin", context: "shell", enabled: true, input: { device: "keyboard", code: "KeyT" } },
    ]
    expect(parseNeoviewInputBindingsConfig({ items: bindings }).bindings).toHaveLength(9)
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

  it("[neoview.bindings.repeat-policy] persists the repeat policy on every binding type and defaults to dispatching repeats", () => {
    const parsed = parseNeoviewInputBindingsPatch({ inputBindings: { bindings: [
      { id: "key", action: "reader.next-page", context: "reader", enabled: true, ignoreRepeat: true, input: { device: "keyboard", code: "ArrowRight" } },
      { id: "mouse", action: "reader.previous-page", context: "reader", enabled: true, input: { device: "mouse", button: 3, action: "click" } },
      { id: "pad", action: "reader.next-page", context: "reader", enabled: true, ignoreRepeat: false, input: { device: "gamepad", button: 5 } },
    ] } })

    expect(parsed.patch.inputBindings.bindings).toEqual([
      { id: "key", action: "reader.next-page", context: "reader", enabled: true, ignoreRepeat: true, input: { device: "keyboard", code: "ArrowRight" } },
      { id: "mouse", action: "reader.previous-page", context: "reader", enabled: true, input: { device: "mouse", button: 3, action: "click" } },
      { id: "pad", action: "reader.next-page", context: "reader", enabled: true, input: { device: "gamepad", button: 5 } },
    ])
    expect(() => parseNeoviewInputBindingsPatch({ inputBindings: { bindings: [
      { id: "invalid", action: "reader.next-page", context: "reader", enabled: true, ignoreRepeat: "yes", input: { device: "keyboard", code: "ArrowRight" } },
    ] } })).toThrow("ignoreRepeat must be a boolean")
  })

  it("[neoview.bindings.action-sequence-config] persists up to seven follow-up actions and defaults old bindings to one action", () => {
    const legacy = { id: "legacy", action: "file.delete-current", context: "reader", enabled: true, input: { device: "keyboard", code: "Delete" } }
    const sequence = { ...legacy, id: "sequence", followUpActions: ["reader.next-book", "reader.first-page"], input: { device: "keyboard", code: "KeyD" } }
    const parsed = parseNeoviewInputBindingsPatch({ inputBindings: { bindings: [legacy, sequence] } })

    expect(parsed.patch.inputBindings.bindings).toEqual([legacy, sequence])
    expect(parsed.tomlPatch).toEqual({ bindings: { items: [legacy, sequence] } })
    expect(parseNeoviewInputBindingsConfig({ items: [legacy] }).bindings[0]?.followUpActions).toBeUndefined()
    expect(() => parseNeoviewInputBindingsPatch({ inputBindings: { bindings: [{
      ...legacy,
      followUpActions: Array(8).fill("reader.next-page"),
    }] } })).toThrow("must not contain more than 7 actions")
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
    expect(() => parseNeoviewInputBindingsPatch({ inputBindings: { bindings: [
      { id: "wrong-context", action: "reader.next-page", context: "global", enabled: true, input: { device: "radial", menuId: "default", itemId: "next" } },
    ] } })).toThrow("must be reader")
  })

  it("[neoview.bindings.reset] emits one canonical defaults patch and tolerates opaque legacy keys on read", () => {
    expect(parseNeoviewInputBindingsConfig({ keybindings: { next: ["ArrowRight"] }, radial_menus: { reader: ["next"] } }).bindings.length).toBeGreaterThan(0)
    const reset = parseNeoviewInputBindingsPatch({ inputBindings: { reset: "defaults" } })
    expect(reset.patch).toEqual({ inputBindings: { reset: "defaults" } })
    expect((reset.tomlPatch.bindings as { items: unknown[] }).items.length).toBeGreaterThan(0)
  })
})
