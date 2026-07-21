import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"

import type { ReaderBoardLayoutPatch, ReaderShellConfigDto } from "../../adapters/reader-http-client"
import { availablePanels, PANEL_DEFINITIONS, type ReaderPanelDefinition, type ReaderPanelSide } from "./registry"
import { moveReaderPanel, readerPanelIdsForSide } from "./reader-panel-layout"

interface PanelDndContextValue {
  previewShell: ReaderShellConfigDto
  dragging: boolean
}

const PanelDndContext = createContext<PanelDndContextValue | null>(null)
const railId = (side: ReaderPanelSide) => `reader-panel-rail:${side}`
const sidebarId = (side: ReaderPanelSide) => `reader-panel-sidebar:${side}`
const disableLayoutAnimation = () => false
// Keep ordinary clicks available for panel switching; dragging requires a deliberate hold.
export const READER_PANEL_POINTER_ACTIVATION = { delay: 500, tolerance: 8 } as const

export function ReaderPanelDndProvider({
  shell,
  onMove,
  children,
}: {
  shell: ReaderShellConfigDto | undefined
  onMove(nextShell: ReaderShellConfigDto, patch: ReaderBoardLayoutPatch): Promise<void>
  children: ReactNode
}) {
  if (!shell) return children
  return <ActiveReaderPanelDndProvider shell={shell} onMove={onMove}>{children}</ActiveReaderPanelDndProvider>
}

function ActiveReaderPanelDndProvider({
  shell,
  onMove,
  children,
}: {
  shell: ReaderShellConfigDto
  onMove(nextShell: ReaderShellConfigDto, patch: ReaderBoardLayoutPatch): Promise<void>
  children: ReactNode
}) {
  const [previewShell, setPreviewShell] = useState(shell)
  const [activeId, setActiveId] = useState<string>()
  const previewRef = useRef(shell)
  const dragShellRef = useRef(shell)
  const baseRef = useRef(shell)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: READER_PANEL_POINTER_ACTIVATION }),
    useSensor(TouchSensor, { activationConstraint: READER_PANEL_POINTER_ACTIVATION }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  useEffect(() => {
    if (activeId) return
    previewRef.current = shell
    baseRef.current = shell
    setPreviewShell(shell)
  }, [activeId, shell])

  const value = useMemo(() => ({ previewShell, dragging: Boolean(activeId) }), [activeId, previewShell])
  const activePanel = activeId ? PANEL_DEFINITIONS.find((panel) => panel.id === activeId) : undefined
  const ActivePanelIcon = activePanel?.icon

  return (
    <PanelDndContext.Provider value={value}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={resetPreview}
      >
        {children}
        <DragOverlay>
          {activePanel ? (
            <div
              className="grid size-9 place-items-center rounded-md border bg-background text-sm shadow-xl"
              aria-hidden="true"
              data-reader-panel-drag-overlay="true"
            >
              {ActivePanelIcon ? <ActivePanelIcon className="size-4" /> : null}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </PanelDndContext.Provider>
  )

  function handleDragStart(event: DragStartEvent): void {
    const id = String(event.active.id)
    baseRef.current = shell
    previewRef.current = shell
    dragShellRef.current = shell
    setPreviewShell(shell)
    setActiveId(id)
  }

  function handleDragOver(event: DragOverEvent): void {
    applyDragPosition(event)
  }

  function handleDragEnd(event: DragEndEvent): void {
    applyDragPosition(event)
    const next = dragShellRef.current
    const movedId = String(event.active.id)
    if (next === baseRef.current) {
      setActiveId(undefined)
      resetPreview()
      return
    }
    const layout = next.panelLayout[movedId]
    if (!layout || (layout.position !== "left" && layout.position !== "right")) {
      setActiveId(undefined)
      resetPreview()
      return
    }
    const index = readerPanelIdsForSide(next, layout.position).indexOf(movedId)
    const move = moveReaderPanel(baseRef.current, movedId, layout.position, index)
    if (!move) {
      setActiveId(undefined)
      resetPreview()
      return
    }
    const commit = () => {
      setActiveId(undefined)
      void onMove(move.shell, move.patch).catch(() => {
        previewRef.current = baseRef.current
        dragShellRef.current = baseRef.current
        setPreviewShell(baseRef.current)
      })
    }
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(commit)
    else setTimeout(commit, 0)
  }

  function applyDragPosition(event: DragOverEvent | DragEndEvent): void {
    if (!event.over) return
    const panelId = String(event.active.id)
    const side = destinationSide(event.over.id, event.over.data.current?.side)
    if (!side) return
    const overId = String(event.over.id)
    if (overId === panelId) return
    const ids = readerPanelIdsForSide(dragShellRef.current, side).filter((id) => id !== panelId)
    let index = overId === railId(side) ? ids.length : ids.indexOf(overId)
    if (index < 0) index = ids.length
    if (overId !== railId(side) && event.active.rect.current.translated) {
      const activeCenter = event.active.rect.current.translated.top + event.active.rect.current.translated.height / 2
      const overCenter = event.over.rect.top + event.over.rect.height / 2
      if (activeCenter > overCenter) index += 1
    }
    const move = moveReaderPanel(dragShellRef.current, panelId, side, index)
    if (!move) return
    dragShellRef.current = move.shell
    if (previewRef.current.panelLayout[panelId]?.position !== move.shell.panelLayout[panelId]?.position) {
      previewRef.current = move.shell
      setPreviewShell(move.shell)
    }
  }

  function resetPreview(): void {
    setActiveId(undefined)
    previewRef.current = shell
    dragShellRef.current = shell
    setPreviewShell(shell)
  }
}

export function useReaderPanelRail(side: ReaderPanelSide, fallbackPanels: readonly ReaderPanelDefinition[]) {
  const context = useContext(PanelDndContext)
  const panels = context?.dragging ? availablePanels(side, context.previewShell) : fallbackPanels
  const items = useMemo(() => panels.map((panel) => panel.id), [panels])
  const data = useMemo(() => ({ type: "reader-panel-rail", side }), [side])
  const droppable = useDroppable({ id: railId(side), data })
  return {
    panels,
    isOver: droppable.isOver,
    setNodeRef: droppable.setNodeRef,
    sortable: (children: ReactNode) => (
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    ),
  }
}

export function useReaderPanelDropZone(side: ReaderPanelSide) {
  const data = useMemo(() => ({ type: "reader-panel-sidebar", side }), [side])
  const droppable = useDroppable({ id: sidebarId(side), data })
  return { isOver: droppable.isOver, setNodeRef: droppable.setNodeRef }
}

export function useReaderPanelTab(panel: ReaderPanelDefinition, side: ReaderPanelSide): {
  attributes: ReturnType<typeof useSortable>["attributes"]
  listeners: ReturnType<typeof useSortable>["listeners"]
  setNodeRef: ReturnType<typeof useSortable>["setNodeRef"]
  style: CSSProperties
  dragging: boolean
} {
  const data = useMemo(() => ({ type: "reader-panel", side }), [side])
  const sortable = useSortable({
    id: panel.id,
    disabled: !panel.canMove,
    data,
    animateLayoutChanges: disableLayoutAnimation,
  })
  return {
    attributes: sortable.attributes,
    listeners: sortable.listeners,
    setNodeRef: sortable.setNodeRef,
    style: {
      transform: CSS.Transform.toString(sortable.transform),
      transition: sortable.transition,
      opacity: sortable.isDragging ? 0.28 : undefined,
      touchAction: "none",
    },
    dragging: sortable.isDragging,
  }
}

function destinationSide(id: string | number, dataSide: unknown): ReaderPanelSide | undefined {
  if (dataSide === "left" || dataSide === "right") return dataSide
  const value = String(id)
  if (value === railId("left")) return "left"
  if (value === railId("right")) return "right"
  return undefined
}
