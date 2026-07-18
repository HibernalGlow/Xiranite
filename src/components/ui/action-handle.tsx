import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Grip } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface ActionHandleItem {
  id: string
  label: string
  preview?: string
  icon: ReactNode
  disabled?: boolean
  active?: boolean
  onSelect(): void
}

const DIRECTIONS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const
const MAX_RINGS = 3
const RING_STEP = 40

export function ActionHandle({ items, disabled = false, label = "操作手柄", menuLabel = "操作" }: {
  items: readonly ActionHandleItem[]
  disabled?: boolean
  label?: string
  menuLabel?: string
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const gestureRef = useRef<{ pointerId: number; centerX: number; centerY: number; selected: number }>()
  const suppressClickRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [palette, setPalette] = useState({ left: 0, top: 0, placement: "bottom" })
  const [selected, setSelected] = useState(-1)
  const [previewed, setPreviewed] = useState(-1)
  const ringCount = Math.min(MAX_RINGS, Math.max(1, Math.ceil(items.length / DIRECTIONS.length)))
  const paletteSize = 144 + (ringCount - 1) * RING_STEP * 2
  const paletteCenter = paletteSize / 2
  const visibleItems = items.slice(0, ringCount * DIRECTIONS.length)

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-action-handle="true"]')) return
      setOpen(false)
      setSelected(-1)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false)
        setSelected(-1)
        triggerRef.current?.focus()
      }
    }
    window.addEventListener("pointerdown", close)
    window.addEventListener("keydown", escape)
    return () => {
      window.removeEventListener("pointerdown", close)
      window.removeEventListener("keydown", escape)
    }
  }, [open])

  return (
    <span className="relative shrink-0" data-action-handle="true">
      <Button
        ref={triggerRef}
        type="button"
        size="icon-sm"
        variant={open ? "secondary" : "outline"}
        aria-label={label}
        title={`${label}：单击展开，按住并拖向一个方向后松开可直接执行`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onPointerDown={beginGesture}
        onPointerMove={moveGesture}
        onPointerUp={finishGesture}
        onPointerCancel={cancelGesture}
        onClick={() => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false
            return
          }
          positionPalette()
          setOpen((current) => !current)
        }}
      >
        <Grip />
      </Button>
      {open ? createPortal(
        <div
          className="fixed z-[100] rounded-md border bg-popover/98 text-popover-foreground shadow-xl backdrop-blur-xl"
          style={{ left: palette.left, top: palette.top, width: paletteSize, height: paletteSize }}
          role="menu"
          aria-label={menuLabel}
          data-action-handle="true"
          data-action-palette="true"
          data-action-placement={palette.placement}
          data-action-rings={ringCount}
        >
          {visibleItems.map((item, index) => {
            const ring = Math.floor(index / DIRECTIONS.length)
            const direction = DIRECTIONS[index % DIRECTIONS.length]!
            const radius = 48 + ring * RING_STEP
            return (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={cn(
                "absolute grid size-10 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                item.active && "bg-primary/15 text-primary",
                selected === index && "bg-primary text-primary-foreground",
              )}
              style={{
                left: paletteCenter + direction[0] * radius - 20,
                top: paletteCenter + direction[1] * radius - 20,
              }}
              aria-label={item.label}
              title={item.label}
              disabled={item.disabled}
              onPointerEnter={() => setPreviewed(index)}
              onPointerLeave={() => setPreviewed(-1)}
              onFocus={() => setPreviewed(index)}
              onBlur={() => setPreviewed(-1)}
              onClick={() => selectItem(index)}
            >
              {item.icon}
            </button>
            )
          })}
          <span
            className="absolute grid size-9 place-items-center rounded-full border bg-muted text-muted-foreground"
            style={{ left: paletteCenter - 18, top: paletteCenter - 18 }}
            aria-hidden="true"
          >
            <Grip className="size-4" />
          </span>
          {items[selected >= 0 ? selected : previewed] ? (
            <div
              className="absolute left-1/2 top-full mt-1 w-48 -translate-x-1/2 rounded-md border bg-popover px-2 py-1.5 text-left shadow-lg"
              role="status"
              aria-live="polite"
              data-action-preview="true"
            >
              <div className="truncate text-xs font-medium">{items[selected >= 0 ? selected : previewed]!.label}</div>
              <div className="line-clamp-2 text-[10px] text-muted-foreground">{items[selected >= 0 ? selected : previewed]!.preview ?? "松手或点击执行"}</div>
            </div>
          ) : null}
        </div>,
        document.body,
      ) : null}
    </span>
  )

  function positionPalette(): { x: number; y: number } {
    const bounds = triggerRef.current?.getBoundingClientRect()
    const triggerCenter = {
      x: (bounds?.left ?? 0) + (bounds?.width ?? 0) / 2,
      y: (bounds?.top ?? 0) + (bounds?.height ?? 0) / 2,
    }
    const width = paletteSize
    const height = paletteSize
    const gap = 8
    const spaces = {
      bottom: window.innerHeight - (bounds?.bottom ?? triggerCenter.y),
      top: bounds?.top ?? triggerCenter.y,
      right: window.innerWidth - (bounds?.right ?? triggerCenter.x),
      left: bounds?.left ?? triggerCenter.x,
    }
    const placement = (Object.entries(spaces) as [keyof typeof spaces, number][])
      .toSorted((left, right) => right[1] - left[1])[0]?.[0] ?? "bottom"
    // Keep the radial center over the trigger; only clamp when the viewport
    // cannot contain the requested ring count.
    const desired = {
      left: triggerCenter.x - width / 2,
      top: triggerCenter.y - height / 2,
    }
    setPalette({
      left: Math.max(gap, Math.min(window.innerWidth - width - gap, desired.left)),
      top: Math.max(gap, Math.min(window.innerHeight - height - 52, desired.top)),
      placement,
    })
    return triggerCenter
  }

  function beginGesture(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (disabled || event.button !== 0) return
    const next = positionPalette()
    gestureRef.current = { pointerId: event.pointerId, centerX: next.x, centerY: next.y, selected: -1 }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setSelected(-1)
    setOpen(true)
  }

  function moveGesture(event: ReactPointerEvent<HTMLButtonElement>): void {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    const next = actionIndex(event.clientX - gesture.centerX, event.clientY - gesture.centerY, ringCount, visibleItems.length)
    if (next === gesture.selected) return
    gesture.selected = next
    setSelected(next)
  }

  function finishGesture(event: ReactPointerEvent<HTMLButtonElement>): void {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    gestureRef.current = undefined
    suppressClickRef.current = true
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (gesture.selected >= 0) selectItem(gesture.selected)
  }

  function cancelGesture(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (gestureRef.current?.pointerId !== event.pointerId) return
    gestureRef.current = undefined
    suppressClickRef.current = true
    setSelected(-1)
    setOpen(false)
  }

  function selectItem(index: number): void {
    const item = items[index]
    if (!item || item.disabled) return
    item.onSelect()
    setOpen(false)
    setSelected(-1)
    triggerRef.current?.focus()
  }
}

function directionSlot(deltaX: number, deltaY: number): number {
  if (Math.hypot(deltaX, deltaY) < 24) return -1
  const octant = Math.round(Math.atan2(deltaY, deltaX) / (Math.PI / 4))
  return ({
    "-4": 3,
    "-3": 0,
    "-2": 1,
    "-1": 2,
    "0": 4,
    "1": 7,
    "2": 6,
    "3": 5,
    "4": 3,
  } as Record<string, number>)[String(octant)] ?? -1
}

function actionIndex(deltaX: number, deltaY: number, ringCount: number, itemCount: number): number {
  const distance = Math.hypot(deltaX, deltaY)
  const slot = directionSlot(deltaX, deltaY)
  if (slot < 0) return -1
  const ring = Math.min(ringCount - 1, Math.max(0, Math.round((distance - 48) / RING_STEP)))
  const index = ring * DIRECTIONS.length + slot
  return index < itemCount ? index : -1
}
