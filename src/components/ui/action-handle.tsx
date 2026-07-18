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
  /** Optional slot override. Coordinates use the eight compass points; ring 0 is nearest the handle. */
  position?: ActionHandlePosition
  onSelect(): void
}

export interface ActionHandlePosition {
  x: -1 | 0 | 1
  y: -1 | 0 | 1
  ring?: number
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

const DEFAULT_ACTION_HANDLE_LAYOUT = {
  itemSize: 30,
  radius: 36,
  ringStep: 30,
  palettePadding: 6,
  maxRings: 3,
} as const

export interface ActionHandleLayout {
  itemSize?: number
  radius?: number
  ringStep?: number
  palettePadding?: number
  maxRings?: 1 | 2 | 3
  /** Per-action slot overrides, useful for a user-editable wheel preset. */
  positions?: Readonly<Record<string, ActionHandlePosition>>
}

interface ActionHandleProps {
  items: readonly ActionHandleItem[]
  disabled?: boolean
  label?: string
  menuLabel?: string
  layout?: ActionHandleLayout
}

interface PlacedActionHandleItem {
  item: ActionHandleItem
  index: number
  position: Required<ActionHandlePosition>
}

export function ActionHandle({
  items,
  disabled = false,
  label = "操作手柄",
  menuLabel = "操作",
  layout,
}: ActionHandleProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const gestureRef = useRef<{ pointerId: number; centerX: number; centerY: number; selected: number }>()
  const suppressClickRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [palette, setPalette] = useState({ left: 0, top: 0, placement: "bottom" })
  const [selected, setSelected] = useState(-1)
  const [previewed, setPreviewed] = useState(-1)
  const geometry = {
    itemSize: Math.max(24, layout?.itemSize ?? DEFAULT_ACTION_HANDLE_LAYOUT.itemSize),
    radius: Math.max(28, layout?.radius ?? DEFAULT_ACTION_HANDLE_LAYOUT.radius),
    ringStep: Math.max(24, layout?.ringStep ?? DEFAULT_ACTION_HANDLE_LAYOUT.ringStep),
    palettePadding: Math.max(4, layout?.palettePadding ?? DEFAULT_ACTION_HANDLE_LAYOUT.palettePadding),
    maxRings: layout?.maxRings ?? DEFAULT_ACTION_HANDLE_LAYOUT.maxRings,
  }
  const placedItems: PlacedActionHandleItem[] = items
    .map((item, index) => ({ item, index, position: resolvePosition(item, index, layout?.positions) }))
    .filter((entry) => entry.position.ring < geometry.maxRings)
    .slice(0, geometry.maxRings * DIRECTIONS.length)
  const ringCount = Math.min(
    geometry.maxRings,
    Math.max(1, ...placedItems.map((entry) => entry.position.ring + 1)),
  )
  const outerRadius = geometry.radius + (ringCount - 1) * geometry.ringStep
  const paletteSize = Math.ceil((outerRadius + geometry.itemSize / 2 + geometry.palettePadding) * 2)
  const paletteCenter = paletteSize / 2

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
          className="fixed z-[100] overflow-visible rounded-full bg-transparent text-popover-foreground"
          style={{ left: palette.left, top: palette.top, width: paletteSize, height: paletteSize }}
          role="menu"
          aria-label={menuLabel}
          data-action-handle="true"
          data-action-palette="true"
          data-action-placement={palette.placement}
          data-action-rings={ringCount}
          data-action-palette-size={paletteSize}
          data-action-palette-frame="circle"
        >
          <span
            className="pointer-events-none absolute inset-1 rounded-full border border-border/45 bg-popover/92 shadow-lg backdrop-blur-md"
            aria-hidden="true"
          />
          {placedItems.map(({ item, index, position }) => {
            const ring = position.ring
            const radius = geometry.radius + ring * geometry.ringStep
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className={cn(
                  "absolute grid place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  item.active && "bg-primary/15 text-primary",
                  selected === index && "bg-primary text-primary-foreground",
                )}
                style={{
                  width: geometry.itemSize,
                  height: geometry.itemSize,
                  left: paletteCenter + position.x * radius - geometry.itemSize / 2,
                  top: paletteCenter + position.y * radius - geometry.itemSize / 2,
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
            className="absolute grid place-items-center rounded-full border bg-muted text-muted-foreground"
            style={{
              width: geometry.itemSize,
              height: geometry.itemSize,
              left: paletteCenter - geometry.itemSize / 2,
              top: paletteCenter - geometry.itemSize / 2,
            }}
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
    const gap = 8
    const spaces = {
      bottom: window.innerHeight - (bounds?.bottom ?? triggerCenter.y),
      top: bounds?.top ?? triggerCenter.y,
      right: window.innerWidth - (bounds?.right ?? triggerCenter.x),
      left: bounds?.left ?? triggerCenter.x,
    }
    const placement = (Object.entries(spaces) as [keyof typeof spaces, number][])
      .toSorted((left, right) => right[1] - left[1])[0]?.[0] ?? "bottom"
    const desired = {
      left: triggerCenter.x - paletteSize / 2,
      top: triggerCenter.y - paletteSize / 2,
    }
    setPalette({
      left: Math.max(gap, Math.min(window.innerWidth - paletteSize - gap, desired.left)),
      top: Math.max(gap, Math.min(window.innerHeight - paletteSize - 52, desired.top)),
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
    const next = actionIndex(
      event.clientX - gesture.centerX,
      event.clientY - gesture.centerY,
      placedItems,
      geometry.radius,
      geometry.ringStep,
    )
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

function actionIndex(
  deltaX: number,
  deltaY: number,
  placedItems: readonly PlacedActionHandleItem[],
  radius: number,
  ringStep: number,
): number {
  const distance = Math.hypot(deltaX, deltaY)
  if (distance < 24 || placedItems.length === 0) return -1
  const angle = Math.atan2(deltaY, deltaX)
  const targetRing = Math.max(0, Math.round((distance - radius) / ringStep))
  let best: { index: number; angleDistance: number; ringDistance: number } | undefined
  for (const entry of placedItems) {
    const slotAngle = Math.atan2(entry.position.y, entry.position.x)
    const angleDistance = circularAngleDistance(angle, slotAngle)
    const candidate = { index: entry.index, angleDistance, ringDistance: Math.abs(entry.position.ring - targetRing) }
    if (!best || candidate.angleDistance < best.angleDistance - 0.01 || (Math.abs(candidate.angleDistance - best.angleDistance) <= 0.01 && candidate.ringDistance < best.ringDistance)) {
      best = candidate
    }
  }
  if (!best || best.angleDistance > Math.PI / 4) return -1
  // Keep the radial gesture forgiving: users can drag past the nominal radius
  // while still selecting a one-ring action, as in the original handle.
  return best.index
}

function resolvePosition(
  item: ActionHandleItem,
  index: number,
  overrides?: Readonly<Record<string, ActionHandlePosition>>,
): Required<ActionHandlePosition> {
  const fallback = DIRECTIONS[index % DIRECTIONS.length]!
  const configured = item.position ?? overrides?.[item.id]
  const x = configured?.x ?? fallback[0]
  const y = configured?.y ?? fallback[1]
  return {
    x: x === 0 && y === 0 ? fallback[0] : x,
    y: x === 0 && y === 0 ? fallback[1] : y,
    ring: Math.max(0, Math.floor(configured?.ring ?? Math.floor(index / DIRECTIONS.length))),
  }
}

function circularAngleDistance(left: number, right: number): number {
  const difference = Math.abs(left - right) % (Math.PI * 2)
  return Math.min(difference, Math.PI * 2 - difference)
}
