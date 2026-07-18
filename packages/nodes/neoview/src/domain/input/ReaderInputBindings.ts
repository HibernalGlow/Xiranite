export const READER_INPUT_CONTEXTS = ["global", "reader", "panel", "editor", "modal"] as const
export const READER_INPUT_ACTIONS = [
  "reader.previous-page",
  "reader.next-page",
  "reader.zoom-in",
  "reader.zoom-out",
  "reader.reset-view",
  "reader.rotate-clockwise",
  "reader.open-settings",
] as const

export type ReaderInputContext = typeof READER_INPUT_CONTEXTS[number]
export type ReaderInputAction = typeof READER_INPUT_ACTIONS[number]

export const READER_INPUT_ACTION_CATEGORIES = ["navigation", "view", "session"] as const
export type ReaderInputActionCategory = typeof READER_INPUT_ACTION_CATEGORIES[number]

export const READER_VIEW_AREAS = [
  "top-left", "top-center", "top-right",
  "middle-left", "middle-center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right",
] as const
export type ReaderViewArea = typeof READER_VIEW_AREAS[number]

export interface ReaderInputActionMetadata {
  label: string
  category: ReaderInputActionCategory
}

export type ReaderInputDescriptor =
  | { device: "keyboard"; code: string; ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean }
  | { device: "mouse"; button: number; click: "single" | "double" }
  | { device: "wheel"; direction: "up" | "down"; ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean }
  | { device: "touch"; gesture: "swipe-left" | "swipe-right" | "swipe-up" | "swipe-down"; fingers: 1 | 2 | 3 }
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
  panel: 200,
  editor: 300,
  modal: 400,
}

export const READER_INPUT_ACTION_METADATA: Readonly<Record<ReaderInputAction, ReaderInputActionMetadata>> = {
  "reader.previous-page": { label: "上一页", category: "navigation" },
  "reader.next-page": { label: "下一页", category: "navigation" },
  "reader.zoom-in": { label: "放大", category: "view" },
  "reader.zoom-out": { label: "缩小", category: "view" },
  "reader.reset-view": { label: "重置视图", category: "view" },
  "reader.rotate-clockwise": { label: "顺时针旋转", category: "view" },
  "reader.open-settings": { label: "打开设置", category: "session" },
}

export const READER_INPUT_ACTION_LABELS: Readonly<Record<ReaderInputAction, string>> = Object.fromEntries(
  READER_INPUT_ACTIONS.map((action) => [action, READER_INPUT_ACTION_METADATA[action].label]),
) as Record<ReaderInputAction, string>

export const READER_INPUT_ACTION_CATEGORY_LABELS: Readonly<Record<ReaderInputActionCategory, string>> = {
  navigation: "导航",
  view: "视图",
  session: "会话",
}

export const READER_INPUT_CONTEXT_LABELS: Readonly<Record<ReaderInputContext, string>> = {
  global: "全局",
  reader: "阅读器",
  panel: "面板",
  editor: "编辑器",
  modal: "对话框",
}

export const DEFAULT_READER_INPUT_BINDINGS: ReaderInputBindingsConfig = {
  bindings: [
    binding("keyboard-previous", "reader.previous-page", "reader", { device: "keyboard", code: "ArrowLeft" }),
    binding("keyboard-next", "reader.next-page", "reader", { device: "keyboard", code: "ArrowRight" }),
    binding("keyboard-zoom-in", "reader.zoom-in", "reader", { device: "keyboard", code: "Equal" }),
    binding("keyboard-zoom-out", "reader.zoom-out", "reader", { device: "keyboard", code: "Minus" }),
    binding("keyboard-reset", "reader.reset-view", "reader", { device: "keyboard", code: "Digit0" }),
    binding("keyboard-rotate", "reader.rotate-clockwise", "reader", { device: "keyboard", code: "KeyR" }),
    binding("touch-previous", "reader.previous-page", "reader", { device: "touch", gesture: "swipe-right", fingers: 1 }),
    binding("touch-next", "reader.next-page", "reader", { device: "touch", gesture: "swipe-left", fingers: 1 }),
    binding("gamepad-previous", "reader.previous-page", "reader", { device: "gamepad", button: 4 }),
    binding("gamepad-next", "reader.next-page", "reader", { device: "gamepad", button: 5 }),
  ],
}

export function readerInputConflictKey(binding: Pick<ReaderInputBinding, "context" | "input">): string {
  return `${binding.context}:${readerInputDescriptorKey(binding.input)}`
}

export function readerInputDescriptorKey(input: ReaderInputDescriptor): string {
  switch (input.device) {
    case "keyboard":
      return `keyboard:${modifiers(input)}:${input.code}`
    case "mouse":
      return `mouse:${input.button}:${input.click}`
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
  const descriptor = readerInputDescriptorKey(input)
  const active = new Set<ReaderInputContext>(["global", ...contexts])
  return [...bindings]
    .filter((candidate) => candidate.enabled && active.has(candidate.context) && readerInputDescriptorKey(candidate.input) === descriptor)
    .sort((left, right) => READER_INPUT_CONTEXT_PRIORITY[right.context] - READER_INPUT_CONTEXT_PRIORITY[left.context])[0]
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
