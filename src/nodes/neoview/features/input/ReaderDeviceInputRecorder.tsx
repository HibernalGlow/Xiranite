import { useGesture } from "@use-gesture/react"
import { Gamepad2, MousePointer2, Radio, X } from "lucide-react"
import { useEffect, useRef } from "react"
import { useHotkeys } from "react-hotkeys-hook"
import type { ReaderInputDescriptor } from "@xiranite/node-neoview/ui-core"

import { Button } from "@/components/ui/button"
import { isReaderInputInteractive } from "./ReaderInputRouter"

type RecordableDevice = Exclude<ReaderInputDescriptor["device"], "keyboard">

export interface ReaderDeviceInputRecorderProps {
  device: RecordableDevice
  onCancel(): void
  onRecord(input: Exclude<ReaderInputDescriptor, { device: "keyboard" }>): void
}

export function ReaderDeviceInputRecorder({ device, onCancel, onRecord }: ReaderDeviceInputRecorderProps) {
  const target = useRef<HTMLDivElement | null>(null)
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
    onDrag: ({ last, event, swipe: [x, y], tap, touches, memo = 1 }) => {
      if (isReaderInputInteractive(event.target)) return memo
      const pointer = event as PointerEvent
      const fingers = Math.max(Number(memo), touches || 1)
      if (!last) return fingers
      if (device === "mouse" && pointer.pointerType === "mouse" && tap) {
        onRecordRef.current({ device: "mouse", button: pointer.button, click: pointer.detail > 1 ? "double" : "single" })
      }
      if (device === "touch" && pointer.pointerType === "touch" && (x || y)) {
        const gesture = Math.abs(x) >= Math.abs(y)
          ? x < 0 ? "swipe-left" : "swipe-right"
          : y < 0 ? "swipe-up" : "swipe-down"
        onRecordRef.current({ device: "touch", gesture, fingers: Math.min(3, fingers) as 1 | 2 | 3 })
      }
      return fingers
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
        <Button type="button" variant="outline" onClick={onCancel}><X />取消录制</Button>
      </div>
    </div>
  )
}

function RecorderIcon({ device }: { device: RecordableDevice }) {
  return device === "gamepad" ? <Gamepad2 className="size-4" /> : device === "mouse" ? <MousePointer2 className="size-4" /> : <Radio className="size-4 animate-pulse" />
}

function deviceLabel(device: RecordableDevice): string {
  return device === "mouse" ? "鼠标" : device === "wheel" ? "滚轮" : device === "touch" ? "触控手势" : "手柄按钮"
}

function recordingPrompt(device: RecordableDevice): string {
  if (device === "mouse") return "请单击或双击要绑定的鼠标按钮。"
  if (device === "wheel") return "请滚动滚轮；当前修饰键会一并记录。"
  if (device === "touch") return "请用一至三指向目标方向滑动。"
  return "请按下要绑定的标准手柄按钮。"
}
