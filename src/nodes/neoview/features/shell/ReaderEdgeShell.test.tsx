import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useRef, useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  ReaderEdgeShell,
  type ReaderEdge,
  type ReaderEdgeOpenReason,
  type ReaderEdgeSlot,
} from "./ReaderEdgeShell"

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

  it("[neoview.shell.constrained-layering] keeps full-height sidebars operable above horizontal bars", () => {
    render(<ReaderEdgeShell edges={{
      top: { ...slot("top", <button>top action</button>), open: true },
      right: { ...slot("right", <button>side action</button>), open: true },
      bottom: { ...slot("bottom", <button>bottom action</button>), open: true },
    }}><div>viewport</div></ReaderEdgeShell>)

    expect(document.querySelector('[data-reader-edge="top"]')?.className).toContain("z-[80]")
    expect(document.querySelector('[data-reader-edge="right"]')?.className).toContain("z-[85]")
    expect(document.querySelector('[data-reader-edge="bottom"]')?.className).toContain("z-[60]")
  })

  it("[neoview.shell.pointer-isolation] keeps edge controls out of reader gesture bindings", () => {
    const readerPointerDown = vi.fn()
    const actionPointerDown = vi.fn()
    const clicked = vi.fn()
    render(
      <div onPointerDown={readerPointerDown}>
        <ReaderEdgeShell edges={{ top: { ...slot("top", <button type="button" onPointerDown={actionPointerDown} onClick={clicked}>toolbar action</button>), open: true, interaction: "fixed-open" } }}>
          <div>viewport</div>
        </ReaderEdgeShell>
      </div>,
    )

    const action = screen.getByRole("button", { name: "toolbar action" })
    fireEvent.pointerDown(action)
    fireEvent.pointerUp(action)
    fireEvent.click(action)
    expect(readerPointerDown).not.toHaveBeenCalled()
    expect(actionPointerDown).toHaveBeenCalledOnce()
    expect(clicked).toHaveBeenCalledOnce()
  })

  it("[neoview.shell.controlled] requests visibility without owning a second open state", () => {
    vi.useFakeTimers()
    const requests = vi.fn()
    render(
      <ReaderEdgeShell
        edges={{ top: { ...slot("top", <div>toolbar</div>), showDelayMs: 40 } }}
        onEdgeOpenRequest={requests}
      >
        <div>viewport</div>
      </ReaderEdgeShell>,
    )

    fireEvent.pointerEnter(document.querySelector('[data-reader-edge-trigger="top"]')!)
    act(() => vi.advanceTimersByTime(40))
    expect(requests).toHaveBeenCalledWith("top", true, "trigger")
    expect(screen.queryByText("toolbar")).toBeNull()
  })

  it("[neoview.shell.hover-delay] lazily mounts once and keeps hidden edge content alive", () => {
    vi.useFakeTimers()
    const requests = vi.fn()
    render(<ControlledShell edge="top" requests={requests} showDelayMs={40} hideDelayMs={80} />)

    const trigger = document.querySelector('[data-reader-edge-trigger="top"]')!
    fireEvent.pointerEnter(trigger)
    act(() => vi.advanceTimersByTime(39))
    expect(screen.queryByText("top content")).toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByText("top content")).toBeTruthy()

    fireEvent.pointerLeave(screen.getByRole("region", { name: "top edge" }))
    act(() => vi.advanceTimersByTime(79))
    expect(screen.getByText("top content")).toBeTruthy()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByText("top content")).toBeTruthy()
    expect(document.querySelector<HTMLElement>('[data-reader-edge="top"]')?.hidden).toBe(true)
    expect(requests.mock.calls).toEqual([
      ["top", true, "trigger"],
      ["top", false, "leave"],
    ])
  })

  it("[neoview.shell.fixed-open] mounts fixed content and never retracts it", () => {
    vi.useFakeTimers()
    const requests = vi.fn()
    render(
      <ReaderEdgeShell
        edges={{ left: { ...slot("left", <div>cards</div>), interaction: "fixed-open", hideDelayMs: 1 } }}
        onEdgeOpenRequest={requests}
      >
        <div>viewport</div>
      </ReaderEdgeShell>,
    )
    fireEvent.pointerLeave(screen.getByRole("region", { name: "left edge" }))
    fireEvent.keyDown(window, { key: "Escape" })
    act(() => vi.runAllTimers())
    expect(screen.getByText("cards")).toBeTruthy()
    expect(requests).not.toHaveBeenCalled()
  })

  it("[neoview.shell.fixed-closed] ignores trigger requests and keeps content unmounted", () => {
    const preload = vi.fn()
    const requests = vi.fn()
    render(
      <ReaderEdgeShell
        edges={{ right: { ...slot("right", <div>cards</div>), open: true, interaction: "fixed-closed", preload } }}
        onEdgeOpenRequest={requests}
      >
        <div>viewport</div>
      </ReaderEdgeShell>,
    )
    fireEvent.pointerEnter(document.querySelector('[data-reader-edge-trigger="right"]')!)
    expect(screen.queryByText("cards")).toBeNull()
    expect(preload).not.toHaveBeenCalled()
    expect(requests).not.toHaveBeenCalled()
  })

  it("[neoview.shell.unpin] restores auto-hide after fixed-open is released", () => {
    vi.useFakeTimers()
    const requests = vi.fn()
    const view = render(
      <ReaderEdgeShell
        edges={{ left: { ...slot("left", <div>cards</div>), interaction: "fixed-open", hideDelayMs: 20 } }}
        onEdgeOpenRequest={requests}
      >
        <div>viewport</div>
      </ReaderEdgeShell>,
    )
    view.rerender(
      <ReaderEdgeShell
        edges={{ left: { ...slot("left", <div>cards</div>), open: true, hideDelayMs: 20 } }}
        onEdgeOpenRequest={requests}
      >
        <div>viewport</div>
      </ReaderEdgeShell>,
    )
    fireEvent.pointerLeave(screen.getByRole("region", { name: "left edge" }))
    act(() => vi.advanceTimersByTime(20))
    expect(requests).toHaveBeenCalledWith("left", false, "leave")
  })

  it("[neoview.shell.input-protection] does not request retract while a text control owns focus", () => {
    vi.useFakeTimers()
    const requests = vi.fn()
    render(
      <ReaderEdgeShell
        edges={{ right: { ...slot("right", <input aria-label="filter" />), open: true, hideDelayMs: 20 } }}
        onEdgeOpenRequest={requests}
      >
        <div>viewport</div>
      </ReaderEdgeShell>,
    )
    const input = screen.getByRole("textbox", { name: "filter" })
    input.focus()
    fireEvent.pointerLeave(screen.getByRole("region", { name: "right edge" }))
    act(() => vi.advanceTimersByTime(100))
    expect(requests).not.toHaveBeenCalled()
  })

  it("[neoview.shell.escape] requests retract for transient edges", () => {
    const requests = vi.fn()
    render(
      <ReaderEdgeShell
        edges={{ left: { ...slot("left", <div>cards</div>), open: true } }}
        onEdgeOpenRequest={requests}
      >
        <div>viewport</div>
      </ReaderEdgeShell>,
    )
    fireEvent.keyDown(window, { key: "Escape" })
    expect(requests).toHaveBeenCalledWith("left", false, "escape")
  })

  it("[neoview.shell.modal-protection] lets a settings dialog own Escape", () => {
    const requests = vi.fn()
    render(
      <ReaderEdgeShell
        edges={{ bottom: { ...slot("bottom", <div>thumbnails</div>), open: true } }}
        onEdgeOpenRequest={requests}
      >
        <div role="dialog"><button type="button">modal control</button></div>
      </ReaderEdgeShell>,
    )
    const control = screen.getByRole("button", { name: "modal control" })
    control.focus()
    fireEvent.keyDown(control, { key: "Escape" })
    expect(requests).not.toHaveBeenCalled()
  })

  it("[neoview.shell.floating-protection] keeps an edge open while context interaction is active", () => {
    vi.useFakeTimers()
    const requests = vi.fn()
    render(
      <ReaderEdgeShell
        edges={{ right: { ...slot("right", <div>cards</div>), open: true, hideDelayMs: 20 } }}
        onEdgeOpenRequest={requests}
      >
        <div>viewport</div>
      </ReaderEdgeShell>,
    )
    const region = screen.getByRole("region", { name: "right edge" })
    fireEvent.contextMenu(region)
    fireEvent.pointerLeave(region)
    act(() => vi.advanceTimersByTime(100))
    expect(requests).not.toHaveBeenCalled()
    fireEvent.pointerDown(window)
    act(() => vi.advanceTimersByTime(20))
    expect(requests).toHaveBeenCalledWith("right", false, "leave")
  })

  it("[neoview.shell.floating-menu-protection] keeps an edge open through a portal menu selection", () => {
    vi.useFakeTimers()
    const requests = vi.fn()
    render(
      <ReaderEdgeShell
        edges={{ left: { ...slot("left", <div>cards</div>), open: true, hideDelayMs: 20 } }}
        onEdgeOpenRequest={requests}
      >
        <div>viewport</div>
      </ReaderEdgeShell>,
    )
    const region = screen.getByRole("region", { name: "left edge" })
    const menu = document.createElement("div")
    menu.setAttribute("role", "menu")
    document.body.appendChild(menu)
    fireEvent.pointerLeave(region)
    act(() => vi.advanceTimersByTime(100))
    expect(requests).not.toHaveBeenCalled()
    fireEvent.pointerDown(menu)
    menu.remove()
    fireEvent.pointerDown(window)
    act(() => vi.advanceTimersByTime(20))
    expect(requests).toHaveBeenCalledWith("left", false, "leave")
  })

  it("[neoview.shell.edge-interaction-protection] keeps an edge open while a side control is being operated", () => {
    vi.useFakeTimers()
    const requests = vi.fn()
    render(
      <ReaderEdgeShell
        edges={{ left: { ...slot("left", <button type="button">side action</button>), open: true, hideDelayMs: 20 } }}
        onEdgeOpenRequest={requests}
      >
        <div>viewport</div>
      </ReaderEdgeShell>,
    )
    const region = screen.getByRole("region", { name: "left edge" })
    const action = screen.getByRole("button", { name: "side action" })
    fireEvent.pointerDown(action)
    fireEvent.pointerLeave(region)
    act(() => vi.advanceTimersByTime(100))
    expect(requests).not.toHaveBeenCalled()
    fireEvent.pointerDown(window)
    act(() => vi.advanceTimersByTime(20))
    expect(requests).toHaveBeenCalledWith("left", false, "leave")
  })

  it("[neoview.shell.pointer-commit] does not render React state on pointer movement", () => {
    const renders = vi.fn()
    render(
      <ReaderEdgeShell edges={{ bottom: { ...slot("bottom", <RenderProbe onRender={renders} />), open: true } }}>
        <div>viewport</div>
      </ReaderEdgeShell>,
    )
    const baseline = renders.mock.calls.length
    for (let index = 0; index < 100; index += 1) fireEvent.pointerMove(window, { clientX: index, clientY: index })
    expect(renders).toHaveBeenCalledTimes(baseline)
  })
})

function slot(edge: string, content: React.ReactNode): ReaderEdgeSlot {
  return { ariaLabel: `${edge} edge`, open: false, interaction: "auto", render: () => content }
}

function ControlledShell({
  edge,
  requests,
  showDelayMs,
  hideDelayMs,
}: {
  edge: ReaderEdge
  requests: (edge: ReaderEdge, open: boolean, reason: ReaderEdgeOpenReason) => void
  showDelayMs: number
  hideDelayMs: number
}) {
  const [open, setOpen] = useState(false)
  return (
    <ReaderEdgeShell
      edges={{ [edge]: { ...slot(edge, <div>{edge} content</div>), open, showDelayMs, hideDelayMs } }}
      onEdgeOpenRequest={(requestedEdge, next, reason) => {
        requests(requestedEdge, next, reason)
        setOpen(next)
      }}
    >
      <div>viewport</div>
    </ReaderEdgeShell>
  )
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
