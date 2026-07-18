import type { DragEvent as ReactDragEvent } from "react"

export const XIRANITE_MODULE_MIME = "application/x-xiranite-module"

export interface ModuleDragPayload {
  moduleId: string
}

type DragLike = Pick<ReactDragEvent<HTMLElement>, "dataTransfer" | "preventDefault">

export function setModuleDragData(event: ReactDragEvent<HTMLElement>, moduleId: string): void {
  event.dataTransfer.effectAllowed = "copy"
  event.dataTransfer.setData(XIRANITE_MODULE_MIME, JSON.stringify({ moduleId }))
  event.dataTransfer.setData("text/plain", moduleId)
}

export function getModuleDragData(event: Pick<ReactDragEvent<HTMLElement>, "dataTransfer">): ModuleDragPayload | null {
  const raw = event.dataTransfer.getData(XIRANITE_MODULE_MIME)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<ModuleDragPayload>
      return typeof parsed.moduleId === "string" && parsed.moduleId.trim()
        ? { moduleId: parsed.moduleId }
        : null
    } catch {
      return null
    }
  }

  const fallback = event.dataTransfer.getData("text/plain").trim()
  return fallback ? { moduleId: fallback } : null
}

export function isModuleDrag(event: Pick<ReactDragEvent<HTMLElement>, "dataTransfer">): boolean {
  const types = Array.from(event.dataTransfer.types ?? [])
  return types.includes(XIRANITE_MODULE_MIME)
}

export function acceptModuleDragOver(event: DragLike): boolean {
  if (!isModuleDrag(event)) return false
  event.preventDefault()
  event.dataTransfer.dropEffect = "copy"
  return true
}
