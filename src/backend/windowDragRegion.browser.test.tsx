import { page } from "vitest/browser"
import { describe, expect, test, vi } from "vitest"
import { render } from "vitest-browser-react"

const startDragging = vi.fn(async () => ({ success: true, supported: true, message: "Window drag started." }))

vi.mock("./client", () => ({
  getRuntime: async () => ({ windows: { startDragging } }),
}))

import { installNativeWindowDragRegion } from "./windowDragRegion"

/**
 * The wiring the unit tests cannot see: whether a real press on the class the captions actually carry
 * reaches the runtime, and whether the controls inside that strip stay clickable.
 */
function CaptionHarness() {
  return (
    <div data-testid="caption" className="xiranite-app-region-drag">
      <span data-testid="strip">标题栏</span>
      <button data-testid="close" type="button" className="xiranite-app-region-no-drag">
        关闭
      </button>
    </div>
  )
}

function press(element: Element, button = 0): void {
  element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button }))
}

describe("native window drag region wiring", () => {
  test("a press on the caption strip asks the host to move this window", async () => {
    startDragging.mockClear()
    await render(<CaptionHarness />)
    const teardown = installNativeWindowDragRegion(window)

    press(page.getByTestId("strip").element())
    await vi.waitFor(() => expect(startDragging).toHaveBeenCalledWith("main"))

    teardown()
  })

  /// Without the opt-out arm every caption button would drag the window instead of clicking.
  test("a control inside the strip does not start a drag", async () => {
    startDragging.mockClear()
    await render(<CaptionHarness />)
    const teardown = installNativeWindowDragRegion(window)

    press(page.getByTestId("close").element())
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(startDragging).not.toHaveBeenCalled()

    teardown()
  })

  test("a right press on the strip is a context menu, not a move", async () => {
    startDragging.mockClear()
    await render(<CaptionHarness />)
    const teardown = installNativeWindowDragRegion(window)

    press(page.getByTestId("strip").element(), 2)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(startDragging).not.toHaveBeenCalled()

    teardown()
  })

  test("teardown stops routing presses to the host", async () => {
    startDragging.mockClear()
    await render(<CaptionHarness />)
    installNativeWindowDragRegion(window)()

    press(page.getByTestId("strip").element())
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(startDragging).not.toHaveBeenCalled()
  })
})
