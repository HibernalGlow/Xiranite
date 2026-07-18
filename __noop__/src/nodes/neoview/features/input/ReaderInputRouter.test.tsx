import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ReaderInputAction, ReaderInputBindingsConfig } from "@xiranite/node-neoview/ui-core"
import { readerInputContexts, useReaderInputRouter } from "./ReaderInputRouter"

afterEach(() => { cleanup(); vi.useRealTimers() })

describe("ReaderInputRouter", () => {
  it("[neoview.bindings.dom-context] derives editor, modal, panel and reader modes", () => {
    const root = document.createElement("div")
    const panel = document.createElement("div")
    panel.dataset.readerPanel = "info"
    const panelButton = document.createElement("button")
    panel.append(panelButton)
    root.append(panel)
    expect(readerInputContexts(panelButton)).toEqual(["panel"])

    const dialog = document.createElement("div")
    dialog.setAttribute("role", "dialog")
    const dialogButton = document.createElement("button")
    dialog.append(dialogButton)
    root.append(dialog)
    expect(readerInputContexts(dialogButton)).toEqual(["modal"])

    const input = document.createElement("input")
    dialog.append(input)
    expect(readerInputContexts(input)).toEqual(["editor"])
    const settings = document.createElement("section")
    settings.dataset.inputContext = "modal"
    const settingsButton = document.createElement("button")
    settings.append(settingsButton)
    root.append(settings)
    expect(readerInputContexts(settingsButton)).toEqual(["modal"])
    const video = document.createElement("video")
    video.dataset.inputContext = "video"
    root.append(video)
    expect(readerInputContexts(video)).toEqual(["video"])
    expect(readerInputContexts(root)).toEqual(["reader"])
  })

  it("[neoview.bindings.keyboard-runtime] delegates dynamic keyboard input and protects editors", async () => {
    const execute = vi.fn()
    render(<Harness config={{ bindings: [
      { id: "next", action: "reader.next-page", context: "reader", enabled: true, input: { device: "keyboard", code: "ArrowRight" } },
      { id: "global-next", action: "reader.next-page", context: "global", enabled: true, input: { device: "keyboard", code: "ArrowDown" } },
    ] }} execute={execute} />)
    fireEvent.keyDown(screen.getByTestId("reader"), { key: "ArrowRight", code: "ArrowRight" })
    await waitFor(() => expect(execute).toHaveBeenCalledWith("reader.next-page"))
    execute.mockClear()
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "ArrowRight", code: "ArrowRight" })
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "ArrowDown", code: "ArrowDown" })
    expect(execute).not.toHaveBeenCalled()
  })

  it("[neoview.bindings.mouse-runtime] routes configured pointer buttons without stealing unbound or interactive clicks", () => {
    const execute = vi.fn()
    render(<Harness config={{ bindings: [
      { id: "next", action: "reader.next-page", context: "reader", enabled: true, input: { device: "mouse", button: 3, action: "click" } },
    ] }} execute={execute} />)
    fireEvent.pointerUp(screen.getByTestId("reader"), { pointerType: "mouse", button: 0, detail: 1 })
    expect(execute).not.toHaveBeenCalled()
    fireEvent.pointerUp(screen.getByRole("button", { name: "toolbar action" }), { pointerType: "mouse", button: 3, detail: 1 })
    expect(execute).not.toHaveBeenCalled()
    fireEvent.pointerUp(screen.getByTestId("reader"), { pointerType: "mouse", button: 3, detail: 1 })
    expect(execute).toHaveBeenCalledWith("reader.next-page")
  })

  it("[neoview.bindings.keyboard-hold-runtime] dispatches after the threshold and cancels on keyup", () => {
    vi.useFakeTimers()
    const execute = vi.fn()
    render(<Harness config={{ bindings: [
      { id: "hold", action: "radial.open-default", context: "reader", enabled: true, input: { device: "keyboard", code: "Enter", trigger: "hold", durationMs: 450 } },
    ] }} execute={execute} />)
    const reader = screen.getByTestId("reader")
    fireEvent.keyDown(reader, { key: "Enter", code: "Enter" })
    vi.advanceTimersByTime(449)
    expect(execute).not.toHaveBeenCalled()
    fireEvent.keyUp(reader, { key: "Enter", code: "Enter" })
    vi.advanceTimersByTime(1)
    expect(execute).not.toHaveBeenCalled()
    fireEvent.keyDown(reader, { key: "Enter", code: "Enter" })
    vi.advanceTimersByTime(450)
    expect(execute).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledWith("radial.open-default")
  })

  it("[neoview.bindings.mouse-press] dispatches press once without a release click", () => {
    const execute = vi.fn()
    render(<Harness config={{ bindings: [
      { id: "press", action: "reader.next-page", context: "reader", enabled: true, input: { device: "mouse", button: 1, action: "press" } },
      { id: "click", action: "reader.previous-page", context: "reader", enabled: true, input: { device: "mouse", button: 1, action: "click" } },
    ] }} execute={execute} />)
    const reader = screen.getByTestId("reader")
    fireEvent.pointerDown(reader, { pointerType: "mouse", pointerId: 4, button: 1 })
    fireEvent.pointerUp(reader, { pointerType: "mouse", pointerId: 4, button: 1, detail: 1 })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith("reader.next-page")
  })

  it("[neoview.bindings.area-runtime] gives a matching nine-area binding precedence over a generic mouse binding", () => {
    const execute = vi.fn()
    render(<Harness config={{ bindings: [
      { id: "area", action: "reader.next-page", context: "reader", enabled: true, input: { device: "area", area: "middle-center", button: 0, action: "click" } },
      { id: "mouse", action: "reader.previous-page", context: "reader", enabled: true, input: { device: "mouse", button: 0, action: "click" } },
    ] }} execute={execute} />)
    const reader = screen.getByTestId("reader")
    reader.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600, toJSON: () => ({}) })
    fireEvent.pointerUp(reader, { pointerType: "mouse", pointerId: 1, button: 0, detail: 1, clientX: 450, clientY: 300 })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith("reader.next-page")
  })
})

function Harness({ config, execute }: { config: ReaderInputBindingsConfig; execute: (action: ReaderInputAction) => void }) {
  const router = useReaderInputRouter({ config, execute })
  return (
    <div
      data-testid="reader"
      onPointerDown={router.onPointerDown}
      onPointerUp={router.onPointerUp}
    >
      <input aria-label="editor" />
      <button type="button">toolbar action</button>
    </div>
  )
}
