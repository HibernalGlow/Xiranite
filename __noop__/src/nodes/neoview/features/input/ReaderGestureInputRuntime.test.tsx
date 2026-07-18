import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useRef } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ReaderInputBindingsConfig, ReaderInputDescriptor } from "@xiranite/node-neoview/ui-core"
import { ReaderGestureInputRuntime } from "./ReaderGestureInputRuntime"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("ReaderGestureInputRuntime", () => {
  it("[neoview.bindings.mouse-gesture-runtime] dispatches a bounded mouse trajectory and claims its release", async () => {
    const dispatch = vi.fn(() => true)
    const claimPointer = vi.fn()
    render(<Harness config={{ bindings: [{
      id: "gesture",
      action: "reader.next-page",
      context: "reader",
      enabled: true,
      input: { device: "mouse-gesture", button: 2, directions: ["right", "down"], trigger: "instant" },
    }] }} dispatch={dispatch} claimPointer={claimPointer} />)
    const target = screen.getByTestId("gesture-target")
    fireEvent.pointerDown(target, { pointerType: "mouse", pointerId: 7, button: 2, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(target, { pointerType: "mouse", pointerId: 7, buttons: 2, clientX: 30, clientY: 0 })
    fireEvent.pointerMove(target, { pointerType: "mouse", pointerId: 7, buttons: 2, clientX: 30, clientY: 30 })
    fireEvent.pointerUp(target, { pointerType: "mouse", pointerId: 7, button: 2, clientX: 30, clientY: 30 })
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ device: "mouse-gesture", button: 2, directions: ["right", "down"], trigger: "instant" }, target))
    expect(claimPointer).toHaveBeenCalledWith(7)
  })

  it("[neoview.bindings.mouse-hold-runtime] uses configured duration and cancels on excess movement", () => {
    vi.useFakeTimers()
    const dispatch = vi.fn(() => true)
    const claimPointer = vi.fn()
    render(<Harness config={{ bindings: [{
      id: "hold",
      action: "reader.next-page",
      context: "reader",
      enabled: true,
      input: { device: "mouse", button: 0, action: "hold", durationMs: 300, moveTolerancePx: 10 },
    }] }} dispatch={dispatch} claimPointer={claimPointer} />)
    const target = screen.getByTestId("gesture-target")
    fireEvent.pointerDown(target, { pointerType: "mouse", pointerId: 8, button: 0, clientX: 0, clientY: 0 })
    act(() => vi.advanceTimersByTime(299))
    expect(dispatch).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(dispatch).toHaveBeenCalledOnce()
    expect(claimPointer).toHaveBeenCalledWith(8)

    dispatch.mockClear()
    fireEvent.pointerDown(target, { pointerType: "mouse", pointerId: 9, button: 0, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(target, { pointerType: "mouse", pointerId: 9, buttons: 1, clientX: 20, clientY: 0 })
    act(() => vi.advanceTimersByTime(300))
    expect(dispatch).not.toHaveBeenCalled()
  })

  it("[neoview.bindings.touch-hold-runtime] routes a configured touch long-press through the same context map", () => {
    vi.useFakeTimers()
    const dispatch = vi.fn(() => true)
    render(<Harness config={{ bindings: [{
      id: "touch-hold",
      action: "reader.open-settings",
      context: "reader",
      enabled: true,
      input: { device: "touch", gesture: "long-press", fingers: 1, durationMs: 400, moveTolerancePx: 12 },
    }] }} dispatch={dispatch} claimPointer={vi.fn()} />)
    const target = screen.getByTestId("gesture-target")
    fireEvent.pointerDown(target, { pointerType: "touch", pointerId: 10, button: 0, clientX: 10, clientY: 10 })
    act(() => vi.advanceTimersByTime(400))
    expect(dispatch).toHaveBeenCalledWith({ device: "touch", gesture: "long-press", fingers: 1, durationMs: 400, moveTolerancePx: 12 }, target)
  })
})

function Harness({ config, claimPointer, dispatch }: {
  config: ReaderInputBindingsConfig
  claimPointer(pointerId: number): void
  dispatch(input: ReaderInputDescriptor, target: EventTarget | null): boolean
}) {
  const target = useRef<HTMLDivElement | null>(null)
  return <div ref={target} data-testid="gesture-target"><ReaderGestureInputRuntime config={config} target={target} claimPointer={claimPointer} dispatch={dispatch} /></div>
}
