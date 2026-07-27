import {
  clampMelodeckFloatingSize,
  MELODECK_FLOATING_SIZE_LIMITS,
  type MelodeckFloatingOffset,
  type MelodeckFloatingSize,
} from "./config"

const FLOATING_PANEL_INSET = 12

export function clampMelodeckFloatingOffset(
  offset: MelodeckFloatingOffset,
  size: MelodeckFloatingSize,
): MelodeckFloatingOffset {
  if (typeof window === "undefined") {
    return {
      x: clamp(offset.x, -900, 0),
      y: clamp(offset.y, -720, 0),
    }
  }

  const panelWidth = Math.min(size.width, Math.max(0, window.innerWidth - FLOATING_PANEL_INSET * 2))
  const panelHeight = Math.min(size.height, Math.max(0, window.innerHeight - FLOATING_PANEL_INSET * 2))
  const baseLeft = window.innerWidth - FLOATING_PANEL_INSET - panelWidth
  const baseTop = window.innerHeight - FLOATING_PANEL_INSET - panelHeight

  return {
    x: clamp(offset.x, FLOATING_PANEL_INSET - baseLeft, 0),
    y: clamp(offset.y, FLOATING_PANEL_INSET - baseTop, 0),
  }
}

export function clampMelodeckFloatingSizeToViewport(size: MelodeckFloatingSize): MelodeckFloatingSize {
  const normalized = clampMelodeckFloatingSize(size)
  if (typeof window === "undefined") return normalized

  return {
    width: clamp(
      normalized.width,
      MELODECK_FLOATING_SIZE_LIMITS.minWidth,
      Math.max(MELODECK_FLOATING_SIZE_LIMITS.minWidth, window.innerWidth - FLOATING_PANEL_INSET * 2),
    ),
    height: clamp(
      normalized.height,
      MELODECK_FLOATING_SIZE_LIMITS.minHeight,
      Math.max(MELODECK_FLOATING_SIZE_LIMITS.minHeight, window.innerHeight - FLOATING_PANEL_INSET * 2),
    ),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
