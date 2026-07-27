import { parseNeoviewInputBindingsPatch, type NeoviewInputBindingsPatch } from "./ReaderInputBindingsConfig.js"
import {
  cloneReaderRadialMenuConfig,
  DEFAULT_READER_RADIAL_MENU_CONFIG,
  parseReaderRadialMenuPatch,
  type NeoviewRadialMenuPatch,
  type ReaderRadialMenuConfig,
} from "./ReaderRadialMenuConfig.js"

export type ReaderInputBindingsRadialMenuPatch =
  | { kind: "input"; input: NeoviewInputBindingsPatch; tomlPatch: Record<string, unknown> }
  | { kind: "radial"; radial: NeoviewRadialMenuPatch; tomlPatch: Record<string, unknown> }
  | { kind: "combined"; input: NeoviewInputBindingsPatch; radialMenu: ReaderRadialMenuConfig; tomlPatch: Record<string, unknown> }

export function parseReaderInputBindingsRadialMenuPatch(value: Record<string, unknown>): ReaderInputBindingsRadialMenuPatch | undefined {
  const hasInputBindings = Object.hasOwn(value, "inputBindings")
  const hasRadialMenu = Object.hasOwn(value, "radialMenu")
  if (!hasInputBindings && !hasRadialMenu) return undefined
  if (hasInputBindings && hasRadialMenu) {
    const input = parseNeoviewInputBindingsPatch({ inputBindings: value.inputBindings })
    const radial = parseReaderRadialMenuPatch({ radialMenu: value.radialMenu })
    return {
      kind: "combined",
      input: input.patch,
      radialMenu: radial.patch.radialMenu.config ?? cloneReaderRadialMenuConfig(DEFAULT_READER_RADIAL_MENU_CONFIG),
      tomlPatch: { bindings: { ...(input.tomlPatch.bindings as Record<string, unknown>), ...(radial.tomlPatch.bindings as Record<string, unknown>) } },
    }
  }
  if (hasInputBindings) {
    const input = parseNeoviewInputBindingsPatch(value)
    return { kind: "input", input: input.patch, tomlPatch: input.tomlPatch }
  }
  const radial = parseReaderRadialMenuPatch(value)
  return { kind: "radial", radial: radial.patch, tomlPatch: radial.tomlPatch }
}
