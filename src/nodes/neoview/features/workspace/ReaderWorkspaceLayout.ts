import type {
  ReaderShellConfigDto,
  ReaderShellControlPatch,
  ReaderSwimlaneId,
} from "../../adapters/reader-http-client"
import { reorderSwimlanes } from "@/components/workspace/swimlane/model"

export type ReaderWorkspaceConfig = NonNullable<ReaderShellConfigDto["workspace"]>
export type ReaderWorkspacePatch = NonNullable<ReaderShellControlPatch["shellControl"]["workspace"]>

const LANE_ORDER: readonly ReaderSwimlaneId[] = ["left", "reader", "right"]
export const MIN_READER_WIDTH_RATIO = 0.25
export const MAX_READER_WIDTH_RATIO = 1
const LEGACY_READER_REFERENCE_WIDTH = 1_920
const DEFAULT_READER_WIDTH_RATIO = 0.5
const DEFAULT_EDGE_REVEAL_DELAY_MS = 180
const DEFAULT_READER_FOCUS_HOVER_DELAY_MS = 650
const DEFAULT_SHOW_LANE_NAVIGATOR_IN_READER_SOLO = false
const DEFAULT_BAR_HANDLE_STYLE = "grip" as const
const DEFAULT_BAR_HANDLE_POSITION = "left" as const
const DEFAULT_LANE_NAVIGATOR_POSITION = { x: 92, y: 96 } as const
const DEFAULT_EDGE_REVEAL_ZONES = {
  left: { x: 0, y: 10, width: 1, height: 80 },
  right: { x: 99, y: 10, width: 1, height: 80 },
  top: { x: 10, y: 0, width: 80, height: 1 },
  bottom: { x: 10, y: 99, width: 80, height: 1 },
} as const

export function readerWorkspaceConfig(shell: ReaderShellConfigDto): ReaderWorkspaceConfig {
  const workspace = shell.workspace
  if (workspace) {
    const laneOrder = normalizeLaneOrder(workspace.swimlane.laneOrder)
    return {
      mode: workspace.mode,
      swimlane: {
        laneOrder,
        activeLane: normalizeLaneId(workspace.swimlane.activeLane, laneOrder),
        readerSolo: workspace.swimlane.readerSolo,
        readerSoloOnFocus: workspace.swimlane.readerSoloOnFocus ?? true,
        ...(workspace.swimlane.soloLaneId && laneOrder.includes(workspace.swimlane.soloLaneId) ? { soloLaneId: workspace.swimlane.soloLaneId } : {}),
        readerWidthRatio: normalizeReaderWidthRatio(workspace.swimlane.readerWidthRatio, workspace.swimlane.lanes.reader.width),
        edgeRevealDelayMs: normalizeEdgeRevealDelay(workspace.swimlane.edgeRevealDelayMs),
        edgeRevealZones: normalizeRevealZones(workspace.swimlane.edgeRevealZones),
        readerFocusOnHover: workspace.swimlane.readerFocusOnHover ?? true,
        readerFocusHoverDelayMs: normalizeReaderFocusHoverDelay(workspace.swimlane.readerFocusHoverDelayMs),
        showLaneNavigatorInReaderSolo: workspace.swimlane.showLaneNavigatorInReaderSolo ?? DEFAULT_SHOW_LANE_NAVIGATOR_IN_READER_SOLO,
        autoFitToViewport: workspace.swimlane.autoFitToViewport ?? false,
        barHandleStyle: normalizeBarHandleStyle(workspace.swimlane.barHandleStyle),
        barHandlePosition: normalizeBarHandlePosition(workspace.swimlane.barHandlePosition),
        laneNavigatorPositionX: clampPercent(workspace.swimlane.laneNavigatorPositionX, DEFAULT_LANE_NAVIGATOR_POSITION.x),
        laneNavigatorPositionY: clampPercent(workspace.swimlane.laneNavigatorPositionY, DEFAULT_LANE_NAVIGATOR_POSITION.y),
        laneNavigatorDock: workspace.swimlane.laneNavigatorDock === "reader-title" ? "reader-title" : "floating",
        lanes: Object.fromEntries(laneOrder.map((laneId) => [
          laneId,
          normalizeLane(
            laneId,
            workspace.swimlane.lanes[laneId],
            laneId === "left" ? shell.sidebars.left.width : laneId === "right" ? shell.sidebars.right.width : laneId === "reader" ? 960 : 320,
            laneId === "left" ? "folder" : laneId === "right" ? "info" : undefined,
          ),
        ])),
      },
    }
  }
  return {
    mode: "edges",
    swimlane: {
      laneOrder: [...LANE_ORDER],
      activeLane: "reader",
      readerSolo: true,
      readerSoloOnFocus: true,
      readerWidthRatio: DEFAULT_READER_WIDTH_RATIO,
      edgeRevealDelayMs: DEFAULT_EDGE_REVEAL_DELAY_MS,
      edgeRevealZones: normalizeRevealZones(),
      readerFocusOnHover: true,
      readerFocusHoverDelayMs: DEFAULT_READER_FOCUS_HOVER_DELAY_MS,
      showLaneNavigatorInReaderSolo: DEFAULT_SHOW_LANE_NAVIGATOR_IN_READER_SOLO,
      autoFitToViewport: false,
      barHandleStyle: DEFAULT_BAR_HANDLE_STYLE,
      barHandlePosition: DEFAULT_BAR_HANDLE_POSITION,
      laneNavigatorPositionX: DEFAULT_LANE_NAVIGATOR_POSITION.x,
      laneNavigatorPositionY: DEFAULT_LANE_NAVIGATOR_POSITION.y,
      laneNavigatorDock: "floating",
      lanes: {
        left: { width: shell.sidebars.left.width, collapsed: false, activePanelId: "folder", ...defaultPanelBar("left") },
        reader: { width: 960, collapsed: false },
        right: { width: shell.sidebars.right.width, collapsed: false, activePanelId: "info", ...defaultPanelBar("right") },
      },
    },
  }
}

export function applyReaderWorkspacePatch(shell: ReaderShellConfigDto, patch: ReaderWorkspacePatch): ReaderShellConfigDto {
  const current = readerWorkspaceConfig(shell)
  const soloLaneId = patch.soloLaneId === null ? undefined : patch.soloLaneId ?? current.swimlane.soloLaneId
  const next: ReaderWorkspaceConfig = {
    mode: patch.mode ?? current.mode,
    swimlane: {
      laneOrder: patch.laneOrder ? normalizeLaneOrder(patch.laneOrder) : current.swimlane.laneOrder,
      activeLane: patch.activeLane ? normalizeLaneId(patch.activeLane, patch.laneOrder ?? current.swimlane.laneOrder) : current.swimlane.activeLane,
      readerSolo: patch.readerSolo ?? current.swimlane.readerSolo,
      readerSoloOnFocus: patch.readerSoloOnFocus ?? current.swimlane.readerSoloOnFocus,
      ...(soloLaneId ? { soloLaneId } : {}),
      readerWidthRatio: patch.readerWidthRatio === undefined
        ? current.swimlane.readerWidthRatio
        : normalizeReaderWidthRatio(patch.readerWidthRatio),
      edgeRevealDelayMs: patch.edgeRevealDelayMs === undefined
        ? current.swimlane.edgeRevealDelayMs
        : normalizeEdgeRevealDelay(patch.edgeRevealDelayMs),
      edgeRevealZones: patch.edgeRevealZones === undefined
        ? current.swimlane.edgeRevealZones
        : normalizeRevealZones(patch.edgeRevealZones),
      readerFocusOnHover: patch.readerFocusOnHover ?? current.swimlane.readerFocusOnHover,
      readerFocusHoverDelayMs: patch.readerFocusHoverDelayMs === undefined
        ? current.swimlane.readerFocusHoverDelayMs
        : normalizeReaderFocusHoverDelay(patch.readerFocusHoverDelayMs),
      showLaneNavigatorInReaderSolo: patch.showLaneNavigatorInReaderSolo ?? current.swimlane.showLaneNavigatorInReaderSolo,
      autoFitToViewport: patch.autoFitToViewport ?? current.swimlane.autoFitToViewport,
      barHandleStyle: patch.barHandleStyle === undefined ? current.swimlane.barHandleStyle : normalizeBarHandleStyle(patch.barHandleStyle),
      barHandlePosition: patch.barHandlePosition === undefined ? current.swimlane.barHandlePosition : normalizeBarHandlePosition(patch.barHandlePosition),
      laneNavigatorPositionX: clampPercent(patch.laneNavigatorPositionX, current.swimlane.laneNavigatorPositionX),
      laneNavigatorPositionY: clampPercent(patch.laneNavigatorPositionY, current.swimlane.laneNavigatorPositionY),
      laneNavigatorDock: patch.laneNavigatorDock === undefined ? current.swimlane.laneNavigatorDock : patch.laneNavigatorDock === "reader-title" ? "reader-title" : "floating",
      lanes: mergeLanePatches(current.swimlane.lanes, patch.lanes),
    },
  }
  return { ...shell, workspace: next }
}

export function reorderedReaderLanes(
  order: readonly ReaderSwimlaneId[],
  dragged: ReaderSwimlaneId,
  target: ReaderSwimlaneId,
): ReaderSwimlaneId[] {
  if (dragged === target) return normalizeLaneOrder(order)
  return reorderSwimlanes(normalizeLaneOrder(order), dragged, target)
}

export function readerLaneWidth(viewportWidth: number, ratio: number): number {
  return Math.max(1, Math.round(viewportWidth * normalizeReaderWidthRatio(ratio)))
}

export function fitReaderSwimlanesToViewport(
  viewportWidth: number,
  swimlane: ReaderWorkspaceConfig["swimlane"],
): ReaderWorkspacePatch {
  const width = Math.max(1, Math.round(viewportWidth))
  const collapsed = swimlane.laneOrder.filter((laneId) => swimlane.lanes[laneId].collapsed)
  const expanded = swimlane.laneOrder.filter((laneId) => !collapsed.includes(laneId))
  const available = Math.max(expanded.length, width - collapsed.length * 44)
  const lanes: NonNullable<ReaderWorkspacePatch["lanes"]> = {}
  const weightedWidth = (laneId: ReaderSwimlaneId) => laneId === "reader"
    ? readerLaneWidth(width, swimlane.readerWidthRatio)
    : Math.max(1, swimlane.lanes[laneId].width)
  const readerExpanded = expanded.includes("reader")
  if (readerExpanded) {
    const totalWeight = expanded.reduce((sum, laneId) => sum + weightedWidth(laneId), 0)
    const readerMinimum = Math.min(available, Math.round(width * MIN_READER_WIDTH_RATIO))
    const readerMaximum = Math.min(available, Math.round(width * MAX_READER_WIDTH_RATIO))
    const readerWidth = clamp(Math.round(available * weightedWidth("reader") / totalWeight), readerMinimum, readerMaximum)
    lanes.reader = { width: readerWidth }
    distributeWidths(expanded.filter((laneId) => laneId !== "reader"), available - readerWidth, weightedWidth, lanes)
  } else {
    distributeWidths(expanded, available, weightedWidth, lanes)
  }
  const readerWidth = lanes.reader?.width ?? readerLaneWidth(width, swimlane.readerWidthRatio)
  return {
    readerSolo: false,
    readerWidthRatio: clamp(readerWidth / width, MIN_READER_WIDTH_RATIO, MAX_READER_WIDTH_RATIO),
    lanes,
  }
}

function distributeWidths(
  laneIds: readonly ReaderSwimlaneId[],
  available: number,
  weight: (laneId: ReaderSwimlaneId) => number,
  lanes: NonNullable<ReaderWorkspacePatch["lanes"]>,
): void {
  if (laneIds.length === 0) return
  const totalWeight = laneIds.reduce((sum, laneId) => sum + weight(laneId), 0)
  let assigned = 0
  laneIds.forEach((laneId, index) => {
    const laneWidth = index === laneIds.length - 1
      ? available - assigned
      : Math.max(1, Math.round(available * weight(laneId) / totalWeight))
    assigned += laneWidth
    lanes[laneId] = { width: laneWidth }
  })
}

function normalizeLaneOrder(order: readonly ReaderSwimlaneId[]): ReaderSwimlaneId[] {
  const next = order.filter((laneId, index) => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(laneId) && order.indexOf(laneId) === index)
  for (const laneId of LANE_ORDER) if (!next.includes(laneId)) next.push(laneId)
  return next
}

function normalizeLaneId(value: ReaderSwimlaneId, order: readonly ReaderSwimlaneId[]): ReaderSwimlaneId {
  return order.includes(value) ? value : "reader"
}

function normalizeReaderWidthRatio(value: number | undefined, legacyWidth?: number): number {
  const candidate = Number.isFinite(value)
    ? value!
    : Number.isFinite(legacyWidth)
      ? legacyWidth! / LEGACY_READER_REFERENCE_WIDTH
      : DEFAULT_READER_WIDTH_RATIO
  return Math.min(MAX_READER_WIDTH_RATIO, Math.max(MIN_READER_WIDTH_RATIO, candidate))
}

function normalizeReaderFocusHoverDelay(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_READER_FOCUS_HOVER_DELAY_MS
  return Math.round(Math.min(5_000, Math.max(200, value!)))
}

function normalizeEdgeRevealDelay(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_EDGE_REVEAL_DELAY_MS
  return Math.round(Math.min(5_000, Math.max(100, value!)))
}

function normalizeRevealZones(zones?: ReaderWorkspaceConfig["swimlane"]["edgeRevealZones"]): ReaderWorkspaceConfig["swimlane"]["edgeRevealZones"] {
  return {
    left: normalizeRevealZone(zones?.left, DEFAULT_EDGE_REVEAL_ZONES.left),
    right: normalizeRevealZone(zones?.right, DEFAULT_EDGE_REVEAL_ZONES.right),
    top: normalizeRevealZone(zones?.top, DEFAULT_EDGE_REVEAL_ZONES.top),
    bottom: normalizeRevealZone(zones?.bottom, DEFAULT_EDGE_REVEAL_ZONES.bottom),
  }
}

function normalizeRevealZone(
  zone: ReaderWorkspaceConfig["swimlane"]["edgeRevealZones"][keyof ReaderWorkspaceConfig["swimlane"]["edgeRevealZones"]] | undefined,
  fallback: ReaderWorkspaceConfig["swimlane"]["edgeRevealZones"][keyof ReaderWorkspaceConfig["swimlane"]["edgeRevealZones"]],
) {
  const x = clamp(Number.isFinite(zone?.x) ? zone!.x : fallback.x, 0, 99)
  const y = clamp(Number.isFinite(zone?.y) ? zone!.y : fallback.y, 0, 99)
  return {
    x,
    y,
    width: clamp(Number.isFinite(zone?.width) ? zone!.width : fallback.width, 1, 100 - x),
    height: clamp(Number.isFinite(zone?.height) ? zone!.height : fallback.height, 1, 100 - y),
  }
}

function normalizeLane(
  laneId: ReaderSwimlaneId,
  lane: ReaderWorkspaceConfig["swimlane"]["lanes"][ReaderSwimlaneId] | undefined,
  width: number,
  activePanelId?: string,
): ReaderWorkspaceConfig["swimlane"]["lanes"][ReaderSwimlaneId] {
  const panelBar = laneId !== "left" && laneId !== "right" ? {} : {
    panelBarMode: lane?.panelBarMode === "floating" ? "floating" as const : "pinned" as const,
    panelBarDock: ["left", "right", "top", "bottom"].includes(lane?.panelBarDock ?? "")
      ? lane!.panelBarDock
      : laneId,
    panelBarPositionX: clampPercent(lane?.panelBarPositionX, laneId === "left" ? 8 : 92),
    panelBarPositionY: clampPercent(lane?.panelBarPositionY, 50),
    panelBarConstrained: lane?.panelBarConstrained !== false,
  }
  return {
    width: Number.isFinite(lane?.width) ? lane!.width : width,
    collapsed: lane?.collapsed === true,
    ...(lane?.title ? { title: lane.title } : {}),
    ...(lane?.activePanelId || activePanelId ? { activePanelId: lane?.activePanelId ?? activePanelId } : {}),
    ...panelBar,
  }
}

function mergeLanePatches(
  lanes: ReaderWorkspaceConfig["swimlane"]["lanes"],
  patches: ReaderWorkspacePatch["lanes"],
): ReaderWorkspaceConfig["swimlane"]["lanes"] {
  const next = { ...lanes }
  for (const [laneId, patch] of Object.entries(patches ?? {})) {
    if (!patch) continue
    const fallback = next[laneId] ?? { width: 320, collapsed: false }
    next[laneId] = { ...fallback, ...patch }
  }
  return next
}

function defaultPanelBar(side: "left" | "right") {
  return {
    panelBarMode: "pinned" as const,
    panelBarDock: side,
    panelBarPositionX: side === "left" ? 8 : 92,
    panelBarPositionY: 50,
    panelBarConstrained: true,
  }
}

function normalizeBarHandleStyle(value: ReaderWorkspaceConfig["swimlane"]["barHandleStyle"] | undefined): ReaderWorkspaceConfig["swimlane"]["barHandleStyle"] {
  return value === "groove" || value === "grab" || value === "move" || value === "edge" ? value : "grip"
}

function normalizeBarHandlePosition(value: ReaderWorkspaceConfig["swimlane"]["barHandlePosition"] | undefined): ReaderWorkspaceConfig["swimlane"]["barHandlePosition"] {
  return value === "right" ? "right" : "left"
}

function clampPercent(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(100, Math.max(0, value!))
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
