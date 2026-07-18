import { useCallback, useEffect, useState, type DragEvent as ReactDragEvent } from "react"
import { acceptModuleDragOver, getModuleDragData, isModuleDrag } from "@/lib/moduleDragDrop"

export function useModuleDropTarget(
  onDropModule: (moduleId: string, event: ReactDragEvent<HTMLElement>) => void,
) {
  const [isModuleOver, setIsModuleOver] = useState(false)

  const onDragEnter = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (!isModuleDrag(event)) return
    event.preventDefault()
    setIsModuleOver(true)
  }, [])

  const onDragOver = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (acceptModuleDragOver(event)) setIsModuleOver(true)
  }, [])

  const onDragLeave = useCallback((event: ReactDragEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget as Node | null
    if (nextTarget && event.currentTarget.contains(nextTarget)) return
    setIsModuleOver(false)
  }, [])

  const onDrop = useCallback((event: ReactDragEvent<HTMLElement>) => {
    const payload = getModuleDragData(event)
    if (!payload) return
    event.preventDefault()
    event.stopPropagation()
    setIsModuleOver(false)
    onDropModule(payload.moduleId, event)
  }, [onDropModule])

  useEffect(() => {
    if (!isModuleOver || typeof window === "undefined") return undefined

    const clearDragState = () => setIsModuleOver(false)
    window.addEventListener("dragend", clearDragState)
    window.addEventListener("drop", clearDragState)
    window.addEventListener("blur", clearDragState)

    return () => {
      window.removeEventListener("dragend", clearDragState)
      window.removeEventListener("drop", clearDragState)
      window.removeEventListener("blur", clearDragState)
    }
  }, [isModuleOver])

  return {
    isModuleOver,
    moduleDropHandlers: {
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop,
    },
  }
}
