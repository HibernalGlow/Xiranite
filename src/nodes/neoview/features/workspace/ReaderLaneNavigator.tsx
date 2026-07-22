import { useEffect, useRef, useState, type FormEvent } from "react"
import { createPortal } from "react-dom"
import { BookOpen, Columns3, PanelLeft, PanelRight, Pin, PinOff, Plus, Trash2 } from "lucide-react"

import { SwimlaneBarMenuItem, SwimlaneNavigatorBar } from "@/components/workspace/swimlane/SwimlaneNavigatorBar"
import { SwimlaneBarAppearanceMenu } from "@/components/workspace/swimlane/SwimlaneBarAppearanceMenu"
import { SwimlaneFitMenuItems } from "@/components/workspace/swimlane/SwimlaneFitMenuItems"
import { ContextMenuCheckboxItem } from "@/components/ui/context-menu"
import type { ReaderSwimlaneId } from "../../adapters/reader-http-client"
import type { ReaderBarHandlePosition, ReaderBarHandleStyle } from "../shell/ReaderBarHandleGlyph"

export function ReaderLaneNavigator({
  lanes,
  activeLane,
  showInReaderSolo,
  handleStyle = "grip",
  handlePosition = "left",
  positionX = 92,
  positionY = 96,
  dock = "floating",
  titleHost,
  boundsHost,
  onSelect,
  onAdd,
  onRemove,
  onFit,
  autoFit,
  onAutoFitChange,
  onHandleStyleChange,
  onHandlePositionChange,
  onShowInReaderSoloChange,
  onPositionChange,
  onDockChange,
}: {
  lanes: readonly { id: ReaderSwimlaneId; title: string }[]
  activeLane: ReaderSwimlaneId
  showInReaderSolo: boolean
  handleStyle?: ReaderBarHandleStyle
  handlePosition?: ReaderBarHandlePosition
  positionX?: number
  positionY?: number
  dock?: "floating" | "reader-title"
  titleHost?: HTMLElement | null
  boundsHost?: HTMLElement | null
  onSelect(laneId: ReaderSwimlaneId): void
  onAdd(title: string): void
  onRemove(laneId: ReaderSwimlaneId): void
  onFit(): void
  autoFit: boolean
  onAutoFitChange(enabled: boolean): void
  onHandleStyleChange(style: ReaderBarHandleStyle): void
  onHandlePositionChange(position: ReaderBarHandlePosition): void
  onShowInReaderSoloChange(enabled: boolean): void
  onPositionChange?(position: { x: number; y: number }): void
  onDockChange?(dock: "floating" | "reader-title"): void
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [title, setTitle] = useState("")
  const activeIsCustom = activeLane !== "left" && activeLane !== "reader" && activeLane !== "right"

  useEffect(() => {
    if (!addOpen) return
    inputRef.current?.focus()
    const closeFromPointer = (event: PointerEvent) => {
      if (!formRef.current?.contains(event.target as Node)) setAddOpen(false)
    }
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAddOpen(false)
    }
    document.addEventListener("pointerdown", closeFromPointer, true)
    document.addEventListener("keydown", closeFromKeyboard, true)
    return () => {
      document.removeEventListener("pointerdown", closeFromPointer, true)
      document.removeEventListener("keydown", closeFromKeyboard, true)
    }
  }, [addOpen])

  function submitLane(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalized = title.trim()
    if (!normalized) return
    onAdd(normalized)
    setTitle("")
    setAddOpen(false)
  }

  const addForm = addOpen && typeof document !== "undefined" ? createPortal(
    <form
      ref={formRef}
      aria-label="添加泳道"
      className="fixed left-1/2 top-1/2 z-[210] flex w-64 -translate-x-1/2 -translate-y-1/2 gap-1 rounded-md border border-border bg-popover p-1 shadow-xl"
      onSubmit={submitLane}
    >
      <input ref={inputRef} aria-label="泳道名称" maxLength={80} className="h-8 min-w-0 flex-1 rounded border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" value={title} onChange={(event) => setTitle(event.currentTarget.value)} />
      <button type="submit" aria-label="确认添加泳道" className="grid size-8 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"><Plus className="size-3.5" /></button>
    </form>,
    document.body,
  ) : null

  return <>
    <SwimlaneNavigatorBar
      items={lanes.map(({ id, title: laneTitle }) => ({ id, label: `定位${laneTitle}泳道`, icon: laneIcon(id) }))}
      activeId={activeLane}
      compactItems
      menuAriaLabel="泳道切换栏设置"
      handleStyle={handleStyle}
      handlePosition={handlePosition}
      position={{ x: positionX, y: positionY }}
      dock={dock === "reader-title" ? "top" : "floating"}
      allowedDocks={["top"]}
      titleHost={titleHost}
      boundsHost={boundsHost}
      className="max-w-[calc(100vw-1.5rem)]"
      onSelect={onSelect}
      onPositionChange={onPositionChange}
      onDockChange={(next) => onDockChange?.(next === "top" ? "reader-title" : "floating")}
      menu={<>
        <SwimlaneBarMenuItem onSelect={() => setAddOpen(true)}><Plus className="size-3.5" />添加泳道</SwimlaneBarMenuItem>
        <SwimlaneFitMenuItems autoFit={autoFit} onFit={onFit} onAutoFitChange={onAutoFitChange} />
        <SwimlaneBarMenuItem onSelect={() => onDockChange?.(dock === "reader-title" ? "floating" : "reader-title")}>
          {dock === "reader-title" ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          {dock === "reader-title" ? "改为悬浮" : "固定到 Reader 标题栏"}
        </SwimlaneBarMenuItem>
        <ContextMenuCheckboxItem checked={showInReaderSolo} onCheckedChange={(checked) => onShowInReaderSoloChange(checked === true)}>Reader 独占时显示</ContextMenuCheckboxItem>
        <SwimlaneBarAppearanceMenu style={handleStyle} position={handlePosition} onStyleChange={onHandleStyleChange} onPositionChange={onHandlePositionChange} />
        {activeIsCustom ? <SwimlaneBarMenuItem destructive onSelect={() => onRemove(activeLane)}><Trash2 className="size-3.5" />删除当前泳道</SwimlaneBarMenuItem> : null}
      </>}
    />
    {addForm}
  </>
}

function laneIcon(laneId: ReaderSwimlaneId) {
  if (laneId === "left") return PanelLeft
  if (laneId === "reader") return BookOpen
  if (laneId === "right") return PanelRight
  return Columns3
}
