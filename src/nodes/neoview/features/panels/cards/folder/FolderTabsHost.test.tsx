import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderFolderViewConfig, ReaderHttpClient } from "../../../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../../registry"
import FolderTabsHost, { type FolderBrowserPaneProps } from "./FolderTabsHost"

afterEach(cleanup)

describe("FolderTabsHost", () => {
  it("[neoview.folder.tabs-toolbar-layout-stable] preserves wrapped toolbar geometry while switching retained tabs", async () => {
    const context = {
      client: {} as ReaderHttpClient,
      disabled: false,
      panelActive: true,
      sourcePath: "C:/A",
      onGoTo: vi.fn(),
      onFolderView: vi.fn(async () => undefined),
    } satisfies ReaderPanelContext
    const view = render(
      <div className="flex h-[360px] w-[420px]">
        <FolderTabsHost context={context} folderView={folderViewConfig()} BrowserPane={TestBrowserPane} />
      </div>,
    )
    const ui = within(view.container)

    fireEvent.click(ui.getByRole("button", { name: "create retained tab" }))
    await waitFor(() => expect(view.container.querySelectorAll("[data-folder-tab-pane]")).toHaveLength(2))

    const panes = [...view.container.querySelectorAll<HTMLElement>("[data-folder-tab-pane]")]
    const firstPane = panes[0]!
    const secondPane = panes[1]!
    const firstToolbar = firstPane.querySelector('[data-folder-toolbar-layout="wrapping"]')
    const secondToolbar = secondPane.querySelector('[data-folder-toolbar-layout="wrapping"]')
    const stablePaneClasses = "col-start-1 row-start-1 flex min-h-0 min-w-0 overflow-hidden"

    expect(firstPane.className).toContain(stablePaneClasses)
    expect(secondPane.className).toContain(stablePaneClasses)
    expect(firstToolbar).toBeTruthy()
    expect(secondToolbar).toBeTruthy()
    expect(firstPane.getAttribute("data-folder-tab-pane-active")).toBeNull()
    expect(secondPane.getAttribute("data-folder-tab-pane-active")).toBe("true")

    fireEvent.click(await ui.findByRole("tab", { name: "A" }))
    await waitFor(() => expect(firstPane.getAttribute("data-folder-tab-pane-active")).toBe("true"))

    expect(secondPane.getAttribute("data-folder-tab-pane-active")).toBeNull()
    expect(firstPane.querySelector('[data-folder-toolbar-layout="wrapping"]')).toBe(firstToolbar)
    expect(secondPane.querySelector('[data-folder-toolbar-layout="wrapping"]')).toBe(secondToolbar)
  })
})

function TestBrowserPane({ active, tabBar, onCreateTab }: FolderBrowserPaneProps) {
  return (
    <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col" data-test-browser-pane-active={active || undefined}>
      {tabBar}
      <div className="flex min-w-0 flex-wrap" data-folder-toolbar-layout="wrapping">
        <button type="button" onClick={onCreateTab}>create retained tab</button>
      </div>
    </div>
  )
}

function folderViewConfig(): ReaderFolderViewConfig {
  return {
    homePath: "C:/B",
    viewMode: "compact",
    previewGridEnabled: false,
    previewCount: 4,
    contentWidthPercent: 35,
    thumbnailWidthPercent: 20,
    bannerWidthPercent: 50,
    hoverPreviewEnabled: true,
    hoverPreviewDelayMs: 500,
    confirmDelete: true,
    tagDisplay: { tagMode: "collect", showRating: true, showCollectTagCount: true, showTags: true, maxTags: 3, showTooltips: true },
    penetration: { enabled: false, maxDepth: 3, terminalTargets: ["archive", "document", "media-directory", "file"] },
    emptyArea: { singleClickAction: "none", doubleClickAction: "goUp", showBackButton: true },
    details: {
      columnOrder: ["name", "path", "type", "extension", "size", "modifiedAt", "dimensions", "pageCount", "rating", "tags"],
      hiddenColumns: [],
      pinnedLeft: ["name"],
      pinnedRight: [],
      columnWidths: {},
    },
    search: { includeSubfolders: true, showHistoryOnFocus: true, searchInPath: false },
    tree: { visible: false, layout: "left", size: 200, pinnedPaths: [] },
    tabs: {
      pinned: [],
      layout: "top",
      width: 200,
      breadcrumbPosition: "top",
      toolbarPosition: "top",
    },
  }
}
