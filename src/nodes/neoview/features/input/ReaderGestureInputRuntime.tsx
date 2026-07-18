import { useGesture } from "@use-gesture/react"
import { useRef, type RefObject } from "react"
import type { ReaderInputDescriptor } from "@xiranite/node-neoview/ui-core"
import { isReaderInputInteractive } from "./ReaderInputRouter"

export interface ReaderGestureInputRuntimeProps {
  disabled?: boolean
  target: RefObject<HTMLElement | null>
  dispatch(input: ReaderInputDescriptor, target: EventTarget | null): boolean
}

export function ReaderGestureInputRuntime({ disabled = false, target, dispatch }: ReaderGestureInputRuntimeProps) {
  const dispatchRef = useRef(dispatch)
  dispatchRef.current = dispatch

  useGesture({
    onWheel: ({ first, event, direction: [, y] }) => {
      if (disabled || !first || y === 0) return
      const wheel = event as WheelEvent
      if (isReaderInputInteractive(wheel.target)) return
      if (dispatchRef.current({
        device: "wheel",
        direction: y > 0 ? "down" : "up",
        ctrl: wheel.ctrlKey || undefined,
        alt: wheel.altKey || undefined,
        shift: wheel.shiftKey || undefined,
        meta: wheel.metaKey || undefined,
      }, wheel.target)) wheel.preventDefault()
    },
    onDrag: ({ last, event, swipe: [x, y], touches, memo = 1 }) => {
      const pointer = event as PointerEvent
      if (isReaderInputInteractive(pointer.target)) return memo
      const fingers = Math.max(Number(memo), touches || 1)
      if (last && !disabled && pointer.pointerType === "touch" && (x || y)) {
        const gesture = Math.abs(x) >= Math.abs(y)
          ? x < 0 ? "swipe-left" : "swipe-right"
          : y < 0 ? "swipe-up" : "swipe-down"
        if (dispatchRef.current({ device: "touch", gesture, fingers: Math.min(3, fingers) as 1 | 2 | 3 }, pointer.target)) pointer.preventDefault()
      }
      return fingers
    },
  }, {
    target,
    drag: { filterTaps: true },
    wheel: { eventOptions: { passive: false } },
  })

  return null
}
