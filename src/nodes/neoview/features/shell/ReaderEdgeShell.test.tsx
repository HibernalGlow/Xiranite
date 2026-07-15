import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useRef } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReaderEdgeShell, type ReaderEdgeSlot } from "./ReaderEdgeShell"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("ReaderEdgeShell", () => {
  it("[neoview.shell.zero-mount] keeps all closed edge content out of the DOM", () => {
    const mounted = vi.fn()
    const edges = Object.fromEntries(["top", "right", "bottom", "left"].map((edge) => [edge, slot(edge, <MountProbe onMount={mounted} />)]))
    render(<ReaderEdgeShell edges={edges}><div>viewport</div></ReaderEdgeShell>)

    expect(screen.getByText("viewport")).toBeTruthy()
    expect(screen.queryAllByRole("region")).toHaveLength(0)
    expect(mounted).not.toHaveBeenCalled()
    expect(document.querySelectorAll("[data-reader-edge-trigger]")).toHaveLength(4)
  })

  it("[neoview.shell.hover-delay] opens and unmounts an edge through bounded timers", () => {
    vi.useFakeTimers()
    const visibility = vi.fn()
    render(
      <ReaderEdgeShell
        edges={{ top: { ...slot("top", <div>toolbar</div>), showDelayMs: 40, hideDelayMs: 80 } }}
        onEdgeVisibilityChange={visibility}
      >
        <div>viewport</div>
      </ReaderEdgeShell>,
    )

    const trigger = document.querySelector('[data-reader-edge-trigger="top"]')!
    fireEvent.pointerEnter(trigger)
    act(() => vi.advanceTimersByTime(39))
    expect(screen.queryByText("toolbar")).toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByText("toolbar")).toBeTruthy()

    fireEvent.pointerLeave(screen.getByRole("region", { name: "top edge" }))
    act(() => vi.advanceTimersByTime(79))
    expect(screen.getByText("toolbar")).toBeTruthy()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.queryByText("toolbar")).toBeNull()
    expect(visibility.mock.calls).toEqual([["top", true], ["top", false]])
  })

  it("[neoview.shell.pinned] mounts pinned content and never retracts it", () => {
    vi.useFakeTimers()
    render(
      <ReaderEdgeShell edges={{ left: { ...slot("left", <div>cards</div>), pinned: true, hideDelayMs: 1 } }}>
        <div>viewport</div>
      </ReaderEdgeShell>,
    )
    fireEvent.pointerLeave(screen.getByRole("region", { name: "left edge" }))
    act(() => vi.runAllTimers())
    expect(screen.getByText("cards")).toBeTruthy()
  })

  it("[neoview.shell.unpin] restores auto-hide after a pinned edge is released", () => {
    vi.useFakeTimers()
    const view = render(
      <ReaderEdgeShell edges={{ left: { ...slot("left", <div>cards</div>), pinned: true, initialVisible: true, hideDelayMs: 20 } }}>
        <div>viewport</div>
      </ReaderEdgeShell>,
    )
    view.rerender(
      <ReaderEdgeShell edges={{ left: { ...slot("left", <div>cards</div>), pinned: false, initialVisible: true, hideDelayMs: 20 } }}>
        <div>viewport</div>
      </ReaderEdgeShell>,
    )
    fireEvent.pointerLeave(screen.getByRole("region", { name: "left edge" }))
    act(() => vi.advanceTimersByTime(20))
    expect(screen.queryByText("cards")).toBeNull()
  })

  it("[neoview.shell.input-protection] does not retract while a text control owns focus", () => {
    vi.useFakeTimers()
    render(
      <ReaderEdgeShell edges={{ right: { ...slot("right", <input aria-label="filter" />), initialVisible: true, hideDelayMs: 20 } }}>
        <div>viewport</div>
      </ReaderEdgeShell>,
    )
    const input = screen.getByRole("textbox", { name: "filter" })
    input.focus()
    fireEvent.pointerLeave(screen.getByRole("region", { name: "right edge" }))
    act(() => vi.advanceTimersByTime(100))
    expect(input).toBeTruthy()
  })

  it("[neoview.shell.escape] retracts transient edges for narrow and keyboard layouts", () => {
    render(
      <ReaderEdgeShell edges={{ left: { ...slot("left", <div>cards</div>), initialVisible: true } }}>
        <div>viewport</div>
      </ReaderEdgeShell>,
    )
    fireEvent.keyDown(window, { key: "Escape" })
    expect(screen.queryByText("cards")).toBeNull()
  })

  it("[neoview.shell.modal-protection] lets a settings dialog own Escape without retracting edges", () => {
    render(
      <ReaderEdgeShell edges={{ bottom: { ...slot("bottom", <div>thumbnails</div>), initialVisible: true } }}>
        <div role="dialog"><button type="button">modal control</button></div>
      </ReaderEdgeShell>,
    )
    const control = screen.getByRole("button", { name: "modal control" })
    control.focus()
    fireEvent.keyDown(control, { key: "Escape" })
    expect(screen.getByText("thumbnails")).toBeTruthy()
  })

  it("[neoview.shell.floating-protection] keeps an edge mounted while its context interaction is active", () => {
    vi.useFakeTimers()
    render(
      <ReaderEdgeShell edges={{ right: { ...slot("right", <div>cards</div>), initialVisible: true, hideDelayMs: 20 } }}>
        <div>viewport</div>
      </ReaderEdgeShell>,
    )
    const region = screen.getByRole("region", { name: "right edge" })
    fireEvent.contextMenu(region)
    fireEvent.pointerLeave(region)
    act(() => vi.advanceTimersByTime(100))
    expect(screen.getByText("cards")).toBeTruthy()
    fireEvent.pointerDown(window)
    act(() => vi.advanceTimersByTime(20))
    expect(screen.queryByText("cards")).toBeNull()
  })

  it("[neoview.shell.pointer-commit] does not render React state on pointer movement", () => {
    const renders = vi.fn()
    render(
      <ReaderEdgeShell edges={{ bottom: { ...slot("bottom", <RenderProbe onRender={renders} />), initialVisible: true } }}>
        <div>viewport</div>
      </ReaderEdgeShell>,
    )
    const baseline = renders.mock.calls.length
    for (let index = 0; index < 100; index += 1) fireEvent.pointerMove(window, { clientX: index, clientY: index })
    expect(renders).toHaveBeenCalledTimes(baseline)
  })
})

function slot(edge: string, content: React.ReactNode): ReaderEdgeSlot {
  return { ariaLabel: `${edge} edge`, render: () => content }
}

function MountProbe({ onMount }: { onMount(): void }) {
  const mounted = useRef(false)
  if (!mounted.current) {
    mounted.current = true
    onMount()
  }
  return <div>mounted</div>
}

function RenderProbe({ onRender }: { onRender(): void }) {
  onRender()
  return <div>probe</div>
}
