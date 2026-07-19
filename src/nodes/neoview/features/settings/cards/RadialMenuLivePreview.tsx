/**
 * Live radial-menu preview that reuses the production NeoViewRayMenu web component.
 * Hosts the component and re-opens it centered on this host as the draft changes.
 */
import { useEffect, useMemo, useRef } from "react"
import type { ReaderRadialMenuConfig, ReaderRadialMenuItem } from "@xiranite/node-neoview/ui-core"
import { NeoViewRayMenu, type NeoViewRayMenuItem } from "../../../vendor/ray-menu/wc/neoview-ray-menu"

export function RadialMenuLivePreview({
  config,
  menuId,
  className,
}: {
  config: ReaderRadialMenuConfig
  menuId: string
  className?: string
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const elementRef = useRef<NeoViewRayMenu | null>(null)

  const menu = useMemo(
    () => config.menus.find((candidate) => candidate.id === menuId) ?? config.menus[0],
    [config.menus, menuId],
  )

  const signature = useMemo(() => JSON.stringify({
    menuId: menu?.id,
    layerCount: config.layerCount,
    radius: config.radius,
    innerRadius: config.innerRadius,
    startAngle: config.startAngle,
    sweepAngle: config.sweepAngle,
    layers: menu?.layers.map((layer) => layer.map((item) => ({
      id: item.id,
      label: item.label,
      action: item.action,
      slotIndex: item.slotIndex,
      disabled: item.disabled,
      moveToMenuId: item.moveToMenuId,
    }))),
  }), [config.innerRadius, config.layerCount, config.radius, config.startAngle, config.sweepAngle, menu])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const element = document.createElement("neoview-ray-menu") as NeoViewRayMenu
    elementRef.current = element
    host.appendChild(element)

    const stop = (event: Event) => { event.stopPropagation() }
    element.addEventListener("ray-select", stop)
    element.addEventListener("ray-moveto", stop)
    element.addEventListener("ray-close", stop)

    return () => {
      element.removeEventListener("ray-select", stop)
      element.removeEventListener("ray-moveto", stop)
      element.removeEventListener("ray-close", stop)
      try { if (element.isOpen) element.close() } catch { /* ignore */ }
      element.remove()
      elementRef.current = null
    }
  }, [])

  useEffect(() => {
    const host = hostRef.current
    const element = elementRef.current
    if (!host || !element || !menu) return

    const apply = () => {
      const rect = host.getBoundingClientRect()
      if (rect.width < 8 || rect.height < 8) return

      element.layers = menu.layers.map((layer, index) => {
        const items = layer.map(toRayItem)
        if (index === 0 && items.length === 0) {
          return [{ id: "empty", label: "空轮盘", action: null, slotIndex: 0, disabled: true, selectable: false }]
        }
        return items
      }) as NeoViewRayMenuItem[][]
      element.items = element.layers[0] ?? []
      element.setAttribute("radius", String(config.radius))
      element.setAttribute("inner-radius", String(config.innerRadius))
      element.setAttribute("start-angle", String(config.startAngle))
      element.setAttribute("sweep-angle", String(config.sweepAngle))
      element.setAttribute("layer-count", String(config.layerCount))

      const size = (config.radius + 28) * 2
      host.style.minHeight = `${Math.max(240, size)}px`

      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      if (element.isOpen) element.close()
      element.open(cx, cy)
      pinMenu(element)
    }

    apply()
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => apply()) : undefined
    observer?.observe(host)
    window.addEventListener("scroll", apply, true)
    return () => {
      observer?.disconnect()
      window.removeEventListener("scroll", apply, true)
    }
  }, [config.innerRadius, config.layerCount, config.radius, config.startAngle, config.sweepAngle, menu, signature])

  return (
    <div
      ref={hostRef}
      className={className}
      data-radial-live-preview="true"
      aria-label="轮盘实时预览"
      style={{
        position: "relative",
        width: "100%",
        minHeight: Math.max(240, (config.radius + 28) * 2),
        overflow: "hidden",
      }}
    />
  )
}

function pinMenu(element: NeoViewRayMenu): void {
  const menu = element.shadowRoot?.querySelector<HTMLElement>(".ray-menu-container")
  if (!menu) return
  menu.setAttribute("aria-label", "轮盘预览")
  menu.style.pointerEvents = "none"
  menu.style.animation = "none"
  menu.style.opacity = "1"
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
