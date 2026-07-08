import type { MouseEvent, ReactNode } from "react"
import { GripHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"

export interface NodeSurfaceChromeAction {
  key: string
  label: string
  icon: ReactNode
  danger?: boolean
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
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
        <div className="ml-auto flex items-center gap-0.5 opacity-65 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          {actions.map((action) => <NodeSurfaceChromeButton key={action.key} action={action} />)}
        </div>
      </div>
    )
  }

  return (
    <div className="xiranite-ui-copy pointer-events-none absolute right-2 top-2 z-20 flex items-center justify-end opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
      <div className="pointer-events-none flex items-center gap-0.5 rounded-[4px] bg-background/45 p-0.5 shadow-sm backdrop-blur-md ring-1 ring-border/20 group-focus-within:pointer-events-auto group-hover:pointer-events-auto">
        {dragHandle && (
          <span className="xiranite-node-drag-handle grid h-6 w-6 place-items-center rounded-[3px] text-muted-foreground transition-colors hover:bg-muted/55 hover:text-primary">
            {dragHandle}
          </span>
        )}
        {actions.map((action) => <NodeSurfaceChromeButton key={action.key} action={action} />)}
      </div>
    </div>
  )
}

export function NodeSurfaceChromeButton({ action }: { action: NodeSurfaceChromeAction }) {
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
