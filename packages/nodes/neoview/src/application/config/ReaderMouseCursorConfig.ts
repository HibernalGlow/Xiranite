import { DEFAULT_READER_MOUSE_CURSOR_SETTINGS, type ReaderMouseCursorSettings } from "../../domain/view/ReaderMouseCursor.js"

export function parseReaderMouseCursorSettings(value: unknown): ReaderMouseCursorSettings {
  const cursor = optionalRecord(value, "[nodes.neoview.view.mouse_cursor]")
  return {
    autoHide: optionalBoolean(cursor?.auto_hide ?? cursor?.autoHide, "[nodes.neoview.view.mouse_cursor].auto_hide") ?? DEFAULT_READER_MOUSE_CURSOR_SETTINGS.autoHide,
    hideDelay: boundedNumber(cursor?.hide_delay ?? cursor?.hideDelay, 0, 60, DEFAULT_READER_MOUSE_CURSOR_SETTINGS.hideDelay, "[nodes.neoview.view.mouse_cursor].hide_delay"),
    showMovementThreshold: boundedNumber(cursor?.show_movement_threshold ?? cursor?.showMovementThreshold, 0, 1_000, DEFAULT_READER_MOUSE_CURSOR_SETTINGS.showMovementThreshold, "[nodes.neoview.view.mouse_cursor].show_movement_threshold"),
    showOnButtonClick: optionalBoolean(cursor?.show_on_button_click ?? cursor?.showOnButtonClick, "[nodes.neoview.view.mouse_cursor].show_on_button_click") ?? DEFAULT_READER_MOUSE_CURSOR_SETTINGS.showOnButtonClick,
    showOnKeyDown: optionalBoolean(cursor?.show_on_key_down ?? cursor?.showOnKeyDown, "[nodes.neoview.view.mouse_cursor].show_on_key_down") ?? DEFAULT_READER_MOUSE_CURSOR_SETTINGS.showOnKeyDown,
    showOnWheel: optionalBoolean(cursor?.show_on_wheel ?? cursor?.showOnWheel, "[nodes.neoview.view.mouse_cursor].show_on_wheel") ?? DEFAULT_READER_MOUSE_CURSOR_SETTINGS.showOnWheel,
  }
}

export function parseReaderMouseCursorPatch(value: unknown): { patch: Partial<ReaderMouseCursorSettings>; tomlPatch: Record<string, unknown> } {
  const cursor = requireRecord(value, "reader view defaults patch.mouseCursor")
  const allowed = new Set(["autoHide", "hideDelay", "showMovementThreshold", "showOnButtonClick", "showOnKeyDown", "showOnWheel"])
  const unknown = Object.keys(cursor).filter((key) => !allowed.has(key))
  if (unknown.length) throw new Error(`reader view defaults patch.mouseCursor contains unsupported fields: ${unknown.join(", ")}.`)
  const patch: Partial<ReaderMouseCursorSettings> = {}
  const tomlPatch: Record<string, unknown> = {}
  if (cursor.autoHide !== undefined) {
    patch.autoHide = requiredBoolean(cursor.autoHide, "reader view defaults patch.mouseCursor.autoHide")
    tomlPatch.auto_hide = patch.autoHide
  }
  if (cursor.hideDelay !== undefined) {
    patch.hideDelay = boundedNumber(cursor.hideDelay, 0, 60, DEFAULT_READER_MOUSE_CURSOR_SETTINGS.hideDelay, "reader view defaults patch.mouseCursor.hideDelay")
    tomlPatch.hide_delay = patch.hideDelay
  }
  if (cursor.showMovementThreshold !== undefined) {
    patch.showMovementThreshold = boundedNumber(cursor.showMovementThreshold, 0, 1_000, DEFAULT_READER_MOUSE_CURSOR_SETTINGS.showMovementThreshold, "reader view defaults patch.mouseCursor.showMovementThreshold")
    tomlPatch.show_movement_threshold = patch.showMovementThreshold
  }
  if (cursor.showOnButtonClick !== undefined) {
    patch.showOnButtonClick = requiredBoolean(cursor.showOnButtonClick, "reader view defaults patch.mouseCursor.showOnButtonClick")
    tomlPatch.show_on_button_click = patch.showOnButtonClick
  }
  if (cursor.showOnKeyDown !== undefined) {
    patch.showOnKeyDown = requiredBoolean(cursor.showOnKeyDown, "reader view defaults patch.mouseCursor.showOnKeyDown")
    tomlPatch.show_on_key_down = patch.showOnKeyDown
  }
  if (cursor.showOnWheel !== undefined) {
    patch.showOnWheel = requiredBoolean(cursor.showOnWheel, "reader view defaults patch.mouseCursor.showOnWheel")
    tomlPatch.show_on_wheel = patch.showOnWheel
  }
  if (!Object.keys(patch).length) throw new Error("reader view defaults patch.mouseCursor must change at least one field.")
  return { patch, tomlPatch }
}

function optionalRecord(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  return requireRecord(value, label)
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object.`)
  return value as Record<string, unknown>
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined
  return requiredBoolean(value, label)
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean.`)
  return value
}

function boundedNumber(value: unknown, minimum: number, maximum: number, fallback: number, label: string): number {
  if (value === undefined) return fallback
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${label} must be between ${minimum} and ${maximum}.`)
  return value
}
