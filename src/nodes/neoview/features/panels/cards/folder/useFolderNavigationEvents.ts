import { useEffect, useRef } from "react"

export function useFolderNavigationEvents({
  events,
  enabled,
  onBrowse,
  onActivate,
}: {
  events?: EventTarget
  enabled: boolean
  onBrowse(path: string, newTab: boolean): void
  onActivate(path: string): boolean
}): void {
  const handlersRef = useRef({ onBrowse, onActivate })
  handlersRef.current = { onBrowse, onActivate }

  useEffect(() => {
    if (!events || !enabled) return
    const browse = (event: Event) => {
      if (!(event instanceof CustomEvent)) return
      const detail = event.detail as { path?: unknown; newTab?: unknown } | undefined
      if (typeof detail?.path === "string" && detail.path.trim()) handlersRef.current.onBrowse(detail.path, detail.newTab === true)
    }
    const activate = (event: Event) => {
      if (!(event instanceof CustomEvent) || !event.detail || typeof event.detail !== "object") return
      const detail = event.detail as { path?: unknown; handled?: boolean }
      if (typeof detail.path === "string" && detail.path.trim()) detail.handled = handlersRef.current.onActivate(detail.path)
    }
    events.addEventListener("browse", browse)
    events.addEventListener("activate", activate)
    return () => {
      events.removeEventListener("browse", browse)
      events.removeEventListener("activate", activate)
    }
  }, [enabled, events])
}
