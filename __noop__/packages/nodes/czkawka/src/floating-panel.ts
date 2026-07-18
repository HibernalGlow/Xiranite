export interface CzkawkaFloatingRect { x: number; y: number; width: number; height: number }
export interface CzkawkaFloatingViewport { width: number; height: number }
export interface CzkawkaFloatingPanelState { open: boolean; rect: CzkawkaFloatingRect }
export type CzkawkaResizeDirection = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw"

const MARGIN = 8
const MIN_WIDTH = 260
const MIN_HEIGHT = 220
const MAX_WIDTH = 900
const MAX_HEIGHT = 900

export function createDefaultCzkawkaFloatingPanel(viewport: CzkawkaFloatingViewport): CzkawkaFloatingPanelState {
  const width = Math.min(380, Math.max(0, viewport.width - MARGIN * 2))
  const height = Math.min(560, Math.max(0, viewport.height - MARGIN * 2))
  return { open: false, rect: clampCzkawkaFloatingRect({ x: viewport.width - width - 24, y: 64, width, height }, viewport) }
}

export function normalizeCzkawkaFloatingPanel(value: CzkawkaFloatingPanelState | undefined, viewport: CzkawkaFloatingViewport): CzkawkaFloatingPanelState {
  const fallback = createDefaultCzkawkaFloatingPanel(viewport)
  return value ? { open: Boolean(value.open), rect: clampCzkawkaFloatingRect(value.rect, viewport) } : fallback
}

export function clampCzkawkaFloatingRect(rect: CzkawkaFloatingRect, viewport: CzkawkaFloatingViewport): CzkawkaFloatingRect {
  const availableWidth = Math.max(0, viewport.width - MARGIN * 2)
  const availableHeight = Math.max(0, viewport.height - MARGIN * 2)
  const width = clamp(rect.width, Math.min(MIN_WIDTH, availableWidth), Math.min(MAX_WIDTH, availableWidth))
  const height = clamp(rect.height, Math.min(MIN_HEIGHT, availableHeight), Math.min(MAX_HEIGHT, availableHeight))
  const x = clamp(rect.x, MARGIN, Math.max(MARGIN, viewport.width - width - MARGIN))
  const y = clamp(rect.y, MARGIN, Math.max(MARGIN, viewport.height - height - MARGIN))
  return { x, y, width, height }
}

export function moveCzkawkaFloatingRect(rect: CzkawkaFloatingRect, deltaX: number, deltaY: number, viewport: CzkawkaFloatingViewport): CzkawkaFloatingRect {
  return clampCzkawkaFloatingRect({ ...rect, x: rect.x + deltaX, y: rect.y + deltaY }, viewport)
}

export function resizeCzkawkaFloatingRect(rect: CzkawkaFloatingRect, direction: CzkawkaResizeDirection, deltaX: number, deltaY: number, viewport: CzkawkaFloatingViewport): CzkawkaFloatingRect {
  let { x, y, width, height } = rect
  if (direction.includes("e")) width += deltaX
  if (direction.includes("s")) height += deltaY
  if (direction.includes("w")) { x += deltaX; width -= deltaX }
  if (direction.includes("n")) { y += deltaY; height -= deltaY }
  const clamped = clampCzkawkaFloatingRect({ x, y, width, height }, viewport)
  if (direction.includes("w")) clamped.x = Math.min(rect.x + rect.width - clamped.width, viewport.width - clamped.width - MARGIN)
  if (direction.includes("n")) clamped.y = Math.min(rect.y + rect.height - clamped.height, viewport.height - clamped.height - MARGIN)
  return clampCzkawkaFloatingRect(clamped, viewport)
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(min, value), Math.max(min, max))
}
