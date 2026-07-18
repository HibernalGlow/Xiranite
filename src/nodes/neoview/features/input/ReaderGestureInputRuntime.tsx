import { useGesture } from "@use-gesture/react"
import { useEffect, useRef, type RefObject } from "react"
import {
  matchingReaderInputBinding,
  type ReaderInputBinding,
  type ReaderInputBindingsConfig,
  type ReaderInputDescriptor,
} from "@xiranite/node-neoview/ui-core"
import { isReaderInputInteractive, readerInputContexts } from "./ReaderInputRouter"
import { advanceReaderMouseGesture, beginReaderMouseGesture, readerMouseButtonFromButtons, type ReaderMouseGestureTrace } from "./ReaderMouseGesture"

export interface ReaderGestureInputRuntimeProps {
  config: ReaderInputBindingsConfig
  disabled?: boolean
  target: RefObject<HTMLElement | null>
  claimPointer(pointerId: number): void
  dispatch(input: ReaderInputDescriptor, target: EventTarget | null): boolean
}

interface DragMemo {
  button: number
  cancelled: boolean
  fingers: number
  holdHandled: boolean
  holdTimer?: ReturnType<typeof setTimeout>
  pointerId: number
  startX: number
  startY: number
  target: EventTarget | null
  trace: ReaderMouseGestureTrace
}

export function ReaderGestureInputRuntime({ config, disabled = false, target, claimPointer, dispatch }: ReaderGestureInputRuntimeProps) {
  const claimPointerRef = useRef(claimPointer)
  claimPointerRef.current = claimPointer
  const configRef = useRef(config)
  configRef.current = config
  const dispatchRef = useRef(dispatch)
  dispatchRef.current = dispatch
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>())

  useEffect(() => () => {
    for (const timer of timersRef.current) clearTimeout(timer)
    timersRef.current.clear()
  }, [])

  function clearHold(memo: DragMemo): void {
    if (!memo.holdTimer) return
    clearTimeout(memo.holdTimer)
    timersRef.current.delete(memo.holdTimer)
    memo.holdTimer = undefined
  }

  function scheduleHold(memo: DragMemo, binding: ReaderInputBinding | undefined): void {
    clearHold(memo)
    if (!binding || disabled) return
    const input = binding.input
    const durationMs = "durationMs" in input ? input.durationMs ?? 500 : 500
    const timer = setTimeout(() => {
      timersRef.current.delete(timer)
      memo.holdTimer = undefined
      if (memo.cancelled || !dispatchRef.current(input, memo.target)) return
      memo.holdHandled = true
      claimPointerRef.current(memo.pointerId)
    }, durationMs)
    memo.holdTimer = timer
    timersRef.current.add(timer)
  }

  function matching(input: ReaderInputDescriptor, eventTarget: EventTarget | null): ReaderInputBinding | undefined {
    return matchingReaderInputBinding(configRef.current.bindings, input, readerInputContexts(eventTarget))
  }

  useGesture({
    onWheel: ({ first, event, direction: [, y], ctrlKey, altKey, shiftKey, metaKey }) => {
      if (disabled || !first || y === 0) return
      const wheel = event as WheelEvent
      if (isReaderInputInteractive(wheel.target)) return
      if (dispatchRef.current({
        device: "wheel",
        direction: y > 0 ? "down" : "up",
        ctrl: ctrlKey || undefined,
        alt: altKey || undefined,
        shift: shiftKey || undefined,
        meta: metaKey || undefined,
      }, wheel.target)) wheel.preventDefault()
    },
    onDrag: ({ first, last, event, swipe: [swipeX, swipeY], tap, touches, buttons, initial: [initialX, initialY], xy: [clientX, clientY], memo }) => {
      const pointer = event as PointerEvent
      if (isReaderInputInteractive(pointer.target)) return memo
      const current: DragMemo = first || !memo
        ? {
            button: readerMouseButtonFromButtons(buttons, pointer.button),
            cancelled: false,
            fingers: touches || 1,
            holdHandled: false,
            pointerId: pointer.pointerId,
            startX: initialX,
            startY: initialY,
            target: pointer.target,
            trace: beginReaderMouseGesture(initialX, initialY),
          }
        : memo as DragMemo
      current.fingers = Math.max(current.fingers, touches || 1)

      if (first && !disabled && pointer.pointerType === "mouse") {
        scheduleHold(current, matching({ device: "mouse", button: current.button, action: "hold" }, current.target))
      }
      if (first && !disabled && pointer.pointerType === "touch") {
        scheduleHold(current, matching({ device: "touch", gesture: "long-press", fingers: Math.min(3, current.fingers) as 1 | 2 | 3 }, current.target))
      }

      const distance = Math.hypot(clientX - current.startX, clientY - current.startY)
      const holdInput = pointer.pointerType === "mouse"
        ? matching({ device: "mouse", button: current.button, action: "hold" }, current.target)?.input
        : matching({ device: "touch", gesture: "long-press", fingers: Math.min(3, current.fingers) as 1 | 2 | 3 }, current.target)?.input
      const tolerance = holdInput && "moveTolerancePx" in holdInput ? holdInput.moveTolerancePx ?? 12 : 12
      if (distance > tolerance) clearHold(current)

      if (pointer.pointerType === "mouse") {
        const previousLength = current.trace.directions.length
        current.trace = advanceReaderMouseGesture(current.trace, clientX, clientY)
        if (!disabled && current.trace.directions.length !== previousLength) {
          const gesture = { device: "mouse-gesture", button: current.button, directions: current.trace.directions, trigger: "hold" } as const
          scheduleHold(current, matching(gesture, current.target))
        }
      }

      if (!last) return current
      current.cancelled = true
      clearHold(current)
      if (disabled || current.holdHandled) {
        if (current.holdHandled) pointer.preventDefault()
        return current
      }
      if (pointer.pointerType === "mouse" && current.trace.directions.length) {
        const input = { device: "mouse-gesture", button: current.button, directions: current.trace.directions, trigger: "instant" } as const
        if (dispatchRef.current(input, current.target)) {
          claimPointerRef.current(current.pointerId)
          pointer.preventDefault()
        }
        return current
      }
      if (pointer.pointerType === "touch" && tap) {
        const input = { device: "touch", gesture: "tap", fingers: Math.min(3, current.fingers) as 1 | 2 | 3 } as const
        if (dispatchRef.current(input, current.target)) pointer.preventDefault()
        return current
      }
      if (pointer.pointerType === "touch" && (swipeX || swipeY)) {
        const gesture = Math.abs(swipeX) >= Math.abs(swipeY)
          ? swipeX < 0 ? "swipe-left" : "swipe-right"
          : swipeY < 0 ? "swipe-up" : "swipe-down"
        if (dispatchRef.current({ device: "touch", gesture, fingers: Math.min(3, current.fingers) as 1 | 2 | 3 }, current.target)) pointer.preventDefault()
      }
      return current
    },
  }, {
    target,
    drag: { filterTaps: false, pointer: { buttons: -1 } },
    wheel: { eventOptions: { passive: false } },
  })

  return <span hidden data-reader-input-runtime="ready" />
}
