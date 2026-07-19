import {
  READER_INPUT_ACTIONS,
  READER_INPUT_ACTION_LABELS,
  READER_INPUT_ACTION_METADATA,
  type ReaderInputAction,
  type ReaderInputActionCategory,
} from "./ReaderInputActions.js"

export {
  LEGACY_READER_INPUT_ACTION_MAP,
  READER_INPUT_ACTION_CATEGORIES,
  READER_INPUT_ACTION_DEFINITIONS,
  READER_INPUT_ACTIONS,
  READER_INPUT_ACTION_LABELS,
  READER_INPUT_ACTION_METADATA,
  readerInputActionFromLegacyId,
  type ReaderInputAction,
  type ReaderInputActionCategory,
  type ReaderInputActionMetadata,
  type ReaderInputActionDefinition,
} from "./ReaderInputActions.js"

export const READER_INPUT_CONTEXTS = ["global", "reader", "video", "panel", "editor", "modal"] as const

export type ReaderInputContext = typeof READER_INPUT_CONTEXTS[number]

export const READER_VIEW_AREAS = [
  "top-left", "top-center", "top-right",
  "middle-left", "middle-center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right",
] as const
export type ReaderViewArea = typeof READER_VIEW_AREAS[number]

export const READER_MOUSE_GESTURE_DIRECTIONS = ["left", "right", "up", "down"] as const
export type ReaderMouseGestureDirection = typeof READER_MOUSE_GESTURE_DIRECTIONS[number]

export type ReaderInputDescriptor =
  | { device: "keyboard"; code: string; trigger?: "down" | "hold"; durationMs?: number; ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean }
  | { device: "mouse"; button: number; action: "click" | "double-click" | "press" | "hold"; durationMs?: number; moveTolerancePx?: number }
  | { device: "mouse-gesture"; button: number; directions: ReaderMouseGestureDirection[]; trigger: "instant" | "hold"; durationMs?: number; moveTolerancePx?: number }
  | { device: "wheel"; direction: "up" | "down"; ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean }
  | { device: "touch"; gesture: "swipe-left" | "swipe-right" | "swipe-up" | "swipe-down" | "tap" | "long-press"; fingers: 1 | 2 | 3; durationMs?: number; moveTolerancePx?: number }
  | { device: "gamepad"; button: number }
  | { device: "area"; area: ReaderViewArea; button: 0 | 1 | 2; action: "click" | "double-click" | "press" }

export interface ReaderInputBinding {
  id: string
  action: ReaderInputAction
  context: ReaderInputContext
  enabled: boolean
  input: ReaderInputDescriptor
}

export interface ReaderInputBindingsConfig {
  bindings: ReaderInputBinding[]
}

export interface ReaderInputConflict {
  key: string
  bindingIds: string[]
}

export const READER_INPUT_CONTEXT_PRIORITY: Readonly<Record<ReaderInputContext, number>> = {
  global: 0,
  reader: 100,
  video: 150,
  panel: 200,
  editor: 300,
  modal: 400,
}

export const READER_INPUT_ACTION_CATEGORY_LABELS: Readonly<Record<ReaderInputActionCategory, string>> = {
  navigation: "导航",
  zoom: "缩放",
  view: "视图",
  radial: "轮盘",
  file: "文件",
  video: "视频",
  upscale: "超分",
  slideshow: "幻灯片",
  "viewer-toggle": "显示开关",
  session: "会话",
}

export const READER_INPUT_CONTEXT_LABELS: Readonly<Record<ReaderInputContext, string>> = {
  global: "全局",
  reader: "阅读器",
  video: "视频模式",
  panel: "面板",
  editor: "编辑器",
  modal: "对话框",
}

/**
 * Defaults converted 1:1 from legacy NeoView export
 * `migration/neoview/neoview-data-1784386950682.json` → appSettings.keybindings.
 * Plus touch/zoom convenience only where the export left those actions empty.
 * Gamepad intentionally omitted for now.
 */
export const DEFAULT_READER_INPUT_BINDINGS: ReaderInputBindingsConfig = {
  bindings: [
    // navigation
    binding("legacy-reader-page-left-global-0", "reader.page-left", "global", { device: "keyboard", code: "KeyA" }),
    binding("legacy-reader-page-left-global-1", "reader.page-left", "global", { device: "area", area: "middle-left", button: 0, action: "click" }),
    binding("legacy-reader-page-left-global-2", "reader.page-left", "global", { device: "wheel", direction: "down" }),
    binding("legacy-reader-page-left-reader-3", "reader.page-left", "reader", { device: "keyboard", code: "ArrowLeft" }),
    binding("legacy-reader-page-right-global-0", "reader.page-right", "global", { device: "keyboard", code: "KeyD" }),
    binding("legacy-reader-page-right-global-1", "reader.page-right", "global", { device: "area", area: "bottom-right", button: 0, action: "click" }),
    binding("legacy-reader-page-right-global-2", "reader.page-right", "global", { device: "area", area: "middle-right", button: 0, action: "click" }),
    binding("legacy-reader-page-right-global-3", "reader.page-right", "global", { device: "wheel", direction: "up" }),
    binding("legacy-reader-page-right-global-4", "reader.page-right", "global", { device: "area", area: "bottom-left", button: 0, action: "click" }),
    binding("legacy-reader-page-right-reader-5", "reader.page-right", "reader", { device: "keyboard", code: "ArrowRight" }),
    binding("legacy-reader-next-book-global-0", "reader.next-book", "global", { device: "keyboard", code: "ArrowDown" }),
    binding("legacy-reader-next-book-global-1", "reader.next-book", "global", { device: "keyboard", code: "KeyS" }),
    binding("legacy-reader-next-book-global-2", "reader.next-book", "global", { device: "area", area: "bottom-center", button: 0, action: "click" }),
    binding("legacy-reader-previous-book-global-0", "reader.previous-book", "global", { device: "keyboard", code: "ArrowUp" }),
    binding("legacy-reader-previous-book-global-1", "reader.previous-book", "global", { device: "keyboard", code: "KeyW" }),
    binding("legacy-reader-previous-book-global-2", "reader.previous-book", "global", { device: "area", area: "top-center", button: 0, action: "click" }),
    binding("touch-previous", "reader.previous-page", "reader", { device: "touch", gesture: "swipe-right", fingers: 1 }),
    binding("touch-next", "reader.next-page", "reader", { device: "touch", gesture: "swipe-left", fingers: 1 }),

    // zoom
    binding("keyboard-zoom-in", "reader.zoom-in", "reader", { device: "keyboard", code: "Equal" }),
    binding("keyboard-zoom-out", "reader.zoom-out", "reader", { device: "keyboard", code: "Minus" }),
    binding("keyboard-reset", "reader.reset-view", "reader", { device: "keyboard", code: "Digit0" }),

    // view
    binding("legacy-reader-fullscreen-global-0", "reader.fullscreen", "global", { device: "keyboard", code: "F11" }),
    binding("legacy-reader-toggle-library-global-0", "reader.toggle-library", "global", { device: "keyboard", code: "KeyL" }),
    binding("legacy-reader-toggle-reading-direction-global-0", "reader.toggle-reading-direction", "global", { device: "keyboard", code: "KeyR" }),

    // radial
    binding("legacy-radial-open-default-global-0", "radial.open-default", "global", { device: "mouse", button: 2, action: "press" }),
    binding("legacy-radial-open-default-global-1", "radial.open-default", "global", { device: "keyboard", code: "Enter" }),
    binding("legacy-radial-confirm-global-0", "radial.confirm", "global", { device: "keyboard", code: "Space" }),

    // video (legacy videoPlayer context → video)
    binding("legacy-video-play-pause-video-0", "video.play-pause", "video", { device: "area", area: "middle-center", button: 0, action: "click" }),
    binding("legacy-video-seek-forward-global-0", "video.seek-forward", "global", { device: "keyboard", code: "MediaTrackNext" }),
    binding("legacy-video-seek-forward-video-1", "video.seek-forward", "video", { device: "keyboard", code: "ArrowRight" }),
    binding("legacy-video-seek-forward-video-2", "video.seek-forward", "video", { device: "area", area: "middle-right", button: 0, action: "click" }),
    binding("legacy-video-seek-backward-global-0", "video.seek-backward", "global", { device: "keyboard", code: "MediaTrackPrevious" }),
    binding("legacy-video-seek-backward-video-1", "video.seek-backward", "video", { device: "keyboard", code: "ArrowLeft" }),
    binding("legacy-video-seek-backward-video-2", "video.seek-backward", "video", { device: "area", area: "middle-left", button: 0, action: "click" }),
    binding("legacy-video-speed-up-global-0", "video.speed-up", "global", { device: "keyboard", code: "KeyC" }),
    binding("legacy-video-speed-down-global-0", "video.speed-down", "global", { device: "keyboard", code: "KeyX" }),
    binding("legacy-video-toggle-speed-global-0", "video.toggle-speed", "global", { device: "keyboard", code: "KeyZ" }),
  ],
}

export function readerInputConflictKey(binding: Pick<ReaderInputBinding, "context" | "input">): string {
  return `${binding.context}:${readerInputDescriptorKey(binding.input)}`
}

export function readerInputDescriptorKey(input: ReaderInputDescriptor): string {
  switch (input.device) {
    case "keyboard":
      return `keyboard:${modifiers(input)}:${input.code}:${input.trigger ?? "down"}`
    case "mouse":
      return `mouse:${input.button}:${input.action}`
    case "mouse-gesture":
      return `mouse-gesture:${input.button}:${input.trigger}:${input.directions.join("-")}`
    case "wheel":
      return `wheel:${modifiers(input)}:${input.direction}`
    case "touch":
      return `touch:${input.fingers}:${input.gesture}`
    case "gamepad":
      return `gamepad:${input.button}`
    case "area":
      return `area:${input.area}:${input.button}:${input.action}`
  }
}

export function readerInputConflicts(bindings: readonly ReaderInputBinding[]): ReaderInputConflict[] {
  const groups = new Map<string, string[]>()
  for (const current of bindings) {
    if (!current.enabled) continue
    const key = readerInputConflictKey(current)
    const ids = groups.get(key) ?? []
    ids.push(current.id)
    groups.set(key, ids)
  }
  return [...groups.entries()].flatMap(([key, bindingIds]) => bindingIds.length > 1 ? [{ key, bindingIds }] : [])
}

export function matchingReaderInputBinding(
  bindings: readonly ReaderInputBinding[],
  input: ReaderInputDescriptor,
  contexts: readonly ReaderInputContext[],
): ReaderInputBinding | undefined {
  const isolatesGlobal = contexts.includes("editor") || contexts.includes("modal")
  let match: ReaderInputBinding | undefined
  let matchPriority = Number.NEGATIVE_INFINITY
  for (const candidate of bindings) {
    if (!candidate.enabled) continue
    if (candidate.context === "global") {
      if (isolatesGlobal) continue
    } else if (!contexts.includes(candidate.context)) {
      continue
    }
    if (!readerInputDescriptorsEqual(candidate.input, input)) continue
    const priority = READER_INPUT_CONTEXT_PRIORITY[candidate.context]
    if (priority > matchPriority) {
      match = candidate
      matchPriority = priority
    }
  }
  return match
}

function readerInputDescriptorsEqual(left: ReaderInputDescriptor, right: ReaderInputDescriptor): boolean {
  if (left.device !== right.device) return false
  switch (left.device) {
    case "keyboard": {
      const candidate = right as Extract<ReaderInputDescriptor, { device: "keyboard" }>
      return left.code === candidate.code
        && (left.trigger ?? "down") === (candidate.trigger ?? "down")
        && sameModifiers(left, candidate)
    }
    case "mouse": {
      const candidate = right as Extract<ReaderInputDescriptor, { device: "mouse" }>
      return left.button === candidate.button && left.action === candidate.action
    }
    case "mouse-gesture": {
      const candidate = right as Extract<ReaderInputDescriptor, { device: "mouse-gesture" }>
      if (left.button !== candidate.button || left.trigger !== candidate.trigger || left.directions.length !== candidate.directions.length) return false
      return left.directions.every((direction, index) => direction === candidate.directions[index])
    }
    case "wheel": {
      const candidate = right as Extract<ReaderInputDescriptor, { device: "wheel" }>
      return left.direction === candidate.direction && sameModifiers(left, candidate)
    }
    case "touch": {
      const candidate = right as Extract<ReaderInputDescriptor, { device: "touch" }>
      return left.fingers === candidate.fingers && left.gesture === candidate.gesture
    }
    case "gamepad":
      return left.button === (right as Extract<ReaderInputDescriptor, { device: "gamepad" }>).button
    case "area": {
      const candidate = right as Extract<ReaderInputDescriptor, { device: "area" }>
      return left.area === candidate.area && left.button === candidate.button && left.action === candidate.action
    }
  }
}

function sameModifiers(
  left: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean },
  right: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean },
): boolean {
  return Boolean(left.ctrl) === Boolean(right.ctrl)
    && Boolean(left.alt) === Boolean(right.alt)
    && Boolean(left.shift) === Boolean(right.shift)
    && Boolean(left.meta) === Boolean(right.meta)
}

export function cloneReaderInputBindings(config: ReaderInputBindingsConfig): ReaderInputBindingsConfig {
  return { bindings: config.bindings.map((current) => ({ ...current, input: { ...current.input } })) }
}

export function readerViewAreaAtPoint(x: number, y: number, width: number, height: number): ReaderViewArea {
  const column = Math.max(0, Math.min(2, Math.floor((x / Math.max(1, width)) * 3)))
  const row = Math.max(0, Math.min(2, Math.floor((y / Math.max(1, height)) * 3)))
  return READER_VIEW_AREAS[row * 3 + column]!
}

function binding(
  id: string,
  action: ReaderInputAction,
  context: ReaderInputContext,
  input: ReaderInputDescriptor,
): ReaderInputBinding {
  return { id, action, context, enabled: true, input }
}

function modifiers(input: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean }): string {
  return `${input.ctrl ? "C" : "-"}${input.alt ? "A" : "-"}${input.shift ? "S" : "-"}${input.meta ? "M" : "-"}`
}
