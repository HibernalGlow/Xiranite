import { useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { useTranslation } from "react-i18next"
import { useWorkspace, useWSDispatch, actions } from "@/store/workspaceContext"
import { ComponentCard } from "./ComponentCard"
import { computeLayout } from "@/lib/workspaceLayout"
import { isComponentVisibleInView } from "@/lib/componentVisibility"
import { Button } from "@/components/ui/button"
import { LayoutGrid, Plus } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * CardView — 卡片形态渲染器。
 * 仅在 viewMode === "cards" 时挂载。grid/stack/split/focus 子布局由 cardLayout 决定。
 * free 模式已删除。
 */
export function CardView() {
  const { state, visibleComponents } = useWorkspace()
  const dispatch = useWSDispatch()
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLDivElement>(null)
  const resizeFrameRef = useRef<number | null>(null)
  const resizeIdleTimerRef = useRef<number | null>(null)
  const sizeRef = useRef({ w: 1200, h: 800 })
  const [size, setSize] = useState({ w: 1200, h: 800 })
  const [isResizing, setIsResizing] = useState(false)

  const { cardLayout, focusedComponentId, fullscreenComponentId } = state

  // 仅渲染未在 cards 模式下隐藏的组件
  const cardComponents = useMemo(
    () => visibleComponents.filter(c => isComponentVisibleInView(c, "cards")),
    [visibleComponents],
  )

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return

    const scheduleSizeUpdate = (rawWidth: number, rawHeight: number) => {
      const next = {
        w: Math.round(rawWidth),
        h: Math.round(rawHeight),
      }

      if (next.w <= 0 || next.h <= 0) return
      if (next.w === sizeRef.current.w && next.h === sizeRef.current.h) return

      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current)
      }

      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = null
        sizeRef.current = next
        setSize(next)
        setIsResizing(true)

        if (resizeIdleTimerRef.current !== null) {
          window.clearTimeout(resizeIdleTimerRef.current)
        }

        resizeIdleTimerRef.current = window.setTimeout(() => {
          resizeIdleTimerRef.current = null
          setIsResizing(false)
        }, 140)
      })
    }

    scheduleSizeUpdate(el.clientWidth, el.clientHeight)

    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      scheduleSizeUpdate(width, height)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current)
      }
      if (resizeIdleTimerRef.current !== null) {
        window.clearTimeout(resizeIdleTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (fullscreenComponentId) dispatch(actions.setFullscreen(null))
        else if (focusedComponentId) dispatch(actions.focusComponent(null))
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [fullscreenComponentId, focusedComponentId, dispatch])

  const layouts = useMemo(
    () =>
      computeLayout({
        components: cardComponents,
        layout: cardLayout,
        focusedId: focusedComponentId,
        fullscreenId: fullscreenComponentId,
        W: size.w,
        H: size.h,
      }),
    [cardComponents, cardLayout, focusedComponentId, fullscreenComponentId, size.h, size.w],
  )

  if (cardComponents.length === 0) {
    return (
      <div className="flex-1 ws-canvas-bg flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center">
            <div className="w-12 h-12 rounded-sm border-2 border-dashed border-border flex items-center justify-center">
              <LayoutGrid className="h-5 w-5 text-muted-foreground/50" />
            </div>
          </div>
          <div>
            <p className="text-sm font-mono text-muted-foreground">{t("view:cards.empty")}</p>
            <p className="text-xs font-mono text-muted-foreground/60 mt-1">{t("view:cards.emptyHint")}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="font-mono text-xs"
            onClick={() => dispatch(actions.setOverlay("registry"))}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            {t("view:cards.openRegistry")}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn("flex-1 ws-canvas-bg overflow-hidden relative", isResizing && "ws-canvas-bg--resizing")}
      ref={canvasRef}
    >
      {cardComponents.map(comp => (
        <ComponentCard
          key={comp.id}
          comp={comp}
          layout={layouts[comp.id]}
          canvasRef={canvasRef}
          isFocused={focusedComponentId === comp.id}
          hasFocused={focusedComponentId !== null}
          cardLayout={cardLayout}
          isLayoutResizing={isResizing}
        />
      ))}

      <AnimatePresence>
        {fullscreenComponentId && (
          <motion.button
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            onClick={() => dispatch(actions.setFullscreen(null))}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1001] rounded-full border border-border bg-card/90 px-4 py-1.5 font-mono text-[11px] tracking-widest text-muted-foreground hover:text-primary backdrop-blur"
          >
            {t("view:cards.exitFullscreen")}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}
