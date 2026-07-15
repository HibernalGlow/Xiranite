import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CollapsibleReaderCard } from "./CollapsibleReaderCard"

afterEach(cleanup)

describe("CollapsibleReaderCard", () => {
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
})
