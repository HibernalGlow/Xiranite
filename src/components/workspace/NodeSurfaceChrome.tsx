import type { MouseEvent, ReactNode } from "react"
import { GripHorizontal } from "lucide-react"
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
  position: "left" | "right"
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
