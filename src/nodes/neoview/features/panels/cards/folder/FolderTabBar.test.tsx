import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import FolderTabBar from "./FolderTabBar"

afterEach(cleanup)

describe("FolderTabBar", () => {
  const layout = {
    pinned: [],
    layout: "none" as const,
    width: 160,
    breadcrumbPosition: "top" as const,
    toolbarPosition: "top" as const,
  }

  const callbacks = {
    onActivate: vi.fn(),
    onCreate: vi.fn(),
    onDuplicate: vi.fn(),
    onClose: vi.fn(),
    onTogglePinned: vi.fn(),
    onCloseOthers: vi.fn(),
    onCloseLeft: vi.fn(),
    onCloseRight: vi.fn(),
    onReopen: vi.fn(),
    onLayoutChange: vi.fn(),
  }

  it("[neoview.folder.tabs-single-hidden] keeps the default tab bar hidden for one tab", () => {
    const view = render(
      <FolderTabBar
        {...callbacks}
        tabs={[{ id: "one", currentPath: "C:/books", title: "books", pinned: false }]}
        activeTabId="one"
        disabled={false}
        maxTabs={8}
        recentlyClosed={[]}
        layout={layout}
      />,
    )

    expect(view.container.querySelector('[data-folder-tab-bar="false"]')).toBeTruthy()
    expect(view.container.querySelector('[data-folder-tab-bar="true"]')).toBeNull()
  })

  it("[neoview.folder.tabs-multi-visible] reveals a top tab bar when the second tab appears", () => {
    const view = render(
      <FolderTabBar
        {...callbacks}
        tabs={[
          { id: "one", currentPath: "C:/books", title: "books", pinned: false },
          { id: "two", currentPath: "C:/other", title: "other", pinned: false },
        ]}
        activeTabId="two"
        disabled={false}
        maxTabs={8}
        recentlyClosed={[]}
        layout={layout}
      />,
    )

    expect(view.container.querySelector('[data-folder-tab-bar="true"]')).toBeTruthy()
    expect(view.container.querySelector('[data-folder-tab-layout="top"]')).toBeTruthy()
    expect(view.getAllByRole("tab")).toHaveLength(2)
  })
})
