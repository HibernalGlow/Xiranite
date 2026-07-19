import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { StrictMode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import DockedSwitchToastCard, { SwitchToastCard, type SwitchToastPatch, type SwitchToastPort, type SwitchToastSettings } from "./SwitchToastCard"

afterEach(cleanup)

describe("SwitchToastCard", () => {
  it("[neoview.switch-toast.resident] keeps the full Card subscribed while its panel is inactive", async () => {
    const port = memoryPort()
    const subscribe = vi.spyOn(port, "subscribe")
    const context = { switchToast: port, disabled: false, client: {} as never, onGoTo: () => undefined }
    const view = render(<DockedSwitchToastCard {...context} panelActive={false} />)

    await vi.waitFor(() => expect(subscribe).toHaveBeenCalled())
    expect(view.container.querySelector('[data-neoview-card="switch-toast"]')).toBeTruthy()
    expect(view.container.querySelector('[data-switch-toast-state="ready"]')).toBeTruthy()
    expect(view.container.querySelector('[data-neoview-card="switch-toast"]')?.getAttribute("data-panel-active")).toBe("false")
  })

  it("[neoview.switch-toast.loading] remains mounted with a stable empty state before config hydration", () => {
    const view = render(<SwitchToastCard />)
    expect(view.container.querySelector('[data-neoview-card="switch-toast"]')).toBeTruthy()
    expect(view.container.querySelector('[data-switch-toast-state="loading"]')).toBeTruthy()
    expect(screen.getByText("切换提示配置加载中...")).toBeTruthy()
  })

  it("[neoview.switch-toast.ui] preserves the legacy compact hierarchy and all controls", () => {
    const view = render(<SwitchToastCard port={memoryPort()} />)
    expect(screen.getByText("提示悬浮窗")).toBeTruthy()
    expect(screen.getAllByRole("switch")).toHaveLength(5)
    expect(screen.getByRole("slider", { name: "透明度" })).toBeTruthy()
    expect(screen.getByLabelText("X 轴")).toBeTruthy()
    expect(screen.getByLabelText("Y 轴")).toBeTruthy()
    expect(screen.getByText("书籍提示模板")).toBeTruthy()
    expect(screen.getByText("页面提示模板")).toBeTruthy()
    expect(screen.getAllByText("变量")).toHaveLength(2)
    expect(screen.getByText("{{page.name}}")).toBeTruthy()
    expect(screen.getAllByRole("table")).toHaveLength(2)
    expect(screen.getAllByRole("table").every((table) => table.className.includes("table-fixed"))).toBe(true)
    expect(screen.getAllByRole("table")[0]?.getAttribute("data-switch-toast-variable-table")).toBe("true")
    const card = view.container.querySelector('[data-neoview-card="switch-toast"]')!
    expect(Array.from(card.children)
      .filter((child) => child.hasAttribute("data-reader-card-section"))
      .map((child) => child.getAttribute("data-reader-card-section"))).toEqual([
        "提示悬浮窗",
        "触发条件",
        "书籍提示模板",
        "页面提示模板",
      ])
  })

  it("[neoview.switch-toast.draft-commit] keeps numeric and text drafts local until blur", () => {
    const port = memoryPort()
    render(<SwitchToastCard port={port} />)
    const x = screen.getByLabelText("X 轴")
    fireEvent.focus(x)
    fireEvent.change(x, { target: { value: "320" } })
    expect(port.update).not.toHaveBeenCalled()
    fireEvent.blur(x)
    expect(port.update).toHaveBeenCalledWith({ positionX: 320 })

    const title = screen.getByLabelText("页面标题模板")
    fireEvent.focus(title)
    fireEvent.change(title, { target: { value: "第 {{page.indexDisplay}} 页" } })
    expect(port.update).toHaveBeenCalledTimes(1)
    fireEvent.blur(title)
    expect(port.update).toHaveBeenLastCalledWith({ pageTitleTemplate: "第 {{page.indexDisplay}} 页" })
  })

  it("[neoview.switch-toast.slider-commit] previews opacity repeatedly and commits once at pointer end", () => {
    const port = memoryPort()
    render(<SwitchToastCard port={port} />)
    const opacity = screen.getByRole("slider", { name: "透明度" })
    fireEvent.change(opacity, { target: { value: "0.75" } })
    fireEvent.change(opacity, { target: { value: "0.64" } })
    expect(port.preview).toHaveBeenCalledTimes(2)
    expect(port.commit).not.toHaveBeenCalled()
    fireEvent.pointerUp(opacity, { pointerId: 1 })
    expect(port.commit).toHaveBeenCalledOnce()
  })

  it("[neoview.switch-toast.preview] sends the current draft-free settings to the test command", () => {
    const onShowTest = vi.fn()
    const settings = defaults()
    render(<SwitchToastCard port={memoryPort(settings)} onShowTest={onShowTest} />)
    fireEvent.click(screen.getByRole("button", { name: "显示测试提示" }))
    expect(onShowTest).toHaveBeenCalledWith(settings)
  })

  it("settles a switch save under React Strict Mode", async () => {
    const port = memoryPort()
    render(<StrictMode><SwitchToastCard port={port} /></StrictMode>)

    const toggle = screen.getByRole("switch", { name: "切换页面时显示提示" })
    fireEvent.click(toggle)

    await waitFor(() => expect(screen.getByText("已保存", { exact: true })).toBeTruthy())
    expect(toggle.getAttribute("data-state")).toBe("checked")
  })

  it("surfaces a failed save and retries it", async () => {
    const port = memoryPort()
    port.update.mockRejectedValueOnce(new Error("disk full"))
    render(<SwitchToastCard port={port} />)

    fireEvent.click(screen.getByRole("switch", { name: "切换页面时显示提示" }))
    expect((await screen.findByRole("alert")).textContent).toContain("保存失败")
    fireEvent.click(screen.getByRole("button", { name: "重试" }))

    await waitFor(() => expect(screen.getByText("已保存", { exact: true })).toBeTruthy())
    expect(port.update).toHaveBeenCalledTimes(2)
  })
})

function defaults(): SwitchToastSettings {
  return {
    enableBook: false,
    enablePage: false,
    enableAction: false,
    enableBoundaryToast: true,
    showBookPath: true,
    showBookPageProgress: true,
    showBookType: false,
    showPageIndex: true,
    showPageSize: false,
    showPageDimensions: true,
    bookTitleTemplate: "已切换到 {{book.displayName}}",
    bookDescriptionTemplate: "路径：{{book.path}}",
    pageTitleTemplate: "",
    pageDescriptionTemplate: "{{page.dimensionsFormatted}}  {{page.sizeFormatted}}",
    positionX: 20,
    positionY: 20,
    opacity: 0.92,
    liquidGlass: false,
  }
}

function memoryPort(initial = defaults()): SwitchToastPort & {
  preview: ReturnType<typeof vi.fn<(patch: SwitchToastPatch) => void>>
  commit: ReturnType<typeof vi.fn<() => Promise<void>>>
  update: ReturnType<typeof vi.fn<(patch: SwitchToastPatch) => Promise<void>>>
} {
  let snapshot = initial
  const listeners = new Set<() => void>()
  const publish = (patch: SwitchToastPatch) => {
    snapshot = { ...snapshot, ...patch }
    for (const listener of listeners) listener()
  }
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    preview: vi.fn((patch: SwitchToastPatch) => { publish(patch) }),
    commit: vi.fn(async () => undefined),
    update: vi.fn(async (patch: SwitchToastPatch) => { publish(patch) }),
  }
}
