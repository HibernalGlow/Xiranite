import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ReaderDeviceInputRecorder } from "./ReaderDeviceInputRecorder"

const gamepad = vi.hoisted(() => ({ instances: [] as MockGamepadListener[] }))

class MockGamepadListener {
  callback?: (event: CustomEvent<{ button: number; pressed: boolean }>) => void
  callbacks = new Map<string, (event: CustomEvent<unknown>) => void>()
  start = vi.fn()
  stop = vi.fn()
  on = vi.fn((name: string, callback: (event: CustomEvent<unknown>) => void) => { this.callbacks.set(name, callback); if (name === "gamepad:button") this.callback = callback as typeof this.callback })
  off = vi.fn((name: string) => { this.callbacks.delete(name) })
  emit(name: string, detail: unknown) { this.callbacks.get(name)?.(new CustomEvent(name, { detail })) }
  constructor() { gamepad.instances.push(this) }
}

vi.mock("gamepad.js", () => ({ GamepadListener: MockGamepadListener }))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  gamepad.instances.length = 0
})

describe("ReaderDeviceInputRecorder", () => {
  it("[neoview.bindings.touch-recording] records a bounded touch long-press without also recording a tap", () => {
    vi.useFakeTimers()
    const onRecord = vi.fn()
    render(<ReaderDeviceInputRecorder device="touch" onCancel={vi.fn()} onRecord={onRecord} />)
    const recorder = document.querySelector('[data-input-recording="true"]')!

    fireEvent.pointerDown(recorder, { pointerType: "touch", pointerId: 1, clientX: 10, clientY: 10 })
    act(() => vi.advanceTimersByTime(500))
    expect(onRecord).toHaveBeenCalledWith({
      device: "touch",
      gesture: "long-press",
      fingers: 1,
      durationMs: 500,
      moveTolerancePx: 12,
    })

    fireEvent.pointerUp(recorder, { pointerType: "touch", pointerId: 1, clientX: 10, clientY: 10 })
    expect(onRecord).toHaveBeenCalledOnce()
  })

  it("[neoview.bindings.mouse-gesture-recording] records a direction sequence through use-gesture", async () => {
    const onRecord = vi.fn()
    render(<ReaderDeviceInputRecorder device="mouse-gesture" onCancel={vi.fn()} onRecord={onRecord} />)
    const recorder = document.querySelector('[data-input-recording="true"]')!
    fireEvent.pointerDown(recorder, { pointerType: "mouse", pointerId: 1, button: 2, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(recorder, { pointerType: "mouse", pointerId: 1, buttons: 2, clientX: 30, clientY: 0 })
    fireEvent.pointerMove(recorder, { pointerType: "mouse", pointerId: 1, buttons: 2, clientX: 30, clientY: 30 })
    expect(screen.getByRole("status", { name: "已录制鼠标轨迹" }).textContent).toBe("→ ↓")
    fireEvent.pointerUp(recorder, { pointerType: "mouse", pointerId: 1, button: 2, clientX: 30, clientY: 30 })
    await waitFor(() => expect(onRecord).toHaveBeenCalledWith({ device: "mouse-gesture", button: 2, directions: ["right", "down"], trigger: "instant" }))
  })

  it("[neoview.bindings.gamepad-recording] records one standard button and releases polling", async () => {
    const onRecord = vi.fn()
    const view = render(<ReaderDeviceInputRecorder device="gamepad" onCancel={vi.fn()} onRecord={onRecord} />)
    await waitFor(() => expect(gamepad.instances).toHaveLength(1))
    const listener = gamepad.instances[0]!
    expect(listener.start).toHaveBeenCalledOnce()
    expect(screen.getByRole("status", { name: "手柄连接状态" }).textContent).toBe("等待手柄连接")

    act(() => listener.emit("gamepad:connected", { index: 0, mapping: "standard" }))
    expect(screen.getByRole("status", { name: "手柄连接状态" }).textContent).toBe("已连接手柄")

    act(() => listener.callback?.(new CustomEvent("gamepad:button", { detail: { button: 7, pressed: true } })))
    expect(onRecord).toHaveBeenCalledWith({ device: "gamepad", button: 7 })

    act(() => listener.emit("gamepad:disconnected", { index: 0 }))
    expect(screen.getByRole("status", { name: "手柄连接状态" }).textContent).toBe("等待手柄连接")

    view.unmount()
    expect(listener.off).toHaveBeenCalledTimes(3)
    expect(listener.off).toHaveBeenCalledWith("gamepad:connected", expect.any(Function))
    expect(listener.off).toHaveBeenCalledWith("gamepad:disconnected", expect.any(Function))
    expect(listener.off).toHaveBeenCalledWith("gamepad:button", expect.any(Function))
    expect(listener.stop).toHaveBeenCalledOnce()
  })
})
