import { useGesture } from "@use-gesture/react"
import { Gamepad2, MousePointer2, Radio, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useHotkeys } from "react-hotkeys-hook"
import type { ReaderInputDescriptor } from "@xiranite/node-neoview/ui-core"

import { Button } from "@/components/ui/button"
import { isReaderInputInteractive } from "./ReaderInputRouter"
import { advanceReaderMouseGesture, beginReaderMouseGesture, readerMouseButtonFromButtons, type ReaderMouseGestureTrace } from "./ReaderMouseGesture"

type RecordableDevice = Extract<ReaderInputDescriptor["device"], "mouse" | "mouse-gesture" | "wheel" | "touch" | "gamepad">
type RecordedInput = Exclude<ReaderInputDescriptor, { device: "keyboard" | "area" }>

interface RecorderDragMemo {
  button: number
  fingers: number
  trace: ReaderMouseGestureTrace
}

export interface ReaderDeviceInputRecorderProps {
  device: RecordableDevice
  onCancel(): void
  onRecord(input: RecordedInput): void
}

export function ReaderDeviceInputRecorder({ device, onCancel, onRecord }: ReaderDeviceInputRecorderProps) {
  const target = useRef<HTMLDivElement | null>(null)
  const [gesturePreview, setGesturePreview] = useState<Extract<ReaderInputDescriptor, { device: "mouse-gesture" }>["directions"]>([])
  const onRecordRef = useRef(onRecord)
  onRecordRef.current = onRecord

  useHotkeys("escape", (event) => {
    event.stopImmediatePropagation()
    onCancel()
  }, {
    eventListenerOptions: { capture: true },
    preventDefault: true,
  }, [onCancel])

  useGesture({
    onWheel: ({ first, event, direction: [, y], ctrlKey, altKey, shiftKey, metaKey }) => {
      if (device !== "wheel" || !first || y === 0) return
      const wheel = event as WheelEvent
      if (isReaderInputInteractive(wheel.target)) return
      wheel.preventDefault()
      onRecordRef.current({
        device: "wheel",
        direction: y > 0 ? "down" : "up",
        ctrl: ctrlKey || undefined,
        alt: altKey || undefined,
        shift: shiftKey || undefined,
        meta: metaKey || undefined,
      })
    },
    onDrag: ({ first, last, event, swipe: [x, y], tap, touches, buttons, initial: [initialX, initialY], xy: [clientX, clientY], memo }) => {
      if (isReaderInputInteractive(event.target)) return memo
      const pointer = event as PointerEvent
      const current: RecorderDragMemo = first || !memo
        ? { button: readerMouseButtonFromButtons(buttons, pointer.button), fingers: touches || 1, trace: beginReaderMouseGesture(initialX, initialY) }
        : memo as RecorderDragMemo
      current.fingers = Math.max(current.fingers, touches || 1)
      if (device === "mouse-gesture" && pointer.pointerType === "mouse") {
        const previousLength = current.trace.directions.length
        current.trace = advanceReaderMouseGesture(current.trace, clientX, clientY)
        if (current.trace.directions.length !== previousLength) setGesturePreview(current.trace.directions)
      }
      if (!last) return current
      if (device === "mouse" && pointer.pointerType === "mouse" && tap) {
        onRecordRef.current({ device: "mouse", button: current.button, action: pointer.detail > 1 ? "double-click" : "click" })
      }
      if (device === "mouse-gesture" && pointer.pointerType === "mouse" && current.trace.directions.length) {
        onRecordRef.current({ device: "mouse-gesture", button: current.button, directions: current.trace.directions, trigger: "instant" })
      }
      if (device === "touch" && pointer.pointerType === "touch" && (x || y)) {
        const gesture = Math.abs(x) >= Math.abs(y)
          ? x < 0 ? "swipe-left" : "swipe-right"
          : y < 0 ? "swipe-up" : "swipe-down"
        onRecordRef.current({ device: "touch", gesture, fingers: Math.min(3, current.fingers) as 1 | 2 | 3 })
      }
      if (device === "touch" && pointer.pointerType === "touch" && tap) {
        onRecordRef.current({ device: "touch", gesture: "tap", fingers: Math.min(3, current.fingers) as 1 | 2 | 3 })
      }
      return current
    },
  }, {
    target,
    drag: { filterTaps: true, pointer: { buttons: -1 } },
    wheel: { eventOptions: { passive: false } },
  })

  useEffect(() => {
    if (device !== "gamepad") return
    let disposed = false
    let listener: import("gamepad.js").GamepadListener | undefined
    const onButton = (event: CustomEvent<import("gamepad.js").GamepadButtonEventDetail>) => {
      if (!event.detail.pressed) return
      onRecordRef.current({ device: "gamepad", button: event.detail.button })
    }
    void import("gamepad.js").then(({ GamepadListener }) => {
      if (disposed) return
      listener = new GamepadListener({ button: { analog: false, deadZone: 0.5 } })
      listener.on("gamepad:button", onButton)
      listener.start()
    }).catch(() => undefined)
    return () => {
      disposed = true
      listener?.off("gamepad:button", onButton)
      listener?.stop()
    }
  }, [device])

  return (
    <div ref={target} className="fixed inset-0 z-[100] grid touch-none place-items-center bg-black/55 p-4" data-input-recording="true" role="dialog" aria-modal="true" aria-label={`${deviceLabel(device)}录制`}>
      <div className="grid w-full max-w-sm gap-3 rounded-md border bg-background p-4 shadow-2xl">
        <div className="flex items-center gap-2"><RecorderIcon device={device} /><h3 className="font-semibold">录制{deviceLabel(device)}</h3></div>
        <p className="text-sm text-muted-foreground">{recordingPrompt(device)}</p>
        {device === "mouse-gesture" ? <output className="min-h-9 rounded border bg-muted/40 px-3 py-2 text-center font-mono text-sm" aria-label="已录制鼠标轨迹">{gesturePreview.length ? gesturePreview.map(directionGlyph).join(" ") : "等待轨迹"}</output> : null}
        <Button type="button" variant="outline" onClick={onCancel}><X />取消录制</Button>
      </div>
    </div>
  )
}

function RecorderIcon({ device }: { device: RecordableDevice }) {
  return device === "gamepad" ? <Gamepad2 className="size-4" /> : device === "mouse" || device === "mouse-gesture" ? <MousePointer2 className="size-4" /> : <Radio className="size-4 animate-pulse" />
}

function deviceLabel(device: RecordableDevice): string {
  return device === "mouse" ? "鼠标" : device === "mouse-gesture" ? "鼠标轨迹" : device === "wheel" ? "滚轮" : device === "touch" ? "触控手势" : "手柄按钮"
}

function recordingPrompt(device: RecordableDevice): string {
  if (device === "mouse") return "请单击或双击要绑定的鼠标按钮。"
  if (device === "mouse-gesture") return "请按住鼠标按钮并拖出一至十六段方向轨迹。"
  if (device === "wheel") return "请滚动滚轮；当前修饰键会一并记录。"
  if (device === "touch") return "请用一至三指向目标方向滑动。"
  return "请按下要绑定的标准手柄按钮。"
}

function directionGlyph(direction: Extract<ReaderInputDescriptor, { device: "mouse-gesture" }>["directions"][number]): string {
  return direction === "left" ? "←" : direction === "right" ? "→" : direction === "up" ? "↑" : "↓"
}
