import { useCallback, useEffect, useMemo, useRef, type DragEvent as ReactDragEvent, type MouseEvent } from "react"
import { useTranslation } from "react-i18next"
import { GridStack, type GridStackNode } from "gridstack"
import "gridstack/dist/gridstack.min.css"
import { GripHorizontal, LayoutTemplate, Maximize2, Minus, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ModuleRenderer } from "@/components/modules/ModuleRenderer"
import { getModule } from "@/components/modules/registry"
import { useModuleDropTarget } from "@/hooks/useModuleDropTarget"
import { isComponentVisibleInView } from "@/lib/componentVisibility"
import { cn } from "@/lib/utils"
import { useWorkspaceActions, useWorkspaceVisibleComponents } from "@/store/workspaceContext"
import type { ComponentInstance } from "@/types/workspace"

const GRID_COLUMNS = 12
const GRID_CELL_HEIGHT = 76
const GRID_MARGIN = 10
const DEFAULT_WIDGET = { x: 0, y: 0, w: 4, h: 4 }

function isBentoVisible(component: ComponentInstance) {
  return isComponentVisibleInView(component, "bento")
}

function layoutFor(component: ComponentInstance, index: number) {
  return component.bentoLayout ?? {
    x: (index % 3) * 4,
    y: Math.floor(index / 3) * 4,
    w: index % 5 === 0 ? 6 : DEFAULT_WIDGET.w,
    h: index % 7 === 2 ? 5 : DEFAULT_WIDGET.h,
  }
}

export function BentoView() {
  const { t } = useTranslation()
  const workspaceActions = useWorkspaceActions()
  const visibleComponents = useWorkspaceVisibleComponents()
  const gridRef = useRef<GridStack | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const bentoComponents = useMemo(
    () => visibleComponents.filter(isBentoVisible),
    [visibleComponents],
  )
  const componentIds = useMemo(() => bentoComponents.map((component) => component.id).join("|"), [bentoComponents])
  const componentsRef = useRef(bentoComponents)
  componentsRef.current = bentoComponents
  const handleDropModule = useCallback((moduleId: string, event: ReactDragEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const xRatio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0
    const x = Math.max(0, Math.min(GRID_COLUMNS - DEFAULT_WIDGET.w, Math.floor(xRatio * GRID_COLUMNS) - Math.floor(DEFAULT_WIDGET.w / 2)))
    const y = Math.max(
      0,
      Math.floor((event.clientY - rect.top) / (GRID_CELL_HEIGHT + GRID_MARGIN)) - Math.floor(DEFAULT_WIDGET.h / 2),
    )
    workspaceActions.deployComponent(moduleId, {
      viewMode: "bento",
      bentoLayout: { ...DEFAULT_WIDGET, x, y },
    })
  }, [workspaceActions])
  const { isModuleOver, moduleDropHandlers } = useModuleDropTarget(handleDropModule)

  useEffect(() => {
    const container = containerRef.current
    if (!container || bentoComponents.length === 0) return undefined

    gridRef.current?.destroy(false)
    const grid = GridStack.init({
      acceptWidgets: false,
      animate: true,
      cellHeight: GRID_CELL_HEIGHT,
      column: GRID_COLUMNS,
      float: false,
      margin: GRID_MARGIN,
      minRow: 1,
      draggable: {
        handle: ".xiranite-bento-drag-handle",
      },
      resizable: {
        handles: "e,se,s,w",
      },
    }, container)
    gridRef.current = grid

    const syncNode = (_event: Event, node: GridStackNode) => {
      const id = node.id ? String(node.id) : node.el?.getAttribute("gs-id")
      if (!id) return
      const current = componentsRef.current.find((c) => c.id === id)
      workspaceActions.setComponentBentoLayout(id, {
        x: node.x ?? current?.bentoLayout?.x ?? 0,
        y: node.y ?? current?.bentoLayout?.y ?? 0,
        w: node.w ?? current?.bentoLayout?.w ?? DEFAULT_WIDGET.w,
        h: node.h ?? current?.bentoLayout?.h ?? DEFAULT_WIDGET.h,
      })
    }

    grid.on("dragstop", syncNode)
    grid.on("resizestop", syncNode)

    return () => {
      grid.off("dragstop")
      grid.off("resizestop")
      grid.destroy(false)
      if (gridRef.current === grid) gridRef.current = null
    }
  }, [componentIds, bentoComponents.length, workspaceActions])

  if (bentoComponents.length === 0) {
    return (
      <div
        className={cn(
          "relative flex min-h-0 flex-1 items-center justify-center ws-canvas-bg transition-colors",
          isModuleOver && "bg-primary/5 ring-1 ring-inset ring-primary/40",
        )}
        data-testid="bento-drop-target"
        {...moduleDropHandlers}
      >
        {isModuleOver && <ModuleDropHint label={t("registry:dropHint")} />}
        <div className="space-y-4 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-sm border-2 border-dashed border-border text-muted-foreground/50">
            <LayoutTemplate className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-mono text-muted-foreground">{t("view:bento.empty")}</p>
            <p className="mt-1 text-xs font-mono text-muted-foreground/60">{t("view:bento.emptyHint")}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="font-mono text-xs"
            onClick={() => workspaceActions.setOverlay("registry")}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t("view:bento.openRegistry")}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "relative min-h-0 flex-1 overflow-auto ws-canvas-bg p-4 transition-colors",
        isModuleOver && "bg-primary/5 ring-1 ring-inset ring-primary/40",
      )}
      data-testid="bento-drop-target"
      {...moduleDropHandlers}
    >
      {isModuleOver && <ModuleDropHint label={t("registry:dropHint")} />}
      <div
        ref={containerRef}
        key={componentIds}
        className="grid-stack xiranite-bento-grid mx-auto max-w-[1680px]"
        data-testid="bento-grid"
      >
        {bentoComponents.map((component, index) => {
          const layout = layoutFor(component, index)
          return (
            <div
              key={component.id}
              className="grid-stack-item"
              gs-id={component.id}
              gs-x={String(layout.x)}
              gs-y={String(layout.y)}
              gs-w={String(layout.w)}
              gs-h={String(layout.h)}
              gs-min-w="2"
              gs-min-h="2"
            >
              <div className="grid-stack-item-content">
                <BentoWidget component={component} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BentoWidget({ component }: { component: ComponentInstance }) {
  const workspaceActions = useWorkspaceActions()
  const { t, i18n } = useTranslation()
  const mod = getModule(component.moduleId)
  const moduleName = i18n.exists(`module:${component.moduleId}.name`)
    ? t(`module:${component.moduleId}.name`)
    : (mod?.name ?? component.moduleId)

  function toggleCollapse(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
    workspaceActions.toggleCollapse(component.id)
  }

  function hideInBento(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
    workspaceActions.setComponentVisibility(component.id, "bento", false)
  }

  return (
    <section className="group flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border/70 bg-card/95 shadow-[0_18px_45px_-24px_oklch(0_0_0/0.45)] backdrop-blur-sm">
      <header className="xiranite-bento-drag-handle flex h-9 shrink-0 cursor-grab items-center gap-2 border-b border-border/60 bg-muted/25 px-2 active:cursor-grabbing">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
        <GripHorizontal className="h-3.5 w-3.5 shrink-0 text-muted-foreground/55" />
        <span className="min-w-0 flex-1 truncate text-[10px] font-mono font-semibold uppercase tracking-widest text-muted-foreground">
          {moduleName}
        </span>
        {mod && (
          <span className="hidden shrink-0 font-mono text-[9px] text-muted-foreground/45 sm:inline">
            {mod.version}
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
          <WidgetButton
            label={component.collapsed ? t("common:expand") : t("common:collapse")}
            onClick={toggleCollapse}
          >
            {component.collapsed ? <Maximize2 className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
          </WidgetButton>
          <WidgetButton
            danger
            label={t("common:hideIn", { view: t("topbar:viewMode.bento") })}
            onClick={hideInBento}
          >
            <X className="h-3 w-3" />
          </WidgetButton>
        </div>
      </header>
      {!component.collapsed && (
        <div className="min-h-0 flex-1 overflow-hidden p-2">
          <ModuleRenderer moduleId={component.moduleId} compId={component.id} />
        </div>
      )}
    </section>
  )
}

function WidgetButton({
  children,
  label,
  onClick,
  danger,
}: {
  children: React.ReactNode
  label: string
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onClick}
      className={cn(
        "grid h-6 w-6 place-items-center rounded-[3px] border border-transparent text-muted-foreground transition-colors hover:border-border",
        danger ? "hover:bg-destructive/10 hover:text-destructive" : "hover:bg-muted/60 hover:text-primary",
      )}
    >
      {children}
    </button>
  )
}

function ModuleDropHint({ label }: { label: string }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-sm border border-primary/40 bg-card/95 px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest text-primary shadow-sm">
      {label}
    </div>
  )
}
