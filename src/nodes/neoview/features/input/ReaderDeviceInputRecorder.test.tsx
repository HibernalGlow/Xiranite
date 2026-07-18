import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ReaderDeviceInputRecorder } from "./ReaderDeviceInputRecorder"

const gamepad = vi.hoisted(() => ({ instances: [] as MockGamepadListener[] }))

class MockGamepadListener {
  callback?: (event: CustomEvent<{ button: number; pressed: boolean }>) => void
  start = vi.fn()
  stop = vi.fn()
  on = vi.fn((_name: string, callback: typeof this.callback) => { this.callback = callback })
  off = vi.fn()
  constructor() { gamepad.instances.push(this) }
}

vi.mock("gamepad.js", () => ({ GamepadListener: MockGamepadListener }))

afterEach(() => {
  cleanup()
  gamepad.instances.length = 0
})

describe("ReaderDeviceInputRecorder", () => {
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

    act(() => listener.callback?.(new CustomEvent("gamepad:button", { detail: { button: 7, pressed: true } })))
    expect(onRecord).toHaveBeenCalledWith({ device: "gamepad", button: 7 })

    view.unmount()
    expect(listener.off).toHaveBeenCalledOnce()
    expect(listener.stop).toHaveBeenCalledOnce()
  })
})
