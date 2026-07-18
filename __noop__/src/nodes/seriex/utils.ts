import { ACTIONS, DEFAULT_CONFIG_TEXT } from "./constants"
import type { SeriexCardState } from "./types"

export function getActionMeta(value: SeriexCardState["action"]) {
  return ACTIONS.find((item) => item.value === value) ?? ACTIONS[0]!
}

export function defaultConfigIfEmpty(value: string | undefined): string {
  return value && value.trim() ? value : DEFAULT_CONFIG_TEXT
}
