import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"
import { useWorkspaceActions, useWorkspaceShallowSelector, useWorkspaceVisibleComponents } from "@/store/workspaceStore"
import { ComponentCard } from "./ComponentCard"
import { computeLayout } from "@/lib/workspaceLayout"
import {
  computeMasonryLayout,
  MASONRY_MAX_HEIGHT,
  MASONRY_MIN_HEIGHT,
} from "@/lib/masonryLayout"
import { isComponentVisibleInView } from "@/lib/componentVisibility"
import { useComponentSurfaceStatusMap } from "@/lib/componentSurfaceStatus"
import { getCardWeight, type CardWeightMeta } from "@/lib/cardWeight"
import { useModuleDropTarget } from "@/hooks/useModuleDropTarget"
import { Button } from "@/components/ui/button"
import { MOSAIC_TILE_KEYFRAMES, MosaicFillerTile } from "@/components/ui/mosaic-filler-tile"
import { LayoutGrid, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ComponentInstance } from "@/types/workspace"

/**
 * CardView — 卡片形态渲染器。
 * 仅在 viewMode === "cards" 时挂载。grid/stack/split/focus 子布局由 cardLayout 决定。
 * free 模式已删除。
 */
export function CardView() {
  const { cardLayout, focusedComponentId, fullscreenComponentId } = useWorkspaceShallowSelector((state) => ({
    cardLayout: state.cardLayout,
    focusedComponentId: state.focusedComponentId,
    fullscreenComponentId: state.fullscreenComponentId,
  }))
  const visibleComponents = useWorkspaceVisibleComponents()
  const workspaceActions = useWorkspaceActions()
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLDivElement>(null)
  const resizeFrameRef = useRef<number | null>(null)
  const resizeIdleTimerRef = useRef<number | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [isResizing, setIsResizing] = useState(false)
  const handleDropModule = useCallback((moduleId: string) => {
    workspaceActions.deployComponent(moduleId, { viewMode: "cards" })
  }, [workspaceActions])
  const { isModuleOver, moduleDropHandlers } = useModuleDropTarget(handleDropModule)

  // 仅渲染未在 cards 模式下隐藏的组件
  const cardComponents = useMemo(
    () => visibleComponents.filter(c => isComponentVisibleInView(c, "cards")),
    [visibleComponents],
  )

  // 派生每个卡片的运行状态（订阅一次 operations）+ 权重，供 computeLayout 智能排序/放大
  const statusMap = useComponentSurfaceStatusMap(cardComponents)
  const cardWeights = useMemo<Record<string, CardWeightMeta>>(() => {
    const now = Date.now()
    const out: Record<string, CardWeightMeta> = {}
    for (const comp of cardComponents) {
      const status = statusMap[comp.id]
      if (!status) continue
      out[comp.id] = getCardWeight({
        component: comp,
        status,
        focusedComponentId,
        now,
      })
    }
    return out
  }, [cardComponents, statusMap, focusedComponentId])

  useLayoutEffect(() => {
    const el = canvasRef.current
    if (!el) return

    const applySize = (rawWidth: number, rawHeight: number, immediate = false) => {
      const next = {
        w: Math.round(rawWidth),
        h: Math.round(rawHeight),
      }

      if (next.w <= 0 || next.h <= 0) return
      if (next.w === sizeRef.current.w && next.h === sizeRef.current.h) return

      if (immediate) {
        if (resizeFrameRef.current !== null) {
          cancelAnimationFrame(resizeFrameRef.current)
          resizeFrameRef.current = null
        }
        sizeRef.current = next
        setSize(next)
        return
      }

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

    applySize(el.clientWidth, el.clientHeight, true)

    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      applySize(width, height)
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
        if (fullscreenComponentId) workspaceActions.setFullscreen(null)
        else if (focusedComponentId) workspaceActions.focusComponent(null)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [fullscreenComponentId, focusedComponentId, workspaceActions])

  const layouts = useMemo(
    () =>
      computeLayout({
        components: cardComponents,
        layout: cardLayout,
        focusedId: focusedComponentId,
        fullscreenId: fullscreenComponentId,
        W: size.w,
        H: size.h,
        cardWeights,
      }),
    [cardComponents, cardLayout, focusedComponentId, fullscreenComponentId, size.h, size.w, cardWeights],
  )

  const isEmpty = cardComponents.length === 0
  const isMasonryLayout = cardLayout === "stack" && !fullscreenComponentId

  return (
    <div
      className={cn(
        "flex-1 ws-canvas-bg overflow-hidden relative transition-colors",
        isMasonryLayout && !isEmpty && "overflow-y-auto",
        isEmpty && "flex items-center justify-center",
        isResizing && "ws-canvas-bg--resizing",
        isModuleOver && "bg-primary/5 ring-1 ring-inset ring-primary/40",
      )}
      ref={canvasRef}
      data-testid="cards-drop-target"
      {...moduleDropHandlers}
    >
      {isModuleOver && <ModuleDropHint label={t("registry:dropHint")} />}

      {isEmpty ? (
        <div className="xiranite-ui-copy text-center space-y-4">
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
            onClick={() => workspaceActions.setOverlay("registry")}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            {t("view:cards.openRegistry")}
          </Button>
        </div>
      ) : (
        <>
          {isMasonryLayout ? (
            <MasonryCardGrid
              cardComponents={cardComponents}
              canvasRef={canvasRef}
              focusedComponentId={focusedComponentId}
              cardLayout={cardLayout}
              isLayoutResizing={isResizing}
              width={size.w}
            />
          ) : (
            cardComponents.map(comp => (
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
            ))
          )}

          {fullscreenComponentId && (
            <button
              onClick={() => workspaceActions.setFullscreen(null)}
              className="xiranite-ui-copy absolute bottom-4 left-1/2 z-[1001] -translate-x-1/2 rounded-full border border-border bg-card/90 px-4 py-1.5 font-mono text-[11px] tracking-widest text-muted-foreground backdrop-blur animate-in fade-in slide-in-from-bottom-2 duration-150 hover:text-primary"
            >
              {t("view:cards.exitFullscreen")}
            </button>
          )}
        </>
      )}
    </div>
  )
}

/** 与布局同一条上下限：拖出来的高度必须落在 computeMasonryLayout 会承认的区间里。 */
function clampMasonryHeight(value: number): number {
  return Math.min(MASONRY_MAX_HEIGHT, Math.max(MASONRY_MIN_HEIGHT, value))
}

function MasonryCardGrid({
  cardComponents,
  canvasRef,
  focusedComponentId,
  cardLayout,
  isLayoutResizing,
  width,
}: {
  cardComponents: ComponentInstance[]
  canvasRef: RefObject<HTMLDivElement | null>
  focusedComponentId: string | null
  cardLayout: "stack"
  isLayoutResizing: boolean
  width: number
}) {
  const reduceMotion = useReducedMotion()
  const workspaceActions = useWorkspaceActions()
  // 拖拽过程中只在本地覆盖高度：布局是纯函数，喂进去就能实时看到整列重排，
  // 松手才落一条 setComponentLaneSize（否则每次 pointermove 都写一次持久化状态）。
  const [resize, setResize] = useState<{ id: string; height: number } | null>(null)
  const layoutComponents = useMemo(
    () =>
      resize
        ? cardComponents.map((comp) => (comp.id === resize.id ? { ...comp, laneSize: { height: resize.height } } : comp))
        : cardComponents,
    [cardComponents, resize],
  )
  const { placements, filler, totalHeight } = useMemo(
    () => computeMasonryLayout(layoutComponents, width, focusedComponentId),
    [layoutComponents, width, focusedComponentId],
  )

  const commitHeight = useCallback(
    (id: string, height: number) => {
      workspaceActions.setComponentLaneSize(id, { height: Math.round(clampMasonryHeight(height)) })
      setResize(null)
    },
    [workspaceActions],
  )

  const beginResize = useCallback(
    (id: string, startHeight: number, event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      const originY = event.clientY
      let latest = startHeight
      setResize({ id, height: startHeight })
      const onMove = (moveEvent: PointerEvent) => {
        latest = startHeight + (moveEvent.clientY - originY)
        setResize({ id, height: clampMasonryHeight(latest) })
      }
      const onUp = () => {
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
        window.removeEventListener("pointercancel", onUp)
        commitHeight(id, latest)
      }
      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
      window.addEventListener("pointercancel", onUp)
    },
    [commitHeight],
  )

  return (
    <div className="mx-auto w-full max-w-[1680px] px-4 py-4">
      {/* 补位格子的关键帧只注入一次；缺了它，六款动画会全变成静止方块 */}
      <style>{MOSAIC_TILE_KEYFRAMES}</style>
      {/* 绝对定位不吃父级 padding，所以定位上下文必须是这层已经内缩过的盒子：
          它的宽度正好等于 computeMasonryLayout 用的 (容器宽 − MASONRY_HORIZONTAL_PADDING)。 */}
      <div className="relative" style={{ height: totalHeight > 0 ? totalHeight : undefined }}>
        {placements.map(({ comp, index, x, y, w, h }) => (
          <motion.div
            key={comp.id}
            className="absolute"
            style={{ left: x, top: y, width: w, height: h }}
            initial={reduceMotion ? false : { opacity: 0, y: 18, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1], delay: Math.min(index, 10) * 0.045 }}
            whileHover={reduceMotion ? undefined : { y: -4 }}
          >
            <ComponentCard
              comp={comp}
              layout={{
                x: 0,
                y: 0,
                w,
                h,
                scale: 1,
                opacity: 1,
                z: comp.z ?? index + 1,
                state: comp.collapsed ? "compact" : focusedComponentId === comp.id ? "focused" : "docked",
                interactive: true,
              }}
              canvasRef={canvasRef}
              isFocused={focusedComponentId === comp.id}
              hasFocused={focusedComponentId !== null}
              cardLayout={cardLayout}
              isLayoutResizing={isLayoutResizing || resize?.id === comp.id}
              positioning="masonry"
            />
            {!comp.collapsed && (
              <div
                aria-label="Resize card height"
                aria-orientation="horizontal"
                aria-valuemax={MASONRY_MAX_HEIGHT}
                aria-valuemin={MASONRY_MIN_HEIGHT}
                aria-valuenow={Math.round(h)}
                className="absolute inset-x-0 bottom-0 z-20 flex h-3 cursor-ns-resize items-center justify-center rounded-b-md outline-none focus-visible:bg-primary/10"
                data-card-id={comp.id}
                data-testid="masonry-resize-handle"
                onKeyDown={(event) => {
                  const step = event.shiftKey ? 64 : 16
                  if (event.key === "ArrowDown") {
                    event.preventDefault()
                    commitHeight(comp.id, h + step)
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault()
                    commitHeight(comp.id, h - step)
                  }
                }}
                onPointerDown={(event) => beginResize(comp.id, h, event)}
                role="separator"
                tabIndex={0}
              >
                <span className="h-[3px] w-9 rounded-full bg-muted-foreground/30" />
              </div>
            )}
          </motion.div>
        ))}
        {filler.map((tile, i) => (
          <motion.div
            key={`masonry-filler-${tile.col}-${tile.row}`}
            data-testid="masonry-filler"
            className="absolute"
            style={{ left: tile.x, top: tile.y, width: tile.w, height: tile.h }}
            initial={reduceMotion ? false : { opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, ease: "easeOut", delay: Math.min(i, 12) * 0.03 }}
          >
            <MosaicFillerTile anim={tile.anim} className="size-full" reducedMotion={reduceMotion === true} />
          </motion.div>
        ))}
      </div>
    </div>
  )
}

function ModuleDropHint({ label }: { label: string }) {
  return (
    <div className="xiranite-ui-copy pointer-events-none absolute left-1/2 top-4 z-[1002] -translate-x-1/2 rounded-sm border border-primary/40 bg-card/95 px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest text-primary shadow-sm">
      {label}
    </div>
  )
}
