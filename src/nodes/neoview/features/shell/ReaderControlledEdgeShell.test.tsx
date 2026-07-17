import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReaderControlledEdgeShell, readerEdgeInteraction } from "./ReaderControlledEdgeShell"
import { createReaderShellControlStore } from "./ReaderShellControlStore"

afterEach(cleanup)

describe("ReaderControlledEdgeShell", () => {
  it("maps one store snapshot into controlled edge visibility and lock interaction", () => {
    const store = createReaderShellControlStore()
    render(
      <ReaderControlledEdgeShell
        store={store}
        edges={{ left: { ariaLabel: "left edge", render: () => <div>cards</div> } }}
      >
        <div>viewport</div>
      </ReaderControlledEdgeShell>,
    )

    expect(screen.queryByText("cards")).toBeNull()
    fireEvent.pointerEnter(document.querySelector('[data-reader-edge-trigger="left"]')!)
    expect(screen.getByText("cards")).toBeTruthy()

    act(() => store.setLock("left", "locked-hidden"))
    expect(screen.queryByText("cards")).toBeNull()
    fireEvent.pointerEnter(document.querySelector('[data-reader-edge-trigger="left"]')!)
    expect(screen.queryByText("cards")).toBeNull()

    act(() => store.setLock("left", "locked-open"))
    expect(screen.getByText("cards")).toBeTruthy()
    expect(screen.getByRole("region", { name: "left edge" }).dataset.readerEdgeInteraction).toBe("fixed-open")
  })

  it("subscribes below the parent so edge updates do not rerender ReaderApp-level content", () => {
    const store = createReaderShellControlStore()
    const parentRenders = vi.fn()

    function Parent() {
      parentRenders()
      return (
        <ReaderControlledEdgeShell
          store={store}
          edges={{ right: { ariaLabel: "right edge", render: () => <div>info</div> } }}
        >
          <div>stable reader frame</div>
        </ReaderControlledEdgeShell>
      )
    }

    render(<Parent />)
    expect(parentRenders).toHaveBeenCalledTimes(1)
    act(() => store.requestOpen("right", true))
    expect(screen.getByText("info")).toBeTruthy()
    expect(parentRenders).toHaveBeenCalledTimes(1)
  })

  it("derives fixed interaction from lock before pin", () => {
    expect(readerEdgeInteraction({ open: true, pinned: true, lockMode: "auto" })).toBe("fixed-open")
    expect(readerEdgeInteraction({ open: true, pinned: true, lockMode: "locked-hidden" })).toBe("fixed-closed")
    expect(readerEdgeInteraction({ open: false, pinned: false, lockMode: "auto" })).toBe("auto")
  })
})
