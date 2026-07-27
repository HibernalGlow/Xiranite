import { useRef } from "react"
import { expect, test } from "vitest"
import { render } from "vitest-browser-react"
import { DEFAULT_READER_MOUSE_CURSOR_SETTINGS, type ReaderMouseCursorSettings } from "@xiranite/node-neoview/ui-core"

import { useReaderMouseCursorAutoHide } from "./useReaderMouseCursorAutoHide"

test("[neoview.viewer.cursor-auto-hide] hides after idle, requires configured movement, and restores at the viewport boundary", async () => {
  await render(<CursorHarness settings={{ ...DEFAULT_READER_MOUSE_CURSOR_SETTINGS, hideDelay: 0, showMovementThreshold: 26 }} />)
  const viewport = document.querySelector<HTMLElement>("[data-testid='reader-cursor-viewport']")!

  pointer(viewport, "pointerenter", 10, 10)
  await expect.poll(() => viewport.dataset.readerCursorHidden).toBe("true")

  pointer(viewport, "pointermove", 25, 10)
  expect(viewport.dataset.readerCursorHidden).toBe("true")
  pointer(viewport, "pointermove", 35, 10)
  expect(viewport.dataset.readerCursorHidden).toBe("true")
  pointer(viewport, "pointermove", 37, 10)
  expect(viewport.dataset.readerCursorHidden).toBeUndefined()

  await expect.poll(() => viewport.dataset.readerCursorHidden).toBe("true")
  viewport.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }))
  expect(viewport.dataset.readerCursorHidden).toBeUndefined()
})

test("[neoview.viewer.cursor-auto-hide-wake-events] honors button, key and wheel wake-up preferences", async () => {
  await render(<CursorHarness settings={{
    ...DEFAULT_READER_MOUSE_CURSOR_SETTINGS,
    hideDelay: 0,
    showOnButtonClick: true,
    showOnKeyDown: true,
    showOnWheel: true,
  }} />)
  const viewport = document.querySelector<HTMLElement>("[data-testid='reader-cursor-viewport']")!

  pointer(viewport, "pointerenter", 10, 10)
  await expect.poll(() => viewport.dataset.readerCursorHidden).toBe("true")
  pointer(viewport, "pointerdown", 10, 10)
  expect(viewport.dataset.readerCursorHidden).toBeUndefined()

  await expect.poll(() => viewport.dataset.readerCursorHidden).toBe("true")
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }))
  expect(viewport.dataset.readerCursorHidden).toBeUndefined()

  await expect.poll(() => viewport.dataset.readerCursorHidden).toBe("true")
  viewport.dispatchEvent(new WheelEvent("wheel", { bubbles: true, clientX: 10, clientY: 10 }))
  expect(viewport.dataset.readerCursorHidden).toBeUndefined()
})

test("[neoview.viewer.cursor-auto-hide-input-boundary] wakes without consuming existing key or wheel input", async () => {
  await render(<CursorHarness settings={{
    ...DEFAULT_READER_MOUSE_CURSOR_SETTINGS,
    hideDelay: 0,
    showOnKeyDown: true,
    showOnWheel: true,
  }} />)
  const viewport = document.querySelector<HTMLElement>("[data-testid='reader-cursor-viewport']")!
  const observedKeys: string[] = []
  let observedWheels = 0
  const observeKey = (event: KeyboardEvent) => observedKeys.push(event.key)
  const observeWheel = () => { observedWheels += 1 }
  window.addEventListener("keydown", observeKey)
  viewport.addEventListener("wheel", observeWheel)

  try {
    pointer(viewport, "pointerenter", 10, 10)
    await expect.poll(() => viewport.dataset.readerCursorHidden).toBe("true")
    const keyEvent = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowRight" })
    expect(window.dispatchEvent(keyEvent)).toBe(true)
    expect(keyEvent.defaultPrevented).toBe(false)
    expect(observedKeys).toEqual(["ArrowRight"])
    expect(viewport.dataset.readerCursorHidden).toBeUndefined()

    await expect.poll(() => viewport.dataset.readerCursorHidden).toBe("true")
    const wheelEvent = new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
    expect(viewport.dispatchEvent(wheelEvent)).toBe(true)
    expect(wheelEvent.defaultPrevented).toBe(false)
    expect(observedWheels).toBe(1)
    expect(viewport.dataset.readerCursorHidden).toBeUndefined()
  } finally {
    window.removeEventListener("keydown", observeKey)
    viewport.removeEventListener("wheel", observeWheel)
  }
})

function CursorHarness({ settings }: { settings: ReaderMouseCursorSettings }) {
  const ref = useRef<HTMLDivElement>(null)
  useReaderMouseCursorAutoHide(ref, settings)
  return <div ref={ref} data-testid="reader-cursor-viewport" style={{ height: 120, width: 240 }} />
}

function pointer(target: HTMLElement, type: string, clientX: number, clientY: number) {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX, clientY }))
}
