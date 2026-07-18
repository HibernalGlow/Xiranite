import {
  readerInputActionFromLegacyId,
  type ReaderInputBinding,
  type ReaderInputContext,
  type ReaderInputDescriptor,
  type ReaderMouseGestureDirection,
  type ReaderViewArea,
} from "../../domain/input/ReaderInputBindings.js"

export interface ReaderLegacyInputBindingReportEntry {
  sourcePath: string
  status: "converted" | "skipped" | "invalid"
  message: string
  bindingId?: string
}

export interface ReaderLegacyInputBindingConversion {
  bindings: ReaderInputBinding[]
  report: ReaderLegacyInputBindingReportEntry[]
}

export function convertLegacyReaderInputBindings(value: unknown): ReaderLegacyInputBindingConversion {
  if (!Array.isArray(value)) return { bindings: [], report: [{ sourcePath: "keybindings", status: "invalid", message: "Expected an ActionBinding array." }] }
  const bindings: ReaderInputBinding[] = []
  const report: ReaderLegacyInputBindingReportEntry[] = []
  for (const [actionIndex, rawAction] of value.entries()) {
    const sourcePath = `keybindings[${actionIndex}]`
    if (!isRecord(rawAction) || typeof rawAction.action !== "string") {
      report.push({ sourcePath, status: "invalid", message: "Expected an action object with a string action ID." })
      continue
    }
    const action = readerInputActionFromLegacyId(rawAction.action)
    if (!action) {
      report.push({ sourcePath: `${sourcePath}.action`, status: "skipped", message: `Unknown legacy action ${rawAction.action}.` })
      continue
    }
    const sources: Array<{ input: unknown; context: ReaderInputContext; path: string }> = []
    if (Array.isArray(rawAction.bindings)) rawAction.bindings.forEach((input, index) => sources.push({ input, context: "global", path: `${sourcePath}.bindings[${index}]` }))
    if (Array.isArray(rawAction.contextBindings)) rawAction.contextBindings.forEach((candidate, index) => {
      const path = `${sourcePath}.contextBindings[${index}]`
      if (!isRecord(candidate)) {
        report.push({ sourcePath: path, status: "invalid", message: "Expected a contextual binding object." })
        return
      }
      const context = legacyContext(candidate.context)
      if (!context) {
        report.push({ sourcePath: `${path}.context`, status: "invalid", message: `Unknown legacy context ${String(candidate.context)}.` })
        return
      }
      sources.push({ input: candidate.input, context, path: `${path}.input` })
    })
    for (const [bindingIndex, source] of sources.entries()) {
      const input = convertLegacyInput(source.input)
      if (!input) {
        report.push({ sourcePath: source.path, status: "skipped", message: "Unsupported or malformed legacy input descriptor." })
        continue
      }
      const id = legacyBindingId(rawAction.action, source.context, bindingIndex, bindings)
      bindings.push({ id, action, context: source.context, enabled: true, input })
      report.push({ sourcePath: source.path, status: "converted", message: `Converted to ${action}.`, bindingId: id })
    }
  }
  return { bindings, report }
}

function convertLegacyInput(value: unknown): ReaderInputDescriptor | undefined {
  if (!isRecord(value) || typeof value.type !== "string") return undefined
  if (value.type === "keyboard" && typeof value.key === "string") return keyboardInput(value)
  if (value.type === "mouse" && typeof value.gesture === "string") return mouseInput(value)
  if (value.type === "touch" && typeof value.gesture === "string") return touchInput(value)
  if (value.type === "area" && typeof value.area === "string") {
    if (!VIEW_AREAS.has(value.area as ReaderViewArea)) return undefined
    return {
      device: "area",
      area: value.area as ReaderViewArea,
      button: mouseButton(value.button),
      action: value.action === "double-click" || value.action === "press" ? value.action : "click",
    }
  }
  return undefined
}

function keyboardInput(value: Record<string, unknown>): ReaderInputDescriptor | undefined {
  const parts = String(value.key).split("+").map((part) => part.trim()).filter(Boolean)
  const key = parts.pop()
  if (!key) return undefined
  const code = legacyKeyCode(key)
  if (!code) return undefined
  const modifiers = new Set(parts.map((part) => part.toLowerCase()))
  const trigger = value.trigger === "hold" ? "hold" : "down"
  return {
    device: "keyboard",
    code,
    ...(trigger === "hold" ? { trigger, durationMs: bounded(value.durationMs, 100, 5_000, 450) } : {}),
    ctrl: modifiers.has("ctrl") || modifiers.has("control") || undefined,
    alt: modifiers.has("alt") || undefined,
    shift: modifiers.has("shift") || undefined,
    meta: modifiers.has("meta") || modifiers.has("cmd") || modifiers.has("command") || undefined,
  }
}

function mouseInput(value: Record<string, unknown>): ReaderInputDescriptor | undefined {
  const gesture = String(value.gesture).toLowerCase()
  if (gesture === "wheel-up" || gesture === "wheel-down") return { device: "wheel", direction: gesture === "wheel-up" ? "up" : "down" }
  if (gesture === "click" || gesture === "double-click" || gesture === "press") {
    return { device: "mouse", button: mouseButton(value.button), action: gesture }
  }
  if (gesture === "hold") return { device: "mouse", button: mouseButton(value.button), action: "hold", ...timing(value, 500) }
  const directions = gestureDirections(gesture)
  if (!directions.length) return undefined
  const trigger = value.trigger === "hold" ? "hold" : "instant"
  return { device: "mouse-gesture", button: mouseButton(value.button), directions, trigger, ...(trigger === "hold" ? timing(value, 500) : {}) }
}

function touchInput(value: Record<string, unknown>): ReaderInputDescriptor | undefined {
  const gesture = String(value.gesture).toLowerCase()
  const supported = new Set(["swipe-left", "swipe-right", "swipe-up", "swipe-down", "tap", "long-press"])
  if (!supported.has(gesture)) return undefined
  const normalized = gesture as Extract<ReaderInputDescriptor, { device: "touch" }>["gesture"]
  return { device: "touch", gesture: normalized, fingers: 1, ...(normalized === "long-press" ? timing(value, 450) : {}) }
}

function legacyContext(value: unknown): ReaderInputContext | undefined {
  return value === "global" ? "global" : value === "viewer" ? "reader" : value === "videoPlayer" ? "video" : undefined
}

function legacyKeyCode(key: string): string | undefined {
  const normalized = key.toLowerCase().replace("←", "arrowleft").replace("→", "arrowright").replace("↑", "arrowup").replace("↓", "arrowdown")
  if (/^[a-z]$/u.test(normalized)) return `Key${normalized.toUpperCase()}`
  if (/^[0-9]$/u.test(normalized)) return `Digit${normalized}`
  const known: Record<string, string> = { arrowleft: "ArrowLeft", arrowright: "ArrowRight", arrowup: "ArrowUp", arrowdown: "ArrowDown", enter: "Enter", space: "Space", escape: "Escape", home: "Home", end: "End", pageup: "PageUp", pagedown: "PageDown", tab: "Tab", backspace: "Backspace", delete: "Delete", "+": "Equal", "-": "Minus" }
  return known[normalized] ?? (/^f(?:[1-9]|1[0-2])$/u.test(normalized) ? normalized.toUpperCase() : undefined)
}

function gestureDirections(value: string): ReaderMouseGestureDirection[] {
  const tokens = value.toUpperCase().split(/[-,\s]+/u).flatMap((token) => token.length > 1 ? [...token] : [token])
  const map: Record<string, ReaderMouseGestureDirection> = { L: "left", R: "right", U: "up", D: "down", LEFT: "left", RIGHT: "right", UP: "up", DOWN: "down" }
  const directions = tokens.map((token) => map[token]).filter((direction): direction is ReaderMouseGestureDirection => Boolean(direction))
  return directions.length === tokens.length && directions.length <= 16 ? directions.filter((direction, index) => index === 0 || direction !== directions[index - 1]) : []
}

function mouseButton(value: unknown): 0 | 1 | 2 {
  return value === "right" ? 2 : value === "middle" ? 1 : 0
}

function timing(value: Record<string, unknown>, fallback: number): { durationMs: number; moveTolerancePx: number } {
  return { durationMs: bounded(value.durationMs, 100, 5_000, fallback), moveTolerancePx: bounded(value.moveTolerancePx, 1, 100, 12) }
}

function bounded(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return Number.isInteger(value) ? Math.min(maximum, Math.max(minimum, value as number)) : fallback
}

function legacyBindingId(action: string, context: ReaderInputContext, index: number, existing: readonly ReaderInputBinding[]): string {
  const base = `legacy-${action.replace(/[^a-zA-Z0-9._-]/gu, "-").slice(0, 48)}-${context}-${index}`
  let id = base
  let suffix = 2
  while (existing.some((binding) => binding.id === id)) id = `${base.slice(0, 74)}-${suffix++}`
  return id
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

const VIEW_AREAS = new Set<ReaderViewArea>(["top-left", "top-center", "top-right", "middle-left", "middle-center", "middle-right", "bottom-left", "bottom-center", "bottom-right"])
