import * as Models from "./ReaderRuntimeConfigModels.js"
import { parseInlineBranchConfigPatch, readInlineBranchConfig } from "./ReaderInlineBranchConfigParser.js"
import { boundedInteger, optionalBoolean, requiredBoolean, optionalEnum, optionalRecord, requireRecord } from "./ReaderRuntimeConfigParserPrimitives.js"

export function parseFileTreeConfig(value: Record<string, unknown> | undefined): Models.NeoviewFileTreeConfig {
  if (!value) return Models.DEFAULT_NEOVIEW_FILE_TREE_CONFIG
  const rawPaths = value.excluded_paths ?? []
  if (!Array.isArray(rawPaths) || rawPaths.length > 256) {
    throw new Error("[nodes.neoview.folder.tree].excluded_paths must be an array with at most 256 paths.")
  }
  const excludedPaths: string[] = []
  for (const rawPath of rawPaths) {
    if (typeof rawPath !== "string" || !rawPath.trim() || rawPath.length > 32_767 || rawPath.includes("\0")) {
      throw new Error("[nodes.neoview.folder.tree].excluded_paths must contain non-empty paths without NUL.")
    }
    const path = rawPath.trim()
    if (!excludedPaths.includes(path)) excludedPaths.push(path)
  }
  return { excludedPaths }
}
export function parseNeoviewFolderViewPatch(value: unknown): {
  patch: Models.NeoviewFolderViewPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader folder view patch")
  if (Object.keys(record).some((key) => key !== "folderView")) throw new Error("reader folder view patch contains unsupported fields.")
  const folder = requireRecord(record.folderView, "reader folder view patch.folderView")
  const allowed = new Set([
    "homePath",
    "viewMode",
    "previewGridEnabled",
    "previewCount",
    "contentWidthPercent",
    "thumbnailWidthPercent",
    "bannerWidthPercent",
    "hoverPreviewEnabled",
    "hoverPreviewDelayMs",
    "titleWrap",
    "typeFilter",
    "showHiddenFolders",
    "hideMissingEfuEntries",
    "confirmations",
    "migration",
    "tagDisplay",
    "penetration",
    "emptyArea",
    "details",
    "search",
    "tree",
    "tabs",
  ])
  const unknown = Object.keys(folder).filter((key) => !allowed.has(key))
  if (unknown.length) throw new Error(`reader folder view patch contains unsupported fields: ${unknown.join(", ")}.`)
  const patch: Models.NeoviewFolderViewPatch = { folderView: {} }
  const toml: Record<string, unknown> = {}
  if (folder.homePath !== undefined) {
    patch.folderView.homePath = normalizedFolderHomePath(folder.homePath, "reader folder view patch.homePath")
    toml.home_path = patch.folderView.homePath
  }
  if (folder.viewMode !== undefined) {
    patch.folderView.viewMode = optionalEnum(folder.viewMode, "reader folder view patch.viewMode", Models.NEOVIEW_FOLDER_VIEW_MODES)
    toml.view_mode = patch.folderView.viewMode
  }
  if (folder.previewGridEnabled !== undefined) {
    patch.folderView.previewGridEnabled = optionalBoolean(folder.previewGridEnabled, "reader folder view patch.previewGridEnabled")
    toml.preview_grid_enabled = patch.folderView.previewGridEnabled
  }
  if (folder.previewCount !== undefined) {
    const count = boundedInteger(folder.previewCount, 4, 16, "reader folder view patch.previewCount")
    if (count !== 4 && count !== 9 && count !== 16) throw new Error("reader folder view patch.previewCount must be 4, 9 or 16.")
    patch.folderView.previewCount = count
    toml.preview_count = count
  }
  if (folder.contentWidthPercent !== undefined) {
    patch.folderView.contentWidthPercent = boundedInteger(folder.contentWidthPercent, 20, 70, "reader folder view patch.contentWidthPercent")
    toml.content_width_percent = patch.folderView.contentWidthPercent
  }
  if (folder.thumbnailWidthPercent !== undefined) {
    const percent = boundedInteger(folder.thumbnailWidthPercent, 10, 90, "reader folder view patch.thumbnailWidthPercent")
    patch.folderView.thumbnailWidthPercent = percent
    toml.thumbnail_width_percent = percent
  }
  if (folder.bannerWidthPercent !== undefined) {
    const percent = boundedInteger(folder.bannerWidthPercent, 20, 100, "reader folder view patch.bannerWidthPercent")
    patch.folderView.bannerWidthPercent = percent
    toml.banner_width_percent = percent
  }
  if (folder.hoverPreviewEnabled !== undefined) {
    patch.folderView.hoverPreviewEnabled = optionalBoolean(folder.hoverPreviewEnabled, "reader folder view patch.hoverPreviewEnabled")
    toml.hover_preview_enabled = patch.folderView.hoverPreviewEnabled
  }
  if (folder.hoverPreviewDelayMs !== undefined) {
    patch.folderView.hoverPreviewDelayMs = parseFolderHoverPreviewDelay(folder.hoverPreviewDelayMs, "reader folder view patch.hoverPreviewDelayMs")
    toml.hover_preview_delay_ms = patch.folderView.hoverPreviewDelayMs
  }
  if (folder.typeFilter !== undefined) {
    patch.folderView.typeFilter = optionalEnum(folder.typeFilter, "reader folder view patch.typeFilter", Models.NEOVIEW_FOLDER_TYPE_FILTERS)
    toml.type_filter = patch.folderView.typeFilter
  }
  if (folder.showHiddenFolders !== undefined) {
    patch.folderView.showHiddenFolders = optionalBoolean(folder.showHiddenFolders, "reader folder view patch.showHiddenFolders")
    toml.show_hidden_folders = patch.folderView.showHiddenFolders
  }
  if (folder.hideMissingEfuEntries !== undefined) {
    patch.folderView.hideMissingEfuEntries = optionalBoolean(folder.hideMissingEfuEntries, "reader folder view patch.hideMissingEfuEntries")
    toml.hide_missing_efu_entries = patch.folderView.hideMissingEfuEntries
  }
  if (folder.titleWrap !== undefined) {
    const titleWrap = requireRecord(folder.titleWrap, "reader folder view patch.titleWrap")
    const unknownModes = Object.keys(titleWrap).filter((key) => !Models.NEOVIEW_FOLDER_VIEW_MODES.includes(key as Models.NeoviewFolderViewMode))
    if (unknownModes.length) throw new Error(`reader folder view patch.titleWrap contains unsupported view modes: ${unknownModes.join(", ")}.`)
    const titleWrapPatch: Partial<Models.NeoviewFolderTitleWrapConfig> = {}
    const titleWrapToml: Record<string, boolean> = {}
    for (const viewMode of Models.NEOVIEW_FOLDER_VIEW_MODES) {
      const value = titleWrap[viewMode]
      if (value === undefined) continue
      const enabled = optionalBoolean(value, `reader folder view patch.titleWrap.${viewMode}`)
      if (enabled === undefined) continue
      titleWrapPatch[viewMode] = enabled
      titleWrapToml[Models.NEOVIEW_FOLDER_TITLE_WRAP_TOML_KEYS[viewMode]] = enabled
    }
    if (!Object.keys(titleWrapPatch).length) throw new Error("reader folder view patch.titleWrap must change at least one view mode.")
    patch.folderView.titleWrap = titleWrapPatch
    toml.title_wrap = titleWrapToml
  }
  if (folder.confirmations !== undefined) {
    const confirmations = requireRecord(folder.confirmations, "reader folder view patch.confirmations")
    const allowedConfirmations = new Set(["trash", "permanentDelete", "batchTrash", "batchPermanentDelete"])
    const unknownConfirmations = Object.keys(confirmations).filter((key) => !allowedConfirmations.has(key))
    if (unknownConfirmations.length) {
      throw new Error(`reader folder view patch.confirmations contains unsupported fields: ${unknownConfirmations.join(", ")}.`)
    }
    const confirmationPatch: Partial<Models.NeoviewFolderConfirmationConfig> = {}
    const confirmationToml: Record<string, unknown> = {}
    for (const [key, tomlKey] of [
      ["trash", "trash"],
      ["permanentDelete", "permanent_delete"],
      ["batchTrash", "batch_trash"],
      ["batchPermanentDelete", "batch_permanent_delete"],
    ] as const) {
      if (confirmations[key] === undefined) continue
      confirmationPatch[key] = optionalBoolean(confirmations[key], `reader folder view patch.confirmations.${key}`)
      confirmationToml[tomlKey] = confirmationPatch[key]
    }
    if (!Object.keys(confirmationPatch).length) {
      throw new Error("reader folder view patch.confirmations must change at least one field.")
    }
    patch.folderView.confirmations = confirmationPatch
    toml.confirmations = confirmationToml
  }
  if (folder.migration !== undefined) {
    const migration = requireRecord(folder.migration, "reader folder view patch.migration")
    const unknownMigration = Object.keys(migration).filter((key) => key !== "quickTargets")
    if (unknownMigration.length) throw new Error(`reader folder view patch.migration contains unsupported fields: ${unknownMigration.join(", ")}.`)
    if (migration.quickTargets === undefined) throw new Error("reader folder view patch.migration must change quickTargets.")
    const quickTargets = normalizedFolderMigrationTargets(
      migration.quickTargets,
      "reader folder view patch.migration.quickTargets",
    )
    patch.folderView.migration = { quickTargets }
    toml.migration = { quick_targets: quickTargets }
  }
  if (folder.tagDisplay !== undefined) {
    const display = requireRecord(folder.tagDisplay, "reader folder view patch.tagDisplay")
    const allowedDisplay = new Set(["tagMode", "showRating", "showCollectTagCount", "showTags", "maxTags", "showTooltips"])
    const unknownDisplay = Object.keys(display).filter((key) => !allowedDisplay.has(key))
    if (unknownDisplay.length) throw new Error(`reader folder view patch.tagDisplay contains unsupported fields: ${unknownDisplay.join(", ")}.`)
    const displayPatch: Partial<Models.NeoviewFolderTagDisplayConfig> = {}
    const displayToml: Record<string, unknown> = {}
    if (display.tagMode !== undefined) {
      displayPatch.tagMode = optionalEnum(display.tagMode, "reader folder view patch.tagDisplay.tagMode", ["all", "collect", "none"])!
      displayToml.tag_mode = displayPatch.tagMode
    }
    for (const [key, tomlKey] of [
      ["showRating", "show_rating"],
      ["showCollectTagCount", "show_collect_tag_count"],
      ["showTags", "show_tags"],
      ["showTooltips", "show_tooltips"],
    ] as const) {
      if (display[key] === undefined) continue
      displayPatch[key] = requiredBoolean(display[key], `reader folder view patch.tagDisplay.${key}`)
      displayToml[tomlKey] = displayPatch[key]
    }
    if (display.maxTags !== undefined) {
      displayPatch.maxTags = boundedInteger(display.maxTags, 1, 12, "reader folder view patch.tagDisplay.maxTags")
      displayToml.max_tags = displayPatch.maxTags
    }
    if (!Object.keys(displayPatch).length) throw new Error("reader folder view patch.tagDisplay must change at least one field.")
    patch.folderView.tagDisplay = displayPatch
    toml.tag_display = displayToml
  }
  if (folder.penetration !== undefined) {
    const penetration = requireRecord(folder.penetration, "reader folder view patch.penetration")
    const allowedPenetration = new Set(["enabled", "expandBranchesInline", "inlineBranchLimitsEnabled", "inlineBranchMaxDirectories", "inlineBranchMaxFiles", "inlineBranchMaxItems", "showInternalFiles", "internalItemsMode", "maxDepth", "terminalTargets"])
    const unknownPenetration = Object.keys(penetration).filter((key) => !allowedPenetration.has(key))
    if (unknownPenetration.length) throw new Error(`reader folder view patch.penetration contains unsupported fields: ${unknownPenetration.join(", ")}.`)
    const penetrationPatch: Partial<Models.NeoviewFolderPenetrationConfig> = {}
    const penetrationToml: Record<string, unknown> = {}
    if (penetration.enabled !== undefined) {
      penetrationPatch.enabled = optionalBoolean(penetration.enabled, "reader folder view patch.penetration.enabled")
      penetrationToml.enabled = penetrationPatch.enabled
    }
    const inlineBranchConfig = parseInlineBranchConfigPatch(penetration)
    Object.assign(penetrationPatch, inlineBranchConfig.patch)
    Object.assign(penetrationToml, inlineBranchConfig.tomlPatch)
    if (penetration.showInternalFiles !== undefined) {
      penetrationPatch.showInternalFiles = optionalBoolean(penetration.showInternalFiles, "reader folder view patch.penetration.showInternalFiles")
      penetrationToml.show_internal_files = penetrationPatch.showInternalFiles
    }
    if (penetration.internalItemsMode !== undefined) {
      penetrationPatch.internalItemsMode = optionalEnum(penetration.internalItemsMode, "reader folder view patch.penetration.internalItemsMode", ["single", "all"])
      penetrationToml.internal_items_mode = penetrationPatch.internalItemsMode
    }
    if (penetration.maxDepth !== undefined) {
      penetrationPatch.maxDepth = boundedInteger(penetration.maxDepth, 1, 32, "reader folder view patch.penetration.maxDepth")
      penetrationToml.max_depth = penetrationPatch.maxDepth
    }
    if (penetration.terminalTargets !== undefined) {
      penetrationPatch.terminalTargets = normalizedFolderPenetrationTargets(penetration.terminalTargets, "reader folder view patch.penetration.terminalTargets")
      penetrationToml.terminal_targets = penetrationPatch.terminalTargets
    }
    if (!Object.keys(penetrationPatch).length) throw new Error("reader folder view patch.penetration must change at least one field.")
    patch.folderView.penetration = penetrationPatch
    toml.penetration = penetrationToml
  }
  if (folder.emptyArea !== undefined) {
    const emptyArea = requireRecord(folder.emptyArea, "reader folder view patch.emptyArea")
    const allowedEmptyArea = new Set(["singleClickAction", "doubleClickAction", "showBackButton"])
    const unknownEmptyArea = Object.keys(emptyArea).filter((key) => !allowedEmptyArea.has(key))
    if (unknownEmptyArea.length) throw new Error(`reader folder view patch.emptyArea contains unsupported fields: ${unknownEmptyArea.join(", ")}.`)
    const emptyAreaPatch: Partial<Models.NeoviewFolderEmptyAreaConfig> = {}
    const emptyAreaToml: Record<string, unknown> = {}
    if (emptyArea.singleClickAction !== undefined) {
      emptyAreaPatch.singleClickAction = optionalEnum(
        emptyArea.singleClickAction,
        "reader folder view patch.emptyArea.singleClickAction",
        Models.NEOVIEW_FOLDER_EMPTY_AREA_ACTIONS,
      )
      emptyAreaToml.single_click_action = emptyAreaPatch.singleClickAction
    }
    if (emptyArea.doubleClickAction !== undefined) {
      emptyAreaPatch.doubleClickAction = optionalEnum(
        emptyArea.doubleClickAction,
        "reader folder view patch.emptyArea.doubleClickAction",
        Models.NEOVIEW_FOLDER_EMPTY_AREA_ACTIONS,
      )
      emptyAreaToml.double_click_action = emptyAreaPatch.doubleClickAction
    }
    if (emptyArea.showBackButton !== undefined) {
      emptyAreaPatch.showBackButton = optionalBoolean(emptyArea.showBackButton, "reader folder view patch.emptyArea.showBackButton")
      emptyAreaToml.show_back_button = emptyAreaPatch.showBackButton
    }
    if (!Object.keys(emptyAreaPatch).length) throw new Error("reader folder view patch.emptyArea must change at least one field.")
    patch.folderView.emptyArea = emptyAreaPatch
    toml.empty_area = emptyAreaToml
  }
  if (folder.details !== undefined) {
    const details = requireRecord(folder.details, "reader folder view patch.details")
    const detailKeys = new Set(["columnOrder", "hiddenColumns", "pinnedLeft", "pinnedRight", "columnWidths"])
    const unknownDetails = Object.keys(details).filter((key) => !detailKeys.has(key))
    if (unknownDetails.length) throw new Error(`reader folder view patch.details contains unsupported fields: ${unknownDetails.join(", ")}.`)
    const detailPatch: Models.NeoviewFolderDetailsPatch = {}
    const detailToml: Record<string, unknown> = {}
    if (details.columnOrder !== undefined) {
      detailPatch.columnOrder = normalizedDetailColumns(details.columnOrder, "columnOrder", true)
      detailToml.column_order = detailPatch.columnOrder
    }
    if (details.hiddenColumns !== undefined) {
      detailPatch.hiddenColumns = normalizedDetailColumns(details.hiddenColumns, "hiddenColumns", false)
      if (detailPatch.hiddenColumns.includes("name")) throw new Error("reader folder view patch.details.hiddenColumns cannot hide name.")
      detailToml.hidden_columns = detailPatch.hiddenColumns
    }
    if (details.pinnedLeft !== undefined) {
      detailPatch.pinnedLeft = normalizedDetailColumns(details.pinnedLeft, "pinnedLeft", false)
      detailToml.pinned_left = detailPatch.pinnedLeft
    }
    if (details.pinnedRight !== undefined) {
      detailPatch.pinnedRight = normalizedDetailColumns(details.pinnedRight, "pinnedRight", false)
      detailToml.pinned_right = detailPatch.pinnedRight
    }
    if (details.columnWidths !== undefined) {
      detailPatch.columnWidths = normalizedDetailWidths(details.columnWidths, "reader folder view patch.details.columnWidths", true)
      detailToml.column_widths = detailPatch.columnWidths
    }
    if (!Object.keys(detailPatch).length) throw new Error("reader folder view patch.details must change at least one field.")
    if (detailPatch.pinnedLeft && detailPatch.pinnedRight && detailPatch.pinnedLeft.some((id) => detailPatch.pinnedRight!.includes(id))) {
      throw new Error("reader folder view patch.details cannot pin a column to both sides.")
    }
    patch.folderView.details = detailPatch
    toml.details = detailToml
  }
  if (folder.search !== undefined) {
    const search = requireRecord(folder.search, "reader folder view patch.search")
    const searchKeys = new Set(["includeSubfolders", "showHistoryOnFocus", "searchInPath"])
    const unknownSearch = Object.keys(search).filter((key) => !searchKeys.has(key))
    if (unknownSearch.length) throw new Error(`reader folder view patch.search contains unsupported fields: ${unknownSearch.join(", ")}.`)
    const searchPatch: Partial<Models.NeoviewFolderSearchConfig> = {}
    const searchToml: Record<string, unknown> = {}
    if (search.includeSubfolders !== undefined) {
      searchPatch.includeSubfolders = optionalBoolean(search.includeSubfolders, "reader folder view patch.search.includeSubfolders")
      searchToml.include_subfolders = searchPatch.includeSubfolders
    }
    if (search.showHistoryOnFocus !== undefined) {
      searchPatch.showHistoryOnFocus = optionalBoolean(search.showHistoryOnFocus, "reader folder view patch.search.showHistoryOnFocus")
      searchToml.show_history_on_focus = searchPatch.showHistoryOnFocus
    }
    if (search.searchInPath !== undefined) {
      searchPatch.searchInPath = optionalBoolean(search.searchInPath, "reader folder view patch.search.searchInPath")
      searchToml.search_in_path = searchPatch.searchInPath
    }
    if (!Object.keys(searchPatch).length) throw new Error("reader folder view patch.search must change at least one field.")
    patch.folderView.search = searchPatch
    toml.search = searchToml
  }
  if (folder.tree !== undefined) {
    const tree = requireRecord(folder.tree, "reader folder view patch.tree")
    const treeKeys = new Set(["visible", "layout", "size", "pinnedPaths"])
    const unknownTree = Object.keys(tree).filter((key) => !treeKeys.has(key))
    if (unknownTree.length) throw new Error(`reader folder view patch.tree contains unsupported fields: ${unknownTree.join(", ")}.`)
    const treePatch: Partial<Models.NeoviewFolderTreeViewConfig> = {}
    const treeToml: Record<string, unknown> = {}
    if (tree.visible !== undefined) {
      treePatch.visible = optionalBoolean(tree.visible, "reader folder view patch.tree.visible")
      treeToml.visible = treePatch.visible
    }
    if (tree.layout !== undefined) {
      treePatch.layout = optionalEnum(tree.layout, "reader folder view patch.tree.layout", Models.NEOVIEW_FOLDER_TREE_LAYOUTS)
      treeToml.layout = treePatch.layout
    }
    if (tree.size !== undefined) {
      treePatch.size = boundedInteger(tree.size, 100, 500, "reader folder view patch.tree.size")
      treeToml.size = treePatch.size
    }
    if (tree.pinnedPaths !== undefined) {
      treePatch.pinnedPaths = normalizedTreePinnedPaths(tree.pinnedPaths, "reader folder view patch.tree.pinnedPaths")
      treeToml.pinned_paths = treePatch.pinnedPaths
    }
    if (!Object.keys(treePatch).length) throw new Error("reader folder view patch.tree must change at least one field.")
    patch.folderView.tree = treePatch
    toml.tree_view = treeToml
  }
  if (folder.tabs !== undefined) {
    const tabs = requireRecord(folder.tabs, "reader folder view patch.tabs")
    const tabKeys = new Set(["pinned", "layout", "width", "breadcrumbPosition", "toolbarPosition"])
    const unknownTabs = Object.keys(tabs).filter((key) => !tabKeys.has(key))
    if (unknownTabs.length) throw new Error(`reader folder view patch.tabs contains unsupported fields: ${unknownTabs.join(", ")}.`)
    const tabPatch: Partial<Models.NeoviewFolderTabsConfig> = {}
    const tabToml: Record<string, unknown> = {}
    if (tabs.pinned !== undefined) {
      tabPatch.pinned = normalizedPinnedTabs(tabs.pinned, "reader folder view patch.tabs.pinned")
      tabToml.pinned = tabPatch.pinned
    }
    if (tabs.layout !== undefined) {
      tabPatch.layout = optionalEnum(tabs.layout, "reader folder view patch.tabs.layout", Models.NEOVIEW_FOLDER_REGION_POSITIONS)
      tabToml.layout = tabPatch.layout
    }
    if (tabs.width !== undefined) {
      tabPatch.width = boundedInteger(tabs.width, 100, 400, "reader folder view patch.tabs.width")
      tabToml.width = tabPatch.width
    }
    if (tabs.breadcrumbPosition !== undefined) {
      tabPatch.breadcrumbPosition = optionalEnum(
        tabs.breadcrumbPosition,
        "reader folder view patch.tabs.breadcrumbPosition",
        Models.NEOVIEW_FOLDER_REGION_POSITIONS,
      )
      tabToml.breadcrumb_position = tabPatch.breadcrumbPosition
    }
    if (tabs.toolbarPosition !== undefined) {
      tabPatch.toolbarPosition = optionalEnum(tabs.toolbarPosition, "reader folder view patch.tabs.toolbarPosition", Models.NEOVIEW_FOLDER_REGION_POSITIONS)
      tabToml.toolbar_position = tabPatch.toolbarPosition
    }
    if (!Object.keys(tabPatch).length) throw new Error("reader folder view patch.tabs must change at least one field.")
    patch.folderView.tabs = tabPatch
    toml.tabs = tabToml
  }
  if (!Object.keys(patch.folderView).length) throw new Error("reader folder view patch must change at least one field.")
  return { patch, tomlPatch: { folder: toml } }
}
export function parseFolderViewConfig(value: Record<string, unknown> | undefined): Models.NeoviewFolderViewConfig {
  if (!value) return Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG
  const details = optionalRecord(value.details, "[nodes.neoview.folder.details]")
  const search = optionalRecord(value.search, "[nodes.neoview.folder.search]")
  const titleWrap = optionalRecord(value.title_wrap ?? value.titleWrap, "[nodes.neoview.folder.title_wrap]")
  const emptyArea = optionalRecord(value.empty_area, "[nodes.neoview.folder.empty_area]")
  const tree = optionalRecord(value.tree_view, "[nodes.neoview.folder.tree_view]")
  const tabs = optionalRecord(value.tabs, "[nodes.neoview.folder.tabs]")
  const penetration = optionalRecord(value.penetration, "[nodes.neoview.folder.penetration]")
  const tagDisplay = optionalRecord(value.tag_display, "[nodes.neoview.folder.tag_display]")
  const confirmations = optionalRecord(value.confirmations, "[nodes.neoview.folder.confirmations]")
  const migration = optionalRecord(value.migration, "[nodes.neoview.folder.migration]")
  const hiddenColumns = normalizedDetailColumns(details?.hidden_columns ?? [], "[nodes.neoview.folder.details].hidden_columns", false, false).filter(
    (id) => id !== "name",
  )
  const pinnedLeft = normalizedDetailColumns(details?.pinned_left ?? ["name"], "[nodes.neoview.folder.details].pinned_left", false, false)
  const pinnedRight = normalizedDetailColumns(details?.pinned_right ?? [], "[nodes.neoview.folder.details].pinned_right", false, false).filter(
    (id) => !pinnedLeft.includes(id),
  )
  const previewCount =
    value.preview_count === undefined
      ? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.previewCount
      : boundedInteger(value.preview_count, 4, 16, "[nodes.neoview.folder].preview_count")
  if (previewCount !== 4 && previewCount !== 9 && previewCount !== 16) throw new Error("[nodes.neoview.folder].preview_count must be 4, 9 or 16.")
  const contentWidthPercent =
    value.content_width_percent === undefined
      ? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.contentWidthPercent
      : boundedInteger(value.content_width_percent, 20, 70, "[nodes.neoview.folder].content_width_percent")
  return {
    homePath:
      value.home_path === undefined
        ? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.homePath
        : normalizedFolderHomePath(value.home_path, "[nodes.neoview.folder].home_path"),
    viewMode:
      optionalEnum(value.view_mode, "[nodes.neoview.folder].view_mode", Models.NEOVIEW_FOLDER_VIEW_MODES) ?? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.viewMode,
    previewGridEnabled:
      optionalBoolean(value.preview_grid_enabled, "[nodes.neoview.folder].preview_grid_enabled") ??
      Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.previewGridEnabled,
    previewCount,
    contentWidthPercent,
    thumbnailWidthPercent:
      value.thumbnail_width_percent === undefined
        ? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.thumbnailWidthPercent
        : boundedInteger(value.thumbnail_width_percent, 10, 90, "[nodes.neoview.folder].thumbnail_width_percent"),
    bannerWidthPercent:
      value.banner_width_percent === undefined
        ? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.bannerWidthPercent
        : boundedInteger(value.banner_width_percent, 20, 100, "[nodes.neoview.folder].banner_width_percent"),
    hoverPreviewEnabled:
      optionalBoolean(value.hover_preview_enabled, "[nodes.neoview.folder].hover_preview_enabled") ??
      Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.hoverPreviewEnabled,
    hoverPreviewDelayMs:
      value.hover_preview_delay_ms === undefined
        ? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.hoverPreviewDelayMs
        : parseFolderHoverPreviewDelay(value.hover_preview_delay_ms, "[nodes.neoview.folder].hover_preview_delay_ms"),
    titleWrap: parseFolderTitleWrapConfig(titleWrap),
    typeFilter:
      optionalEnum(value.type_filter, "[nodes.neoview.folder].type_filter", Models.NEOVIEW_FOLDER_TYPE_FILTERS) ??
      Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.typeFilter,
    showHiddenFolders:
      optionalBoolean(value.show_hidden_folders, "[nodes.neoview.folder].show_hidden_folders") ?? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.showHiddenFolders,
    hideMissingEfuEntries:
      optionalBoolean(value.hide_missing_efu_entries, "[nodes.neoview.folder].hide_missing_efu_entries")
      ?? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.hideMissingEfuEntries,
    confirmations: {
      trash:
        optionalBoolean(confirmations?.trash, "[nodes.neoview.folder.confirmations].trash")
        ?? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.confirmations.trash,
      permanentDelete:
        optionalBoolean(confirmations?.permanent_delete ?? confirmations?.permanentDelete, "[nodes.neoview.folder.confirmations].permanent_delete")
        ?? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.confirmations.permanentDelete,
      batchTrash:
        optionalBoolean(confirmations?.batch_trash ?? confirmations?.batchTrash, "[nodes.neoview.folder.confirmations].batch_trash")
        ?? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.confirmations.batchTrash,
      batchPermanentDelete:
        optionalBoolean(confirmations?.batch_permanent_delete ?? confirmations?.batchPermanentDelete, "[nodes.neoview.folder.confirmations].batch_permanent_delete")
        ?? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.confirmations.batchPermanentDelete,
    },
    migration: {
      quickTargets: normalizedFolderMigrationTargets(
        migration?.quick_targets ?? migration?.quickTargets ?? [],
        "[nodes.neoview.folder.migration].quick_targets",
      ),
    },
    tagDisplay: {
      tagMode:
        optionalEnum(tagDisplay?.tag_mode ?? tagDisplay?.tagMode, "[nodes.neoview.folder.tag_display].tag_mode", ["all", "collect", "none"]) ??
        Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.tagDisplay.tagMode,
      showRating:
        optionalBoolean(tagDisplay?.show_rating, "[nodes.neoview.folder.tag_display].show_rating") ??
        Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.tagDisplay.showRating,
      showCollectTagCount:
        optionalBoolean(tagDisplay?.show_collect_tag_count, "[nodes.neoview.folder.tag_display].show_collect_tag_count") ??
        Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.tagDisplay.showCollectTagCount,
      showTags:
        optionalBoolean(tagDisplay?.show_tags, "[nodes.neoview.folder.tag_display].show_tags") ?? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.tagDisplay.showTags,
      maxTags:
        tagDisplay?.max_tags === undefined
          ? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.tagDisplay.maxTags
          : boundedInteger(tagDisplay.max_tags, 1, 12, "[nodes.neoview.folder.tag_display].max_tags"),
      showTooltips:
        optionalBoolean(tagDisplay?.show_tooltips, "[nodes.neoview.folder.tag_display].show_tooltips") ??
        Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.tagDisplay.showTooltips,
    },
    penetration: {
      enabled:
        optionalBoolean(penetration?.enabled, "[nodes.neoview.folder.penetration].enabled") ?? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.penetration.enabled,
      ...readInlineBranchConfig(penetration, Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.penetration),
      showInternalFiles:
        optionalBoolean(penetration?.show_internal_files ?? penetration?.showInternalFiles, "[nodes.neoview.folder.penetration].show_internal_files") ?? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.penetration.showInternalFiles,
      internalItemsMode:
        optionalEnum(penetration?.internal_items_mode ?? penetration?.internalItemsMode, "[nodes.neoview.folder.penetration].internal_items_mode", ["single", "all"]) ?? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.penetration.internalItemsMode,
      maxDepth:
        penetration?.max_depth === undefined
          ? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.penetration.maxDepth
          : boundedInteger(penetration.max_depth, 1, 32, "[nodes.neoview.folder.penetration].max_depth"),
      terminalTargets:
        penetration?.terminal_targets === undefined
          ? [...Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.penetration.terminalTargets]
          : normalizedFolderPenetrationTargets(penetration.terminal_targets, "[nodes.neoview.folder.penetration].terminal_targets"),
    },
    emptyArea: {
      singleClickAction:
        optionalEnum(emptyArea?.single_click_action, "[nodes.neoview.folder.empty_area].single_click_action", Models.NEOVIEW_FOLDER_EMPTY_AREA_ACTIONS) ??
        Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.emptyArea.singleClickAction,
      doubleClickAction:
        optionalEnum(emptyArea?.double_click_action, "[nodes.neoview.folder.empty_area].double_click_action", Models.NEOVIEW_FOLDER_EMPTY_AREA_ACTIONS) ??
        Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.emptyArea.doubleClickAction,
      showBackButton:
        optionalBoolean(emptyArea?.show_back_button, "[nodes.neoview.folder.empty_area].show_back_button") ??
        Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.emptyArea.showBackButton,
    },
    details: {
      columnOrder: normalizedDetailColumns(
        details?.column_order ?? Models.NEOVIEW_FOLDER_DETAIL_COLUMNS,
        "[nodes.neoview.folder.details].column_order",
        true,
        false,
      ),
      hiddenColumns,
      pinnedLeft,
      pinnedRight,
      columnWidths: {
        ...Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.details.columnWidths,
        ...normalizedDetailWidths(details?.column_widths ?? {}, "[nodes.neoview.folder.details].column_widths", false),
      },
    },
    search: {
      includeSubfolders:
        optionalBoolean(search?.include_subfolders, "[nodes.neoview.folder.search].include_subfolders") ??
        Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.search.includeSubfolders,
      showHistoryOnFocus:
        optionalBoolean(search?.show_history_on_focus, "[nodes.neoview.folder.search].show_history_on_focus") ??
        Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.search.showHistoryOnFocus,
      searchInPath:
        optionalBoolean(search?.search_in_path, "[nodes.neoview.folder.search].search_in_path") ??
        Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.search.searchInPath,
    },
    tree: {
      visible: optionalBoolean(tree?.visible, "[nodes.neoview.folder.tree_view].visible") ?? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.tree.visible,
      layout:
        optionalEnum(tree?.layout, "[nodes.neoview.folder.tree_view].layout", Models.NEOVIEW_FOLDER_TREE_LAYOUTS) ??
        Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.tree.layout,
      size:
        tree?.size === undefined
          ? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.tree.size
          : boundedInteger(tree.size, 100, 500, "[nodes.neoview.folder.tree_view].size"),
      pinnedPaths: normalizedTreePinnedPaths(tree?.pinned_paths ?? [], "[nodes.neoview.folder.tree_view].pinned_paths"),
    },
    tabs: {
      pinned: normalizedPinnedTabs(tabs?.pinned ?? [], "[nodes.neoview.folder.tabs].pinned"),
      layout:
        optionalEnum(tabs?.layout, "[nodes.neoview.folder.tabs].layout", Models.NEOVIEW_FOLDER_REGION_POSITIONS) ??
        Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.tabs.layout,
      width:
        tabs?.width === undefined
          ? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.tabs.width
          : boundedInteger(tabs.width, 100, 400, "[nodes.neoview.folder.tabs].width"),
      breadcrumbPosition:
        optionalEnum(tabs?.breadcrumb_position, "[nodes.neoview.folder.tabs].breadcrumb_position", Models.NEOVIEW_FOLDER_REGION_POSITIONS) ??
        Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.tabs.breadcrumbPosition,
      toolbarPosition:
        optionalEnum(tabs?.toolbar_position, "[nodes.neoview.folder.tabs].toolbar_position", Models.NEOVIEW_FOLDER_REGION_POSITIONS) ??
        Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.tabs.toolbarPosition,
    },
  }
}
export function normalizedPinnedTabs(value: unknown, path: string): Models.NeoviewFolderPinnedTab[] {
  if (!Array.isArray(value) || value.length > 7) throw new Error(`${path} must be an array containing at most 7 tabs.`)
  return value.map((item, index) => {
    const tab = requireRecord(item, `${path}[${index}]`)
    if (Object.keys(tab).some((key) => key !== "path" && key !== "title")) throw new Error(`${path}[${index}] contains unsupported fields.`)
    const tabPath = normalizedFolderHomePath(tab.path, `${path}[${index}].path`)
    if (!tabPath) throw new Error(`${path}[${index}].path must not be empty.`)
    if (typeof tab.title !== "string") throw new Error(`${path}[${index}].title must be a string.`)
    const title = tab.title.trim()
    if (!title || title.length > 256 || title.includes("\0")) throw new Error(`${path}[${index}].title must be 1 to 256 characters without NUL.`)
    return { path: tabPath, title }
  })
}
export function normalizedFolderMigrationTargets(value: unknown, path: string): Models.NeoviewFolderMigrationTarget[] {
  if (!Array.isArray(value) || value.length > 16) throw new Error(`${path} must be an array containing at most 16 targets.`)
  const targets: Models.NeoviewFolderMigrationTarget[] = []
  const seenIds = new Set<string>()
  const seenPaths = new Set<string>()
  for (const [index, item] of value.entries()) {
    const target = requireRecord(item, `${path}[${index}]`)
    if (Object.keys(target).some((key) => key !== "id" && key !== "name" && key !== "path")) {
      throw new Error(`${path}[${index}] contains unsupported fields.`)
    }
    const id = normalizedFolderMigrationText(target.id, `${path}[${index}].id`, 128)
    const name = normalizedFolderMigrationText(target.name, `${path}[${index}].name`, 128)
    const targetPath = normalizedFolderHomePath(target.path, `${path}[${index}].path`)
    if (!targetPath) throw new Error(`${path}[${index}].path must not be empty.`)
    const pathKey = targetPath.replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase()
    if (seenIds.has(id) || seenPaths.has(pathKey)) continue
    seenIds.add(id)
    seenPaths.add(pathKey)
    targets.push({ id, name, path: targetPath })
  }
  return targets
}

function normalizedFolderMigrationText(value: unknown, path: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${path} must be a string.`)
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength || normalized.includes("\0")) {
    throw new Error(`${path} must be 1 to ${maxLength} characters without NUL.`)
  }
  return normalized
}
export function normalizedBookmarkListId(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Error(`${path} must be a string.`)
  const normalized = value.trim()
  if (!normalized || normalized.length > 256 || normalized.includes("\0")) {
    throw new Error(`${path} must be 1 to 256 characters without NUL.`)
  }
  return normalized
}
export function normalizedFolderHomePath(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Error(`${path} must be a string.`)
  const normalized = value.trim()
  if (normalized.length > 4096 || normalized.includes("\0")) throw new Error(`${path} must be at most 4096 characters without NUL.`)
  return normalized
}
export function normalizedFolderPenetrationTargets(value: unknown, path: string): Models.NeoviewFolderPenetrationTarget[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > Models.NEOVIEW_FOLDER_PENETRATION_TARGETS.length) {
    throw new Error(`${path} must contain 1-${Models.NEOVIEW_FOLDER_PENETRATION_TARGETS.length} targets.`)
  }
  const targets: Models.NeoviewFolderPenetrationTarget[] = []
  for (const target of value) {
    if (typeof target !== "string" || !Models.NEOVIEW_FOLDER_PENETRATION_TARGETS.includes(target as Models.NeoviewFolderPenetrationTarget)) {
      throw new Error(`${path} contains an unsupported target.`)
    }
    if (targets.includes(target as Models.NeoviewFolderPenetrationTarget)) throw new Error(`${path} cannot contain duplicate targets.`)
    targets.push(target as Models.NeoviewFolderPenetrationTarget)
  }
  return targets
}
export function normalizedTreePinnedPaths(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length > 64) throw new Error(`${path} must be an array containing at most 64 paths.`)
  const result = new Map<string, string>()
  for (const item of value) {
    if (typeof item !== "string") throw new Error(`${path} must contain only string paths.`)
    const pinnedPath = item.trim()
    if (!pinnedPath || pinnedPath.length > 32_767 || pinnedPath.includes("\0")) throw new Error(`${path} contains an invalid path.`)
    const normalized = pinnedPath.replaceAll("\\", "/").replace(/\/+$/u, "") || "/"
    const key = /^(?:[A-Za-z]:|\/\/)/u.test(normalized) ? normalized.toLocaleLowerCase() : normalized
    if (!result.has(key)) result.set(key, pinnedPath)
  }
  return [...result.values()]
}
export function normalizedDetailColumns(value: unknown, path: string, appendMissing: boolean, strict = true): Models.NeoviewFolderDetailColumn[] {
  if (!Array.isArray(value) || value.length > (strict ? Models.NEOVIEW_FOLDER_DETAIL_COLUMNS.length : 64))
    throw new Error(`${path} must be a bounded array of known column IDs.`)
  const known = new Set<string>(Models.NEOVIEW_FOLDER_DETAIL_COLUMNS)
  const result: Models.NeoviewFolderDetailColumn[] = []
  for (const item of value) {
    if (typeof item !== "string" || !known.has(item)) {
      if (strict) throw new Error(`${path} contains an unknown column ID.`)
      continue
    }
    const column = item as Models.NeoviewFolderDetailColumn
    if (!result.includes(column)) result.push(column)
  }
  if (appendMissing) for (const column of Models.NEOVIEW_FOLDER_DETAIL_COLUMNS) if (!result.includes(column)) result.push(column)
  return result
}
export function normalizedDetailWidths(value: unknown, path: string, strict: boolean): Partial<Record<Models.NeoviewFolderDetailColumn, number>> {
  const record = requireRecord(value, path)
  const known = new Set<string>(Models.NEOVIEW_FOLDER_DETAIL_COLUMNS)
  const result: Partial<Record<Models.NeoviewFolderDetailColumn, number>> = {}
  for (const [id, width] of Object.entries(record)) {
    if (!known.has(id)) {
      if (strict) throw new Error(`${path} contains unknown column ${id}.`)
      continue
    }
    result[id as Models.NeoviewFolderDetailColumn] = boundedInteger(width, 48, 800, `${path}.${id}`)
  }
  if (strict && !Object.keys(result).length) throw new Error(`${path} must change at least one known column.`)
  return result
}
export function parseFolderHoverPreviewDelay(value: unknown, path: string): Models.NeoviewFolderHoverPreviewDelay {
  const delay = boundedInteger(value, 0, 2_000, path)
  if (!Models.NEOVIEW_FOLDER_HOVER_PREVIEW_DELAYS.includes(delay as Models.NeoviewFolderHoverPreviewDelay)) {
    throw new Error(`${path} must be one of: ${Models.NEOVIEW_FOLDER_HOVER_PREVIEW_DELAYS.join(", ")}.`)
  }
  return delay as Models.NeoviewFolderHoverPreviewDelay
}
export function parseFolderTitleWrapConfig(value: Record<string, unknown> | undefined): Models.NeoviewFolderTitleWrapConfig {
  return Object.fromEntries(Models.NEOVIEW_FOLDER_VIEW_MODES.map((viewMode) => {
    const tomlKey = Models.NEOVIEW_FOLDER_TITLE_WRAP_TOML_KEYS[viewMode]
    const camelKey = viewMode.replace(/-([a-z])/gu, (_, letter: string) => letter.toUpperCase())
    const enabled = optionalBoolean(
      value?.[tomlKey] ?? value?.[viewMode] ?? value?.[camelKey],
      `[nodes.neoview.folder.title_wrap].${tomlKey}`,
    )
    return [viewMode, enabled ?? Models.DEFAULT_NEOVIEW_FOLDER_TITLE_WRAP[viewMode]]
  })) as Models.NeoviewFolderTitleWrapConfig
}
