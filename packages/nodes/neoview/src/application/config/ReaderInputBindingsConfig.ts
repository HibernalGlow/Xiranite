import {
  cloneReaderInputBindings,
  DEFAULT_READER_INPUT_BINDINGS,
  READER_INPUT_ACTIONS,
  READER_INPUT_CONTEXTS,
  READER_MOUSE_GESTURE_DIRECTIONS,
  READER_VIEW_AREAS,
  readerInputConflicts,
  type ReaderInputAction,
  type ReaderInputBinding,
  type ReaderInputBindingsConfig,
  type ReaderInputContext,
  type ReaderInputDescriptor,
} from "../../domain/input/ReaderInputBindings.js"

export interface NeoviewInputBindingsPatch {
  inputBindings: { bindings?: ReaderInputBinding[]; reset?: "defaults" }
}

export function parseNeoviewInputBindingsConfig(value: unknown): ReaderInputBindingsConfig {
  if (value === undefined) return cloneReaderInputBindings(DEFAULT_READER_INPUT_BINDINGS)
  const record = requireRecord(value, "[nodes.neoview.bindings]")
  if (record.items === undefined) return cloneReaderInputBindings(DEFAULT_READER_INPUT_BINDINGS)
  return { bindings: parseBindings(record.items, "[nodes.neoview.bindings].items") }
}

export function parseNeoviewInputBindingsPatch(value: unknown): {
  patch: NeoviewInputBindingsPatch
  tomlPatch: Record<string, unknown>
} {
  const root = requireRecord(value, "reader input bindings patch")
  rejectUnknown(root, ["inputBindings"], "reader input bindings patch")
  const source = requireRecord(root.inputBindings, "reader input bindings patch.inputBindings")
  rejectUnknown(source, ["bindings", "reset"], "reader input bindings patch.inputBindings")
  if (source.reset !== undefined) {
    if (source.reset !== "defaults") throw new Error("reader input bindings patch.reset must be defaults.")
    if (source.bindings !== undefined) throw new Error("reader input bindings patch.reset cannot be combined with bindings.")
    const defaults = cloneReaderInputBindings(DEFAULT_READER_INPUT_BINDINGS).bindings
    return { patch: { inputBindings: { reset: "defaults" } }, tomlPatch: { bindings: { items: persistedBindings(defaults) } } }
  }
  const bindings = parseBindings(source.bindings, "reader input bindings patch.bindings")
  return {
    patch: { inputBindings: { bindings } },
    tomlPatch: { bindings: { items: persistedBindings(bindings) } },
  }
}

function parseBindings(value: unknown, label: string): ReaderInputBinding[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`)
  if (value.length > 256) throw new Error(`${label} must not contain more than 256 bindings.`)
  const bindings = value.map((entry, index) => parseBinding(entry, `${label}[${index}]`))
  const ids = new Set<string>()
  for (const current of bindings) {
    if (ids.has(current.id)) throw new Error(`${label} contains duplicate id ${current.id}.`)
    ids.add(current.id)
  }
  const conflicts = readerInputConflicts(bindings)
  if (conflicts.length) throw new Error(`${label} contains conflicting enabled bindings: ${conflicts[0]!.key}.`)
  return bindings
}

function parseBinding(value: unknown, label: string): ReaderInputBinding {
  const source = requireRecord(value, label)
  rejectUnknown(source, ["id", "action", "context", "enabled", "input"], label)
  const id = requiredString(source.id, `${label}.id`, 80)
  const action = requiredEnum(source.action, READER_INPUT_ACTIONS, `${label}.action`)
  const context = requiredEnum(source.context, READER_INPUT_CONTEXTS, `${label}.context`)
  if (typeof source.enabled !== "boolean") throw new Error(`${label}.enabled must be a boolean.`)
  return { id, action, context, enabled: source.enabled, input: parseInput(source.input, `${label}.input`) }
}

function parseInput(value: unknown, label: string): ReaderInputDescriptor {
  const source = requireRecord(value, label)
  const device = requiredEnum(source.device, ["keyboard", "mouse", "mouse-gesture", "wheel", "touch", "gamepad", "area"] as const, `${label}.device`)
  if (device === "keyboard") {
    rejectUnknown(source, ["device", "code", "ctrl", "alt", "shift", "meta"], label)
    return { device, code: requiredString(source.code, `${label}.code`, 64), ...modifiers(source, label) }
  }
  if (device === "mouse") {
    rejectUnknown(source, ["device", "button", "action", "click", "durationMs", "moveTolerancePx"], label)
    const legacyClick = source.click === undefined ? undefined : requiredEnum(source.click, ["single", "double"] as const, `${label}.click`)
    if (source.action !== undefined && legacyClick !== undefined) throw new Error(`${label}.action cannot be combined with legacy click.`)
    const action = source.action === undefined
      ? legacyClick === "double" ? "double-click" : legacyClick === "single" ? "click" : undefined
      : requiredEnum(source.action, ["click", "double-click", "press", "hold"] as const, `${label}.action`)
    if (!action) throw new Error(`${label}.action is required.`)
    return {
      device,
      button: boundedInteger(source.button, 0, 7, `${label}.button`),
      action,
      ...timing(source, label, action === "hold"),
    }
  }
  if (device === "mouse-gesture") {
    rejectUnknown(source, ["device", "button", "directions", "trigger", "durationMs", "moveTolerancePx"], label)
    if (!Array.isArray(source.directions) || source.directions.length < 1 || source.directions.length > 16) {
      throw new Error(`${label}.directions must contain between 1 and 16 directions.`)
    }
    const directions = source.directions.map((direction, index) => requiredEnum(direction, READER_MOUSE_GESTURE_DIRECTIONS, `${label}.directions[${index}]`))
    if (directions.some((direction, index) => index > 0 && direction === directions[index - 1])) {
      throw new Error(`${label}.directions must not contain adjacent duplicates.`)
    }
    const trigger = requiredEnum(source.trigger, ["instant", "hold"] as const, `${label}.trigger`)
    return {
      device,
      button: boundedInteger(source.button, 0, 7, `${label}.button`),
      directions,
      trigger,
      ...timing(source, label, trigger === "hold"),
    }
  }
  if (device === "wheel") {
    rejectUnknown(source, ["device", "direction", "ctrl", "alt", "shift", "meta"], label)
    return { device, direction: requiredEnum(source.direction, ["up", "down"] as const, `${label}.direction`), ...modifiers(source, label) }
  }
  if (device === "touch") {
    rejectUnknown(source, ["device", "gesture", "fingers", "durationMs", "moveTolerancePx"], label)
    const gesture = requiredEnum(source.gesture, ["swipe-left", "swipe-right", "swipe-up", "swipe-down", "tap", "long-press"] as const, `${label}.gesture`)
    return {
      device,
      gesture,
      fingers: requiredEnum(source.fingers, [1, 2, 3] as const, `${label}.fingers`),
      ...timing(source, label, gesture === "long-press"),
    }
  }
  if (device === "gamepad") {
    rejectUnknown(source, ["device", "button"], label)
    return { device, button: boundedInteger(source.button, 0, 31, `${label}.button`) }
  }
  rejectUnknown(source, ["device", "area", "button", "action"], label)
  return {
    device,
    area: requiredEnum(source.area, READER_VIEW_AREAS, `${label}.area`),
    button: requiredEnum(source.button, [0, 1, 2] as const, `${label}.button`),
    action: requiredEnum(source.action, ["click", "double-click", "press"] as const, `${label}.action`),
  }
}

function persistedBindings(bindings: readonly ReaderInputBinding[]): unknown[] {
  return bindings.map((current) => ({ ...current, input: { ...current.input } }))
}

function modifiers(source: Record<string, unknown>, label: string): { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } {
  const result: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}
  for (const key of ["ctrl", "alt", "shift", "meta"] as const) {
    if (source[key] === undefined) continue
    if (typeof source[key] !== "boolean") throw new Error(`${label}.${key} must be a boolean.`)
    if (source[key]) result[key] = true
  }
  return result
}

function timing(source: Record<string, unknown>, label: string, durationRequired: boolean): { durationMs?: number; moveTolerancePx?: number } {
  const result: { durationMs?: number; moveTolerancePx?: number } = {}
  if (source.durationMs !== undefined) result.durationMs = boundedInteger(source.durationMs, 100, 5_000, `${label}.durationMs`)
  if (source.moveTolerancePx !== undefined) result.moveTolerancePx = boundedInteger(source.moveTolerancePx, 1, 100, `${label}.moveTolerancePx`)
  if (durationRequired && result.durationMs === undefined) result.durationMs = 500
  if (durationRequired && result.moveTolerancePx === undefined) result.moveTolerancePx = 12
  return result
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`)
  return value as Record<string, unknown>
}

function rejectUnknown(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key))
  if (unknown.length) throw new Error(`${label} contains unsupported fields: ${unknown.join(", ")}.`)
}

function requiredString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) throw new Error(`${label} must be a non-empty string up to ${maxLength} characters.`)
  return value.trim()
}

function requiredEnum<const T extends string | number>(value: unknown, values: readonly T[], label: string): T {
  if (!values.includes(value as T)) throw new Error(`${label} is invalid.`)
  return value as T
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`)
  return value as number
}
