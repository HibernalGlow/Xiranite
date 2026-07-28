import { Grid2X2 } from "lucide-react"
import { expect, test, vi } from "vitest"
import { page } from "vitest/browser"
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

function ToolbarWithStartupPreference({ preference }: { preference: ReaderStartupRestorePreference }) {
  return (
    <ReaderStartupRestorePreferenceProvider preference={preference}>
      <FolderToolbar {...toolbarProps()} />
    </ReaderStartupRestorePreferenceProvider>
  )
}

function toolbarProps(): FolderToolbarProps {
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
  }
}
