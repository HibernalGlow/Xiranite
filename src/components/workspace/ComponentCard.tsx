import { memo } from "react"
import { motion } from "motion/react"
import { cn } from "@/lib/utils"
import { useWSDispatch, actions } from "@/store/workspaceContext"
import type { ComponentInstance, ComputedLayout, LayoutMode } from "@/types/workspace"
import { ModuleRenderer } from "@/components/modules/ModuleRenderer"
import { getModule } from "@/components/modules/registry"
import {
  Maximize2,
  Minimize2,
  X,
  Minus,
  Pin,
  PinOff,
  Expand,
} from "lucide-react"

interface Props {
  comp: ComponentInstance
  layout: ComputedLayout
  canvasRef: React.RefObject<HTMLDivElement | null>
  isFocused: boolean
  hasFocused: boolean
  layoutMode: LayoutMode
}

const stateLabel: Record<ComputedLayout["state"], string> = {
  docked: "DOCKED",
  floating: "FLOAT",
  compact: "COMPACT",
  focused: "FOCUS",
  fullscreen: "FULL",
}

function ComponentCardInner({ comp, layout, canvasRef, layoutMode }: Props) {
  const dispatch = useWSDispatch()
  const mod = getModule(comp.moduleId)

  const isFullscreen = layout.state === "fullscreen"
  const isCompact = layout.state === "compact"
  const isFloating = layout.state === "floating"
  const isFocusedState = layout.state === "focused"
  const isTiny = layout.w < 240

  function toggleCollapse() {
    dispatch(actions.toggleCollapse(comp.id))
  }

  function toggleFullscreen() {
    dispatch(actions.setFullscreen(isFullscreen ? null : comp.id))
  }

  function toggleFloat() {
    // In free mode, pin/unpin toggles whether this card floats on top.
    dispatch(actions.setComponentState(comp.id, isFloating ? "docked" : "floating"))
  }

  function activateFocus() {
    // Enter focus layout mode and mark this panel as the hero.
    dispatch(actions.setLayout("focus"))
    dispatch(actions.focusComponent(comp.id))
  }

  function exitFocus() {
    dispatch(actions.setLayout("grid"))
    dispatch(actions.focusComponent(null))
  }

  return (
    <motion.div
      drag={layoutMode === "free" && !isFullscreen}
      dragMomentum={false}
      dragConstraints={canvasRef}
      onPointerDown={() => dispatch(actions.raiseComponent(comp.id))}
      onDragEnd={(_, info) => {
        const nx = Math.max(0, layout.x + info.offset.x)
        const ny = Math.max(0, layout.y + info.offset.y)
        dispatch(actions.moveComponent(comp.id, nx, ny))
      }}
      initial={false}
      animate={{
        x: layout.x,
        y: layout.y,
        width: layout.w,
        height: layout.h,
        opacity: layout.opacity,
        scale: layout.scale,
      }}
      transition={{ type: "spring", stiffness: 320, damping: 34, mass: 0.7 }}
      style={{
        position: "absolute",
        zIndex: layout.z,
        pointerEvents: layout.interactive ? "auto" : "none",
      }}
      className={cn(
        "group flex flex-col overflow-hidden rounded-md border bg-card backdrop-blur-sm",
        isFullscreen && "comp-card--fullscreen",
        (isFocusedState || isFullscreen)
          ? "border-primary/60 shadow-[0_0_0_1px_var(--ws-accent-glow),0_24px_60px_-20px_var(--ws-accent-glow)]"
          : "border-border shadow-[0_12px_40px_-12px_oklch(0_0_0/0.35)]",
        isFloating && !isFullscreen && "comp-card--floating",
        isCompact && "comp-card--compact",
      )}
    >
      {/* ── Header ── */}
      <div
        className={cn(
          "flex h-10 shrink-0 items-center gap-2 border-b border-border/60 bg-muted/30 px-3 select-none",
          layoutMode === "free" && !isFullscreen && "cursor-grab active:cursor-grabbing",
        )}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
        <span className="truncate text-[10px] font-mono font-semibold tracking-widest text-muted-foreground uppercase">
          {mod?.name ?? comp.moduleId}
        </span>
        {mod && (
          <span className="text-[9px] font-mono text-muted-foreground/50 flex-shrink-0">
            {mod.version}
          </span>
        )}
        <span className="ml-1 rounded-[3px] bg-background/60 px-1.5 py-0.5 font-mono text-[9px] tracking-widest text-muted-foreground">
          {stateLabel[layout.state]}
        </span>

        <div className="ml-auto flex items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
          <HeaderBtn label={comp.collapsed ? "Expand" : "Collapse"} onClick={toggleCollapse}>
            {comp.collapsed ? <Maximize2 className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
          </HeaderBtn>

          {layoutMode === "free" && (
            <HeaderBtn label="Float" onClick={toggleFloat}>
              {isFloating ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
            </HeaderBtn>
          )}

          {!isFocusedState && !isFullscreen && (
            <HeaderBtn label="Focus" onClick={activateFocus}>
              <Expand className="h-3 w-3" />
            </HeaderBtn>
          )}
          {isFocusedState && (
            <HeaderBtn label="Exit focus" onClick={exitFocus}>
              <Minimize2 className="h-3 w-3" />
            </HeaderBtn>
          )}

          <HeaderBtn
            label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            onClick={toggleFullscreen}
          >
            {isFullscreen ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          </HeaderBtn>

          <HeaderBtn label="Remove" danger onClick={() => dispatch(actions.removeComponent(comp.id))}>
            <X className="h-3 w-3" />
          </HeaderBtn>
        </div>
      </div>

      {/* ── Body — always mounted so component state survives every layout morph ── */}
      {!comp.collapsed && (
        <div className={cn("min-h-0 flex-1 overflow-hidden", isTiny ? "p-1.5" : "p-2")}>
          {isTiny ? (
            <div className="grid h-full place-items-center text-center text-[10px] font-mono text-muted-foreground">
              <span>
                {mod?.name ?? comp.moduleId}
                <br />
                live
              </span>
            </div>
          ) : (
            <ModuleRenderer moduleId={comp.moduleId} />
          )}
        </div>
      )}
    </motion.div>
  )
}

function HeaderBtn({
  children,
  onClick,
  label,
  danger,
}: {
  children: React.ReactNode
  onClick: () => void
  label: string
  danger?: boolean
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        "grid h-6 w-6 place-items-center rounded-[3px] border border-transparent text-muted-foreground transition-colors hover:border-border",
        danger
          ? "hover:bg-destructive/10 hover:text-destructive"
          : "hover:bg-muted/60 hover:text-primary",
      )}
    >
      {children}
    </button>
  )
}

export const ComponentCard = memo(ComponentCardInner)
