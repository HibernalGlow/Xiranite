// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"

import type { ReaderShellControlPort } from "./ReaderShellControlPort"
import { createReaderShellControlStore } from "./ReaderShellControlStore"
import { ReaderWindowBar } from "./ReaderWindowBar"

afterEach(cleanup)

function createControl(): ReaderShellControlPort {
  const store = createReaderShellControlStore()
  return {
    store,
    requestOpen: store.requestOpen,
    setPinned: store.setPinned,
    cycleLock: store.cycleLock,
    setLock: store.setLock,
    setFloating: store.setFloating,
    setTriggerSize: () => undefined,
    reset: () => undefined,
    persist: () => undefined,
  }
}

describe("ReaderWindowBar", () => {
  test("keeps shell actions before caption controls when embedded in the Reader topbar", () => {
    const onOpenSettings = vi.fn()
    render(
      <ReaderWindowBar
        control={createControl()}
        mode="edges"
        onModeChange={vi.fn()}
        onOpenSettings={onOpenSettings}
        windowControls={<button type="button" aria-label="关闭窗口">×</button>}
      />,
    )

    const bar = document.querySelector('[data-reader-window-bar="true"]')
    expect(bar).toBeTruthy()
    expect(bar?.getAttribute("data-reader-topbar-controls")).toBe("all")
    expect(bar?.querySelector('[data-reader-topbar-cluster="leading"]')?.querySelectorAll("button")).toHaveLength(5)
    const labels = Array.from(bar!.querySelectorAll("button")).map((button) => button.getAttribute("aria-label"))
    expect(labels.slice(-3)).toEqual(["固定顶栏", "打开 NeoView 设置", "关闭窗口"])

    fireEvent.click(screen.getByLabelText("打开 NeoView 设置"))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })

  test("keeps one reversible mode switch and the topbar pin in both layouts", () => {
    const onModeChange = vi.fn()
    const control = createControl()
    const setPinned = vi.spyOn(control, "setPinned")
    const view = render(
      <ReaderWindowBar
        control={control}
        mode="swimlane"
        onModeChange={onModeChange}
        onOpenSettings={vi.fn()}
        windowControls={null}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "四边栏模式" }))
    expect(onModeChange).toHaveBeenCalledWith("edges")
    fireEvent.click(screen.getByRole("button", { name: "固定顶栏" }))
    expect(setPinned).toHaveBeenCalledWith("top", true)
    expect(screen.queryByRole("button", { name: "顶部边栏" })).toBeNull()

    view.rerender(
      <ReaderWindowBar
        control={control}
        mode="edges"
        onModeChange={onModeChange}
        onOpenSettings={vi.fn()}
        windowControls={null}
      />,
    )
    expect(screen.getByRole("button", { name: "顶部边栏" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "泳道模式" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Reader 视图全屏/ })).toBeNull()
  })

  test("shows the Reader fullscreen exit in the Reader topbar only while its lane title is hidden", () => {
    const onReaderViewFullscreenChange = vi.fn()
    render(
      <ReaderWindowBar
        control={createControl()}
        mode="swimlane"
        readerViewFullscreen
        onModeChange={vi.fn()}
        onReaderViewFullscreenChange={onReaderViewFullscreenChange}
        onOpenSettings={vi.fn()}
        part="trailing"
      />,
    )
    const exit = screen.getByRole("button", { name: "退出 Reader 视图全屏" })
    expect(exit.querySelector("svg.lucide-scan")).toBeTruthy()
    fireEvent.click(exit)
    expect(onReaderViewFullscreenChange).toHaveBeenCalledOnce()
  })
})
