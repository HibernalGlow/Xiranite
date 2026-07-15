import { DEFAULT_READER_LAYOUT } from "../../domain/frame/frame.js"
import type { TailOverflowBehavior } from "../../domain/navigation/navigation.js"
import type { ReaderSessionOptions } from "../reader/contracts.js"

export interface NeoviewRuntimeConfig {
  schemaVersion: 1
  sessionOptions: Partial<ReaderSessionOptions>
  shellOptions: NeoviewShellConfig
}

export interface NeoviewShellEdgeConfig {
  enabled: boolean
  initialVisible: boolean
  pinned: boolean
  triggerSize: number
}

export interface NeoviewShellSidebarConfig {
  width: number
  height: "full" | "two-thirds" | "half" | "one-third" | "custom"
  customHeight: number
  verticalAlign: number
  horizontalPosition: number
}

export interface NeoviewShellConfig {
  showDelayMs: number
  hideDelayMs: number
  opacity: { top: number; bottom: number; sidebar: number }
  blur: { top: number; bottom: number; sidebar: number }
  edges: Record<"top" | "right" | "bottom" | "left", NeoviewShellEdgeConfig>
  sidebars: Record<"left" | "right", NeoviewShellSidebarConfig>
  panelLayout: Record<string, NeoviewPanelLayout>
}

export interface NeoviewPanelLayout {
  visible: boolean
  order: number
  position: "left" | "right" | "bottom" | "floating"
}

export interface NeoviewSidebarLayoutPatch {
  side: "left" | "right"
  width?: number
  height?: NeoviewShellSidebarConfig["height"]
  customHeight?: number
  verticalAlign?: number
  horizontalPosition?: number
}

export const DEFAULT_NEOVIEW_SHELL_CONFIG: NeoviewShellConfig = {
  showDelayMs: 0,
  hideDelayMs: 0,
  opacity: { top: 85, bottom: 85, sidebar: 85 },
  blur: { top: 12, bottom: 12, sidebar: 12 },
  edges: {
    top: { enabled: true, initialVisible: true, pinned: false, triggerSize: 32 },
    right: { enabled: true, initialVisible: false, pinned: false, triggerSize: 32 },
    bottom: { enabled: true, initialVisible: false, pinned: false, triggerSize: 32 },
    left: { enabled: true, initialVisible: true, pinned: true, triggerSize: 32 },
  },
  sidebars: {
    left: { width: 320, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
    right: { width: 280, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
  },
  panelLayout: {
    folder: { visible: true, order: 0, position: "left" },
    history: { visible: true, order: 1, position: "left" },
    bookmark: { visible: true, order: 2, position: "left" },
    pageList: { visible: true, order: 3, position: "left" },
    playlist: { visible: false, order: 4, position: "left" },
    settings: { visible: true, order: 99, position: "left" },
    info: { visible: true, order: 0, position: "right" },
    properties: { visible: true, order: 1, position: "right" },
    upscale: { visible: true, order: 2, position: "right" },
    insights: { visible: true, order: 3, position: "right" },
    control: { visible: true, order: 4, position: "right" },
    ai: { visible: true, order: 5, position: "right" },
    benchmark: { visible: false, order: 10, position: "right" },
    cardwindow: { visible: false, order: 100, position: "floating" },
  },
}

export function parseNeoviewRuntimeConfig(value: unknown): NeoviewRuntimeConfig {
  if (value === undefined) return { schemaVersion: 1, sessionOptions: {}, shellOptions: DEFAULT_NEOVIEW_SHELL_CONFIG }
  const config = requireRecord(value, "[nodes.neoview]")
  const schemaVersion = config.schema_version ?? 1
  if (schemaVersion !== 1) throw new Error(`[nodes.neoview].schema_version must be 1, received ${String(schemaVersion)}.`)
  const reader = optionalRecord(config.reader, "[nodes.neoview.reader]")
  const panels = optionalRecord(config.panels, "[nodes.neoview.panels]")

  const direction = optionalEnum(
    reader?.reading_direction ?? nestedValue(reader, "book", "reading_direction"),
    "[nodes.neoview.reader].reading_direction",
    ["left-to-right", "right-to-left"] as const,
  )
  const doublePage = optionalBoolean(
    reader?.double_page_view ?? nestedValue(reader, "book", "double_page_view"),
    "[nodes.neoview.reader].double_page_view",
  )
  const tailOverflow = parseTailOverflow(
    reader?.tail_overflow_behavior ?? nestedValue(reader, "book", "tail_overflow_behavior"),
  )

  return {
    schemaVersion: 1,
    sessionOptions: {
      direction,
      layout: doublePage === undefined
        ? undefined
        : { ...DEFAULT_READER_LAYOUT, pageMode: doublePage ? "double" : "single" },
      tailOverflow,
    },
    shellOptions: parseShellOptions(panels),
  }
}

export function parseNeoviewSidebarLayoutPatch(value: unknown): {
  patch: NeoviewSidebarLayoutPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader shell patch")
  const allowed = new Set(["side", "width", "height", "customHeight", "verticalAlign", "horizontalPosition"])
  const unknown = Object.keys(record).filter((key) => !allowed.has(key))
  if (unknown.length) throw new Error(`reader shell patch contains unsupported fields: ${unknown.join(", ")}.`)
  const side = optionalEnum(record.side, "reader shell patch.side", ["left", "right"] as const)
  if (!side) throw new Error("reader shell patch.side is required.")
  const patch: NeoviewSidebarLayoutPatch = { side }
  if (record.width !== undefined) patch.width = boundedNumber(record.width, 200, 600, 320, "reader shell patch.width")
  if (record.height !== undefined) patch.height = sidebarHeight(record.height, "reader shell patch.height")
  if (record.customHeight !== undefined) patch.customHeight = boundedNumber(record.customHeight, 10, 100, 100, "reader shell patch.customHeight")
  if (record.verticalAlign !== undefined) patch.verticalAlign = boundedNumber(record.verticalAlign, 0, 100, 0, "reader shell patch.verticalAlign")
  if (record.horizontalPosition !== undefined) patch.horizontalPosition = boundedNumber(record.horizontalPosition, 0, 100, 0, "reader shell patch.horizontalPosition")
  if (Object.keys(patch).length === 1) throw new Error("reader shell patch must change at least one layout field.")
  const sidePatch: Record<string, unknown> = {}
  if (patch.width !== undefined) sidePatch.width = patch.width
  if (patch.height !== undefined) sidePatch.height = patch.height === "two-thirds" ? "2/3" : patch.height === "one-third" ? "1/3" : patch.height
  if (patch.customHeight !== undefined) sidePatch.custom_height = patch.customHeight
  if (patch.verticalAlign !== undefined) sidePatch.vertical_align = patch.verticalAlign
  if (patch.horizontalPosition !== undefined) sidePatch.horizontal_position = patch.horizontalPosition
  return { patch, tomlPatch: { panels: { sidebars: { [side]: sidePatch } } } }
}

function parseShellOptions(panels: Record<string, unknown> | undefined): NeoviewShellConfig {
  if (!panels) return DEFAULT_NEOVIEW_SHELL_CONFIG
  const hover = optionalRecord(panels.hover_areas, "[nodes.neoview.panels.hover_areas]")
  const timing = optionalRecord(panels.auto_hide_timing, "[nodes.neoview.panels.auto_hide_timing]")
  const sidebars = optionalRecord(panels.sidebars, "[nodes.neoview.panels.sidebars]")
  const left = optionalRecord(sidebars?.left, "[nodes.neoview.panels.sidebars.left]")
  const right = optionalRecord(sidebars?.right, "[nodes.neoview.panels.sidebars.right]")
  const autoHideToolbar = optionalBoolean(panels.auto_hide_toolbar, "[nodes.neoview.panels].auto_hide_toolbar")
  return {
    showDelayMs: secondsToMilliseconds(timing?.show_delay_sec, "[nodes.neoview.panels.auto_hide_timing].show_delay_sec"),
    hideDelayMs: secondsToMilliseconds(timing?.hide_delay_sec, "[nodes.neoview.panels.auto_hide_timing].hide_delay_sec"),
    opacity: {
      top: boundedNumber(panels.top_toolbar_opacity, 0, 100, DEFAULT_NEOVIEW_SHELL_CONFIG.opacity.top, "top_toolbar_opacity"),
      bottom: boundedNumber(panels.bottom_bar_opacity, 0, 100, DEFAULT_NEOVIEW_SHELL_CONFIG.opacity.bottom, "bottom_bar_opacity"),
      sidebar: boundedNumber(panels.sidebar_opacity, 0, 100, DEFAULT_NEOVIEW_SHELL_CONFIG.opacity.sidebar, "sidebar_opacity"),
    },
    blur: {
      top: boundedNumber(panels.top_toolbar_blur, 0, 20, DEFAULT_NEOVIEW_SHELL_CONFIG.blur.top, "top_toolbar_blur"),
      bottom: boundedNumber(panels.bottom_bar_blur, 0, 20, DEFAULT_NEOVIEW_SHELL_CONFIG.blur.bottom, "bottom_bar_blur"),
      sidebar: boundedNumber(panels.sidebar_blur, 0, 20, DEFAULT_NEOVIEW_SHELL_CONFIG.blur.sidebar, "sidebar_blur"),
    },
    edges: {
      top: edgeConfig("top", true, autoHideToolbar === false, autoHideToolbar === false, hover?.top_trigger_height),
      right: edgeConfig("right", optionalBoolean(panels.right_sidebar_visible, "right_sidebar_visible") ?? true, false, optionalBoolean(right?.pinned, "right.pinned") ?? false, hover?.right_trigger_width),
      bottom: edgeConfig("bottom", optionalBoolean(panels.bottom_panel_visible, "bottom_panel_visible") ?? true, optionalBoolean(panels.bottom_panel_visible, "bottom_panel_visible") ?? false, false, hover?.bottom_trigger_height),
      left: edgeConfig("left", optionalBoolean(panels.left_sidebar_visible, "left_sidebar_visible") ?? true, optionalBoolean(left?.open, "left.open") ?? true, optionalBoolean(left?.pinned, "left.pinned") ?? true, hover?.left_trigger_width),
    },
    sidebars: { left: sidebarConfig("left", left), right: sidebarConfig("right", right) },
    panelLayout: parsePanelLayout(panels),
  }
}

function parsePanelLayout(panels: Record<string, unknown>): Record<string, NeoviewPanelLayout> {
  const layout = optionalRecord(panels.layout, "[nodes.neoview.panels.layout]")
  const source = optionalRecord(layout?.sidebarConfig, "[nodes.neoview.panels.layout.sidebarConfig]")
    ?? layout
  const values = source?.panels
  const result: Record<string, NeoviewPanelLayout> = { ...DEFAULT_NEOVIEW_SHELL_CONFIG.panelLayout }
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
  return result
}

function edgeConfig(edge: string, enabled: boolean, initialVisible: boolean, pinned: boolean, trigger: unknown): NeoviewShellEdgeConfig {
  return { enabled, initialVisible, pinned, triggerSize: boundedNumber(trigger, 1, 128, 32, `${edge} trigger`) }
}

function sidebarConfig(side: "left" | "right", value: Record<string, unknown> | undefined): NeoviewShellSidebarConfig {
  return {
    width: boundedNumber(value?.width, 200, 600, side === "left" ? 320 : 280, `${side}.width`),
    height: sidebarHeight(value?.height, `${side}.height`),
    customHeight: boundedNumber(value?.custom_height, 10, 100, 100, `${side}.custom_height`),
    verticalAlign: boundedNumber(value?.vertical_align, 0, 100, 0, `${side}.vertical_align`),
    horizontalPosition: boundedNumber(value?.horizontal_position, 0, 100, 0, `${side}.horizontal_position`),
  }
}

function sidebarHeight(value: unknown, path: string): NeoviewShellSidebarConfig["height"] {
  if (value === undefined) return "full"
  if (value === "2/3") return "two-thirds"
  if (value === "1/3") return "one-third"
  return optionalEnum(value, path, ["full", "two-thirds", "half", "one-third", "custom"] as const) ?? "full"
}

function secondsToMilliseconds(value: unknown, path: string): number {
  return Math.round(boundedNumber(value, 0, 5, 0, path) * 1000)
}

function boundedNumber(value: unknown, min: number, max: number, fallback: number, path: string): number {
  if (value === undefined) return fallback
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${path} must be a finite number between ${min} and ${max}.`)
  }
  return value
}

function parseTailOverflow(value: unknown): TailOverflowBehavior | undefined {
  if (value === undefined) return undefined
  const aliases: Readonly<Record<string, TailOverflowBehavior>> = {
    "do-nothing": "do-nothing",
    doNothing: "do-nothing",
    "stay-on-last-page": "stay-on-last-page",
    stayOnLastPage: "stay-on-last-page",
    "next-book": "next-book",
    nextBook: "next-book",
    loop: "loop",
    loopTopBottom: "loop",
    "seamless-loop": "seamless-loop",
    seamlessLoop: "seamless-loop",
  }
  if (typeof value !== "string" || !aliases[value]) {
    throw new Error("[nodes.neoview.reader].tail_overflow_behavior is invalid.")
  }
  return aliases[value]
}

function nestedValue(record: Record<string, unknown> | undefined, section: string, key: string): unknown {
  if (!record) return undefined
  const nested = record[section]
  return isRecord(nested) ? nested[key] : undefined
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean.`)
  return value
}

function optionalEnum<const Values extends readonly string[]>(
  value: unknown,
  path: string,
  values: Values,
): Values[number] | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string" || !values.includes(value)) {
    throw new Error(`${path} must be one of: ${values.join(", ")}.`)
  }
  return value as Values[number]
}

function optionalRecord(value: unknown, path: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  return requireRecord(value, path)
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${path} must be a table.`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
