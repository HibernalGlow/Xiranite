import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
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

  it("[neoview.folder.tabs-single-hidden] keeps the default tab bar hidden while retaining its action menu", async () => {
    const user = userEvent.setup()
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
    await user.click(screen.getByRole("button", { name: "标签操作 books" }))
    expect(screen.getByRole("menuitem", { name: "固定标签" })).toBeTruthy()
    expect(screen.getByRole("menuitem", { name: "复制标签" })).toBeTruthy()
    expect(screen.getByRole("menuitem", { name: "关闭标签" }).getAttribute("data-disabled")).not.toBeNull()
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

  it("[neoview.folder.tabs-action-pad] packs create / reopen / layout into one 3-way pad", async () => {
    const user = userEvent.setup()
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
        recentlyClosed={[{ id: "closed-1", currentPath: "C:/old", title: "old", kind: "directory" }]}
        layout={{ ...layout, layout: "top" }}
      />,
    )

    const pad = view.container.querySelector('[data-folder-tab-action-pad="true"]')
    expect(pad).toBeTruthy()
    expect(pad?.getAttribute("role")).toBe("group")
    expect(screen.getByRole("group", { name: "标签页操作" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "新建文件夹标签" }).getAttribute("data-folder-tab-pad-position")).toBe("top")
    expect(screen.getByRole("button", { name: "重新打开关闭的页签" }).getAttribute("data-folder-tab-pad-position")).toBe("left")
    expect(screen.getByRole("button", { name: "标签栏布局设置" }).getAttribute("data-folder-tab-pad-position")).toBe("right")

    await user.click(screen.getByRole("button", { name: "新建文件夹标签" }))
    expect(callbacks.onCreate).toHaveBeenCalledOnce()

    await user.click(screen.getByRole("button", { name: "重新打开关闭的页签" }))
    await user.click(await screen.findByRole("menuitem", { name: /old/ }))
    expect(callbacks.onReopen).toHaveBeenCalledWith("closed-1")
  })
})
