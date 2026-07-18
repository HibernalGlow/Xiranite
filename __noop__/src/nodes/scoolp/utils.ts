import { ACTIONS, DEFAULT_CONFIG_TEXT } from "./constants"
import type { ScoolpCardState } from "./types"

export function getActionMeta(value: ScoolpCardState["action"]) {
  return ACTIONS.find((item) => item.value === value) ?? ACTIONS[0]!
}

export function defaultConfigIfEmpty(value: string | undefined): string {
  return value && value.trim() ? value : DEFAULT_CONFIG_TEXT
}
