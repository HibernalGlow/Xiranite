import type { CzkawkaEntry, CzkawkaGroup } from "./core.js"

export type CzkawkaImageComparisonMode = "single" | "side-by-side" | "swipe" | "onion-skin"

export interface CzkawkaImageComparisonPreferences {
  mode: CzkawkaImageComparisonMode
  colorCoding: boolean
}

export interface CzkawkaImageComparisonState extends CzkawkaImageComparisonPreferences {
  activePath?: string
  targetPath?: string
  swipePercent: number
  onionOpacity: number
}

export const CZKAWKA_IMAGE_COMPARISON_DEFAULTS: CzkawkaImageComparisonPreferences = {
  mode: "single",
  colorCoding: false,
}

export function createCzkawkaImageComparison(
  preferences: Partial<CzkawkaImageComparisonPreferences> = {},
): CzkawkaImageComparisonState {
  return {
    mode: preferences.mode ?? CZKAWKA_IMAGE_COMPARISON_DEFAULTS.mode,
    colorCoding: preferences.colorCoding ?? CZKAWKA_IMAGE_COMPARISON_DEFAULTS.colorCoding,
    swipePercent: 50,
    onionOpacity: 50,
  }
}

export function openCzkawkaImageComparison(
  state: CzkawkaImageComparisonState,
  groups: readonly CzkawkaGroup[],
  activePath: string,
): CzkawkaImageComparisonState {
  const group = findGroup(groups, activePath)
  if (!group) return closeCzkawkaImageComparison(state)
  return {
    ...state,
    activePath,
    targetPath: group.entries.find((entry) => entry.path !== activePath)?.path,
    swipePercent: 50,
    onionOpacity: 50,
  }
}

export function closeCzkawkaImageComparison(
  state: CzkawkaImageComparisonState,
): CzkawkaImageComparisonState {
  return { ...state, activePath: undefined, targetPath: undefined }
}

export function setCzkawkaImageComparisonTarget(
  state: CzkawkaImageComparisonState,
  groups: readonly CzkawkaGroup[],
  targetPath: string,
): CzkawkaImageComparisonState {
  const group = state.activePath ? findGroup(groups, state.activePath) : undefined
  if (!group || targetPath === state.activePath || !group.entries.some((entry) => entry.path === targetPath)) return state
  return { ...state, targetPath, swipePercent: 50, onionOpacity: 50 }
}

export function setCzkawkaImageComparisonMode(
  state: CzkawkaImageComparisonState,
  mode: CzkawkaImageComparisonMode,
): CzkawkaImageComparisonState {
  return state.mode === mode ? state : { ...state, mode }
}

export function setCzkawkaImageComparisonColorCoding(
  state: CzkawkaImageComparisonState,
  colorCoding: boolean,
): CzkawkaImageComparisonState {
  return state.colorCoding === colorCoding ? state : { ...state, colorCoding }
}

export function setCzkawkaImageComparisonSwipe(
  state: CzkawkaImageComparisonState,
  swipePercent: number,
): CzkawkaImageComparisonState {
  const next = percentage(swipePercent)
  return state.swipePercent === next ? state : { ...state, swipePercent: next }
}

export function setCzkawkaImageComparisonOpacity(
  state: CzkawkaImageComparisonState,
  onionOpacity: number,
): CzkawkaImageComparisonState {
  const next = percentage(onionOpacity)
  return state.onionOpacity === next ? state : { ...state, onionOpacity: next }
}

export function getCzkawkaImageComparisonEntries(
  state: CzkawkaImageComparisonState,
  groups: readonly CzkawkaGroup[],
): { active?: CzkawkaEntry; target?: CzkawkaEntry; group: readonly CzkawkaEntry[] } {
  const group = state.activePath ? findGroup(groups, state.activePath) : undefined
  if (!group) return { group: [] }
  return {
    active: group.entries.find((entry) => entry.path === state.activePath),
    target: group.entries.find((entry) => entry.path === state.targetPath),
    group: group.entries,
  }
}

export function czkawkaImageComparisonPreferences(
  state: CzkawkaImageComparisonState,
): CzkawkaImageComparisonPreferences {
  return { mode: state.mode, colorCoding: state.colorCoding }
}

function findGroup(groups: readonly CzkawkaGroup[], path: string): CzkawkaGroup | undefined {
  return groups.find((group) => group.entries.some((entry) => entry.path === path))
}

function percentage(value: number): number {
  if (!Number.isFinite(value)) return 50
  return Math.max(0, Math.min(100, Math.round(value)))
}
