import { Grid2X2 } from "lucide-react"
import { expect, test, vi } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "vitest-browser-react"

import { ReaderStartupRestorePreferenceProvider } from "../../../../app/ReaderStartupRestorePreferenceContext"
import type { ReaderStartupRestorePreference } from "../../../../app/useReaderStartupRestore"
import FolderToolbar, { type FolderToolbarProps } from "./FolderToolbar"

test("[neoview.file-card.startup-restore-menu-gui] saves the File Card More menu preference", async () => {
  const setRestoreLastBook = vi.fn(async () => undefined)
  await render(<ToolbarWithStartupPreference preference={{ restoreLastBook: true, canUpdate: true, pending: false, setRestoreLastBook }} />)

  await page.getByRole("button", { name: "更多" }).click()
  await page.getByRole("menuitemcheckbox", { name: "启动时恢复上次阅读" }).click()

  await expect.poll(() => setRestoreLastBook).toHaveBeenCalledWith(false)
})

test("[neoview.file-card.startup-restore-menu-gui] disables the control until the config writer is available", async () => {
  await render(<ToolbarWithStartupPreference preference={{ restoreLastBook: true, canUpdate: false, pending: false, setRestoreLastBook: async () => undefined }} />)

  await page.getByRole("button", { name: "更多" }).click()
  await expect.element(page.getByRole("menuitemcheckbox", { name: "启动时恢复上次阅读" })).toBeDisabled()
})

test("[neoview.file-card.cm-rating-sort-gui] selects CM rating with its required descending order", async () => {
  const onUpdateSort = vi.fn()
  await render(<FolderToolbar {...toolbarProps({
    canSort: true,
    sort: { field: "name", order: "asc", directoriesFirst: true },
    sortFields: ["name", "cmRating"],
    sortLabels: { name: "名称", cmRating: "CM 评分" } as FolderToolbarProps["sortLabels"],
    onUpdateSort,
  })} />)

  await page.getByRole("button", { name: "排序" }).click()
  await page.getByRole("menuitemradio", { name: "CM 评分" }).click()

  await expect.poll(() => onUpdateSort).toHaveBeenCalledWith({
    field: "cmRating",
    order: "desc",
    directoriesFirst: true,
  })
})

test("[neoview.folder.mega-menu.desktop-gui] [neoview.folder.mega-menu.keyboard-gui] [neoview.folder.mega-menu.no-duplicate-refresh-gui] shows four semantic columns, retains keyboard submenus, and keeps refresh direct", async () => {
  const onRefresh = vi.fn()
  await page.viewport(1440, 900)
  await render(
    <ReaderStartupRestorePreferenceProvider preference={{ restoreLastBook: true, canUpdate: true, pending: false, setRestoreLastBook: async () => undefined }}>
      <FolderToolbar {...toolbarProps({
        canFilter: true,
        canTree: true,
        canImportEfu: true,
        canRefreshThumbnails: true,
        canRefreshSelectedThumbnails: true,
        onRefresh,
      })} />
    </ReaderStartupRestorePreferenceProvider>,
  )

  await page.getByRole("button", { name: "更多" }).click()
  const menu = document.querySelector<HTMLElement>("[data-folder-mega-menu='true']")!
  const columns = Array.from(menu.querySelectorAll<HTMLElement>("[data-folder-mega-menu-column]"))
  const columnRects = columns.map((column) => column.getBoundingClientRect())

  expect(columns).toHaveLength(4)
  expect(new Set(columnRects.map((rect) => Math.round(rect.left))).size).toBe(4)
  expect(new Set(columnRects.map((rect) => Math.round(rect.top))).size).toBe(1)
  expect(document.body.textContent).not.toContain("刷新当前目录")
  expect(document.querySelector("[data-navigation-pad-position='center']")).not.toBeNull()

  const typeFilterTrigger = await page.getByRole("menuitem", { name: /显示类型/ }).findElement()
  typeFilterTrigger.focus()
  await userEvent.keyboard("{ArrowRight}")
  await expect.poll(() => document.querySelector("[data-folder-toolbar-menu='type-filter']")).not.toBeNull()

  await userEvent.keyboard("{Escape}")
  await userEvent.keyboard("{Escape}")
  await page.getByRole("button", { name: "刷新" }).click()
  expect(onRefresh).toHaveBeenCalledOnce()
})

test("[neoview.folder.mega-menu.medium-gui] reflows the same semantic columns into three columns at medium widths", async () => {
  await page.viewport(1100, 900)
  try {
    await render(<ToolbarWithStartupPreference preference={{ restoreLastBook: true, canUpdate: true, pending: false, setRestoreLastBook: async () => undefined }} />)
    await page.getByRole("button", { name: "更多" }).click()

    const columns = Array.from(document.querySelectorAll<HTMLElement>("[data-folder-mega-menu-column]"))
    const columnRects = columns.map((column) => column.getBoundingClientRect())

    expect(columns).toHaveLength(4)
    expect(new Set(columnRects.map((rect) => Math.round(rect.left))).size).toBe(3)
    expect(new Set(columnRects.map((rect) => Math.round(rect.top))).size).toBe(2)
  } finally {
    await page.viewport(1440, 900)
  }
})

test("[neoview.folder.mega-menu.constrained-gui] reflows the stable columns without clipping", async () => {
  await page.viewport(760, 900)
  try {
    await render(<ToolbarWithStartupPreference preference={{ restoreLastBook: true, canUpdate: true, pending: false, setRestoreLastBook: async () => undefined }} />)
    await page.getByRole("button", { name: "更多" }).click()

    const menu = document.querySelector<HTMLElement>("[data-folder-mega-menu='true']")!
    const columns = Array.from(menu.querySelectorAll<HTMLElement>("[data-folder-mega-menu-column]"))
    const columnRects = columns.map((column) => column.getBoundingClientRect())
    const menuRect = menu.getBoundingClientRect()

    expect(columns).toHaveLength(4)
    expect(new Set(columnRects.map((rect) => Math.round(rect.left))).size).toBe(2)
    expect(new Set(columnRects.map((rect) => Math.round(rect.top))).size).toBe(2)
    expect(menuRect.left).toBeGreaterThanOrEqual(0)
    expect(menuRect.right).toBeLessThanOrEqual(window.innerWidth)
    expect(columnRects.every((rect) => rect.left >= menuRect.left && rect.right <= menuRect.right)).toBe(true)
  } finally {
    await page.viewport(1440, 900)
  }
})

function ToolbarWithStartupPreference({ preference }: { preference: ReaderStartupRestorePreference }) {
  return (
    <ReaderStartupRestorePreferenceProvider preference={preference}>
      <FolderToolbar {...toolbarProps()} />
    </ReaderStartupRestorePreferenceProvider>
  )
}

function toolbarProps(overrides: Partial<FolderToolbarProps> = {}): FolderToolbarProps {
  return {
    disabled: false,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    canGoUp: false,
    currentPath: "D:/books",
    viewMode: "compact",
    viewModeOptions: [{ value: "compact", label: "紧凑列表", icon: Grid2X2 }],
    previewGridEnabled: false,
    previewCount: 4,
    hoverPreviewEnabled: true,
    hoverPreviewDelayMs: 500,
    contentWidthPercent: 100,
    thumbnailWidthPercent: 100,
    bannerWidthPercent: 100,
    searchOpen: false,
    canFilter: false,
    showHiddenFolders: false,
    hideMissingEfuEntries: false,
    canHideMissingEfuEntries: false,
    tagDisplay: { tagMode: "collect", showRating: true, showCollectTagCount: true, showTags: true, maxTags: 3, showTooltips: true },
    titleWrap: { compact: false, "cover-list": false, "mosaic-list": false, details: false, "cover-grid": false, "mosaic-grid": false },
    penetration: {
      enabled: false,
      expandBranchesInline: false,
      inlineBranchLimitsEnabled: false,
      inlineBranchMaxDirectories: 10,
      inlineBranchMaxFiles: 10,
      inlineBranchMaxItems: 20,
      showInternalFiles: false,
      internalItemsMode: "single",
      maxDepth: 3,
      terminalTargets: [],
    },
    treeOpen: false,
    treeLayout: "left",
    canTree: false,
    inlineTreeOpen: false,
    multiSelectMode: false,
    confirmations: { trash: true, permanentDelete: true, batchTrash: true, batchPermanentDelete: true },
    canSort: false,
    canSortPreference: false,
    emptyArea: { singleClickAction: "none", doubleClickAction: "none", showBackButton: false },
    thumbnailRefreshPending: false,
    canRefreshThumbnails: false,
    canRefreshSelectedThumbnails: false,
    sortLabels: {} as FolderToolbarProps["sortLabels"],
    sortSourceLabels: {} as FolderToolbarProps["sortSourceLabels"],
    onNavigateBack: () => undefined,
    onNavigateForward: () => undefined,
    onNavigateUp: () => undefined,
    onGoHome: () => undefined,
    onSetHome: () => undefined,
    onRefresh: () => undefined,
    onSwitchView: () => undefined,
    onTogglePreviewGrid: () => undefined,
    onSwitchPreviewCount: () => undefined,
    onCommitHoverPreviewEnabled: () => undefined,
    onCommitHoverPreviewDelay: () => undefined,
    onContentWidthChange: () => undefined,
    onCommitContentWidth: () => undefined,
    onThumbnailWidthChange: () => undefined,
    onCommitThumbnailWidth: () => undefined,
    onBannerWidthChange: () => undefined,
    onCommitBannerWidth: () => undefined,
    onToggleSearch: () => undefined,
    onTagDisplayChange: () => undefined,
    onTitleWrapChange: () => undefined,
    onTogglePenetration: () => undefined,
    onUpdatePenetration: () => undefined,
    onToggleTree: () => undefined,
    onTreeLayoutChange: () => undefined,
    onToggleInlineTree: () => undefined,
    onToggleMultiSelect: () => undefined,
    onUpdateSort: () => undefined,
    onUpdateSortPreference: () => undefined,
    onEmptyAreaChange: () => undefined,
    onRefreshVisibleThumbnails: () => undefined,
    onRefreshSelectedThumbnails: () => undefined,
    onCancelThumbnailRefresh: () => undefined,
    ...overrides,
  }
}
