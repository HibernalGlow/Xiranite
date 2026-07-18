import { useCallback, useState } from "react"
import { useHotkeys } from "react-hotkeys-hook"
import type { ReaderInputDescriptor } from "@xiranite/node-neoview/ui-core"

const MODIFIER_CODES = new Set([
  "ControlLeft", "ControlRight", "AltLeft", "AltRight",
  "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight",
])

export function useReaderKeyboardRecorder(
  onRecord: (id: string, input: Extract<ReaderInputDescriptor, { device: "keyboard" }>) => void,
) {
  const [recordingId, setRecordingId] = useState<string>()

  useHotkeys("*", (event) => {
    if (!recordingId || event.repeat || event.isComposing) return
    event.stopImmediatePropagation()
    if (event.code === "Escape") {
      setRecordingId(undefined)
      return
    }
    if (MODIFIER_CODES.has(event.code)) return
    onRecord(recordingId, {
      device: "keyboard",
      code: event.code,
      ctrl: event.ctrlKey || undefined,
      alt: event.altKey || undefined,
      shift: event.shiftKey || undefined,
      meta: event.metaKey || undefined,
    })
    setRecordingId(undefined)
  }, {
    enabled: Boolean(recordingId),
    enableOnFormTags: true,
    enableOnContentEditable: true,
    eventListenerOptions: { capture: true },
    ignoreModifiers: true,
    preventDefault: (event) => !event.isComposing,
    useKey: false,
  }, [recordingId, onRecord])

  const toggleRecording = useCallback((id: string) => {
    setRecordingId((current) => current === id ? undefined : id)
  }, [])
  const cancelRecording = useCallback(() => setRecordingId(undefined), [])

  return { recordingId, toggleRecording, cancelRecording }
}
