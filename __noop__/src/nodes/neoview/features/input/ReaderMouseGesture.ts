import type { ReaderMouseGestureDirection } from "@xiranite/node-neoview/ui-core"

export interface ReaderMouseGestureTrace {
  anchorX: number
  anchorY: number
  directions: ReaderMouseGestureDirection[]
}

export function beginReaderMouseGesture(x: number, y: number): ReaderMouseGestureTrace {
  return { anchorX: x, anchorY: y, directions: [] }
}

export function advanceReaderMouseGesture(
  trace: ReaderMouseGestureTrace,
  x: number,
  y: number,
  minimumDistance = 20,
): ReaderMouseGestureTrace {
  const dx = x - trace.anchorX
  const dy = y - trace.anchorY
  if (Math.hypot(dx, dy) < minimumDistance || trace.directions.length >= 16) return trace
  const direction: ReaderMouseGestureDirection = Math.abs(dx) >= Math.abs(dy)
    ? dx < 0 ? "left" : "right"
    : dy < 0 ? "up" : "down"
  const directions = trace.directions.at(-1) === direction ? trace.directions : [...trace.directions, direction]
  return { anchorX: x, anchorY: y, directions }
}

export function readerMouseButtonFromButtons(buttons: number, fallback: number): number {
  if (buttons & 1) return 0
  if (buttons & 4) return 1
  if (buttons & 2) return 2
  for (let button = 3; button <= 7; button += 1) {
    if (buttons & (1 << button)) return button
  }
  return fallback
}
