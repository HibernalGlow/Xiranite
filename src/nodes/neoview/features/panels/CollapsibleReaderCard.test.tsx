import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CollapsibleReaderCard } from "./CollapsibleReaderCard"

afterEach(cleanup)

describe("CollapsibleReaderCard", () => {
  it("renders the shared magic-card surface and title slot", () => {
    render(<CollapsibleReaderCard title="共享标题">content</CollapsibleReaderCard>)

    expect(document.querySelector('[data-slot="magic-card"]')).toBeTruthy()
    expect(document.querySelector('[data-slot="reader-card-title"]')).toBeTruthy()
  })

  it("[neoview.card.header-icon] preserves an explicitly registered legacy header icon", () => {
    render(
      <CollapsibleReaderCard title="预加载状态" icon={<span data-testid="loader-icon" />}>content</CollapsibleReaderCard>,
    )
    expect(screen.getByTestId("loader-icon")).toBeTruthy()
    expect(screen.getByText("预加载状态")).toBeTruthy()
  })

  it("[neoview.card.zero-mount] is controlled and does not mount collapsed content", () => {
    const changed = vi.fn()
    const view = render(
      <CollapsibleReaderCard title="性能卡片" collapsed onCollapsedChange={changed}>
        <div data-testid="heavy-card-content">heavy</div>
      </CollapsibleReaderCard>,
    )
    expect(screen.queryByTestId("heavy-card-content")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "展开性能卡片" }))
    expect(changed).toHaveBeenCalledWith(false)
    expect(screen.queryByTestId("heavy-card-content")).toBeNull()

    view.rerender(
      <CollapsibleReaderCard title="性能卡片" collapsed={false} onCollapsedChange={changed}>
        <div data-testid="heavy-card-content">heavy</div>
      </CollapsibleReaderCard>,
    )
    expect(screen.getByTestId("heavy-card-content")).toBeTruthy()
  })

  it("[neoview.card.resize-performance] mutates DOM during pointer moves and commits once on pointer up", () => {
    const changed = vi.fn()
    render(
      <CollapsibleReaderCard title="性能卡片" onHeightChange={changed}>
        <div>heavy</div>
      </CollapsibleReaderCard>,
    )
    const content = document.querySelector<HTMLElement>('[data-reader-card-content="性能卡片"]')!
    Object.defineProperty(content, "offsetHeight", { configurable: true, value: 200 })
    const handle = screen.getByRole("button", { name: "调整性能卡片高度" })

    fireEvent.pointerDown(handle, { pointerId: 11, clientY: 100 })
    for (let index = 1; index <= 40; index += 1) {
      fireEvent.pointerMove(handle, { pointerId: 11, clientY: 100 + index * 2 })
    }
    expect(changed).not.toHaveBeenCalled()
    expect(content.style.height).toBe("280px")
    fireEvent.pointerUp(handle, { pointerId: 11, clientY: 180 })
    expect(changed).toHaveBeenCalledOnce()
    expect(changed).toHaveBeenCalledWith(280)
  })

  it("[neoview.card.resize-bounds] clamps the minimum and restores the configured height on cancel", () => {
    const changed = vi.fn()
    render(
      <CollapsibleReaderCard title="性能卡片" height={180} onHeightChange={changed}>
        <div>heavy</div>
      </CollapsibleReaderCard>,
    )
    const content = document.querySelector<HTMLElement>('[data-reader-card-content="性能卡片"]')!
    const handle = screen.getByRole("button", { name: "调整性能卡片高度" })

    fireEvent.pointerDown(handle, { pointerId: 12, clientY: 200 })
    fireEvent.pointerMove(handle, { pointerId: 12, clientY: -200 })
    expect(content.style.height).toBe("50px")
    fireEvent.pointerCancel(handle, { pointerId: 12, clientY: -200 })
    expect(content.style.height).toBe("180px")
    expect(changed).not.toHaveBeenCalled()
  })

  it("[neoview.card.resize-reset] resets custom height and keeps collapsed resize controls unmounted", () => {
    const changed = vi.fn()
    const view = render(
      <CollapsibleReaderCard title="性能卡片" height={180} onHeightChange={changed}>
        <div>heavy</div>
      </CollapsibleReaderCard>,
    )
    const handle = screen.getByRole("button", { name: "调整性能卡片高度" })
    fireEvent.doubleClick(handle)
    expect(changed).toHaveBeenCalledOnce()
    expect(changed).toHaveBeenCalledWith(undefined)

    view.rerender(
      <CollapsibleReaderCard title="性能卡片" collapsed height={180} onHeightChange={changed}>
        <div data-testid="heavy-card-content">heavy</div>
      </CollapsibleReaderCard>,
    )
    expect(screen.queryByRole("button", { name: "调整性能卡片高度" })).toBeNull()
    expect(screen.queryByTestId("heavy-card-content")).toBeNull()
  })

  it("[neoview.card.single-exclusive] removes chrome without replacing the Card content", () => {
    const view = render(
      <CollapsibleReaderCard title="文件浏览">
        <div data-testid="resident-card">content</div>
      </CollapsibleReaderCard>,
    )
    const resident = screen.getByTestId("resident-card")

    view.rerender(
      <CollapsibleReaderCard title="文件浏览" frameless collapsed height={180}>
        <div data-testid="resident-card">content</div>
      </CollapsibleReaderCard>,
    )

    expect(screen.getByTestId("resident-card")).toBe(resident)
    expect(document.querySelector('[data-reader-card="文件浏览"]')?.getAttribute("data-reader-card-chrome")).toBe("none")
    expect(screen.queryByRole("button", { name: "展开文件浏览" })).toBeNull()
    expect(screen.queryByRole("button", { name: "调整文件浏览高度" })).toBeNull()
  })
})
