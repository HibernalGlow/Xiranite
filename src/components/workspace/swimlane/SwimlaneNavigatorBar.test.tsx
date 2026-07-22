// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ContextMenuProvider, useContextMenuBuilder } from "@/components/context-menu"
import { SwimlaneBarMenuItem, SwimlaneNavigatorBar } from "./SwimlaneNavigatorBar"

function WorkspaceMenu() {
  useContextMenuBuilder("workspace-canvas", () => [{ label: "viewMode", onSelect: vi.fn() }])
  return null
}

describe("SwimlaneNavigatorBar", () => {
  it("stops the workspace menu and opens only its native handle menu", () => {
    render(
      <ContextMenuProvider>
        <WorkspaceMenu />
        <div data-context-menu="workspace-canvas">
          <SwimlaneNavigatorBar items={[{ id: "lane", label: "泳道" }]} activeId="lane" onSelect={vi.fn()} menu={<SwimlaneBarMenuItem onSelect={vi.fn()}>泳道设置</SwimlaneBarMenuItem>} />
        </div>
      </ContextMenuProvider>,
    )

    fireEvent.contextMenu(screen.getByRole("button", { name: "拖动或设置泳道切换栏" }))
    expect(screen.getByRole("menuitem", { name: "泳道设置" })).toBeTruthy()
    expect(screen.queryByRole("menuitem", { name: "viewMode" })).toBeNull()
  })
})
