import { useRef } from "react"
import { expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-react"
import type { ReaderInputAction, ReaderInputBindingsConfig } from "@xiranite/node-neoview/ui-core"

import { ReaderGestureInputRuntime } from "./ReaderGestureInputRuntime"
import { READER_POINTER_DOUBLE_CLICK_WINDOW_MS, useReaderInputRouter } from "./ReaderInputRouter"

test("[neoview.bindings.area-double-click-gui] upgrades two releases to a double-click without firing the competing single-click", async () => {
  const execute = vi.fn()
  await render(<Harness config={{ bindings: [
    { id: "single", action: "reader.previous-page", context: "reader", enabled: true, input: { device: "area", area: "middle-center", button: 0, action: "click" } },
    { id: "double", action: "reader.next-page", context: "reader", enabled: true, input: { device: "area", area: "middle-center", button: 0, action: "double-click" } },
  ] }} execute={execute} />)
  const reader = await readerElement()
  const point = centerPoint(reader)

  clickPointer(reader, 1, point)
  clickPointer(reader, 2, point)
  await expect.poll(() => executedActions(execute)).toEqual(["reader.next-page"])
  await delay(READER_POINTER_DOUBLE_CLICK_WINDOW_MS + 30)
  expect(executedActions(execute)).toEqual(["reader.next-page"])

  execute.mockClear()
  clickPointer(reader, 3, point)
  await delay(READER_POINTER_DOUBLE_CLICK_WINDOW_MS + 30)
  await expect.poll(() => executedActions(execute)).toEqual(["reader.previous-page"])
})

test("[neoview.bindings.area-hold-gui] fires at the configured threshold and suppresses the release click", async () => {
  const execute = vi.fn()
  await render(<Harness gestures config={{ bindings: [
    { id: "click", action: "reader.previous-page", context: "reader", enabled: true, input: { device: "area", area: "middle-center", button: 0, action: "click" } },
    { id: "hold", action: "reader.next-page", context: "reader", enabled: true, input: { device: "area", area: "middle-center", button: 0, action: "hold", durationMs: 120, moveTolerancePx: 10 } },
  ] }} execute={execute} />)
  const reader = await readerElement()
  const point = centerPoint(reader)

  dispatchPointer(reader, "pointerdown", 4, point, 1)
  await delay(150)
  await expect.poll(() => executedActions(execute)).toEqual(["reader.next-page"])
  dispatchPointer(reader, "pointerup", 4, point, 0)
  await delay(30)
  expect(executedActions(execute)).toEqual(["reader.next-page"])
})

function Harness({
  config,
  execute,
  gestures = false,
}: {
  config: ReaderInputBindingsConfig
  execute(action: ReaderInputAction): void
  gestures?: boolean
}) {
  const target = useRef<HTMLDivElement | null>(null)
  const router = useReaderInputRouter({ config, execute: (action) => execute(action) })
  return (
    <div
      ref={target}
      data-testid="reader-input-target"
      data-input-context="reader"
      style={{ width: 600, height: 300 }}
      onPointerDown={router.onPointerDown}
      onPointerUp={router.onPointerUp}
    >
      Reader input target
      {gestures ? <ReaderGestureInputRuntime config={config} target={target} claimPointer={router.claimPointer} dispatch={router.dispatch} /> : null}
    </div>
  )
}

async function readerElement(): Promise<HTMLElement> {
  await expect.element(page.getByTestId("reader-input-target")).toBeVisible()
  return document.querySelector<HTMLElement>('[data-testid="reader-input-target"]')!
}

function centerPoint(element: HTMLElement): { x: number; y: number } {
  const rect = element.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

function clickPointer(element: HTMLElement, pointerId: number, point: { x: number; y: number }): void {
  dispatchPointer(element, "pointerdown", pointerId, point, 1)
  dispatchPointer(element, "pointerup", pointerId, point, 0)
}

function dispatchPointer(
  element: HTMLElement,
  type: "pointerdown" | "pointerup",
  pointerId: number,
  point: { x: number; y: number },
  buttons: number,
): void {
  element.dispatchEvent(new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId,
    pointerType: "mouse",
    isPrimary: true,
    button: 0,
    buttons,
    clientX: point.x,
    clientY: point.y,
  }))
}

function executedActions(execute: ReturnType<typeof vi.fn>): ReaderInputAction[] {
  return execute.mock.calls.map(([action]) => action as ReaderInputAction)
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}
