import { describe, expect, it } from "vitest"
import { parseNeoviewBoardLayoutPatch, parseNeoviewBookPatch, parseNeoviewBookmarkListPatch, parseNeoviewCardLayoutPatch, parseNeoviewEmmPatch, parseNeoviewFolderViewPatch, parseNeoviewHistoryListPatch, parseNeoviewPageListPatch, parseNeoviewPageTransitionPatch, parseNeoviewRuntimeConfig, parseNeoviewShellControlPatch, parseNeoviewSidebarLayoutPatch, parseNeoviewSlideshowPatch, parseNeoviewSystemMonitorPatch, parseNeoviewViewDefaultsPatch } from "./ReaderRuntimeConfig.js"

describe("parseNeoviewRuntimeConfig", () => {
  it("[neoview.folder.settings] [neoview.folder.search-settings] [neoview.folder.tabs-pin-config] normalizes folder view and legacy search settings", () => {
      expect(parseNeoviewRuntimeConfig({ folder: {
        home_path: " D:/Books ",
        view_mode: "details",
        preview_count: 9,
        thumbnail_width_percent: 34,
        banner_width_percent: 70,
        penetration: { enabled: true, max_depth: 5, terminal_targets: ["archive", "media-directory"] },
        tabs: {
          pinned: [{ path: "D:/Books", title: "Books" }, { path: "D:/Books", title: "Books copy" }],
          layout: "right",
          width: 240,
          breadcrumb_position: "left",
          toolbar_position: "bottom",
        },
        tree_view: { visible: true, layout: "right", size: 260, pinned_paths: ["D:\\Pinned", "d:/pinned"] },
        details: {
          column_order: ["name", "rating", "path"],
          hidden_columns: ["tags", "future-column"],
          pinned_left: ["name", "rating"],
          pinned_right: ["rating", "tags"],
          column_widths: { name: 260, path: 420, "future-column": 999 },
        },
      } }).folderView).toEqual({
        homePath: "D:/Books",
        confirmations: { trash: false, permanentDelete: true, batchTrash: false, batchPermanentDelete: true },
        viewMode: "details",
        previewGridEnabled: false,
        previewCount: 9,
        contentWidthPercent: 35,
        thumbnailWidthPercent: 34,
        bannerWidthPercent: 70,
        hoverPreviewEnabled: true,
        hoverPreviewDelayMs: 500,
        titleWrap: { compact: false, "cover-list": false, "mosaic-list": false, details: false, "cover-grid": true, "mosaic-grid": false },
        typeFilter: "library",
        showHiddenFolders: false,
        hideMissingEfuEntries: false,
        tagDisplay: { tagMode: "collect", showRating: true, showCollectTagCount: true, showTags: true, maxTags: 3, showTooltips: true },
        migration: { quickTargets: [] },
        penetration: { enabled: true, expandBranchesInline: false, inlineBranchLimitsEnabled: true, inlineBranchMaxDirectories: 4, inlineBranchMaxFiles: 4, inlineBranchMaxItems: 4, showInternalFiles: true, internalItemsMode: "single", maxDepth: 5, terminalTargets: ["archive", "media-directory"] },
        emptyArea: { singleClickAction: "none", doubleClickAction: "goUp", showBackButton: false },
        details: {
          columnOrder: ["name", "rating", "path", "type", "extension", "size", "modifiedAt", "dimensions", "pageCount", "tags"],
          hiddenColumns: ["tags"],
          pinnedLeft: ["name", "rating"],
          pinnedRight: ["tags"],
          columnWidths: {
            name: 260, path: 420, type: 80, extension: 80, size: 96,
            modifiedAt: 152, dimensions: 96, pageCount: 72, rating: 72, tags: 180,
          },
        },
        search: { includeSubfolders: true, showHistoryOnFocus: true, searchInPath: false },
        tree: { visible: true, layout: "right", size: 260, pinnedPaths: ["D:\\Pinned"] },
        tabs: {
          pinned: [{ path: "D:/Books", title: "Books" }, { path: "D:/Books", title: "Books copy" }],
          layout: "right",
          width: 240,
          breadcrumbPosition: "left",
          toolbarPosition: "bottom",
        },
      })
      expect(parseNeoviewFolderViewPatch({ folderView: {
        homePath: " E:/Library ",
        viewMode: "cover-grid",
        previewGridEnabled: true,
        previewCount: 16,
        thumbnailWidthPercent: 42,
        bannerWidthPercent: 80,
        hoverPreviewEnabled: false,
        hoverPreviewDelayMs: 1200,
        showHiddenFolders: true,
        hideMissingEfuEntries: true,
        confirmations: { trash: true, permanentDelete: false, batchTrash: true, batchPermanentDelete: false },
        penetration: { enabled: true, expandBranchesInline: true, showInternalFiles: false, internalItemsMode: "single", maxDepth: 10, terminalTargets: ["archive", "document"] },
        tree: { visible: true, layout: "bottom", size: 320, pinnedPaths: ["E:/Books"] },
        tabs: { pinned: [{ path: "E:/Library", title: "Library" }] },
        details: { columnOrder: ["rating", "name"], hiddenColumns: ["tags"], pinnedLeft: ["name"], pinnedRight: ["rating"], columnWidths: { name: 300, rating: 84 } },
        search: { includeSubfolders: false, showHistoryOnFocus: false, searchInPath: true },
      } })).toEqual({
        patch: { folderView: {
          homePath: "E:/Library",
          viewMode: "cover-grid",
          previewGridEnabled: true,
          previewCount: 16,
          thumbnailWidthPercent: 42,
          bannerWidthPercent: 80,
          hoverPreviewEnabled: false,
          hoverPreviewDelayMs: 1200,
          showHiddenFolders: true,
          hideMissingEfuEntries: true,
          confirmations: { trash: true, permanentDelete: false, batchTrash: true, batchPermanentDelete: false },
          penetration: { enabled: true, expandBranchesInline: true, showInternalFiles: false, internalItemsMode: "single", maxDepth: 10, terminalTargets: ["archive", "document"] },
          details: {
            columnOrder: ["rating", "name", "path", "type", "extension", "size", "modifiedAt", "dimensions", "pageCount", "tags"],
            hiddenColumns: ["tags"],
            pinnedLeft: ["name"],
            pinnedRight: ["rating"],
            columnWidths: { name: 300, rating: 84 },
          },
          search: { includeSubfolders: false, showHistoryOnFocus: false, searchInPath: true },
          tree: { visible: true, layout: "bottom", size: 320, pinnedPaths: ["E:/Books"] },
          tabs: { pinned: [{ path: "E:/Library", title: "Library" }] },
        } },
        tomlPatch: { folder: {
          home_path: "E:/Library",
          view_mode: "cover-grid",
          preview_grid_enabled: true,
          preview_count: 16,
          thumbnail_width_percent: 42,
          banner_width_percent: 80,
          hover_preview_enabled: false,
          hover_preview_delay_ms: 1200,
          show_hidden_folders: true,
          hide_missing_efu_entries: true,
          confirmations: { trash: true, permanent_delete: false, batch_trash: true, batch_permanent_delete: false },
          penetration: { enabled: true, expand_branches_inline: true, show_internal_files: false, internal_items_mode: "single", max_depth: 10, terminal_targets: ["archive", "document"] },
          details: {
            column_order: ["rating", "name", "path", "type", "extension", "size", "modifiedAt", "dimensions", "pageCount", "tags"],
            hidden_columns: ["tags"],
            pinned_left: ["name"],
            pinned_right: ["rating"],
            column_widths: { name: 300, rating: 84 },
          },
          search: { include_subfolders: false, show_history_on_focus: false, search_in_path: true },
          tree_view: { visible: true, layout: "bottom", size: 320, pinned_paths: ["E:/Books"] },
          tabs: { pinned: [{ path: "E:/Library", title: "Library" }] },
        } },
      })
      expect(parseNeoviewRuntimeConfig({ folder: { search: {
        include_subfolders: false,
        show_history_on_focus: false,
        search_in_path: true,
      } } }).folderView.search).toEqual({ includeSubfolders: false, showHistoryOnFocus: false, searchInPath: true })
      expect(parseNeoviewRuntimeConfig(undefined).folderView.homePath).toBe("")
      expect(parseNeoviewRuntimeConfig(undefined).folderView.confirmations).toEqual({ trash: false, permanentDelete: true, batchTrash: false, batchPermanentDelete: true })
      expect(parseNeoviewRuntimeConfig({ folder: { confirmations: { trash: true } } }).folderView.confirmations).toEqual({ trash: true, permanentDelete: true, batchTrash: false, batchPermanentDelete: true })
      expect(() => parseNeoviewFolderViewPatch({ folderView: { confirmDelete: false } })).toThrow("confirmDelete")
      expect(parseNeoviewFolderViewPatch({ folderView: { tabs: {
        layout: "left", width: 220, breadcrumbPosition: "bottom", toolbarPosition: "right",
      } } })).toEqual({
        patch: { folderView: { tabs: { layout: "left", width: 220, breadcrumbPosition: "bottom", toolbarPosition: "right" } } },
        tomlPatch: { folder: { tabs: { layout: "left", width: 220, breadcrumb_position: "bottom", toolbar_position: "right" } } },
      })
      expect(parseNeoviewFolderViewPatch({ folderView: { homePath: "" } })).toEqual({
        patch: { folderView: { homePath: "" } },
        tomlPatch: { folder: { home_path: "" } },
      })
      expect(parseNeoviewFolderViewPatch({ folderView: { viewMode: "mosaic-grid" } })).toEqual({
        patch: { folderView: { viewMode: "mosaic-grid" } },
        tomlPatch: { folder: { view_mode: "mosaic-grid" } },
      })
      expect(() => parseNeoviewFolderViewPatch({ folderView: { homePath: "bad\0path" } })).toThrow("without NUL")
      expect(() => parseNeoviewFolderViewPatch({ folderView: { homePath: "x".repeat(4097) } })).toThrow("at most 4096")
      expect(() => parseNeoviewFolderViewPatch({ folderView: { homePath: 1 } })).toThrow("must be a string")
      expect(() => parseNeoviewFolderViewPatch({ folderView: { previewCount: 8 } })).toThrow("4, 9 or 16")
      expect(() => parseNeoviewFolderViewPatch({ folderView: { contentWidthPercent: 19 } })).toThrow("between 20 and 70")
      expect(() => parseNeoviewFolderViewPatch({ folderView: { thumbnailWidthPercent: 9 } })).toThrow("between 10 and 90")
      expect(() => parseNeoviewFolderViewPatch({ folderView: { bannerWidthPercent: 101 } })).toThrow("between 20 and 100")
      expect(() => parseNeoviewFolderViewPatch({ folderView: { hoverPreviewDelayMs: 300 } })).toThrow("one of: 200, 500, 800, 1200")
      expect(() => parseNeoviewFolderViewPatch({ folderView: { showHiddenFolders: "yes" } })).toThrow("showHiddenFolders")
      expect(() => parseNeoviewFolderViewPatch({ folderView: { hideMissingEfuEntries: "yes" } })).toThrow("hideMissingEfuEntries")
      expect(parseNeoviewRuntimeConfig(undefined).folderView.penetration).toEqual({
        enabled: false, expandBranchesInline: false, inlineBranchLimitsEnabled: true, inlineBranchMaxDirectories: 4, inlineBranchMaxFiles: 4, inlineBranchMaxItems: 4,
        showInternalFiles: true,
        internalItemsMode: "single",
        maxDepth: 3,
        terminalTargets: ["archive", "document", "media-directory", "file"],
      })
      expect(() => parseNeoviewFolderViewPatch({ folderView: { penetration: { maxDepth: 33 } } })).toThrow("between 1 and 32")
      expect(() => parseNeoviewFolderViewPatch({ folderView: { penetration: { terminalTargets: ["archive", "archive"] } } })).toThrow("duplicate")
      expect(() => parseNeoviewFolderViewPatch({ folderView: { penetration: { terminalTargets: ["folder"] } } })).toThrow("unsupported target")
      expect(() => parseNeoviewRuntimeConfig({ folder: { hover_preview_delay_ms: 800 } })).not.toThrow()
      expect(() => parseNeoviewFolderViewPatch({ folderView: { details: { hiddenColumns: ["name"] } } })).toThrow("cannot hide name")
      expect(() => parseNeoviewFolderViewPatch({ folderView: { details: { columnOrder: ["unknown"] } } })).toThrow("unknown column")
      expect(() => parseNeoviewFolderViewPatch({ folderView: { details: { columnWidths: { name: 47 } } } })).toThrow("between 48 and 800")
      expect(() => parseNeoviewFolderViewPatch({ folderView: { details: { columnWidths: { future: 200 } } } })).toThrow("unknown column")
      expect(() => parseNeoviewFolderViewPatch({ folderView: { search: { searchInPath: "yes" } } })).toThrow("searchInPath")
      expect(() => parseNeoviewFolderViewPatch({ folderView: { search: { future: true } } })).toThrow("unsupported fields")
      expect(() => parseNeoviewFolderViewPatch({ folderView: { tree: { layout: "center" } } })).toThrow("layout")
      expect(() => parseNeoviewFolderViewPatch({ folderView: { tree: { size: 99 } } })).toThrow("between 100 and 500")
      expect(() => parseNeoviewFolderViewPatch({ folderView: { tree: { future: true } } })).toThrow("unsupported fields")
      expect(() => parseNeoviewFolderViewPatch({ folderView: { tree: { pinnedPaths: Array(65).fill("D:/Books") } } })).toThrow("at most 64")
      expect(() => parseNeoviewFolderViewPatch({ folderView: { tree: { pinnedPaths: [""] } } })).toThrow("invalid path")
      expect(parseNeoviewRuntimeConfig(undefined).folderView.tabs).toEqual({
        pinned: [], layout: "top", width: 160, breadcrumbPosition: "top", toolbarPosition: "top",
      })
      expect(() => parseNeoviewFolderViewPatch({ folderView: { tabs: { pinned: Array(8).fill({ path: "D:/Books", title: "Books" }) } } })).toThrow("at most 7")
      expect(() => parseNeoviewFolderViewPatch({ folderView: { tabs: { pinned: [{ path: "D:/Books", title: "" }] } } })).toThrow("1 to 256")
      expect(() => parseNeoviewFolderViewPatch({ folderView: { tabs: { layout: "center" } } })).toThrow("layout")
      expect(() => parseNeoviewFolderViewPatch({ folderView: { tabs: { width: 99 } } })).toThrow("between 100 and 400")
      expect(() => parseNeoviewFolderViewPatch({ folderView: { tabs: { future: true } } })).toThrow("unsupported fields")
    })

  it("[neoview.folder.tree-config] keeps persistent exclusions in the node TOML contract", () => {
      expect(parseNeoviewRuntimeConfig({
        folder: { tree: { excluded_paths: ["D:/Library/private", "D:/Library/archive"] } },
      }).fileTree).toEqual({ excludedPaths: ["D:/Library/private", "D:/Library/archive"] })
      expect(() => parseNeoviewRuntimeConfig({
        folder: { tree: { excluded_paths: Array(257).fill("D:/Library/private") } },
      })).toThrow("at most 256")
    })

  it("[neoview.folder.tag-display-config] persists the File Card More-menu display policy", () => {
      expect(parseNeoviewRuntimeConfig({ folder: { tag_display: { show_rating: false, show_collect_tag_count: true, show_tags: true, max_tags: 5, show_tooltips: false } } }).folderView.tagDisplay).toEqual({
        tagMode: "collect",
        showRating: false,
        showCollectTagCount: true,
        showTags: true,
        maxTags: 5,
        showTooltips: false,
      })
      expect(parseNeoviewFolderViewPatch({ folderView: { tagDisplay: { showTags: false, maxTags: 8 } } })).toEqual({
        patch: { folderView: { tagDisplay: { showTags: false, maxTags: 8 } } },
        tomlPatch: { folder: { tag_display: { show_tags: false, max_tags: 8 } } },
      })
    })

  it("[neoview.folder.migration-targets-config] persists bounded, ordered quick migration targets", () => {
      expect(parseNeoviewRuntimeConfig({ folder: { migration: { quick_targets: [
        { id: "archive", name: "归档", path: " E:/Archive " },
        { id: "duplicate-path", name: "重复路径", path: "e:\\archive\\" },
        { id: "archive", name: "重复标识", path: "F:/Other" },
        { id: "finished", name: "完成", path: "F:/Finished" },
      ] } } }).folderView.migration).toEqual({
        quickTargets: [
          { id: "archive", name: "归档", path: "E:/Archive" },
          { id: "finished", name: "完成", path: "F:/Finished" },
        ],
      })
      expect(parseNeoviewFolderViewPatch({ folderView: { migration: { quickTargets: [
        { id: "archive", name: "归档", path: "E:/Archive" },
        { id: "finished", name: "完成", path: "F:/Finished" },
      ] } } })).toEqual({
        patch: { folderView: { migration: { quickTargets: [
          { id: "archive", name: "归档", path: "E:/Archive" },
          { id: "finished", name: "完成", path: "F:/Finished" },
        ] } } },
        tomlPatch: { folder: { migration: { quick_targets: [
          { id: "archive", name: "归档", path: "E:/Archive" },
          { id: "finished", name: "完成", path: "F:/Finished" },
        ] } } },
      })
      expect(parseNeoviewRuntimeConfig(undefined).folderView.migration).toEqual({ quickTargets: [] })
      expect(() => parseNeoviewFolderViewPatch({ folderView: { migration: { quickTargets: Array(17).fill({ id: "id", name: "目录", path: "E:/Archive" }) } } })).toThrow("at most 16")
      expect(() => parseNeoviewFolderViewPatch({ folderView: { migration: { quickTargets: [{ id: "", name: "目录", path: "E:/Archive" }] } } })).toThrow("must be 1 to 128")
      expect(() => parseNeoviewFolderViewPatch({ folderView: { migration: { future: [] } } })).toThrow("unsupported fields")
    })

  it("[neoview.folder.title-wrap-config] persists a separate title policy for every File Card view", () => {
      expect(parseNeoviewRuntimeConfig({ folder: { title_wrap: {
        compact: true,
        cover_list: true,
        mosaic_list: false,
        details: true,
        cover_grid: false,
        mosaic_grid: true,
      } } }).folderView.titleWrap).toEqual({
        compact: true,
        "cover-list": true,
        "mosaic-list": false,
        details: true,
        "cover-grid": false,
        "mosaic-grid": true,
      })
      expect(parseNeoviewFolderViewPatch({ folderView: { titleWrap: { "cover-grid": false, "mosaic-grid": true } } })).toEqual({
        patch: { folderView: { titleWrap: { "cover-grid": false, "mosaic-grid": true } } },
        tomlPatch: { folder: { title_wrap: { cover_grid: false, mosaic_grid: true } } },
      })
      expect(() => parseNeoviewFolderViewPatch({ folderView: { titleWrap: { unknown: true } } })).toThrow("unsupported view modes")
    })
})
