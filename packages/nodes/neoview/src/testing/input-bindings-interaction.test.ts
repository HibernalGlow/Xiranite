import { describe, expect, it, vi } from "vitest"

import type { NeoviewInputBindingsTuiPort } from "../interaction.js"
import { createNeoviewInputBindingsTuiDefinition } from "../interaction.js"
import type { ReaderHeadlessController } from "../core.js"

describe("NeoView input-bindings terminal interaction", () => {
  it("[neoview.bindings.tui] inspects, applies and resets through the canonical configuration port", async () => {
    const current = { bindings: [binding("key", "keyboard"), binding("mouse", "mouse")] }
    const inspect = vi.fn(async () => current)
    const apply = vi.fn(async (bindings) => ({ changed: true, config: { bindings: [...bindings] } }))
    const reset = vi.fn(async () => ({ changed: true, config: current }))
    const port = { inspect, apply, reset } as NeoviewInputBindingsTuiPort
    const definition = createNeoviewInputBindingsTuiDefinition("en", port)

    await expect(definition.run({ action: "inspect" }, () => undefined)).resolves.toMatchObject({ success: true, config: current })
    await expect(definition.run({ action: "apply", bindings: current.bindings }, () => undefined)).resolves.toMatchObject({ success: true, config: current })
    await expect(definition.run({ action: "reset" }, () => undefined)).resolves.toMatchObject({ success: true, config: current })
    expect(apply).toHaveBeenCalledWith(current.bindings, true)
    expect(reset).toHaveBeenCalledWith(true)
  })

  it("[neoview.bindings.tui.data-contract] preserves a complete multi-binding JSON array and confirms writes", () => {
    const schema = createNeoviewInputBindingsTuiDefinition("en", {} as NeoviewInputBindingsTuiPort).schema
    const bindings = [binding("key", "keyboard"), binding("mouse", "mouse")]
    const input = schema.toInput({ action: "apply", bindingsJson: JSON.stringify({ bindings }) })

    expect(input).toEqual({ action: "apply", bindings })
    expect(schema.validate({ bindingsJson: JSON.stringify(bindings) }, input)).toBeNull()
    expect(schema.validate({ bindingsJson: "{" }, { action: "apply", bindings: [] })).toContain("Invalid")
    expect(schema.isDangerous(input)).toBe(true)
    expect(schema.isDangerous({ action: "inspect" })).toBe(false)
    expect(schema.toInput({ action: "dispatch", path: " book.cbz ", inputAction: "nextPage" })).toEqual({
      action: "dispatch", bindings: undefined, path: "book.cbz", inputAction: "reader.next-page",
    })
  })

  it("[neoview.bindings.tui.conflicts] reports shared conflict validation without claiming a write", async () => {
    const port = {
      inspect: vi.fn(), reset: vi.fn(),
      apply: vi.fn(async () => { throw new Error("conflicting enabled bindings") }),
    } as NeoviewInputBindingsTuiPort
    const definition = createNeoviewInputBindingsTuiDefinition("en", port)
    await expect(definition.run({ action: "apply", bindings: [binding("key", "keyboard")] }, () => undefined)).resolves.toEqual({
      success: false, message: "conflicting enabled bindings",
    })
  })

  it("[neoview.bindings.action-dispatch-tui] dispatches through an owned headless controller and releases it", async () => {
    const snapshot = readerSnapshot()
    const dispose = vi.fn(async () => undefined)
    const next = vi.fn(async () => snapshot)
    const controller = {
      open: vi.fn(async () => snapshot), inspect: vi.fn(() => snapshot), next,
      [Symbol.asyncDispose]: dispose,
    } as unknown as ReaderHeadlessController
    const definition = createNeoviewInputBindingsTuiDefinition("en", {} as NeoviewInputBindingsTuiPort, async () => controller)

    await expect(definition.run({ action: "dispatch", path: "book.cbz", inputAction: "reader.next-page" }, () => undefined)).resolves.toMatchObject({
      success: true, dispatch: { handled: true, action: "reader.next-page" },
    })
    expect(next).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
  })
})

function binding(id: string, device: "keyboard" | "mouse") {
  return {
    id,
    action: "reader.next-page" as const,
    context: "reader" as const,
    enabled: true,
    input: device === "keyboard"
      ? { device, code: "ArrowRight" } as const
      : { device, button: 3, action: "click" } as const,
  }
}

function readerSnapshot() {
  return {
    book: { displayName: "book.cbz", pageCount: 2 },
    frame: {
      generation: 0, anchorPageIndex: 0, direction: "left-to-right" as const,
      layout: { pageMode: "single" as const, panorama: false, singleFirstPage: true, singleLastPage: true, treatWidePageAsSingle: true },
      pages: [{ pageId: "page-1", pageIndex: 0, side: "single" as const }], pageCount: 2, atStart: true, atEnd: false,
    },
    visiblePages: [{ id: "page-1", index: 0, name: "1.jpg", mediaKind: "image" as const, contentVersion: "v1" }],
  }
}
