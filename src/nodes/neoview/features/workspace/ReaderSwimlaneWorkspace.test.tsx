// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ReaderShellConfigDto } from "../../adapters/reader-http-client"
import { applyReaderWorkspacePatch, readerWorkspaceConfig, type ReaderWorkspacePatch } from "./ReaderWorkspaceLayout"
import { ReaderSwimlaneWorkspace } from "./ReaderSwimlaneWorkspace"

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal("ResizeObserver", ResizeObserverStub)
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
  vi.stubGlobal("cancelAnimationFrame", vi.fn())
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("ReaderSwimlaneWorkspace", () => {
  it("renders every lane in one horizontal strip and keeps panel input out of Reader", () => {
    const onWorkspaceChange = vi.fn()
    const readerPointer = vi.fn()
    render(
      <div onPointerDown={readerPointer}>
        <ReaderSwimlaneWorkspace
          shell={shellConfig("swimlane")}
          workspace={readerWorkspaceConfig(shellConfig("swimlane"))}
          reader={<button type="button">Reader action</button>}
          left={<button type="button">Left action</button>}
          right={<button type="button">Right action</button>}
          onWorkspaceChange={onWorkspaceChange}
        />
      </div>,
    )

    const strip = document.querySelector('[data-reader-swimlane-strip="true"]')!
    expect(strip.querySelectorAll(":scope > [data-reader-swimlane]")).toHaveLength(3)
    expect(document.querySelector('[data-reader-swimlane="reader"]')?.className).toContain("ring-primary/55")
    expect(document.querySelector('[data-reader-swimlane="left"]')?.className).not.toContain("ring-primary/55")
    fireEvent.pointerDown(screen.getByRole("button", { name: "Right action" }), { pointerId: 3, button: 0 })
    expect(readerPointer).not.toHaveBeenCalled()
    expect(onWorkspaceChange).toHaveBeenCalledWith({ activeLane: "right" })
    expect(document.querySelector<HTMLElement>('[data-reader-swimlane="reader"]')?.style.width).toBe(`${window.innerWidth}px`)
    expect(document.querySelector<HTMLElement>('[data-reader-swimlane="right"]')?.style.width).toBe("300px")
  })

  it("keeps Reader fullscreen latent while a side lane is focused and restores Reader through the navigator", () => {
    const shell = shellConfig("swimlane", "right")
    shell.workspace!.swimlane.showLaneNavigatorInReaderSolo = true
    const onWorkspaceChange = vi.fn()
    const readerAction = vi.fn()
    const view = render(
      <ReaderSwimlaneWorkspace
        shell={shell}
        workspace={readerWorkspaceConfig(shell)}
        reader={<button type="button" onClick={readerAction}>Reader action</button>}
        left={<div>left</div>}
        right={<div>right</div>}
        onWorkspaceChange={onWorkspaceChange}
      />,
    )
    const action = screen.getByRole("button", { name: "Reader action" })
    expect(document.querySelector<HTMLElement>('[data-reader-swimlane="reader"]')?.style.width).toBe(`${window.innerWidth}px`)
    expect(document.querySelector<HTMLElement>('[data-reader-swimlane="right"]')?.style.width).toBe("300px")
    expect(document.querySelector('[data-reader-swimlane-header="reader"]')).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "定位阅读器泳道" }))
    expect(onWorkspaceChange).toHaveBeenCalledWith({ activeLane: "reader" })
    expect(readerAction).not.toHaveBeenCalled()

    const focusedShell = shellConfig("swimlane", "reader")
    view.rerender(
      <ReaderSwimlaneWorkspace
        shell={focusedShell}
        workspace={readerWorkspaceConfig(focusedShell)}
        reader={<button type="button" onClick={readerAction}>Reader action</button>}
        left={<div>left</div>}
        right={<div>right</div>}
        onWorkspaceChange={onWorkspaceChange}
      />,
    )
    expect(document.querySelector<HTMLElement>('[data-reader-swimlane="reader"]')?.style.width).toBe(`${window.innerWidth}px`)
    expect(document.querySelector('[data-reader-swimlane-header="reader"]')).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Reader action" }))
    expect(readerAction).toHaveBeenCalledOnce()
  })

  it("uses edge dwell to preview a real adjacent lane without changing focus", () => {
    const shell = shellConfig("swimlane", "reader")
    shell.workspace!.swimlane.edgeRevealDelayMs = 420
    const onWorkspaceChange = vi.fn()
    render(
      <ReaderSwimlaneWorkspace
        shell={shell}
        workspace={readerWorkspaceConfig(shell)}
        reader={<div>reader</div>}
        left={<div>left</div>}
        right={<div>right</div>}
        onWorkspaceChange={onWorkspaceChange}
      />,
    )
    const trigger = document.querySelector<HTMLElement>('[data-reader-swimlane-trigger="right"]')!
    fireEvent.pointerEnter(trigger)
    act(() => vi.advanceTimersByTime(419))
    expect(document.querySelector('[data-reader-swimlane-preview="right"]')).toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(document.querySelector('[data-reader-swimlane-preview="right"]')).toBeTruthy()
    expect(document.querySelector('[data-reader-swimlane-trigger="right"]')).toBeNull()
    expect(onWorkspaceChange).not.toHaveBeenCalled()
  })

  it("does not cover an active side lane with the reveal trigger while Reader fullscreen stays latent", () => {
    const shell = shellConfig("swimlane", "right")
    render(
      <ReaderSwimlaneWorkspace
        shell={shell}
        workspace={readerWorkspaceConfig(shell)}
        reader={<div>reader</div>}
        left={<div>left</div>}
        right={<button type="button">Right action</button>}
        onWorkspaceChange={vi.fn()}
      />,
    )

    expect(shell.workspace!.swimlane.readerSolo).toBe(true)
    expect(document.querySelector('[data-reader-swimlane-trigger]')).toBeNull()
    expect(screen.getByRole("button", { name: "Right action" })).toBeTruthy()
  })

  it("resizes both side lanes from the boundary facing a fullscreen Reader", () => {
    const shell = shellConfig("swimlane", "right")
    const onWorkspaceChange = vi.fn()
    render(
      <ReaderSwimlaneWorkspace
        shell={shell}
        workspace={readerWorkspaceConfig(shell)}
        reader={<div>reader</div>}
        left={<div>left</div>}
        right={<div>right</div>}
        onWorkspaceChange={onWorkspaceChange}
      />,
    )

    expect(screen.getAllByRole("separator", { name: /调整左侧面板泳道宽度/ })).toHaveLength(2)
    expect(screen.getAllByRole("separator", { name: /调整右侧面板泳道宽度/ })).toHaveLength(2)
    const left = screen.getByRole("separator", { name: "从右侧调整左侧面板泳道宽度" })
    const right = screen.getByRole("separator", { name: "从左侧调整右侧面板泳道宽度" })
    expect(left.getAttribute("data-lane-resizer-edge")).toBe("end")
    expect(right.getAttribute("data-lane-resizer-edge")).toBe("start")

    fireEvent.pointerDown(left, { pointerId: 51, clientX: 100, button: 0 })
    fireEvent.pointerMove(window, { pointerId: 51, clientX: 132 })
    fireEvent.pointerUp(window, { pointerId: 51, clientX: 132 })
    expect(onWorkspaceChange).toHaveBeenCalledWith({ lanes: { left: { width: 352 } } })

    const viewport = document.querySelector<HTMLElement>('[data-reader-swimlane-viewport="true"]')!
    viewport.scrollLeft = 200
    fireEvent.pointerDown(right, { pointerId: 52, clientX: 300, button: 0 })
    fireEvent.pointerMove(window, { pointerId: 52, clientX: 268 })
    fireEvent.pointerUp(window, { pointerId: 52, clientX: 268 })
    expect(onWorkspaceChange).toHaveBeenCalledWith({ lanes: { right: { width: 332 } } })
    expect(viewport.scrollLeft).toBe(232)
  })

  it("restores ordinary Reader width from the current viewport ratio and freezes resize after release", () => {
    vi.stubGlobal("innerWidth", 600)
    const onWorkspaceChange = vi.fn()
    const soloShell = shellConfig("swimlane", "reader")
    const view = render(
      <ReaderSwimlaneWorkspace
        shell={soloShell}
        workspace={readerWorkspaceConfig(soloShell)}
        reader={<div>reader</div>}
        left={<div>left</div>}
        right={<div>right</div>}
        onWorkspaceChange={onWorkspaceChange}
      />,
    )
    expect(document.querySelector<HTMLElement>('[data-reader-swimlane="reader"]')?.style.width).toBe("600px")
    expect(document.querySelector('[data-reader-swimlane-header="reader"]')).toBeNull()

    const ordinaryShell = shellConfig("swimlane", "reader")
    ordinaryShell.workspace!.swimlane.readerSolo = false
    ordinaryShell.workspace!.swimlane.readerWidthRatio = 0.5
    ordinaryShell.workspace!.swimlane.lanes.reader.width = 1_600
    view.rerender(
      <ReaderSwimlaneWorkspace
        shell={ordinaryShell}
        workspace={readerWorkspaceConfig(ordinaryShell)}
        reader={<div>reader</div>}
        left={<div>left</div>}
        right={<div>right</div>}
        onWorkspaceChange={onWorkspaceChange}
      />,
    )

    const readerLane = document.querySelector<HTMLElement>('[data-reader-swimlane="reader"]')!
    expect(readerLane.style.width).toBe("300px")
    expect(document.querySelector('[data-reader-swimlane-header="reader"]')).toBeTruthy()
    const separator = screen.getByRole("separator", { name: "从右侧调整阅读器泳道宽度" })
    fireEvent.pointerDown(separator, { pointerId: 13, clientX: 100, button: 0 })
    fireEvent.pointerMove(window, { pointerId: 13, clientX: 160 })
    fireEvent.pointerUp(window, { pointerId: 13, clientX: 160 })
    fireEvent.pointerMove(window, { pointerId: 13, clientX: 220 })

    expect(readerLane.style.width).toBe("360px")
    expect(onWorkspaceChange).toHaveBeenCalledOnce()
    expect(onWorkspaceChange).toHaveBeenCalledWith({
      readerWidthRatio: 0.6,
      lanes: { reader: { width: 360 } },
    })
  })

  it("optionally restores latent Reader solo after dwelling inside the inactive Reader lane", () => {
    const shell = shellConfig("swimlane", "right")
    shell.workspace!.swimlane.readerFocusHoverDelayMs = 700
    const onWorkspaceChange = vi.fn()
    render(
      <ReaderSwimlaneWorkspace
        shell={shell}
        workspace={readerWorkspaceConfig(shell)}
        reader={<div>reader</div>}
        left={<div>left</div>}
        right={<div>right</div>}
        onWorkspaceChange={onWorkspaceChange}
      />,
    )

    const readerLane = document.querySelector<HTMLElement>('[data-reader-swimlane="reader"]')!
    fireEvent.pointerEnter(readerLane)
    act(() => vi.advanceTimersByTime(699))
    expect(onWorkspaceChange).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onWorkspaceChange).toHaveBeenCalledWith({ activeLane: "reader" })
  })

  it("cancels hover focus when the pointer leaves Reader before the configured delay", () => {
    const shell = shellConfig("swimlane", "right")
    const onWorkspaceChange = vi.fn()
    render(
      <ReaderSwimlaneWorkspace
        shell={shell}
        workspace={readerWorkspaceConfig(shell)}
        reader={<div>reader</div>}
        left={<div>left</div>}
        right={<div>right</div>}
        onWorkspaceChange={onWorkspaceChange}
      />,
    )

    const readerLane = document.querySelector<HTMLElement>('[data-reader-swimlane="reader"]')!
    fireEvent.pointerEnter(readerLane)
    fireEvent.pointerLeave(readerLane)
    act(() => vi.advanceTimersByTime(1_000))
    expect(onWorkspaceChange).not.toHaveBeenCalled()
  })

  it("offers shared fullscreen and lane-level numeric settings from every lane header", () => {
    const shell = shellConfig("swimlane", "right")
    shell.workspace!.swimlane.readerSolo = false
    const onWorkspaceChange = vi.fn()
    render(
      <ReaderSwimlaneWorkspace
        shell={shell}
        workspace={readerWorkspaceConfig(shell)}
        reader={<div>reader</div>}
        left={<div>left</div>}
        right={<div>right</div>}
        onWorkspaceChange={onWorkspaceChange}
      />,
    )

    expect(screen.queryByRole("button", { name: "左侧面板全屏" })).toBeNull()
    fireEvent.pointerDown(screen.getByRole("button", { name: "阅读器更多设置" }), { button: 0, ctrlKey: false })
    fireEvent.click(screen.getByRole("menuitem", { name: "当前泳道全屏" }))
    expect(onWorkspaceChange).toHaveBeenLastCalledWith({ activeLane: "reader", readerSolo: true, soloLaneId: null, lanes: { reader: { collapsed: false } } })

    fireEvent.pointerDown(screen.getByRole("button", { name: "左侧面板更多设置" }), { button: 0, ctrlKey: false })
    fireEvent.click(screen.getByRole("menuitem", { name: "当前泳道全屏" }))
    expect(onWorkspaceChange).toHaveBeenLastCalledWith({
      activeLane: "left",
      soloLaneId: "left",
      lanes: { left: { collapsed: false } },
    })

    fireEvent.pointerDown(screen.getByRole("button", { name: "左侧面板更多设置" }), { button: 0, ctrlKey: false })
    const width = screen.getByRole("spinbutton", { name: "左侧面板宽度" })
    fireEvent.change(width, { target: { value: "420" } })
    fireEvent.blur(width)
    expect(onWorkspaceChange).toHaveBeenLastCalledWith({ lanes: { left: { width: 420 } } })
  })

  it("persists collapse and drag reorder from lane chrome", () => {
    const shell = shellConfig("swimlane", "reader")
    shell.workspace!.swimlane.readerSolo = false
    const onWorkspaceChange = vi.fn()
    render(
      <ReaderSwimlaneWorkspace
        shell={shell}
        workspace={readerWorkspaceConfig(shell)}
        reader={<div>reader</div>}
        left={<div>left</div>}
        right={<div>right</div>}
        onWorkspaceChange={onWorkspaceChange}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "折叠左侧面板泳道；按住可拖动" }))
    expect(onWorkspaceChange).toHaveBeenCalledWith({ lanes: { left: { collapsed: true } } })
    fireEvent.click(screen.getByRole("button", { name: "折叠阅读器泳道；按住可拖动" }))
    expect(onWorkspaceChange).toHaveBeenCalledWith({ lanes: { reader: { collapsed: true } } })

    fireEvent.dragStart(screen.getByRole("button", { name: "折叠右侧面板泳道；按住可拖动" }))
    fireEvent.drop(document.querySelector('[data-reader-swimlane="left"]')!)
    expect(onWorkspaceChange).toHaveBeenCalledWith({ laneOrder: ["right", "left", "reader"] })
  })

  it("adds a named dynamic lane from the bottom navigator", () => {
    const shell = shellConfig("swimlane", "reader")
    shell.workspace!.swimlane.readerSolo = false
    const onWorkspaceChange = vi.fn()
    render(
      <ReaderSwimlaneWorkspace
        shell={shell}
        workspace={readerWorkspaceConfig(shell)}
        reader={<div>reader</div>}
        left={<div>left</div>}
        right={<div>right</div>}
        onWorkspaceChange={onWorkspaceChange}
      />,
    )

    const handle = screen.getByRole("button", { name: "拖动或设置泳道切换栏" })
    fireEvent.contextMenu(handle)
    expect(screen.getByRole("menu", { name: "泳道切换栏设置" })).toBeTruthy()
    fireEvent.contextMenu(handle)
    expect(screen.queryByRole("menu", { name: "泳道切换栏设置" })).toBeNull()
    fireEvent.contextMenu(handle)
    fireEvent.click(screen.getByRole("menuitem", { name: "添加泳道" }))
    fireEvent.change(screen.getByRole("textbox", { name: "泳道名称" }), { target: { value: "资料" } })
    fireEvent.click(screen.getByRole("button", { name: "确认添加泳道" }))

    const patch = onWorkspaceChange.mock.calls.at(-1)?.[0]
    const laneId = patch.laneOrder.at(-1)
    expect(laneId).toMatch(/^lane-/)
    expect(patch).toMatchObject({
      activeLane: laneId,
      lanes: { [laneId]: { width: 320, collapsed: false, title: "资料" } },
    })
  })

  it("pins the lane navigator into the Reader title bar and exposes settings from Reader more", () => {
    const shell = shellConfig("swimlane", "reader")
    shell.workspace!.swimlane.readerSolo = false
    shell.workspace!.swimlane.laneNavigatorDock = "reader-title"
    const onWorkspaceChange = vi.fn()
    const onOpenSettings = vi.fn()
    render(
      <ReaderSwimlaneWorkspace
        shell={shell}
        workspace={readerWorkspaceConfig(shell)}
        reader={<div>reader</div>}
        left={<div>left</div>}
        right={<div>right</div>}
        onWorkspaceChange={onWorkspaceChange}
        onOpenSettings={onOpenSettings}
      />,
    )

    const titleSlot = document.querySelector('[data-reader-lane-navigator-title-slot="true"]')!
    expect(titleSlot.querySelector('[data-reader-lane-navigator="true"]')).toBeTruthy()
    expect(document.querySelector('[data-reader-swimlane-header="reader"]')?.textContent).not.toContain("阅读器")

    const handle = screen.getByRole("button", { name: "拖动或设置泳道切换栏" })
    fireEvent.contextMenu(handle)
    fireEvent.click(screen.getByRole("menuitem", { name: "改为悬浮" }))
    expect(onWorkspaceChange).toHaveBeenCalledWith({ laneNavigatorDock: "floating" })

    fireEvent.pointerDown(screen.getByRole("button", { name: "阅读器更多设置" }), { button: 0, ctrlKey: false })
    fireEvent.click(screen.getByRole("menuitem", { name: "打开 NeoView 设置" }))
    expect(onOpenSettings).toHaveBeenCalledOnce()
  })

  it("preserves the complete Reader and lane fullscreen state machine across focus changes", () => {
    let shell = shellConfig("swimlane", "reader")
    let view: ReturnType<typeof render>
    const onWorkspaceChange = vi.fn((patch: ReaderWorkspacePatch) => {
      shell = applyReaderWorkspacePatch(shell, patch)
      view.rerender(workspace())
    })
    const workspace = () => (
      <ReaderSwimlaneWorkspace
        shell={shell}
        workspace={readerWorkspaceConfig(shell)}
        reader={<button type="button">Reader state action</button>}
        left={<button type="button">Left state action</button>}
        right={<button type="button">Right state action</button>}
        onWorkspaceChange={onWorkspaceChange}
      />
    )
    view = render(workspace())

    const readerLane = () => document.querySelector<HTMLElement>('[data-reader-swimlane="reader"]')!
    const rightLane = () => document.querySelector<HTMLElement>('[data-reader-swimlane="right"]')!
    expect(readerLane().style.width).toBe(`${window.innerWidth}px`)
    expect(document.querySelector('[data-reader-swimlane-header="reader"]')).toBeNull()

    fireEvent.pointerDown(screen.getByRole("button", { name: "Right state action" }), { pointerId: 31, button: 0 })
    expect(shell.workspace!.swimlane).toMatchObject({ activeLane: "right", readerSolo: true, readerSoloOnFocus: true })
    expect(shell.workspace!.swimlane.soloLaneId).toBeUndefined()
    expect(readerLane().style.width).toBe(`${window.innerWidth}px`)
    expect(rightLane().style.width).toBe("300px")

    fireEvent.click(screen.getByRole("button", { name: "Reader state action" }))
    expect(shell.workspace!.swimlane).toMatchObject({ activeLane: "reader", readerSolo: true })
    expect(readerLane().style.width).toBe(`${window.innerWidth}px`)

    onWorkspaceChange({ readerSoloOnFocus: false })
    expect(shell.workspace!.swimlane).toMatchObject({ readerSolo: true, readerSoloOnFocus: false })
    expect(readerLane().style.width).toBe(`${window.innerWidth}px`)

    onWorkspaceChange({ readerSolo: false })
    expect(readerLane().style.width).toBe(`${window.innerWidth * 0.5}px`)
    expect(document.querySelector('[data-reader-swimlane-header="reader"]')).toBeTruthy()
    onWorkspaceChange({ activeLane: "right" })
    const callsBeforeHover = onWorkspaceChange.mock.calls.length
    fireEvent.pointerEnter(readerLane())
    act(() => vi.advanceTimersByTime(1_000))
    expect(onWorkspaceChange).toHaveBeenCalledTimes(callsBeforeHover)

    fireEvent.pointerDown(screen.getByRole("button", { name: "右侧面板更多设置" }), { button: 0, ctrlKey: false })
    fireEvent.click(screen.getByRole("menuitem", { name: "当前泳道全屏" }))
    expect(shell.workspace!.swimlane).toMatchObject({ activeLane: "right", readerSolo: false, soloLaneId: "right" })
    expect(rightLane().style.width).toBe(`${window.innerWidth}px`)

    fireEvent.click(screen.getByRole("button", { name: "Reader state action" }))
    expect(shell.workspace!.swimlane).toMatchObject({ activeLane: "reader", readerSolo: false, readerSoloOnFocus: false })
    expect(shell.workspace!.swimlane.soloLaneId).toBeUndefined()
    expect(readerLane().style.width).toBe(`${window.innerWidth * 0.5}px`)
  })
})

function shellConfig(mode: "edges" | "swimlane", activeLane: "left" | "reader" | "right" = "reader"): ReaderShellConfigDto {
  return {
    showDelayMs: 0,
    hideDelayMs: 0,
    opacity: { top: 85, bottom: 85, sidebar: 85 },
    blur: { top: 12, bottom: 12, sidebar: 12 },
    edges: {
      top: { enabled: true, initialVisible: true, pinned: false, triggerSize: 32 },
      right: { enabled: true, initialVisible: false, pinned: false, triggerSize: 32 },
      bottom: { enabled: true, initialVisible: false, pinned: false, triggerSize: 32 },
      left: { enabled: true, initialVisible: true, pinned: true, triggerSize: 32 },
    },
    sidebars: {
      left: { width: 320, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
      right: { width: 280, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
    },
    workspace: {
      mode,
      swimlane: {
        laneOrder: ["left", "reader", "right"],
        activeLane,
        readerSolo: true,
        readerSoloOnFocus: true,
        readerWidthRatio: 0.5,
        edgeRevealDelayMs: 180,
        readerFocusOnHover: true,
        readerFocusHoverDelayMs: 650,
        lanes: {
          left: { width: 320, collapsed: false, activePanelId: "folder" },
          reader: { width: 960, collapsed: false },
          right: { width: 300, collapsed: false, activePanelId: "info" },
        },
      },
    },
    panelLayout: {},
    cardLayout: {},
  }
}
