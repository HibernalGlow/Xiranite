import { useEffect, useId, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react"
import { AnimatePresence, motion } from "motion/react"
import { GripHorizontal } from "lucide-react"
import {
  DynamicContainer,
  DynamicIsland,
  DynamicIslandProvider,
  useDynamicIslandSize,
} from "@/components/ui/dynamic-island"
import { cn } from "@/lib/utils"
import { useWorkspaceShallowSelector } from "@/store/workspaceContext"

/** 操作栏动作语义，用于红绿灯样式下决定圆点颜色。 */
export type ChromeActionTone = "close" | "minimize" | "maximize" | "neutral"

export interface NodeSurfaceChromeAction {
  key: string
  label: string
  icon: ReactNode
  danger?: boolean
  tone?: ChromeActionTone
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
}

export interface ChromeAppearance {
  visible: boolean
  position: "left" | "right" | "island"
  style: "default" | "traffic-light"
}

/**
 * 从 store 读取操作栏外观设置（可见性 / 位置 / 样式）。
 * CardView 与各节点视图共享同一份设置。
 */
export function useChromeAppearance(): ChromeAppearance {
  return useWorkspaceShallowSelector((store) => ({
    visible: store.chromeVisible,
    position: store.chromePosition,
    style: store.chromeStyle,
  }))
}

/** 由 tone + danger 推断红绿灯颜色。danger 优先视作 close（红）。 */
function resolveTone(action: NodeSurfaceChromeAction): ChromeActionTone {
  if (action.tone) return action.tone
  if (action.danger) return "close"
  return "neutral"
}

/** 红绿灯样式下，圆点的底色 + hover 高亮色（按 tone 分配）。 */
function trafficLightDotClasses(tone: ChromeActionTone): string {
  switch (tone) {
    case "close":
      return "bg-destructive/70 hover:bg-destructive text-white"
    case "minimize":
      return "bg-yellow-500/75 hover:bg-yellow-500 text-black"
    case "maximize":
      return "bg-emerald-500/75 hover:bg-emerald-500 text-black"
    default:
      return "bg-muted-foreground/45 hover:bg-muted-foreground/70 text-foreground"
  }
}

export function NodeSurfaceChrome({
  actions,
  collapsed,
  dragHandle,
  moduleName,
  stateLabel,
  version,
}: {
  actions: NodeSurfaceChromeAction[]
  collapsed?: boolean
  dragHandle?: ReactNode
  moduleName: string
  stateLabel?: string
  version?: string
}) {
  const { visible, position, style } = useChromeAppearance()

  if (!visible) return null

  const isTrafficLight = style === "traffic-light"
  // 折叠态是一整条窄条，左/右区分意义不大，统一保持右对齐（ml-auto）。
  // 位置设置主要作用于展开态的浮动操作栏。
  if (collapsed) {
    return (
      <div className="xiranite-ui-copy flex h-full min-h-10 select-none items-center gap-2 px-3">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/80 shadow-[0_0_12px_var(--ws-accent-glow)]" />
        {dragHandle}
        <span className="min-w-0 truncate text-[10px] font-mono font-semibold uppercase tracking-widest text-foreground/80">
          {moduleName}
        </span>
        {version && (
          <span className="shrink-0 text-[9px] font-mono text-muted-foreground/50">
            {version}
          </span>
        )}
        {stateLabel && (
          <span className="ml-1 shrink-0 rounded-[3px] bg-muted/35 px-1.5 py-0.5 font-mono text-[9px] tracking-widest text-muted-foreground">
            {stateLabel}
          </span>
        )}
        <div className={cn(
          "ml-auto flex items-center transition-opacity",
          isTrafficLight ? "gap-1.5" : "gap-0.5 opacity-65 group-focus-within:opacity-100 group-hover:opacity-100",
        )}>
          {actions.map((action) => (
            <ChromeActionButton
              key={action.key}
              action={action}
              trafficLight={isTrafficLight}
            />
          ))}
        </div>
      </div>
    )
  }

  if (position === "island") {
    return (
      <DynamicIslandChrome
        actions={actions}
        dragHandle={dragHandle}
      />
    )
  }

  const positionClass = position === "left" ? "left-2 justify-start" : "right-2 justify-end"

  if (isTrafficLight) {
    // 红绿灯：圆点常驻可见，hover 时圆点内出现图标。
    return (
      <div className={cn(
        "xiranite-ui-copy absolute top-2 z-20 flex items-center gap-1.5 transition-opacity duration-150",
        positionClass,
        "opacity-80 group-focus-within:opacity-100 group-hover:opacity-100",
      )}>
        {dragHandle && (
          <span className="xiranite-node-drag-handle grid h-6 w-6 place-items-center rounded-[3px] text-muted-foreground transition-colors hover:bg-muted/55 hover:text-primary">
            {dragHandle}
          </span>
        )}
        {actions.map((action) => (
          <ChromeActionButton
            key={action.key}
            action={action}
            trafficLight
          />
        ))}
      </div>
    )
  }

  // 默认胶囊样式：hover/focus 时才浮现。
  return (
    <div className={cn(
      "xiranite-ui-copy pointer-events-none absolute top-2 z-20 flex items-center opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100",
      positionClass,
    )}>
      <div className="pointer-events-none flex items-center gap-0.5 rounded-[4px] bg-background/45 p-0.5 shadow-sm backdrop-blur-md ring-1 ring-border/20 group-focus-within:pointer-events-auto group-hover:pointer-events-auto">
        {dragHandle && (
          <span className="xiranite-node-drag-handle grid h-6 w-6 place-items-center rounded-[3px] text-muted-foreground transition-colors hover:bg-muted/55 hover:text-primary">
            {dragHandle}
          </span>
        )}
        {actions.map((action) => (
          <ChromeActionButton
            key={action.key}
            action={action}
            trafficLight={false}
          />
        ))}
      </div>
    </div>
  )
}

function DynamicIslandChrome({
  actions,
  dragHandle,
}: {
  actions: NodeSurfaceChromeAction[]
  dragHandle?: ReactNode
}) {
  const islandId = useId()
  const hostRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [surfaceSize, setSurfaceSize] = useState({ width: 260, height: 160 })
  const buttonCount = actions.length + (dragHandle ? 1 : 0)
  const metrics = useMemo(
    () => getIslandMetrics(surfaceSize.width, surfaceSize.height, buttonCount),
    [buttonCount, surfaceSize.height, surfaceSize.width],
  )
  const presets = useMemo(() => ({
    minimalLeading: {
      width: metrics.idleWidth,
      aspectRatio: metrics.idleHeight / metrics.idleWidth,
      borderRadius: metrics.idleHeight / 2,
    },
    compact: {
      width: metrics.compactWidth,
      aspectRatio: metrics.compactHeight / metrics.compactWidth,
      borderRadius: metrics.compactHeight / 2,
    },
  }), [metrics])

  useEffect(() => {
    const host = hostRef.current
    const surface = host?.parentElement
    if (!surface) return

    function updateSurfaceSize() {
      const rect = surface.getBoundingClientRect()
      setSurfaceSize({
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
      })
    }

    updateSurfaceSize()
    if (typeof ResizeObserver === "undefined") return

    const observer = new ResizeObserver(updateSurfaceSize)
    observer.observe(surface)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={hostRef}
      className="xiranite-ui-copy absolute left-1/2 top-2 z-20 -translate-x-1/2"
      onPointerEnter={() => setExpanded(true)}
      onPointerLeave={() => setExpanded(false)}
    >
      <DynamicIslandProvider initialSize="minimalLeading" presets={presets}>
        <DynamicIsland
          id={`node-operation-island-${islandId}`}
          className={cn(
            "text-foreground transition-[background-color,border-color,box-shadow,backdrop-filter] duration-200",
            expanded
              ? "border border-border/35 bg-background/70 shadow-sm backdrop-blur-xl ring-1 ring-primary/10"
              : "border border-transparent bg-transparent shadow-none backdrop-blur-0 hover:shadow-none",
          )}
        >
          <DynamicIslandChromeContent
            actions={actions}
            contentScale={metrics.contentScale}
            dragHandle={dragHandle}
            expanded={expanded}
          />
        </DynamicIsland>
      </DynamicIslandProvider>
    </div>
  )
}

function DynamicIslandChromeContent({
  actions,
  contentScale,
  dragHandle,
  expanded,
}: {
  actions: NodeSurfaceChromeAction[]
  contentScale: number
  dragHandle?: ReactNode
  expanded: boolean
}) {
  const { setSize } = useDynamicIslandSize()

  useEffect(() => {
    setSize(expanded ? "compact" : "minimalLeading")
  }, [expanded, setSize])

  return (
    <div
      role="toolbar"
      aria-label="Node operation island"
      className="flex h-full w-full items-center justify-center"
    >
      <DynamicContainer className={cn("relative flex h-full w-full items-center justify-center", expanded ? "gap-0.5 px-2" : "gap-1")}>
        <AnimatePresence initial={false} mode="wait">
          {expanded ? (
            <motion.div
              key="island-actions"
              initial={{ opacity: 0, scale: 0.86, y: 2, filter: "blur(3px)" }}
              animate={{ opacity: 1, scale: contentScale, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, scale: contentScale * 0.86, y: -2, filter: "blur(3px)" }}
              transition={{ type: "spring", stiffness: 460, damping: 36, mass: 0.55 }}
              className="flex items-center justify-center gap-0.5"
              style={{ transformOrigin: "center" }}
            >
              {dragHandle && (
                <span className="xiranite-node-drag-handle grid h-6 w-6 place-items-center rounded-[3px] text-muted-foreground transition-colors hover:bg-muted/55 hover:text-primary">
                  {dragHandle}
                </span>
              )}
              {actions.map((action) => (
                <ChromeActionButton
                  key={action.key}
                  action={action}
                  trafficLight={false}
                />
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="island-idle"
              initial={{ opacity: 0, scale: 0.72, y: -1, filter: "blur(2px)" }}
              animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, scale: 0.7, y: 1, filter: "blur(2px)" }}
              transition={{ type: "spring", stiffness: 500, damping: 34, mass: 0.45 }}
              className="flex items-center justify-center gap-1"
            >
              <span className="h-1.5 w-5 rounded-full bg-primary/75 shadow-[0_0_14px_var(--ws-accent-glow)]" />
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/35" />
            </motion.div>
          )}
        </AnimatePresence>
      </DynamicContainer>
    </div>
  )
}

function getIslandMetrics(surfaceWidth: number, surfaceHeight: number, buttonCount: number) {
  const availableWidth = Math.max(36, surfaceWidth - 16)
  const availableHeight = Math.max(28, surfaceHeight - 12)
  const desiredContentWidth = Math.min(235, Math.max(148, buttonCount * 30 + 40))
  const scale = Math.max(0.62, Math.min(1, availableWidth / desiredContentWidth, availableHeight / 44))
  const compactWidth = Math.round(Math.max(52, Math.min(desiredContentWidth * scale, availableWidth)))
  const compactHeight = Math.round(Math.max(32, Math.min(44 * scale, availableHeight)))
  const idleWidth = Math.round(Math.max(36, Math.min(52 * scale, availableWidth)))
  const idleHeight = Math.round(Math.max(28, Math.min(44 * scale, availableHeight)))

  return {
    compactWidth,
    compactHeight,
    idleWidth,
    idleHeight,
    contentScale: Number(scale.toFixed(3)),
  }
}

function ChromeActionButton({
  action,
  trafficLight,
}: {
  action: NodeSurfaceChromeAction
  trafficLight: boolean
}) {
  if (trafficLight) {
    const tone = resolveTone(action)
    return (
      <button
        type="button"
        title={action.label}
        aria-label={action.label}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={action.onClick}
        className={cn(
          "grid h-3.5 w-3.5 place-items-center rounded-full transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/70",
          trafficLightDotClasses(tone),
        )}
      >
        <span className="hidden leading-none group-hover:inline group-focus-within:inline [&_svg]:h-2.5 [&_svg]:w-2.5">
          {action.icon}
        </span>
      </button>
    )
  }

  return (
    <button
      type="button"
      title={action.label}
      aria-label={action.label}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={action.onClick}
      className={cn(
        "grid h-6 w-6 place-items-center rounded-[3px] text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/70",
        action.danger
          ? "hover:bg-destructive/10 hover:text-destructive"
          : "hover:bg-muted/55 hover:text-primary",
      )}
    >
      {action.icon}
    </button>
  )
}

export function DefaultNodeDragGrip() {
  return <GripHorizontal className="h-3.5 w-3.5" />
}
