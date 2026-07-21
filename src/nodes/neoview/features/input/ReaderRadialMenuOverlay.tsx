import { createElement, useEffect, useRef } from "react"
import type { ReaderInputAction, ReaderRadialMenuConfig, ReaderRadialMenuItem } from "@xiranite/node-neoview/ui-core"
import { NeoViewRayMenu, type NeoViewRayMenuItem } from "../../vendor/ray-menu/wc/neoview-ray-menu"

export interface ReaderRadialMenuOpenRequest {
  id: number
  x: number
  y: number
}

export interface ReaderRadialMenuOverlayProps {
  config: ReaderRadialMenuConfig
  request: ReaderRadialMenuOpenRequest
  onClose(): void
  onSelect(action: ReaderInputAction): void
}

export function ReaderRadialMenuOverlay({ config, request, onClose, onSelect }: ReaderRadialMenuOverlayProps) {
  const elementRef = useRef<NeoViewRayMenu | null>(null)
  const configRef = useRef(config)
  configRef.current = config
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  useEffect(() => {
    const element = elementRef.current
    if (!element) return
    const syncMenuSemantics = () => labelMenu(element)
    const menuObserver = element.shadowRoot ? new MutationObserver(syncMenuSemantics) : undefined
    menuObserver?.observe(element.shadowRoot!, { childList: true, subtree: true })
    let moving = false
    let activeMenuId = configRef.current.activeMenuId
    const applyMenu = () => {
      const current = configRef.current
      const menu = current.menus.find((candidate) => candidate.id === activeMenuId) ?? current.menus[0]
      if (!menu) return false
      element.layers = menu.layers.map((layer, index) => {
        const items = layer.map(toRayItem)
        if (index === 0 && items.length === 0) {
          return [{ id: "empty", label: "暂无操作", action: null, slotIndex: 0, disabled: true, selectable: false }]
        }
        return items
      })
      element.items = element.layers[0] ?? []
      element.setAttribute("radius", String(current.radius))
      element.setAttribute("inner-radius", String(current.innerRadius))
      element.setAttribute("start-angle", String(current.startAngle))
      element.setAttribute("sweep-angle", String(current.sweepAngle))
      element.setAttribute("layer-count", String(current.layerCount))
      element.setAttribute("confirm-keys", "Space,Enter")
      return true
    }
    const handleSelect = (event: Event) => {
      const action = (event as CustomEvent<NeoViewRayMenuItem>).detail.action
      if (action) onSelectRef.current(action as ReaderInputAction)
    }
    const handleMoveTo = (event: Event) => {
      const menuId = (event as CustomEvent<{ menuId: string }>).detail.menuId
      if (!configRef.current.menus.some((menu) => menu.id === menuId)) return
      moving = true
      activeMenuId = menuId
      if (applyMenu()) requestAnimationFrame(() => {
        element.open(request.x, request.y)
        labelMenu(element)
      })
      queueMicrotask(() => { moving = false })
    }
    const handleClose = () => {
      if (!moving) onCloseRef.current()
    }
    element.addEventListener("ray-select", handleSelect)
    element.addEventListener("ray-moveto", handleMoveTo)
    element.addEventListener("ray-close", handleClose)
    applyMenu()
    element.open(request.x, request.y)
    labelMenu(element)
    return () => {
      element.removeEventListener("ray-select", handleSelect)
      element.removeEventListener("ray-moveto", handleMoveTo)
      element.removeEventListener("ray-close", handleClose)
      menuObserver?.disconnect()
      if (element.isOpen) element.close()
    }
  }, [request.id])

  return createElement("neoview-ray-menu", {
    ref: elementRef,
    "data-reader-radial-menu": "true",
    style: { position: "fixed", inset: 0, zIndex: 70 },
  })
}

function labelMenu(element: NeoViewRayMenu): void {
  const menu = element.shadowRoot?.querySelector<HTMLElement>('[role="menu"]')
  if (!menu) return
  menu.setAttribute("aria-label", "Menu")
}

function toRayItem(item: ReaderRadialMenuItem): NeoViewRayMenuItem {
  return {
    id: item.id,
    label: item.label,
    action: item.action,
    moveToMenuId: item.moveToMenuId,
    slotIndex: item.slotIndex,
    disabled: item.disabled,
    selectable: item.disabled || item.moveToMenuId ? false : undefined,
    children: item.children?.map(toRayItem),
  }
}
