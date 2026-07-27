import * as Models from "./ReaderRuntimeConfigModels.js"
import { boundedNumber, boundedIntegerWithFallback, optionalBoolean, requireLayoutId, requireLaneTitle, optionalEnum, optionalRecord, isRecord } from "./ReaderRuntimeConfigParserPrimitives.js"
import { NEOVIEW_SHELL_EDGES, NEOVIEW_SHELL_SURFACES, normalizedSwimlaneOrder, swimlaneWidth, readerWidthRatio, revealZone, readerFocusHoverDelay, edgeRevealDelay, shellEdgeLockMode, sidebarHeight } from "./ReaderRuntimeConfigShellPatchParser.js"
import type { NeoviewShellEdge } from "./ReaderRuntimeConfigShellPatchParser.js"

export function parseShellOptions(panels: Record<string, unknown> | undefined, reader: Record<string, unknown> | undefined): Models.NeoviewShellConfig {
  if (!panels && !reader) return Models.DEFAULT_NEOVIEW_SHELL_CONFIG
  panels ??= {}
  const hover = optionalRecord(panels.hover_areas, "[nodes.neoview.panels.hover_areas]")
  const timing = optionalRecord(panels.auto_hide_timing, "[nodes.neoview.panels.auto_hide_timing]")
  const sidebars = optionalRecord(panels.sidebars, "[nodes.neoview.panels.sidebars]")
  const left = optionalRecord(sidebars?.left, "[nodes.neoview.panels.sidebars.left]")
  const right = optionalRecord(sidebars?.right, "[nodes.neoview.panels.sidebars.right]")
  const autoHideToolbar = optionalBoolean(panels.auto_hide_toolbar, "[nodes.neoview.panels].auto_hide_toolbar")
  const canonicalControl = optionalRecord(panels.sidebar_control, "[nodes.neoview.panels.sidebar_control]")
  const canonicalInteraction = optionalRecord(panels.sidebar_interaction, "[nodes.neoview.panels.sidebar_interaction]")
  const canonicalMaterial = optionalRecord(panels.material, "[nodes.neoview.panels.material]")
  const canonicalPosition = optionalRecord(canonicalControl?.position, "[nodes.neoview.panels.sidebar_control.position]")
  const legacyView = optionalRecord(reader?.view, "[nodes.neoview.reader.view]")
  const legacyControl = optionalRecord(legacyView?.sidebar_control ?? legacyView?.sidebarControl, "[nodes.neoview.reader.view.sidebar_control]")
  const legacyPosition = optionalRecord(legacyControl?.position, "[nodes.neoview.reader.view.sidebar_control.position]")
  const canonicalEdges = optionalRecord(panels.edges, "[nodes.neoview.panels.edges]")
  const legacyEdges = {
    top: {
      enabled: true,
      initialVisible: autoHideToolbar === false,
      pinned: autoHideToolbar === false,
      trigger: hover?.top_trigger_height,
    },
    right: {
      enabled: optionalBoolean(panels.right_sidebar_visible, "right_sidebar_visible") ?? true,
      initialVisible: optionalBoolean(right?.open, "right.open") ?? true,
      pinned: optionalBoolean(right?.pinned, "right.pinned") ?? false,
      trigger: hover?.right_trigger_width,
    },
    bottom: {
      enabled: optionalBoolean(panels.bottom_panel_visible, "bottom_panel_visible") ?? true,
      initialVisible: optionalBoolean(panels.bottom_panel_visible, "bottom_panel_visible") ?? false,
      pinned: false,
      trigger: hover?.bottom_trigger_height,
    },
    left: {
      enabled: optionalBoolean(panels.left_sidebar_visible, "left_sidebar_visible") ?? true,
      initialVisible: optionalBoolean(left?.open, "left.open") ?? true,
      pinned: optionalBoolean(left?.pinned, "left.pinned") ?? true,
      trigger: hover?.left_trigger_width,
    },
  } satisfies Record<
    NeoviewShellEdge,
    {
      enabled: boolean
      initialVisible: boolean
      pinned: boolean
      trigger: unknown
    }
  >
  const parsedSidebars = {
    left: sidebarConfig("left", left),
    right: sidebarConfig("right", right),
  }
  return {
    showDelayMs: secondsToMilliseconds(timing?.show_delay_sec, "[nodes.neoview.panels.auto_hide_timing].show_delay_sec"),
    hideDelayMs: secondsToMilliseconds(timing?.hide_delay_sec, "[nodes.neoview.panels.auto_hide_timing].hide_delay_sec"),
    opacity: {
      top: boundedNumber(panels.top_toolbar_opacity, 0, 100, Models.DEFAULT_NEOVIEW_SHELL_CONFIG.opacity.top, "top_toolbar_opacity"),
      bottom: boundedNumber(panels.bottom_bar_opacity, 0, 100, Models.DEFAULT_NEOVIEW_SHELL_CONFIG.opacity.bottom, "bottom_bar_opacity"),
      sidebar: boundedNumber(panels.sidebar_opacity, 0, 100, Models.DEFAULT_NEOVIEW_SHELL_CONFIG.opacity.sidebar, "sidebar_opacity"),
    },
    blur: {
      top: boundedNumber(panels.top_toolbar_blur, 0, 20, Models.DEFAULT_NEOVIEW_SHELL_CONFIG.blur.top, "top_toolbar_blur"),
      bottom: boundedNumber(panels.bottom_bar_blur, 0, 20, Models.DEFAULT_NEOVIEW_SHELL_CONFIG.blur.bottom, "bottom_bar_blur"),
      sidebar: boundedNumber(panels.sidebar_blur, 0, 20, Models.DEFAULT_NEOVIEW_SHELL_CONFIG.blur.sidebar, "sidebar_blur"),
    },
    material: {
      preset:
        optionalEnum(canonicalMaterial?.preset, "material.preset", ["solid", "soft", "frosted", "custom"] as const) ??
        Models.DEFAULT_NEOVIEW_SHELL_MATERIAL_CONFIG.preset,
      saturation: shellMaterialValues(canonicalMaterial, "saturation", 50, 180, Models.DEFAULT_NEOVIEW_SHELL_MATERIAL_CONFIG.saturation),
      highlight: shellMaterialValues(canonicalMaterial, "highlight", 0, 100, Models.DEFAULT_NEOVIEW_SHELL_MATERIAL_CONFIG.highlight),
      shadow: shellMaterialValues(canonicalMaterial, "shadow", 0, 100, Models.DEFAULT_NEOVIEW_SHELL_MATERIAL_CONFIG.shadow),
    },
    floatingControl: {
      enabled:
        optionalBoolean(canonicalControl?.enabled, "sidebar_control.enabled") ??
        optionalBoolean(legacyControl?.enabled, "reader.view.sidebar_control.enabled") ??
        Models.DEFAULT_NEOVIEW_SHELL_CONFIG.floatingControl.enabled,
      position: {
        x: boundedIntegerWithFallback(
          canonicalPosition?.x ?? legacyPosition?.x,
          0,
          32_767,
          Models.DEFAULT_NEOVIEW_SHELL_CONFIG.floatingControl.position.x,
          "sidebar_control.position.x",
        ),
        y: boundedIntegerWithFallback(
          canonicalPosition?.y ?? legacyPosition?.y,
          0,
          32_767,
          Models.DEFAULT_NEOVIEW_SHELL_CONFIG.floatingControl.position.y,
          "sidebar_control.position.y",
        ),
      },
    },
    edges: Object.fromEntries(
      NEOVIEW_SHELL_EDGES.map((edge) => [
        edge,
        edgeConfig(edge, optionalRecord(canonicalEdges?.[edge], `[nodes.neoview.panels.edges.${edge}]`), legacyEdges[edge]),
      ]),
    ) as Models.NeoviewShellConfig["edges"],
    sidebars: parsedSidebars,
    sidebarInteraction: {
      showDragHandle:
        optionalBoolean(canonicalInteraction?.show_drag_handle, "sidebar_interaction.show_drag_handle") ??
        Models.DEFAULT_NEOVIEW_SHELL_CONFIG.sidebarInteraction.showDragHandle,
      enableBlankAreaCollapse:
        optionalBoolean(canonicalInteraction?.enable_blank_area_collapse, "sidebar_interaction.enable_blank_area_collapse") ??
        Models.DEFAULT_NEOVIEW_SHELL_CONFIG.sidebarInteraction.enableBlankAreaCollapse,
      blankAreaCollapseMode:
        optionalEnum(canonicalInteraction?.blank_area_collapse_mode, "sidebar_interaction.blank_area_collapse_mode", ["single", "double"] as const) ??
        Models.DEFAULT_NEOVIEW_SHELL_CONFIG.sidebarInteraction.blankAreaCollapseMode,
    },
    workspace: parseWorkspaceConfig(panels, parsedSidebars),
    panelLayout: parsePanelLayout(panels),
    cardLayout: parseCardLayout(panels),
  }
}
export function parseWorkspaceConfig(
  panels: Record<string, unknown>,
  sidebars: Models.NeoviewShellConfig["sidebars"],
): Models.NeoviewWorkspaceConfig {
  const source = optionalRecord(panels.swimlane, "[nodes.neoview.panels.swimlane]")
  const defaults = Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane
  const laneOrder = normalizedSwimlaneOrder(source?.lane_order ?? source?.laneOrder, defaults.laneOrder, "[nodes.neoview.panels.swimlane].lane_order")
  const laneIds = [...laneOrder]
  const reservedSwimlaneKeys = new Set([
    "lane_order", "laneOrder", "active_lane", "activeLane", "reader_solo", "readerSolo",
    "reader_solo_on_focus", "readerSoloOnFocus", "solo_lane", "soloLaneId",
    "reader_width_ratio", "readerWidthRatio", "edge_reveal_delay_ms", "edgeRevealDelayMs",
    "left_reveal_zone", "leftRevealZone", "right_reveal_zone", "rightRevealZone",
    "top_reveal_zone", "topRevealZone", "bottom_reveal_zone", "bottomRevealZone",
    "reader_focus_on_hover", "readerFocusOnHover", "reader_focus_hover_delay_ms", "readerFocusHoverDelayMs",
    "manual_scroll_enabled", "manualScrollEnabled",
    "show_lane_navigator_in_reader_solo", "showLaneNavigatorInReaderSolo",
    "auto_fit_to_viewport", "autoFitToViewport",
    "bar_handle_style", "barHandleStyle", "bar_handle_position", "barHandlePosition", "lane_navigator_position_x", "laneNavigatorPositionX",
    "lane_navigator_position_y", "laneNavigatorPositionY",
    "lane_navigator_dock", "laneNavigatorDock",
    "window_controls_placement", "windowControlsPlacement",
    "window_controls_owner_lane_id", "windowControlsOwnerLaneId",
    "window_controls_expanded", "windowControlsExpanded",
  ])
  for (const [key, value] of Object.entries(source ?? {})) {
    if (!reservedSwimlaneKeys.has(key) && value && typeof value === "object" && !Array.isArray(value) && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(key) && !laneIds.includes(key)) laneIds.push(key)
  }
  const lanes = Object.fromEntries(laneIds.map((laneId) => {
    const lane = optionalRecord(source?.[laneId], `[nodes.neoview.panels.swimlane].${laneId}`)
    const laneDefaults = defaults.lanes[laneId] ?? { width: 320, collapsed: false }
    const fallbackWidth = laneId === "left" ? sidebars.left.width : laneId === "right" ? sidebars.right.width : laneDefaults.width
    const activePanelValue = lane?.active_panel_id ?? lane?.activePanelId
    const panelBarMode = optionalEnum(lane?.panel_bar_mode ?? lane?.panelBarMode, `[nodes.neoview.panels.swimlane].${laneId}.panel_bar_mode`, Models.NEOVIEW_PANEL_BAR_MODES) ?? laneDefaults.panelBarMode
    const panelBarDock = optionalEnum(lane?.panel_bar_dock ?? lane?.panelBarDock, `[nodes.neoview.panels.swimlane].${laneId}.panel_bar_dock`, Models.NEOVIEW_PANEL_BAR_DOCKS) ?? laneDefaults.panelBarDock
    const panelBarPositionX = lane?.panel_bar_position_x ?? lane?.panelBarPositionX
    const panelBarPositionY = lane?.panel_bar_position_y ?? lane?.panelBarPositionY
    const panelBarConstrained = optionalBoolean(lane?.panel_bar_constrained ?? lane?.panelBarConstrained, `[nodes.neoview.panels.swimlane].${laneId}.panel_bar_constrained`) ?? laneDefaults.panelBarConstrained
    return [laneId, {
      width: swimlaneWidth(lane?.width, laneId, `[nodes.neoview.panels.swimlane].${laneId}.width`, fallbackWidth),
      ...((lane?.landscape_width ?? lane?.landscapeWidth) === undefined ? {} : {
        landscapeWidth: swimlaneWidth(lane?.landscape_width ?? lane?.landscapeWidth, laneId, `[nodes.neoview.panels.swimlane].${laneId}.landscape_width`),
      }),
      ...((lane?.portrait_width ?? lane?.portraitWidth) === undefined ? {} : {
        portraitWidth: swimlaneWidth(lane?.portrait_width ?? lane?.portraitWidth, laneId, `[nodes.neoview.panels.swimlane].${laneId}.portrait_width`),
      }),
      ...((lane?.landscape_reader_solo_width ?? lane?.landscapeReaderSoloWidth) === undefined ? {} : {
        landscapeReaderSoloWidth: swimlaneWidth(lane?.landscape_reader_solo_width ?? lane?.landscapeReaderSoloWidth, laneId, `[nodes.neoview.panels.swimlane].${laneId}.landscape_reader_solo_width`),
      }),
      ...((lane?.portrait_reader_solo_width ?? lane?.portraitReaderSoloWidth) === undefined ? {} : {
        portraitReaderSoloWidth: swimlaneWidth(lane?.portrait_reader_solo_width ?? lane?.portraitReaderSoloWidth, laneId, `[nodes.neoview.panels.swimlane].${laneId}.portrait_reader_solo_width`),
      }),
      collapsed: optionalBoolean(lane?.collapsed, `[nodes.neoview.panels.swimlane].${laneId}.collapsed`) ?? laneDefaults.collapsed,
      ...((lane?.title ?? laneDefaults.title) === undefined ? {} : {
        title: requireLaneTitle(lane?.title ?? laneDefaults.title, `[nodes.neoview.panels.swimlane].${laneId}.title`),
      }),
      ...(activePanelValue === undefined
        ? (laneDefaults.activePanelId ? { activePanelId: laneDefaults.activePanelId } : {})
        : { activePanelId: requireLayoutId(activePanelValue, `[nodes.neoview.panels.swimlane].${laneId}.active_panel_id`) }),
      ...(panelBarMode ? { panelBarMode } : {}),
      ...(panelBarDock ? { panelBarDock } : {}),
      ...(panelBarPositionX === undefined && laneDefaults.panelBarPositionX === undefined ? {} : {
        panelBarPositionX: boundedNumber(panelBarPositionX, 0, 100, laneDefaults.panelBarPositionX ?? 50, `[nodes.neoview.panels.swimlane].${laneId}.panel_bar_position_x`),
      }),
      ...(panelBarPositionY === undefined && laneDefaults.panelBarPositionY === undefined ? {} : {
        panelBarPositionY: boundedNumber(panelBarPositionY, 0, 100, laneDefaults.panelBarPositionY ?? 50, `[nodes.neoview.panels.swimlane].${laneId}.panel_bar_position_y`),
      }),
      ...(panelBarConstrained === undefined ? {} : { panelBarConstrained }),
    }]
  })) as Models.NeoviewSwimlaneConfig["lanes"]
  if (!source?.left) lanes.left.width = sidebars.left.width
  if (!source?.right) lanes.right.width = sidebars.right.width
  const activeLaneValue = source?.active_lane ?? source?.activeLane
  const activeLane = activeLaneValue === undefined
    ? defaults.activeLane
    : requireLayoutId(activeLaneValue, "[nodes.neoview.panels.swimlane].active_lane")
  const soloLaneValue = source?.solo_lane ?? source?.soloLaneId
  const soloLaneId = typeof soloLaneValue === "string" && soloLaneValue.trim()
    ? requireLayoutId(soloLaneValue, "[nodes.neoview.panels.swimlane].solo_lane")
    : undefined
  return {
    mode:
      optionalEnum(panels.layout_mode ?? panels.layoutMode, "[nodes.neoview.panels].layout_mode", Models.NEOVIEW_WORKSPACE_MODES) ??
      Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.mode,
    swimlane: {
      laneOrder,
      activeLane: laneOrder.includes(activeLane) ? activeLane : defaults.activeLane,
      readerSolo:
        optionalBoolean(source?.reader_solo ?? source?.readerSolo, "[nodes.neoview.panels.swimlane].reader_solo") ?? defaults.readerSolo,
      readerSoloOnFocus:
        optionalBoolean(source?.reader_solo_on_focus ?? source?.readerSoloOnFocus, "[nodes.neoview.panels.swimlane].reader_solo_on_focus") ?? defaults.readerSoloOnFocus,
      ...(soloLaneId && laneOrder.includes(soloLaneId) ? { soloLaneId } : {}),
      readerWidthRatio: readerWidthRatio(
        source?.reader_width_ratio ?? source?.readerWidthRatio,
        "[nodes.neoview.panels.swimlane].reader_width_ratio",
        Math.min(1, Math.max(0.25, lanes.reader.width / 1_920)),
      ),
      edgeRevealDelayMs: edgeRevealDelay(
        source?.edge_reveal_delay_ms ?? source?.edgeRevealDelayMs,
        "[nodes.neoview.panels.swimlane].edge_reveal_delay_ms",
        defaults.edgeRevealDelayMs,
      ),
      edgeRevealZones: {
        left: revealZone(source?.left_reveal_zone ?? source?.leftRevealZone ?? defaults.edgeRevealZones.left, "[nodes.neoview.panels.swimlane].left_reveal_zone", defaults.edgeRevealZones.left),
        right: revealZone(source?.right_reveal_zone ?? source?.rightRevealZone ?? defaults.edgeRevealZones.right, "[nodes.neoview.panels.swimlane].right_reveal_zone", defaults.edgeRevealZones.right),
        top: revealZone(source?.top_reveal_zone ?? source?.topRevealZone ?? defaults.edgeRevealZones.top, "[nodes.neoview.panels.swimlane].top_reveal_zone", defaults.edgeRevealZones.top),
        bottom: revealZone(source?.bottom_reveal_zone ?? source?.bottomRevealZone ?? defaults.edgeRevealZones.bottom, "[nodes.neoview.panels.swimlane].bottom_reveal_zone", defaults.edgeRevealZones.bottom),
      },
      readerFocusOnHover:
        optionalBoolean(source?.reader_focus_on_hover ?? source?.readerFocusOnHover, "[nodes.neoview.panels.swimlane].reader_focus_on_hover") ??
        defaults.readerFocusOnHover,
      readerFocusHoverDelayMs: readerFocusHoverDelay(
        source?.reader_focus_hover_delay_ms ?? source?.readerFocusHoverDelayMs,
        "[nodes.neoview.panels.swimlane].reader_focus_hover_delay_ms",
        defaults.readerFocusHoverDelayMs,
      ),
      manualScrollEnabled:
        optionalBoolean(source?.manual_scroll_enabled ?? source?.manualScrollEnabled, "[nodes.neoview.panels.swimlane].manual_scroll_enabled") ??
        defaults.manualScrollEnabled,
      showLaneNavigatorInReaderSolo:
        optionalBoolean(
          source?.show_lane_navigator_in_reader_solo ?? source?.showLaneNavigatorInReaderSolo,
          "[nodes.neoview.panels.swimlane].show_lane_navigator_in_reader_solo",
        ) ?? defaults.showLaneNavigatorInReaderSolo,
      autoFitToViewport:
        optionalBoolean(source?.auto_fit_to_viewport ?? source?.autoFitToViewport, "[nodes.neoview.panels.swimlane].auto_fit_to_viewport") ?? defaults.autoFitToViewport,
      barHandleStyle:
        optionalEnum(source?.bar_handle_style ?? source?.barHandleStyle, "[nodes.neoview.panels.swimlane].bar_handle_style", Models.NEOVIEW_BAR_HANDLE_STYLES) ?? defaults.barHandleStyle,
      barHandlePosition:
        optionalEnum(source?.bar_handle_position ?? source?.barHandlePosition, "[nodes.neoview.panels.swimlane].bar_handle_position", Models.NEOVIEW_BAR_HANDLE_POSITIONS) ?? defaults.barHandlePosition,
      laneNavigatorPositionX: boundedNumber(source?.lane_navigator_position_x ?? source?.laneNavigatorPositionX, 0, 100, defaults.laneNavigatorPositionX, "[nodes.neoview.panels.swimlane].lane_navigator_position_x"),
      laneNavigatorPositionY: boundedNumber(source?.lane_navigator_position_y ?? source?.laneNavigatorPositionY, 0, 100, defaults.laneNavigatorPositionY, "[nodes.neoview.panels.swimlane].lane_navigator_position_y"),
      laneNavigatorDock:
        optionalEnum(source?.lane_navigator_dock ?? source?.laneNavigatorDock, "[nodes.neoview.panels.swimlane].lane_navigator_dock", Models.NEOVIEW_LANE_NAVIGATOR_DOCKS) ?? defaults.laneNavigatorDock,
      windowControlsPlacement:
        optionalEnum(source?.window_controls_placement ?? source?.windowControlsPlacement, "[nodes.neoview.panels.swimlane].window_controls_placement", Models.NEOVIEW_WINDOW_CONTROLS_PLACEMENTS) ?? defaults.windowControlsPlacement,
      windowControlsOwnerLaneId: (() => {
        const owner = requireLayoutId(
          source?.window_controls_owner_lane_id ?? source?.windowControlsOwnerLaneId ?? defaults.windowControlsOwnerLaneId,
          "[nodes.neoview.panels.swimlane].window_controls_owner_lane_id",
        )
        return laneOrder.includes(owner) ? owner : laneOrder.at(-1) ?? defaults.windowControlsOwnerLaneId
      })(),
      windowControlsExpanded:
        optionalBoolean(source?.window_controls_expanded ?? source?.windowControlsExpanded, "[nodes.neoview.panels.swimlane].window_controls_expanded") ?? defaults.windowControlsExpanded,
      lanes,
    },
  }
}
export function parseCardLayout(panels: Record<string, unknown>): Record<string, Models.NeoviewCardLayout> {
  const result: Record<string, Models.NeoviewCardLayout> = {
    ...Models.DEFAULT_NEOVIEW_SHELL_CONFIG.cardLayout,
  }
  const legacy = optionalRecord(panels.card_configs, "[nodes.neoview.panels.card_configs]")
  const legacyData = optionalRecord(legacy?.data, "[nodes.neoview.panels.card_configs.data]")
  for (const [panelId, cards] of Object.entries(legacyData ?? {})) {
    if (!Array.isArray(cards)) continue
    for (const value of cards) {
      if (!isRecord(value) || typeof value.id !== "string") continue
      result[value.id] = parseCardValue(value.id, panelId, value, result[value.id])
    }
  }
  const canonical = optionalRecord(panels.card_state, "[nodes.neoview.panels.card_state]")
  const legacyAmbientBackground = canonical?.["ambient-background-settings"]
  if (canonical?.["ambient-background"] === undefined && legacyAmbientBackground !== undefined) {
    if (!isRecord(legacyAmbientBackground)) throw new Error("[nodes.neoview.panels.card_state.ambient-background-settings] must be a table.")
    result["ambient-background"] = parseCardValue(
      "ambient-background",
      undefined,
      legacyAmbientBackground,
      result["ambient-background"],
    )
  }
  for (const [cardId, value] of Object.entries(canonical ?? {})) {
    if (cardId === "ambient-background-settings") continue
    if (!isRecord(value)) throw new Error(`[nodes.neoview.panels.card_state.${cardId}] must be a table.`)
    result[cardId] = parseCardValue(cardId, undefined, value, result[cardId])
  }
  return result
}
export function parseCardValue(
  cardId: string,
  legacyPanelId: string | undefined,
  value: Record<string, unknown>,
  fallback: Models.NeoviewCardLayout | undefined,
): Models.NeoviewCardLayout {
  const panelId = value.panel_id ?? value.panelId ?? legacyPanelId ?? fallback?.panelId
  if (typeof panelId !== "string" || !panelId) throw new Error(`${cardId}.panelId must be a non-empty string.`)
  return {
    panelId,
    visible: optionalBoolean(value.visible, `${cardId}.visible`) ?? fallback?.visible ?? true,
    expanded: optionalBoolean(value.expanded, `${cardId}.expanded`) ?? fallback?.expanded ?? true,
    order: boundedNumber(value.order, 0, 10_000, fallback?.order ?? 0, `${cardId}.order`),
    height:
      value.height === "auto" ? undefined : value.height === undefined ? fallback?.height : boundedNumber(value.height, 50, 4_096, 50, `${cardId}.height`),
  }
}
export function parsePanelLayout(panels: Record<string, unknown>): Record<string, Models.NeoviewPanelLayout> {
  const layout = optionalRecord(panels.layout, "[nodes.neoview.panels.layout]")
  const source = optionalRecord(layout?.sidebarConfig, "[nodes.neoview.panels.layout.sidebarConfig]") ?? layout
  const values = source?.panels
  const result: Record<string, Models.NeoviewPanelLayout> = {
    ...Models.DEFAULT_NEOVIEW_SHELL_CONFIG.panelLayout,
  }
  if (Array.isArray(values)) {
    for (const value of values) {
      if (!isRecord(value) || typeof value.id !== "string") continue
      const id = value.id
      result[id] = {
        visible: optionalBoolean(value.visible, `${id}.visible`) ?? result[id]?.visible ?? true,
        order: boundedNumber(value.order, 0, 10_000, result[id]?.order ?? 0, `${id}.order`),
        position: optionalEnum(value.position, `${id}.position`, ["left", "right", "bottom", "floating"] as const) ?? result[id]?.position ?? "left",
      }
    }
  }
  const canonical = optionalRecord(panels.panel_state, "[nodes.neoview.panels.panel_state]")
  for (const [id, value] of Object.entries(canonical ?? {})) {
    if (!isRecord(value)) throw new Error(`[nodes.neoview.panels.panel_state.${id}] must be a table.`)
    result[id] = {
      visible: optionalBoolean(value.visible, `${id}.visible`) ?? result[id]?.visible ?? true,
      order: boundedNumber(value.order, 0, 10_000, result[id]?.order ?? 0, `${id}.order`),
      position: optionalEnum(value.position, `${id}.position`, ["left", "right", "bottom", "floating"] as const) ?? result[id]?.position ?? "left",
    }
  }
  return result
}
export function edgeConfig(
  edge: NeoviewShellEdge,
  canonical: Record<string, unknown> | undefined,
  legacy: {
    enabled: boolean
    initialVisible: boolean
    pinned: boolean
    trigger: unknown
  },
): Models.NeoviewShellEdgeConfig {
  return {
    enabled: optionalBoolean(canonical?.enabled, `${edge}.enabled`) ?? legacy.enabled,
    initialVisible: optionalBoolean(canonical?.initial_visible, `${edge}.initial_visible`) ?? legacy.initialVisible,
    pinned: optionalBoolean(canonical?.pinned, `${edge}.pinned`) ?? legacy.pinned,
    triggerSize: boundedNumber(canonical?.trigger_size ?? legacy.trigger, 1, 128, 32, `${edge} trigger`),
    lockMode: shellEdgeLockMode(canonical?.lock_mode, `${edge}.lock_mode`),
  }
}
export function sidebarConfig(side: "left" | "right", value: Record<string, unknown> | undefined): Models.NeoviewShellSidebarConfig {
  return {
    width: boundedNumber(value?.width, 200, 600, side === "left" ? 320 : 280, `${side}.width`),
    height: sidebarHeight(value?.height, `${side}.height`),
    customHeight: boundedNumber(value?.custom_height, 10, 100, 100, `${side}.custom_height`),
    verticalAlign: boundedNumber(value?.vertical_align, 0, 100, 0, `${side}.vertical_align`),
    horizontalPosition: boundedNumber(value?.horizontal_position, 0, 100, 0, `${side}.horizontal_position`),
  }
}
export function secondsToMilliseconds(value: unknown, path: string): number {
  return Math.round(boundedNumber(value, 0, 5, 0, path) * 1000)
}
export function shellMaterialValues(
  source: Record<string, unknown> | undefined,
  key: "saturation" | "highlight" | "shadow",
  minimum: number,
  maximum: number,
  defaults: Models.NeoviewShellSurfaceValues,
): Models.NeoviewShellSurfaceValues {
  return Object.fromEntries(
    NEOVIEW_SHELL_SURFACES.map((surface) => [
      surface,
      boundedNumber(source?.[`${surface}_${key}`], minimum, maximum, defaults[surface], `material.${surface}_${key}`),
    ]),
  ) as Models.NeoviewShellSurfaceValues
}
