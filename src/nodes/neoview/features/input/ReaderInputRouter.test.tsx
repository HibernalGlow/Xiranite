import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ReaderInputAction, ReaderInputBindingsConfig } from "@xiranite/node-neoview/ui-core"
import { readerInputContexts, useReaderInputRouter } from "./ReaderInputRouter"

afterEach(cleanup)

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
    expect(readerInputContexts(root)).toEqual(["reader"])
  })

  it("[neoview.bindings.keyboard-runtime] delegates dynamic keyboard input and protects editors", async () => {
    const execute = vi.fn()
    render(<Harness config={{ bindings: [
      { id: "next", action: "reader.next-page", context: "reader", enabled: true, input: { device: "keyboard", code: "ArrowRight" } },
    ] }} execute={execute} />)
    fireEvent.keyDown(screen.getByTestId("reader"), { key: "ArrowRight", code: "ArrowRight" })
    await waitFor(() => expect(execute).toHaveBeenCalledWith("reader.next-page"))
    execute.mockClear()
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "ArrowRight", code: "ArrowRight" })
    expect(execute).not.toHaveBeenCalled()
  })

  it("[neoview.bindings.mouse-runtime] routes configured pointer buttons without stealing unbound or interactive clicks", () => {
    const execute = vi.fn()
    render(<Harness config={{ bindings: [
      { id: "next", action: "reader.next-page", context: "reader", enabled: true, input: { device: "mouse", button: 3, click: "single" } },
    ] }} execute={execute} />)
    fireEvent.pointerUp(screen.getByTestId("reader"), { pointerType: "mouse", button: 0, detail: 1 })
    expect(execute).not.toHaveBeenCalled()
    fireEvent.pointerUp(screen.getByRole("button", { name: "toolbar action" }), { pointerType: "mouse", button: 3, detail: 1 })
    expect(execute).not.toHaveBeenCalled()
    fireEvent.pointerUp(screen.getByTestId("reader"), { pointerType: "mouse", button: 3, detail: 1 })
    expect(execute).toHaveBeenCalledWith("reader.next-page")
  })
})

function Harness({ config, execute }: { config: ReaderInputBindingsConfig; execute: (action: ReaderInputAction) => void }) {
  const router = useReaderInputRouter({ config, execute })
  return (
    <div
      data-testid="reader"
      onPointerUp={router.onPointerUp}
    >
      <input aria-label="editor" />
      <button type="button">toolbar action</button>
    </div>
  )
}
