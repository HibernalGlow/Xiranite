import { useEffect, useId, useRef, type DragEventHandler } from "react"
import type { NodeLocalFilesCapability } from "@xiranite/contract"

type SubscribeDrops = NodeLocalFilesCapability["subscribeDrops"]

export interface LocalFileDropOptions {
  disabled?: boolean
  onDropPaths: (paths: string[]) => void
  onUnsupported?: () => void
  subscribeDrops?: SubscribeDrops
}

/**
 * Framework-neutral file-drop target for node UIs.
 *
 * Direct DOM paths are used by hosts that expose File.path. Native desktop
 * adapters publish absolute paths through subscribeDrops. The Wails marker is
 * intentionally contained here so node components never import its runtime.
 */
export function useLocalFileDrop(options: LocalFileDropOptions) {
  const targetId = `local-file-drop-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`
  const latestRef = useRef(options)
  latestRef.current = options

  useEffect(() => {
    if (!options.subscribeDrops) return
    let disposed = false
    let unsubscribe: (() => void) | undefined
    void options.subscribeDrops(targetId, (paths) => {
      if (!disposed && !latestRef.current.disabled && paths.length) latestRef.current.onDropPaths(paths)
    }).then((release) => {
      if (disposed) release()
      else unsubscribe = release
    })
    return () => { disposed = true; unsubscribe?.() }
  }, [options.subscribeDrops, targetId])

  const onDragOver: DragEventHandler<HTMLElement> = (event) => {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = "copy"
  }
  const onDrop: DragEventHandler<HTMLElement> = (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (latestRef.current.disabled) return
    const paths = Array.from(event.dataTransfer.files).flatMap((file) => {
      const path = (file as File & { path?: string }).path?.trim()
      return path ? [path] : []
    })
    if (paths.length) latestRef.current.onDropPaths(paths)
    else if (event.dataTransfer.files.length) latestRef.current.onUnsupported?.()
  }

  return {
    targetId,
    targetProps: {
      id: targetId,
      "data-file-drop-target": "local-files",
      "data-local-file-drop-target": "true",
      onDragOver,
      onDrop,
    },
  }
}
