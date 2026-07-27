import { DEFAULT_NEOVIEW_SHELL_CONFIG } from "@xiranite/node-neoview/ui-core"

import type { ReaderShellConfigDto } from "../adapters/reader-http-client"

const SHELL_EDGES = ["top", "right", "bottom", "left"] as const
const SHELL_SURFACES = ["top", "bottom", "sidebar"] as const

export function createInitialReaderShellConfig(snapshot: unknown): ReaderShellConfigDto {
  const restored = normalizeReaderShellSnapshot(snapshot)
  if (restored) return restored
  const fallback = structuredClone(DEFAULT_NEOVIEW_SHELL_CONFIG)
  fallback.workspace.mode = "swimlane"
  return fallback
}

export function normalizeReaderShellSnapshot(value: unknown): ReaderShellConfigDto | undefined {
  if (!isRecord(value)
    || !optionalNonNegativeInteger(value.revision)
    || !finiteNumber(value.showDelayMs)
    || !finiteNumber(value.hideDelayMs)
    || !surfaceValues(value.opacity)
    || !surfaceValues(value.blur)
    || !optionalMaterial(value.material)
    || !edgeMap(value.edges)
    || !optionalFloatingControl(value.floatingControl)
    || !sidebars(value.sidebars)
    || !optionalSidebarInteraction(value.sidebarInteraction)
    || !optionalWorkspace(value.workspace)
    || !panelLayout(value.panelLayout)
    || !cardLayout(value.cardLayout)) return undefined
  return structuredClone(value) as ReaderShellConfigDto
}

export function readerShellSnapshotsEqual(
  left: ReaderShellConfigDto | undefined,
  right: ReaderShellConfigDto,
): boolean {
  if (!left) return false
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

function edgeMap(value: unknown): boolean {
  return isRecord(value) && SHELL_EDGES.every((edge) => {
    const item = value[edge]
    return isRecord(item)
      && typeof item.enabled === "boolean"
      && typeof item.initialVisible === "boolean"
      && typeof item.pinned === "boolean"
      && finiteNumber(item.triggerSize)
      && optionalEnum(item.lockMode, ["auto", "locked-open", "locked-hidden"])
  })
}

function sidebars(value: unknown): boolean {
  return isRecord(value) && ["left", "right"].every((side) => {
    const item = value[side]
    return isRecord(item)
      && finiteNumber(item.width)
      && enumValue(item.height, ["full", "two-thirds", "half", "one-third", "custom"])
      && finiteNumber(item.customHeight)
      && finiteNumber(item.verticalAlign)
      && finiteNumber(item.horizontalPosition)
  })
}

function optionalWorkspace(value: unknown): boolean {
  if (value === undefined) return true
  if (!isRecord(value) || !enumValue(value.mode, ["edges", "swimlane"]) || !isRecord(value.swimlane)) return false
  const swimlane = value.swimlane
  if (!Array.isArray(swimlane.laneOrder)
    || swimlane.laneOrder.length === 0
    || !swimlane.laneOrder.every(nonEmptyString)
    || !nonEmptyString(swimlane.activeLane)
    || typeof swimlane.readerSolo !== "boolean"
    || typeof swimlane.readerSoloOnFocus !== "boolean"
    || !optionalNonEmptyString(swimlane.soloLaneId)
    || !finiteNumber(swimlane.readerWidthRatio)
    || !finiteNumber(swimlane.edgeRevealDelayMs)
    || !revealZones(swimlane.edgeRevealZones)
    || typeof swimlane.readerFocusOnHover !== "boolean"
    || !finiteNumber(swimlane.readerFocusHoverDelayMs)
    || typeof swimlane.manualScrollEnabled !== "boolean"
    || typeof swimlane.showLaneNavigatorInReaderSolo !== "boolean"
    || typeof swimlane.autoFitToViewport !== "boolean"
    || !enumValue(swimlane.barHandleStyle, ["grip", "groove", "move", "grab", "edge"])
    || !enumValue(swimlane.barHandlePosition, ["left", "right"])
    || !finiteNumber(swimlane.laneNavigatorPositionX)
    || !finiteNumber(swimlane.laneNavigatorPositionY)
    || !enumValue(swimlane.laneNavigatorDock, ["floating", "reader-title", "window-title"])
    || !optionalEnum(swimlane.windowControlsPlacement, ["lane", "titlebar"])
    || !optionalNonEmptyString(swimlane.windowControlsOwnerLaneId)
    || !optionalBoolean(swimlane.windowControlsExpanded)
    || !isRecord(swimlane.lanes)
    || !lane(swimlane.lanes.reader)) return false
  return swimlane.laneOrder.every((laneId) => lane(swimlane.lanes[laneId]))
}

function lane(value: unknown): boolean {
  return isRecord(value)
    && finiteNumber(value.width)
    && optionalFiniteNumber(value.landscapeWidth)
    && optionalFiniteNumber(value.portraitWidth)
    && optionalFiniteNumber(value.landscapeReaderSoloWidth)
    && optionalFiniteNumber(value.portraitReaderSoloWidth)
    && typeof value.collapsed === "boolean"
    && optionalNonEmptyString(value.title)
    && optionalNonEmptyString(value.activePanelId)
    && optionalEnum(value.panelBarMode, ["pinned", "floating"])
    && optionalEnum(value.panelBarDock, ["left", "right", "top", "bottom"])
    && optionalFiniteNumber(value.panelBarPositionX)
    && optionalFiniteNumber(value.panelBarPositionY)
    && optionalBoolean(value.panelBarConstrained)
}

function revealZones(value: unknown): boolean {
  return isRecord(value) && SHELL_EDGES.every((edge) => {
    const zone = value[edge]
    return isRecord(zone)
      && finiteNumber(zone.x)
      && finiteNumber(zone.y)
      && finiteNumber(zone.width)
      && finiteNumber(zone.height)
  })
}

function panelLayout(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every((item) => isRecord(item)
    && typeof item.visible === "boolean"
    && finiteNumber(item.order)
    && enumValue(item.position, ["left", "right", "bottom", "floating"]))
}

function cardLayout(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every((item) => isRecord(item)
    && nonEmptyString(item.panelId)
    && typeof item.visible === "boolean"
    && typeof item.expanded === "boolean"
    && finiteNumber(item.order)
    && optionalFiniteNumber(item.height))
}

function optionalFloatingControl(value: unknown): boolean {
  return value === undefined || (isRecord(value)
    && typeof value.enabled === "boolean"
    && isRecord(value.position)
    && finiteNumber(value.position.x)
    && finiteNumber(value.position.y))
}

function optionalSidebarInteraction(value: unknown): boolean {
  return value === undefined || (isRecord(value)
    && typeof value.showDragHandle === "boolean"
    && typeof value.enableBlankAreaCollapse === "boolean"
    && enumValue(value.blankAreaCollapseMode, ["single", "double"]))
}

function optionalMaterial(value: unknown): boolean {
  return value === undefined || (isRecord(value)
    && enumValue(value.preset, ["solid", "soft", "frosted", "custom"])
    && surfaceValues(value.saturation)
    && surfaceValues(value.highlight)
    && surfaceValues(value.shadow))
}

function surfaceValues(value: unknown): boolean {
  return isRecord(value) && SHELL_SURFACES.every((surface) => finiteNumber(value[surface]))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function optionalFiniteNumber(value: unknown): boolean {
  return value === undefined || finiteNumber(value)
}

function optionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined || (Number.isInteger(value) && (value as number) >= 0)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function optionalNonEmptyString(value: unknown): boolean {
  return value === undefined || nonEmptyString(value)
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean"
}

function enumValue<const Value extends string>(value: unknown, options: readonly Value[]): value is Value {
  return typeof value === "string" && options.includes(value as Value)
}

function optionalEnum<const Value extends string>(value: unknown, options: readonly Value[]): boolean {
  return value === undefined || enumValue(value, options)
}
