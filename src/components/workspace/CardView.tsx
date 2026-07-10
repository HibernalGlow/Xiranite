import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react"
import { MasonryGrid } from "react-masonry-virtualized"
import { useTranslation } from "react-i18next"
import { useWorkspaceActions, useWorkspaceShallowSelector, useWorkspaceVisibleComponents } from "@/store/workspaceStore"
import { ComponentCard } from "./ComponentCard"
import { computeLayout } from "@/lib/workspaceLayout"
import { isComponentVisibleInView } from "@/lib/componentVisibility"
import { useComponentSurfaceStatusMap } from "@/lib/componentSurfaceStatus"
import { getCardWeight, type CardWeightMeta } from "@/lib/cardWeight"
import { useModuleDropTarget } from "@/hooks/useModuleDropTarget"
import { Button } from "@/components/ui/button"
import { LayoutGrid, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { getModule } from "@/components/modules/registry"
import type { ComponentInstance, ComputedLayout } from "@/types/workspace"

const MASONRY_BASE_WIDTH = 420
const MASONRY_MIN_WIDTH = 360
const MASONRY_GAP = 16
const MASONRY_MAX_COLUMNS = 4
const MASONRY_HORIZONTAL_PADDING = 32
const MASONRY_COLLAPSED_HEIGHT = 40
const MASONRY_DEFAULT_HEIGHT = 420
const MASONRY_FOCUSED_HEIGHT = 680
const MASONRY_MIN_HEIGHT = 240
const MASONRY_MAX_HEIGHT = 860
const MASONRY_MEASURE_TOLERANCE = 12

const MODULE_MASONRY_HEIGHTS: Record<string, number> = {
  database: 640,
  blocknote: 620,
  kanban: 540,
  terminal: 500,
  "module-registry": 560,
  "node-history": 520,
  "node-operations": 500,
  "music-player": 340,
  settings: 420,
  scratch: 360,
  tasks: 440,
  calculator: 300,
  clock: 280,
  counter: 260,
  "acid-mixer": 440,
}

const CATEGORY_MASONRY_HEIGHTS: Record<string, number> = {
  file: 520,
  image: 560,
  video: 520,
  text: 460,
  system: 400,
  dev: 430,
  meta: 540,
  utility: 340,
  state: 300,
  organize: 500,
  process: 460,
  media: 380,
}

const MASONRY_HEIGHT_OFFSETS = [-56, -24, 0, 32, 64, 96] as const

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
  const columnCount = useMemo(() => getMasonryColumnCount(width), [width])
  const getItemSize = useCallback(
    (component: ComponentInstance) => Promise.resolve(resolveMasonryItemSize(component, focusedComponentId)),
    [focusedComponentId],
  )

  return (
    <div className="relative mx-auto w-full max-w-[1680px] px-4 py-4">
      <MasonryGrid
        items={cardComponents}
        renderItem={(comp, index) => (
          <ComponentCard
            comp={comp}
            layout={getMasonryCardLayout(comp, index, focusedComponentId)}
            canvasRef={canvasRef}
            isFocused={focusedComponentId === comp.id}
            hasFocused={focusedComponentId !== null}
            cardLayout={cardLayout}
            isLayoutResizing={isLayoutResizing}
            positioning="masonry"
          />
        )}
        getItemSize={getItemSize}
        baseWidth={MASONRY_BASE_WIDTH}
        minWidth={MASONRY_MIN_WIDTH}
        gap={MASONRY_GAP}
        columnCount={columnCount}
        bufferMultiplier={1.5}
        scrollContainer={canvasRef as RefObject<HTMLElement>}
      />
    </div>
  )
}

function getMasonryColumnCount(width: number): number {
  const availableWidth = Math.max(0, Math.min(1680, width) - MASONRY_HORIZONTAL_PADDING)
  if (availableWidth <= 0) return 1
  return clampNumber(
    Math.floor((availableWidth + MASONRY_GAP) / (MASONRY_MIN_WIDTH + MASONRY_GAP)),
    1,
    MASONRY_MAX_COLUMNS,
  )
}

function getMasonryCardLayout(
  component: ComponentInstance,
  index: number,
  focusedComponentId: string | null,
): ComputedLayout {
  const size = resolveMasonryItemSize(component, focusedComponentId)
  const isFocused = focusedComponentId === component.id
  return {
    x: 0,
    y: 0,
    w: size.width,
    h: size.height,
    scale: 1,
    opacity: 1,
    z: component.z ?? index + 1,
    state: component.collapsed ? "compact" : (isFocused ? "focused" : "docked"),
    interactive: true,
  }
}

function resolveMasonryItemSize(
  component: ComponentInstance,
  focusedComponentId?: string | null,
): { width: number; height: number } {
  if (component.collapsed) {
    return { width: MASONRY_BASE_WIDTH, height: MASONRY_COLLAPSED_HEIGHT }
  }

  const persistedSize = getPersistedComponentSize(component)
  if (persistedSize) {
    return normalizeMasonrySize(persistedSize)
  }

  return {
    width: MASONRY_BASE_WIDTH,
    height: focusedComponentId === component.id ? MASONRY_FOCUSED_HEIGHT : MASONRY_DEFAULT_HEIGHT,
  }
}

function getPersistedComponentSize(component: ComponentInstance): { width: number; height: number } | null {
  if (component.size) {
    return { width: component.size.w, height: component.size.h }
  }
  if (component.flowSize) {
    return { width: component.flowSize.width, height: component.flowSize.height }
  }
  if (component.laneSize) {
    return { width: MASONRY_BASE_WIDTH, height: component.laneSize.height }
  }
  if (component.bentoLayout) {
    return {
      width: Math.max(MASONRY_BASE_WIDTH, component.bentoLayout.w * 96),
      height: component.bentoLayout.h * 86,
    }
  }
  return null
}

function normalizeMasonrySize(size: { width: number; height: number }): { width: number; height: number } {
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) {
    return { width: MASONRY_BASE_WIDTH, height: MASONRY_DEFAULT_HEIGHT }
  }

  return {
    width: MASONRY_BASE_WIDTH,
    height: clampNumber(
      Math.round(size.height * (MASONRY_BASE_WIDTH / size.width)),
      MASONRY_MIN_HEIGHT,
      MASONRY_MAX_HEIGHT,
    ),
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function ModuleDropHint({ label }: { label: string }) {
  return (
    <div className="xiranite-ui-copy pointer-events-none absolute left-1/2 top-4 z-[1002] -translate-x-1/2 rounded-sm border border-primary/40 bg-card/95 px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest text-primary shadow-sm">
      {label}
    </div>
  )
}
