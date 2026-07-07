import { memo } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { useWorkspaceActions } from "@/store/workspaceContext"
import type { ComponentInstance, ComputedLayout, CardLayout } from "@/types/workspace"
import { ModuleRenderer } from "@/components/modules/ModuleRenderer"
import { getModule } from "@/components/modules/registry"
import { useWindowControls } from "@/hooks/useWindowControls"
import {
  Maximize2,
  Minimize2,
  X,
  Minus,
  Expand,
  ExternalLink,
} from "lucide-react"

interface Props {
  comp: ComponentInstance
  layout: ComputedLayout
  canvasRef: React.RefObject<HTMLDivElement | null>
  isFocused: boolean
  hasFocused: boolean
  cardLayout: CardLayout
  isLayoutResizing: boolean
}

const stateLabelKey: Record<ComputedLayout["state"], string> = {
  docked: "common:dock",
  floating: "common:float",
  compact: "common:compact",
  focused: "common:focusState",
  fullscreen: "common:full",
}

function ComponentCardInner({ comp, layout, isLayoutResizing }: Props) {
  const workspaceActions = useWorkspaceActions()
  const { t, i18n } = useTranslation()
  const { openComponent } = useWindowControls()
  const mod = getModule(comp.moduleId)
  const moduleId = comp.moduleId
  const moduleName = i18n.exists(`module:${moduleId}.name`) ? t(`module:${moduleId}.name`) : (mod?.name ?? comp.moduleId)

  const isFullscreen = layout.state === "fullscreen"
  const isCompact = layout.state === "compact"
  const isFocusedState = layout.state === "focused"
  const isTiny = layout.w < 240

  function toggleCollapse() {
    workspaceActions.toggleCollapse(comp.id)
  }

  function toggleFullscreen() {
    workspaceActions.setFullscreen(isFullscreen ? null : comp.id)
  }

  function activateFocus() {
    workspaceActions.setCardLayout("focus")
    workspaceActions.focusComponent(comp.id)
  }

  function exitFocus() {
    workspaceActions.setCardLayout("grid")
    workspaceActions.focusComponent(null)
  }

  async function openFloatingWindow() {
    const result = await openComponent({
      componentId: comp.id,
      moduleId: comp.moduleId,
      title: moduleName,
      width: Math.round(layout.w),
      height: Math.round(layout.h),
    })
    if (result.success) {
      workspaceActions.setComponentState(comp.id, "floating")
    } else {
      console.info(`[window] ${result.message}`)
    }
  }

  return (
    <div
      data-context-menu="component-card"
      data-component-id={comp.id}
      onPointerDown={() => workspaceActions.raiseComponent(comp.id)}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: layout.w,
        height: layout.h,
        opacity: layout.opacity,
        transform: `translate3d(${layout.x}px, ${layout.y}px, 0) scale(${layout.scale})`,
        transformOrigin: "top left",
        zIndex: layout.z,
        pointerEvents: layout.interactive ? "auto" : "none",
      }}
      className={cn(
        "group flex flex-col overflow-hidden rounded-md border bg-card",
        !isLayoutResizing && "comp-card--animated backdrop-blur-sm transition-[transform,width,height,opacity] duration-200 ease-out",
        isFullscreen && "comp-card--fullscreen",
        (isFocusedState || isFullscreen)
          ? "border-primary/60 shadow-[0_0_0_1px_var(--ws-accent-glow),0_24px_60px_-20px_var(--ws-accent-glow)]"
          : "border-border shadow-[0_12px_40px_-12px_oklch(0_0_0/0.35)]",
        isCompact && "comp-card--compact",
      )}
    >
      {/* ── Header ── */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 bg-muted/30 px-3 select-none">
        <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
        <span className="truncate text-[10px] font-mono font-semibold tracking-widest text-muted-foreground uppercase">
          {moduleName}
        </span>
        {mod && (
          <span className="text-[9px] font-mono text-muted-foreground/50 flex-shrink-0">
            {mod.version}
          </span>
        )}
        <span className="ml-1 rounded-[3px] bg-background/60 px-1.5 py-0.5 font-mono text-[9px] tracking-widest text-muted-foreground">
          {t(stateLabelKey[layout.state])}
        </span>

        <div className="ml-auto flex items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
          <HeaderBtn label={comp.collapsed ? t("common:expand") : t("common:collapse")} onClick={toggleCollapse}>
            {comp.collapsed ? <Maximize2 className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
          </HeaderBtn>

          {!isFocusedState && !isFullscreen && (
            <HeaderBtn label={t("common:focus")} onClick={activateFocus}>
              <Expand className="h-3 w-3" />
            </HeaderBtn>
          )}
          {isFocusedState && (
            <HeaderBtn label={t("common:exitFocus")} onClick={exitFocus}>
              <Minimize2 className="h-3 w-3" />
            </HeaderBtn>
          )}

          <HeaderBtn
            label={isFullscreen ? t("common:exitFullscreen") : t("common:fullscreen")}
            onClick={toggleFullscreen}
          >
            {isFullscreen ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          </HeaderBtn>

          <HeaderBtn label={t("common:openFloatingWindow")} onClick={openFloatingWindow}>
            <ExternalLink className="h-3 w-3" />
          </HeaderBtn>

          <HeaderBtn label={t("common:hideIn", { view: t("topbar:viewMode.cards") })} danger onClick={() => workspaceActions.toggleComponentVisibility(comp.id, "cards")}>
            <X className="h-3 w-3" />
          </HeaderBtn>
        </div>
      </div>

      {/* ── Body — always mounted so component state survives every layout morph ── */}
      {!comp.collapsed && (
        <div className={cn("min-h-0 flex-1 overflow-hidden", isTiny ? "p-1.5" : "p-2")}>
          <ModuleRenderer moduleId={comp.moduleId} compId={comp.id} />
        </div>
      )}
    </div>
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
