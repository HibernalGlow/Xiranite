import { createContext, useContext, useEffect, useId, useRef, useState, type DragEventHandler, type ReactNode } from "react"
import type { NodeLocalFilesCapability } from "@xiranite/contract"

type SubscribeDrops = NodeLocalFilesCapability["subscribeDrops"]

export interface LocalFileDropOptions {
  disabled?: boolean
  onDropFiles?: (files: File[]) => void
  onDropPaths: (paths: string[]) => void
  onUnsupported?: () => void
  subscribeDrops?: SubscribeDrops
}

const LocalFilesContext = createContext<NodeLocalFilesCapability | undefined>(undefined)

export function LocalFilesProvider(props: { children: ReactNode; value?: NodeLocalFilesCapability }) {
  return <LocalFilesContext.Provider value={props.value}>{props.children}</LocalFilesContext.Provider>
}

/**
 * Framework-neutral file-drop target for node UIs.
 *
 * Direct DOM paths are used by hosts that expose File.path. Native desktop
 * adapters publish absolute paths through subscribeDrops. The Wails marker is
 * intentionally contained here so node components never import its runtime.
 */
export function useLocalFileDrop(options: LocalFileDropOptions) {
  const localFiles = useContext(LocalFilesContext)
  const targetId = `local-file-drop-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`
  const [dragging, setDragging] = useState(false)
  const latestRef = useRef(options)
  const pendingBrowserDropRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  latestRef.current = options
  const subscribeDrops = options.subscribeDrops ?? localFiles?.subscribeDrops

  function cancelPendingBrowserDrop() {
    if (pendingBrowserDropRef.current) clearTimeout(pendingBrowserDropRef.current)
    pendingBrowserDropRef.current = undefined
  }

  useEffect(() => {
    if (!subscribeDrops) return
    let disposed = false
    let unsubscribe: (() => void) | undefined
    void subscribeDrops(targetId, (paths) => {
      if (!disposed && !latestRef.current.disabled && paths.length) {
        cancelPendingBrowserDrop()
        latestRef.current.onDropPaths(paths)
      }
    }).then((release) => {
      if (disposed) release()
      else unsubscribe = release
    })
    return () => { disposed = true; cancelPendingBrowserDrop(); unsubscribe?.() }
  }, [subscribeDrops, targetId])

  const onDragOver: DragEventHandler<HTMLElement> = (event) => {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = "copy"
    setDragging(true)
  }
  const onDrop: DragEventHandler<HTMLElement> = (event) => {
    event.preventDefault()
    event.stopPropagation()
    setDragging(false)
    if (latestRef.current.disabled) return
    const paths = Array.from(event.dataTransfer.files).flatMap((file) => {
      const path = (file as File & { path?: string }).path?.trim()
      return path ? [path] : []
    })
    if (paths.length) latestRef.current.onDropPaths(paths)
    else if (event.dataTransfer.files.length && latestRef.current.onDropFiles) {
      const files = Array.from(event.dataTransfer.files)
      if (subscribeDrops) {
        cancelPendingBrowserDrop()
        // Wails sends the real absolute paths just after the DOM drop. Wait for
        // that event before falling back to browser File objects and Wasm.
        pendingBrowserDropRef.current = setTimeout(() => {
          pendingBrowserDropRef.current = undefined
          if (!latestRef.current.disabled) latestRef.current.onDropFiles?.(files)
        }, 400)
      } else latestRef.current.onDropFiles(files)
    }
    else if (event.dataTransfer.files.length) latestRef.current.onUnsupported?.()
  }

  return {
    targetId,
    targetProps: {
      "data-file-drop-target": "local-files",
      "data-local-file-drop-target": targetId,
      onDragOver,
      onDragLeave: () => setDragging(false),
      onDrop,
    },
    dragging,
  }
}
