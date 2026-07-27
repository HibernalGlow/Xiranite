import { READER_CARD_MANIFEST, readerCardCanMoveTo } from "./ReaderLayoutManifest.js"
import * as Models from "./ReaderRuntimeConfigModels.js"
import { boundedNumber, boundedInteger, requiredStringArray, optionalBoolean, requiredBoolean, requireLayoutId, requireLaneTitle, optionalEnum, requireRecord } from "./ReaderRuntimeConfigParserPrimitives.js"

export const READER_CARD_MANIFEST_BY_ID = new Map(READER_CARD_MANIFEST.map((card) => [card.id as string, card]))
export function parseNeoviewShellControlPatch(value: unknown): {
  patch: Models.NeoviewShellControlPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader shell control patch")
  const unknownRoot = Object.keys(record).filter((key) => key !== "expectedRevision" && key !== "shellControl")
  if (unknownRoot.length) throw new Error(`reader shell control patch contains unsupported fields: ${unknownRoot.join(", ")}.`)
  const expectedRevision = boundedInteger(record.expectedRevision, 0, Number.MAX_SAFE_INTEGER, "reader shell control patch.expectedRevision")
  const control = requireRecord(record.shellControl, "reader shell control patch.shellControl")
  const unknownControl = Object.keys(control).filter(
    (key) => key !== "floating" && key !== "edges" && key !== "sidebarInteraction" && key !== "workspace" && key !== "material" && key !== "reset",
  )
  if (unknownControl.length) throw new Error(`reader shell control patch contains unsupported fields: ${unknownControl.join(", ")}.`)
  const reset = control.reset === undefined ? undefined : optionalEnum(control.reset, "reader shell control patch.reset", ["known-defaults"] as const)
  if (reset && (control.floating !== undefined || control.edges !== undefined || control.sidebarInteraction !== undefined || control.workspace !== undefined || control.material !== undefined)) {
    throw new Error("reader shell control patch.reset cannot be combined with floating, edges, sidebarInteraction, workspace or material.")
  }
  if (reset) {
    return {
      patch: { expectedRevision, shellControl: { reset } },
      tomlPatch: shellControlTomlPatch(
        Models.DEFAULT_NEOVIEW_SHELL_CONFIG.floatingControl,
        Models.DEFAULT_NEOVIEW_SHELL_CONFIG.edges,
        Models.DEFAULT_NEOVIEW_SHELL_CONFIG.sidebarInteraction,
        {
          mode: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.mode,
          laneOrder: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.laneOrder,
          activeLane: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.activeLane,
          readerSolo: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.readerSolo,
          readerSoloOnFocus: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.readerSoloOnFocus,
          readerWidthRatio: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.readerWidthRatio,
          edgeRevealDelayMs: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.edgeRevealDelayMs,
          edgeRevealZones: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.edgeRevealZones,
          readerFocusOnHover: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.readerFocusOnHover,
          readerFocusHoverDelayMs: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.readerFocusHoverDelayMs,
          manualScrollEnabled: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.manualScrollEnabled,
          showLaneNavigatorInReaderSolo: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.showLaneNavigatorInReaderSolo,
          windowControlsPlacement: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.windowControlsPlacement,
          windowControlsOwnerLaneId: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.windowControlsOwnerLaneId,
          windowControlsExpanded: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.windowControlsExpanded,
          lanes: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.lanes,
        },
        {
          preset: Models.DEFAULT_NEOVIEW_SHELL_MATERIAL_CONFIG.preset,
          opacity: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.opacity,
          blur: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.blur,
          saturation: Models.DEFAULT_NEOVIEW_SHELL_MATERIAL_CONFIG.saturation,
          highlight: Models.DEFAULT_NEOVIEW_SHELL_MATERIAL_CONFIG.highlight,
          shadow: Models.DEFAULT_NEOVIEW_SHELL_MATERIAL_CONFIG.shadow,
        },
      ),
    }
  }

  const patch: Models.NeoviewShellControlPatch = {
    expectedRevision,
    shellControl: {},
  }
  let floatingPatch: Models.NeoviewShellControlPatch["shellControl"]["floating"]
  if (control.floating !== undefined) {
    const floating = requireRecord(control.floating, "reader shell control patch.floating")
    const unknown = Object.keys(floating).filter((key) => key !== "enabled" && key !== "position")
    if (unknown.length) throw new Error(`reader shell control patch.floating contains unsupported fields: ${unknown.join(", ")}.`)
    floatingPatch = {}
    if (floating.enabled !== undefined) floatingPatch.enabled = requiredBoolean(floating.enabled, "reader shell control patch.floating.enabled")
    if (floating.position !== undefined) {
      const position = requireRecord(floating.position, "reader shell control patch.floating.position")
      const positionKeys = Object.keys(position)
      if (positionKeys.some((key) => key !== "x" && key !== "y")) throw new Error("reader shell control patch.floating.position contains unsupported fields.")
      if (position.x === undefined || position.y === undefined) throw new Error("reader shell control patch.floating.position requires x and y.")
      floatingPatch.position = {
        x: boundedInteger(position.x, 0, 32_767, "reader shell control patch.floating.position.x"),
        y: boundedInteger(position.y, 0, 32_767, "reader shell control patch.floating.position.y"),
      }
    }
    if (!Object.keys(floatingPatch).length) throw new Error("reader shell control patch.floating must change at least one field.")
    patch.shellControl.floating = floatingPatch
  }

  let edgePatches: Models.NeoviewShellControlPatch["shellControl"]["edges"]
  if (control.edges !== undefined) {
    const edges = requireRecord(control.edges, "reader shell control patch.edges")
    const unknownEdges = Object.keys(edges).filter((edge) => !NEOVIEW_SHELL_EDGES.includes(edge as NeoviewShellEdge))
    if (unknownEdges.length) throw new Error(`reader shell control patch.edges contains unsupported edges: ${unknownEdges.join(", ")}.`)
    edgePatches = {}
    for (const edge of NEOVIEW_SHELL_EDGES) {
      if (edges[edge] === undefined) continue
      const source = requireRecord(edges[edge], `reader shell control patch.edges.${edge}`)
      const unknown = Object.keys(source).filter((key) => !["enabled", "initialVisible", "pinned", "triggerSize", "lockMode"].includes(key))
      if (unknown.length) throw new Error(`reader shell control patch.edges.${edge} contains unsupported fields: ${unknown.join(", ")}.`)
      const target: Partial<Models.NeoviewShellEdgeConfig> = {}
      if (source.enabled !== undefined) target.enabled = requiredBoolean(source.enabled, `${edge}.enabled`)
      if (source.initialVisible !== undefined) target.initialVisible = requiredBoolean(source.initialVisible, `${edge}.initialVisible`)
      if (source.pinned !== undefined) target.pinned = requiredBoolean(source.pinned, `${edge}.pinned`)
      if (source.triggerSize !== undefined) target.triggerSize = boundedNumber(source.triggerSize, 1, 128, 32, `${edge}.triggerSize`)
      if (source.lockMode !== undefined) target.lockMode = shellEdgeLockMode(source.lockMode, `${edge}.lockMode`)
      if (!Object.keys(target).length) throw new Error(`reader shell control patch.edges.${edge} must change at least one field.`)
      edgePatches[edge] = target
    }
    if (!Object.keys(edgePatches).length) throw new Error("reader shell control patch.edges must change at least one edge.")
    patch.shellControl.edges = edgePatches
  }
  let sidebarInteractionPatch: Models.NeoviewShellControlPatch["shellControl"]["sidebarInteraction"]
  if (control.sidebarInteraction !== undefined) {
    const interaction = requireRecord(control.sidebarInteraction, "reader shell control patch.sidebarInteraction")
    const unknown = Object.keys(interaction).filter((key) => !["showDragHandle", "enableBlankAreaCollapse", "blankAreaCollapseMode"].includes(key))
    if (unknown.length) throw new Error(`reader shell control patch.sidebarInteraction contains unsupported fields: ${unknown.join(", ")}.`)
    sidebarInteractionPatch = {}
    if (interaction.showDragHandle !== undefined)
      sidebarInteractionPatch.showDragHandle = requiredBoolean(interaction.showDragHandle, "sidebarInteraction.showDragHandle")
    if (interaction.enableBlankAreaCollapse !== undefined)
      sidebarInteractionPatch.enableBlankAreaCollapse = requiredBoolean(interaction.enableBlankAreaCollapse, "sidebarInteraction.enableBlankAreaCollapse")
    if (interaction.blankAreaCollapseMode !== undefined) {
      sidebarInteractionPatch.blankAreaCollapseMode = optionalEnum(interaction.blankAreaCollapseMode, "sidebarInteraction.blankAreaCollapseMode", [
        "single",
        "double",
      ] as const)
    }
    if (!Object.keys(sidebarInteractionPatch).length) throw new Error("reader shell control patch.sidebarInteraction must change at least one field.")
    patch.shellControl.sidebarInteraction = sidebarInteractionPatch
  }
  let workspacePatch: Models.NeoviewShellControlPatch["shellControl"]["workspace"]
  if (control.workspace !== undefined) {
    const workspace = requireRecord(control.workspace, "reader shell control patch.workspace")
    const unknown = Object.keys(workspace).filter((key) => ![
      "mode",
      "laneOrder",
      "activeLane",
      "readerSolo",
      "readerSoloOnFocus",
      "soloLaneId",
      "readerWidthRatio",
      "edgeRevealDelayMs",
      "edgeRevealZones",
      "readerFocusOnHover",
      "readerFocusHoverDelayMs",
      "manualScrollEnabled",
      "showLaneNavigatorInReaderSolo",
      "autoFitToViewport",
      "barHandleStyle",
      "barHandlePosition",
      "laneNavigatorPositionX",
      "laneNavigatorPositionY",
      "laneNavigatorDock",
      "windowControlsPlacement",
      "windowControlsOwnerLaneId",
      "windowControlsExpanded",
      "lanes",
    ].includes(key))
    if (unknown.length) throw new Error(`reader shell control patch.workspace contains unsupported fields: ${unknown.join(", ")}.`)
    workspacePatch = {}
    if (workspace.mode !== undefined) {
      workspacePatch.mode = optionalEnum(workspace.mode, "workspace.mode", Models.NEOVIEW_WORKSPACE_MODES)
    }
    if (workspace.laneOrder !== undefined) {
      workspacePatch.laneOrder = normalizedSwimlaneOrder(workspace.laneOrder, Models.NEOVIEW_SWIMLANE_IDS, "workspace.laneOrder", true)
    }
    if (workspace.activeLane !== undefined) {
      workspacePatch.activeLane = requireLayoutId(workspace.activeLane, "workspace.activeLane")
    }
    if (workspace.readerSolo !== undefined) {
      workspacePatch.readerSolo = requiredBoolean(workspace.readerSolo, "workspace.readerSolo")
    }
    if (workspace.readerSoloOnFocus !== undefined) {
      workspacePatch.readerSoloOnFocus = requiredBoolean(workspace.readerSoloOnFocus, "workspace.readerSoloOnFocus")
    }
    if (workspace.soloLaneId !== undefined) {
      workspacePatch.soloLaneId = workspace.soloLaneId === null ? null : requireLayoutId(workspace.soloLaneId, "workspace.soloLaneId")
    }
    if (workspace.readerWidthRatio !== undefined) {
      workspacePatch.readerWidthRatio = readerWidthRatio(workspace.readerWidthRatio, "workspace.readerWidthRatio")
    }
    if (workspace.edgeRevealDelayMs !== undefined) {
      workspacePatch.edgeRevealDelayMs = edgeRevealDelay(workspace.edgeRevealDelayMs, "workspace.edgeRevealDelayMs")
    }
    if (workspace.edgeRevealZones !== undefined) {
      const zones = requireRecord(workspace.edgeRevealZones, "workspace.edgeRevealZones")
      const unknownZones = Object.keys(zones).filter((edge) => !Models.NEOVIEW_SWIMLANE_REVEAL_EDGES.includes(edge as Models.NeoviewSwimlaneRevealEdge))
      if (unknownZones.length) throw new Error(`workspace.edgeRevealZones contains unsupported edges: ${unknownZones.join(", ")}.`)
      workspacePatch.edgeRevealZones = {
        left: revealZone(zones.left, "workspace.edgeRevealZones.left", Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.edgeRevealZones.left),
        right: revealZone(zones.right, "workspace.edgeRevealZones.right", Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.edgeRevealZones.right),
        top: revealZone(zones.top, "workspace.edgeRevealZones.top", Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.edgeRevealZones.top),
        bottom: revealZone(zones.bottom, "workspace.edgeRevealZones.bottom", Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.edgeRevealZones.bottom),
      }
    }
    if (workspace.readerFocusOnHover !== undefined) {
      workspacePatch.readerFocusOnHover = requiredBoolean(workspace.readerFocusOnHover, "workspace.readerFocusOnHover")
    }
    if (workspace.readerFocusHoverDelayMs !== undefined) {
      workspacePatch.readerFocusHoverDelayMs = readerFocusHoverDelay(workspace.readerFocusHoverDelayMs, "workspace.readerFocusHoverDelayMs")
    }
    if (workspace.manualScrollEnabled !== undefined) {
      workspacePatch.manualScrollEnabled = requiredBoolean(workspace.manualScrollEnabled, "workspace.manualScrollEnabled")
    }
    if (workspace.showLaneNavigatorInReaderSolo !== undefined) {
      workspacePatch.showLaneNavigatorInReaderSolo = requiredBoolean(workspace.showLaneNavigatorInReaderSolo, "workspace.showLaneNavigatorInReaderSolo")
    }
    if (workspace.autoFitToViewport !== undefined) {
      workspacePatch.autoFitToViewport = requiredBoolean(workspace.autoFitToViewport, "workspace.autoFitToViewport")
    }
    if (workspace.barHandleStyle !== undefined) {
      workspacePatch.barHandleStyle = optionalEnum(workspace.barHandleStyle, "workspace.barHandleStyle", Models.NEOVIEW_BAR_HANDLE_STYLES)
    }
    if (workspace.barHandlePosition !== undefined) {
      workspacePatch.barHandlePosition = optionalEnum(workspace.barHandlePosition, "workspace.barHandlePosition", Models.NEOVIEW_BAR_HANDLE_POSITIONS)
    }
    if (workspace.laneNavigatorPositionX !== undefined) workspacePatch.laneNavigatorPositionX = boundedNumber(workspace.laneNavigatorPositionX, 0, 100, 92, "workspace.laneNavigatorPositionX")
    if (workspace.laneNavigatorPositionY !== undefined) workspacePatch.laneNavigatorPositionY = boundedNumber(workspace.laneNavigatorPositionY, 0, 100, 96, "workspace.laneNavigatorPositionY")
    if (workspace.laneNavigatorDock !== undefined) workspacePatch.laneNavigatorDock = optionalEnum(workspace.laneNavigatorDock, "workspace.laneNavigatorDock", Models.NEOVIEW_LANE_NAVIGATOR_DOCKS)
    if (workspace.windowControlsPlacement !== undefined) workspacePatch.windowControlsPlacement = optionalEnum(workspace.windowControlsPlacement, "workspace.windowControlsPlacement", Models.NEOVIEW_WINDOW_CONTROLS_PLACEMENTS)
    if (workspace.windowControlsOwnerLaneId !== undefined) workspacePatch.windowControlsOwnerLaneId = requireLayoutId(workspace.windowControlsOwnerLaneId, "workspace.windowControlsOwnerLaneId")
    if (workspace.windowControlsExpanded !== undefined) workspacePatch.windowControlsExpanded = requiredBoolean(workspace.windowControlsExpanded, "workspace.windowControlsExpanded")
    if (workspace.lanes !== undefined) {
      const lanes = requireRecord(workspace.lanes, "reader shell control patch.workspace.lanes")
      const lanePatches: NonNullable<Models.NeoviewShellControlPatch["shellControl"]["workspace"]>["lanes"] = {}
      for (const laneId of Object.keys(lanes)) {
        requireLayoutId(laneId, `reader shell control patch.workspace.lanes.${laneId}`)
        const source = requireRecord(lanes[laneId], `reader shell control patch.workspace.lanes.${laneId}`)
        const unknownLaneFields = Object.keys(source).filter((key) => ![
          "width",
          "landscapeWidth",
          "portraitWidth",
          "landscapeReaderSoloWidth",
          "portraitReaderSoloWidth",
          "collapsed",
          "title",
          "activePanelId",
          "panelBarMode",
          "panelBarDock",
          "panelBarPositionX",
          "panelBarPositionY",
          "panelBarConstrained",
        ].includes(key))
        if (unknownLaneFields.length) throw new Error(`reader shell control patch.workspace.lanes.${laneId} contains unsupported fields: ${unknownLaneFields.join(", ")}.`)
        const lane: Partial<Models.NeoviewSwimlaneLaneConfig> = {}
        if (source.width !== undefined) lane.width = swimlaneWidth(source.width, laneId, `workspace.lanes.${laneId}.width`)
        if (source.landscapeWidth !== undefined) lane.landscapeWidth = swimlaneWidth(source.landscapeWidth, laneId, `workspace.lanes.${laneId}.landscapeWidth`)
        if (source.portraitWidth !== undefined) lane.portraitWidth = swimlaneWidth(source.portraitWidth, laneId, `workspace.lanes.${laneId}.portraitWidth`)
        if (source.landscapeReaderSoloWidth !== undefined) lane.landscapeReaderSoloWidth = swimlaneWidth(source.landscapeReaderSoloWidth, laneId, `workspace.lanes.${laneId}.landscapeReaderSoloWidth`)
        if (source.portraitReaderSoloWidth !== undefined) lane.portraitReaderSoloWidth = swimlaneWidth(source.portraitReaderSoloWidth, laneId, `workspace.lanes.${laneId}.portraitReaderSoloWidth`)
        if (source.collapsed !== undefined) lane.collapsed = requiredBoolean(source.collapsed, `workspace.lanes.${laneId}.collapsed`)
        if (source.title !== undefined) lane.title = requireLaneTitle(source.title, `workspace.lanes.${laneId}.title`)
        if (source.activePanelId !== undefined) lane.activePanelId = requireLayoutId(source.activePanelId, `workspace.lanes.${laneId}.activePanelId`)
        if (source.panelBarMode !== undefined) lane.panelBarMode = optionalEnum(source.panelBarMode, `workspace.lanes.${laneId}.panelBarMode`, Models.NEOVIEW_PANEL_BAR_MODES)
        if (source.panelBarDock !== undefined) lane.panelBarDock = optionalEnum(source.panelBarDock, `workspace.lanes.${laneId}.panelBarDock`, Models.NEOVIEW_PANEL_BAR_DOCKS)
        if (source.panelBarPositionX !== undefined) lane.panelBarPositionX = boundedNumber(source.panelBarPositionX, 0, 100, 50, `workspace.lanes.${laneId}.panelBarPositionX`)
        if (source.panelBarPositionY !== undefined) lane.panelBarPositionY = boundedNumber(source.panelBarPositionY, 0, 100, 50, `workspace.lanes.${laneId}.panelBarPositionY`)
        if (source.panelBarConstrained !== undefined) lane.panelBarConstrained = requiredBoolean(source.panelBarConstrained, `workspace.lanes.${laneId}.panelBarConstrained`)
        if (!Object.keys(lane).length) throw new Error(`reader shell control patch.workspace.lanes.${laneId} must change at least one field.`)
        lanePatches[laneId] = lane
      }
      if (!Object.keys(lanePatches).length) throw new Error("reader shell control patch.workspace.lanes must change at least one lane.")
      workspacePatch.lanes = lanePatches
    }
    if (!Object.keys(workspacePatch).length) throw new Error("reader shell control patch.workspace must change at least one field.")
    patch.shellControl.workspace = workspacePatch
  }
  let materialPatch: Models.NeoviewShellControlPatch["shellControl"]["material"]
  if (control.material !== undefined) {
    const material = requireRecord(control.material, "reader shell control patch.material")
    const unknown = Object.keys(material).filter((key) => !["preset", "opacity", "blur", "saturation", "highlight", "shadow"].includes(key))
    if (unknown.length) throw new Error(`reader shell control patch.material contains unsupported fields: ${unknown.join(", ")}.`)
    materialPatch = {}
    if (material.preset !== undefined) {
      materialPatch.preset = optionalEnum(material.preset, "material.preset", ["solid", "soft", "frosted", "custom"] as const)
    }
    if (material.opacity !== undefined) materialPatch.opacity = shellSurfaceNumberPatch(material.opacity, "material.opacity", 0, 100)
    if (material.blur !== undefined) materialPatch.blur = shellSurfaceNumberPatch(material.blur, "material.blur", 0, 20)
    if (material.saturation !== undefined) materialPatch.saturation = shellSurfaceNumberPatch(material.saturation, "material.saturation", 50, 180)
    if (material.highlight !== undefined) materialPatch.highlight = shellSurfaceNumberPatch(material.highlight, "material.highlight", 0, 100)
    if (material.shadow !== undefined) materialPatch.shadow = shellSurfaceNumberPatch(material.shadow, "material.shadow", 0, 100)
    if (!Object.keys(materialPatch).length) throw new Error("reader shell control patch.material must change at least one field.")
    patch.shellControl.material = materialPatch
  }
  if (!patch.shellControl.floating && !patch.shellControl.edges && !patch.shellControl.sidebarInteraction && !patch.shellControl.workspace && !patch.shellControl.material)
    throw new Error("reader shell control patch must change at least one field.")
  return {
    patch,
    tomlPatch: shellControlTomlPatch(floatingPatch, edgePatches, sidebarInteractionPatch, workspacePatch, materialPatch),
  }
}
export const NEOVIEW_SHELL_EDGES = ["top", "right", "bottom", "left"] as const
export type NeoviewShellEdge = (typeof NEOVIEW_SHELL_EDGES)[number]
export const NEOVIEW_SHELL_SURFACES = ["top", "bottom", "sidebar"] as const
export function normalizedSwimlaneOrder(
  value: unknown,
  fallback: readonly Models.NeoviewSwimlaneId[],
  path: string,
  _strict = false,
): Models.NeoviewSwimlaneId[] {
  if (value === undefined) return [...fallback]
  const source = requiredStringArray(value, path)
  const order = source
    .map((laneId) => requireLayoutId(laneId, path))
    .filter((laneId, index, lanes) => lanes.indexOf(laneId) === index)
  if (order.length > 32) throw new Error(`${path} cannot contain more than 32 lanes.`)
  for (const laneId of Models.NEOVIEW_SWIMLANE_IDS) if (!order.includes(laneId)) order.push(laneId)
  return order
}
export function swimlaneWidth(value: unknown, laneId: Models.NeoviewSwimlaneId, path: string, fallback = laneId === "reader" ? 960 : laneId === "right" ? 280 : 320): number {
  return boundedNumber(value, laneId === "reader" ? 120 : 240, 8_192, fallback, path)
}
export function readerWidthRatio(value: unknown, path: string, fallback = 0.5): number {
  return boundedNumber(value, 0.25, 1, fallback, path)
}
export function revealZone(value: unknown, path: string, fallback: Models.NeoviewSwimlaneRevealZone): Models.NeoviewSwimlaneRevealZone {
  const source = requireRecord(value, path)
  const unknown = Object.keys(source).filter((key) => !["x", "y", "width", "height"].includes(key))
  if (unknown.length) throw new Error(`${path} contains unsupported fields: ${unknown.join(", ")}.`)
  const x = boundedNumber(source.x, 0, 99, fallback.x, `${path}.x`)
  const y = boundedNumber(source.y, 0, 99, fallback.y, `${path}.y`)
  return {
    x,
    y,
    width: boundedNumber(source.width, 1, 100 - x, Math.min(fallback.width, 100 - x), `${path}.width`),
    height: boundedNumber(source.height, 1, 100 - y, Math.min(fallback.height, 100 - y), `${path}.height`),
  }
}
export function readerFocusHoverDelay(value: unknown, path: string, fallback = 650): number {
  if (value === undefined) return fallback
  return boundedInteger(value, 200, 5_000, path)
}
export function edgeRevealDelay(value: unknown, path: string, fallback = 180): number {
  if (value === undefined) return fallback
  return boundedInteger(value, 100, 5_000, path)
}
export function shellSurfaceNumberPatch(value: unknown, label: string, minimum: number, maximum: number): Partial<Models.NeoviewShellSurfaceValues> {
  const source = requireRecord(value, label)
  const unknown = Object.keys(source).filter((key) => !NEOVIEW_SHELL_SURFACES.includes(key as Models.NeoviewShellSurface))
  if (unknown.length) throw new Error(`${label} contains unsupported surfaces: ${unknown.join(", ")}.`)
  const result: Partial<Models.NeoviewShellSurfaceValues> = {}
  for (const surface of NEOVIEW_SHELL_SURFACES) {
    if (source[surface] !== undefined) result[surface] = boundedNumber(source[surface], minimum, maximum, minimum, `${label}.${surface}`)
  }
  if (!Object.keys(result).length) throw new Error(`${label} must change at least one surface.`)
  return result
}
export function shellControlTomlPatch(
  floating: Partial<Models.NeoviewShellFloatingControlConfig> | undefined,
  edges: Partial<Record<NeoviewShellEdge, Partial<Models.NeoviewShellEdgeConfig>>> | undefined,
  sidebarInteraction: Partial<Models.NeoviewShellSidebarInteractionConfig> | undefined,
  workspace: Models.NeoviewShellControlPatch["shellControl"]["workspace"] | undefined,
  material: Models.NeoviewShellMaterialPatch | undefined,
): Record<string, unknown> {
  const panels: Record<string, unknown> = {}
  if (floating) {
    const value: Record<string, unknown> = {}
    if (floating.enabled !== undefined) value.enabled = floating.enabled
    if (floating.position !== undefined) value.position = { x: floating.position.x, y: floating.position.y }
    panels.sidebar_control = value
  }
  if (edges) {
    panels.edges = Object.fromEntries(
      Object.entries(edges).map(([edge, source]) => {
        const value: Record<string, unknown> = {}
        if (source.enabled !== undefined) value.enabled = source.enabled
        if (source.initialVisible !== undefined) value.initial_visible = source.initialVisible
        if (source.pinned !== undefined) value.pinned = source.pinned
        if (source.triggerSize !== undefined) value.trigger_size = source.triggerSize
        if (source.lockMode !== undefined) value.lock_mode = source.lockMode
        return [edge, value]
      }),
    )
  }
  if (sidebarInteraction) {
    const value: Record<string, unknown> = {}
    if (sidebarInteraction.showDragHandle !== undefined) value.show_drag_handle = sidebarInteraction.showDragHandle
    if (sidebarInteraction.enableBlankAreaCollapse !== undefined) value.enable_blank_area_collapse = sidebarInteraction.enableBlankAreaCollapse
    if (sidebarInteraction.blankAreaCollapseMode !== undefined) value.blank_area_collapse_mode = sidebarInteraction.blankAreaCollapseMode
    panels.sidebar_interaction = value
  }
  if (workspace) {
    if (workspace.mode !== undefined) panels.layout_mode = workspace.mode
    const value: Record<string, unknown> = {}
    if (workspace.laneOrder !== undefined) value.lane_order = workspace.laneOrder
    // activeLane, readerSolo and soloLaneId are accepted for old clients but
    // belong to the per-instance frontend session and must not re-enter TOML.
    if (workspace.readerSoloOnFocus !== undefined) value.reader_solo_on_focus = workspace.readerSoloOnFocus
    if (workspace.readerWidthRatio !== undefined) value.reader_width_ratio = workspace.readerWidthRatio
    if (workspace.edgeRevealDelayMs !== undefined) value.edge_reveal_delay_ms = workspace.edgeRevealDelayMs
    if (workspace.edgeRevealZones !== undefined) {
      value.left_reveal_zone = workspace.edgeRevealZones.left
      value.right_reveal_zone = workspace.edgeRevealZones.right
      value.top_reveal_zone = workspace.edgeRevealZones.top
      value.bottom_reveal_zone = workspace.edgeRevealZones.bottom
    }
    if (workspace.readerFocusOnHover !== undefined) value.reader_focus_on_hover = workspace.readerFocusOnHover
    if (workspace.readerFocusHoverDelayMs !== undefined) value.reader_focus_hover_delay_ms = workspace.readerFocusHoverDelayMs
    if (workspace.manualScrollEnabled !== undefined) value.manual_scroll_enabled = workspace.manualScrollEnabled
    if (workspace.showLaneNavigatorInReaderSolo !== undefined) value.show_lane_navigator_in_reader_solo = workspace.showLaneNavigatorInReaderSolo
    if (workspace.autoFitToViewport !== undefined) value.auto_fit_to_viewport = workspace.autoFitToViewport
    if (workspace.barHandleStyle !== undefined) value.bar_handle_style = workspace.barHandleStyle
    if (workspace.barHandlePosition !== undefined) value.bar_handle_position = workspace.barHandlePosition
    if (workspace.laneNavigatorPositionX !== undefined) value.lane_navigator_position_x = workspace.laneNavigatorPositionX
    if (workspace.laneNavigatorPositionY !== undefined) value.lane_navigator_position_y = workspace.laneNavigatorPositionY
    if (workspace.laneNavigatorDock !== undefined) value.lane_navigator_dock = workspace.laneNavigatorDock
    if (workspace.windowControlsPlacement !== undefined) value.window_controls_placement = workspace.windowControlsPlacement
    if (workspace.windowControlsOwnerLaneId !== undefined) value.window_controls_owner_lane_id = workspace.windowControlsOwnerLaneId
    if (workspace.windowControlsExpanded !== undefined) value.window_controls_expanded = workspace.windowControlsExpanded
    if (workspace.lanes !== undefined) {
      for (const [laneId, source] of Object.entries(workspace.lanes)) {
        if (!source) continue
        const lane: Record<string, unknown> = {}
        if (source.width !== undefined) lane.width = source.width
        if (source.landscapeWidth !== undefined) lane.landscape_width = source.landscapeWidth
        if (source.portraitWidth !== undefined) lane.portrait_width = source.portraitWidth
        if (source.landscapeReaderSoloWidth !== undefined) lane.landscape_reader_solo_width = source.landscapeReaderSoloWidth
        if (source.portraitReaderSoloWidth !== undefined) lane.portrait_reader_solo_width = source.portraitReaderSoloWidth
        if (source.collapsed !== undefined) lane.collapsed = source.collapsed
        if (source.title !== undefined) lane.title = source.title
        if (source.activePanelId !== undefined) lane.active_panel_id = source.activePanelId
        if (source.panelBarMode !== undefined) lane.panel_bar_mode = source.panelBarMode
        if (source.panelBarDock !== undefined) lane.panel_bar_dock = source.panelBarDock
        if (source.panelBarPositionX !== undefined) lane.panel_bar_position_x = source.panelBarPositionX
        if (source.panelBarPositionY !== undefined) lane.panel_bar_position_y = source.panelBarPositionY
        if (source.panelBarConstrained !== undefined) lane.panel_bar_constrained = source.panelBarConstrained
        value[laneId] = lane
      }
    }
    if (Object.keys(value).length) panels.swimlane = value
  }
  if (material) {
    if (material.opacity) {
      if (material.opacity.top !== undefined) panels.top_toolbar_opacity = material.opacity.top
      if (material.opacity.bottom !== undefined) panels.bottom_bar_opacity = material.opacity.bottom
      if (material.opacity.sidebar !== undefined) panels.sidebar_opacity = material.opacity.sidebar
    }
    if (material.blur) {
      if (material.blur.top !== undefined) panels.top_toolbar_blur = material.blur.top
      if (material.blur.bottom !== undefined) panels.bottom_bar_blur = material.blur.bottom
      if (material.blur.sidebar !== undefined) panels.sidebar_blur = material.blur.sidebar
    }
    const value: Record<string, unknown> = {}
    if (material.preset !== undefined) value.preset = material.preset
    for (const key of ["saturation", "highlight", "shadow"] as const) {
      const values = material[key]
      if (!values) continue
      for (const surface of NEOVIEW_SHELL_SURFACES) {
        if (values[surface] !== undefined) value[`${surface}_${key}`] = values[surface]
      }
    }
    if (Object.keys(value).length) panels.material = value
  }
  return Object.keys(panels).length ? { panels } : {}
}
export function parseNeoviewSidebarLayoutPatch(value: unknown): {
  patch: Models.NeoviewSidebarLayoutPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader shell patch")
  const allowed = new Set(["side", "pinned", "width", "height", "customHeight", "verticalAlign", "horizontalPosition"])
  const unknown = Object.keys(record).filter((key) => !allowed.has(key))
  if (unknown.length) throw new Error(`reader shell patch contains unsupported fields: ${unknown.join(", ")}.`)
  const side = optionalEnum(record.side, "reader shell patch.side", ["left", "right"] as const)
  if (!side) throw new Error("reader shell patch.side is required.")
  const patch: Models.NeoviewSidebarLayoutPatch = { side }
  if (record.pinned !== undefined) patch.pinned = optionalBoolean(record.pinned, "reader shell patch.pinned")
  if (record.width !== undefined) patch.width = boundedNumber(record.width, 200, 600, 320, "reader shell patch.width")
  if (record.height !== undefined) patch.height = sidebarHeight(record.height, "reader shell patch.height")
  if (record.customHeight !== undefined) patch.customHeight = boundedNumber(record.customHeight, 10, 100, 100, "reader shell patch.customHeight")
  if (record.verticalAlign !== undefined) patch.verticalAlign = boundedNumber(record.verticalAlign, 0, 100, 0, "reader shell patch.verticalAlign")
  if (record.horizontalPosition !== undefined)
    patch.horizontalPosition = boundedNumber(record.horizontalPosition, 0, 100, 0, "reader shell patch.horizontalPosition")
  if (Object.keys(patch).length === 1) throw new Error("reader shell patch must change at least one layout field.")
  const sidePatch: Record<string, unknown> = {}
  if (patch.pinned !== undefined) sidePatch.pinned = patch.pinned
  if (patch.width !== undefined) sidePatch.width = patch.width
  if (patch.height !== undefined) sidePatch.height = patch.height === "two-thirds" ? "2/3" : patch.height === "one-third" ? "1/3" : patch.height
  if (patch.customHeight !== undefined) sidePatch.custom_height = patch.customHeight
  if (patch.verticalAlign !== undefined) sidePatch.vertical_align = patch.verticalAlign
  if (patch.horizontalPosition !== undefined) sidePatch.horizontal_position = patch.horizontalPosition
  const panelsPatch: Record<string, unknown> = {
    sidebars: { [side]: sidePatch },
  }
  if (patch.pinned !== undefined) panelsPatch.edges = { [side]: { pinned: patch.pinned } }
  return { patch, tomlPatch: { panels: panelsPatch } }
}
export function parseNeoviewCardLayoutPatch(value: unknown): {
  patch: Models.NeoviewCardLayoutPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader card patch")
  const allowed = new Set(["cardId", "panelId", "visible", "expanded", "order", "height"])
  const unknown = Object.keys(record).filter((key) => !allowed.has(key))
  if (unknown.length) throw new Error(`reader card patch contains unsupported fields: ${unknown.join(", ")}.`)
  if (typeof record.cardId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(record.cardId)) {
    throw new Error("reader card patch.cardId is invalid.")
  }
  const patch: Models.NeoviewCardLayoutPatch = { cardId: record.cardId }
  if (record.panelId !== undefined) {
    if (typeof record.panelId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(record.panelId))
      throw new Error("reader card patch.panelId is invalid.")
    patch.panelId = record.panelId
  }
  if (record.visible !== undefined) patch.visible = optionalBoolean(record.visible, "reader card patch.visible")
  if (record.expanded !== undefined) patch.expanded = optionalBoolean(record.expanded, "reader card patch.expanded")
  if (record.order !== undefined) patch.order = boundedNumber(record.order, 0, 10_000, 0, "reader card patch.order")
  if (record.height === null) patch.height = null
  else if (record.height !== undefined) patch.height = boundedNumber(record.height, 50, 4_096, 50, "reader card patch.height")
  if (Object.keys(patch).length === 1) throw new Error("reader card patch must change at least one field.")
  const manifest = READER_CARD_MANIFEST_BY_ID.get(patch.cardId)
  if (manifest && patch.visible === false && !manifest.canHide) throw new Error(`reader card patch cannot hide card ${patch.cardId}.`)
  if (patch.panelId && !readerCardCanMoveTo(patch.cardId, patch.panelId)) {
    throw new Error(`reader card patch cannot place card ${patch.cardId} in panel ${patch.panelId}.`)
  }
  const state: Record<string, unknown> = {}
  if (patch.panelId !== undefined) state.panel_id = patch.panelId
  if (patch.visible !== undefined) state.visible = patch.visible
  if (patch.expanded !== undefined) state.expanded = patch.expanded
  if (patch.order !== undefined) state.order = patch.order
  if (patch.height !== undefined) state.height = patch.height === null ? "auto" : patch.height
  return {
    patch,
    tomlPatch: { panels: { card_state: { [patch.cardId]: state } } },
  }
}
export function parseNeoviewBoardLayoutPatch(value: unknown): {
  patch: Models.NeoviewBoardLayoutPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader board patch")
  if (Object.keys(record).some((key) => key !== "board" && key !== "expectedRevision")) throw new Error("reader board patch contains unsupported fields.")
  const expectedRevision = boundedInteger(record.expectedRevision, 0, Number.MAX_SAFE_INTEGER, "reader board patch.expectedRevision")
  const board = requireRecord(record.board, "reader board patch.board")
  if (Object.keys(board).some((key) => key !== "panels" && key !== "cards")) throw new Error("reader board patch.board contains unsupported fields.")
  if (!Array.isArray(board.panels) || !Array.isArray(board.cards)) throw new Error("reader board patch requires panels and cards arrays.")
  if (board.panels.length > 128 || board.cards.length > 512) throw new Error("reader board patch exceeds the layout item limit.")
  const panelIds = new Set<string>()
  const panels = board.panels.map((value, index) => {
    const item = requireRecord(value, `reader board patch.panels[${index}]`)
    const id = requireLayoutId(item.id, `reader board patch.panels[${index}].id`)
    if (panelIds.has(id)) throw new Error(`reader board patch contains duplicate panel ${id}.`)
    panelIds.add(id)
    return {
      id,
      visible: requiredBoolean(item.visible, `${id}.visible`),
      order: boundedNumber(item.order, 0, 10_000, 0, `${id}.order`),
      position: optionalEnum(item.position, `${id}.position`, ["left", "right", "bottom", "floating"] as const) ?? "left",
    }
  })
  const cardIds = new Set<string>()
  const cards = board.cards.map((value, index) => {
    const item = requireRecord(value, `reader board patch.cards[${index}]`)
    const cardId = requireLayoutId(item.cardId, `reader board patch.cards[${index}].cardId`)
    if (cardIds.has(cardId)) throw new Error(`reader board patch contains duplicate card ${cardId}.`)
    cardIds.add(cardId)
    return {
      cardId,
      panelId: requireLayoutId(item.panelId, `${cardId}.panelId`),
      visible: requiredBoolean(item.visible, `${cardId}.visible`),
      order: boundedNumber(item.order, 0, 10_000, 0, `${cardId}.order`),
    }
  })
  const panelById = new Map(panels.map((panel) => [panel.id, panel]))
  const visibleCardsByPanel = new Map<string, Array<(typeof cards)[number]>>()
  for (const card of cards) {
    const manifest = READER_CARD_MANIFEST_BY_ID.get(card.cardId)
    if (!manifest) continue
    if (!card.visible && !manifest.canHide) throw new Error(`reader board patch cannot hide card ${card.cardId}.`)
    if (!card.visible) continue
    const panel = panelById.get(card.panelId)
    if (!panel) throw new Error(`reader board patch card ${card.cardId} references missing panel ${card.panelId}.`)
    if (panel.position !== "left" && panel.position !== "right") {
      throw new Error(`reader board patch card ${card.cardId} cannot be placed in a ${panel.position} panel.`)
    }
    const panelCards = visibleCardsByPanel.get(card.panelId) ?? []
    panelCards.push(card)
    visibleCardsByPanel.set(card.panelId, panelCards)
  }
  for (const [panelId, panelCards] of visibleCardsByPanel) {
    if (panelCards.length < 2) continue
    const exclusiveCard = panelCards.find((card) => READER_CARD_MANIFEST_BY_ID.get(card.cardId)?.exclusivePanel)
    if (exclusiveCard) {
      throw new Error(`reader board patch card ${exclusiveCard.cardId} requires exclusive panel ${panelId}.`)
    }
  }
  const panelState = Object.fromEntries(panels.map(({ id, ...state }) => [id, state]))
  const cardState = Object.fromEntries(cards.map(({ cardId, panelId, ...state }) => [cardId, { ...state, panel_id: panelId }]))
  return {
    patch: { expectedRevision, board: { panels, cards } },
    tomlPatch: { panels: { panel_state: panelState, card_state: cardState } },
  }
}
export function shellEdgeLockMode(value: unknown, path: string): Models.NeoviewShellEdgeLockMode {
  return optionalEnum(value, path, ["auto", "locked-open", "locked-hidden"] as const) ?? "auto"
}
export function sidebarHeight(value: unknown, path: string): Models.NeoviewShellSidebarConfig["height"] {
  if (value === undefined) return "full"
  if (value === "2/3") return "two-thirds"
  if (value === "1/3") return "one-third"
  return optionalEnum(value, path, ["full", "two-thirds", "half", "one-third", "custom"] as const) ?? "full"
}
