import { useMemo } from "react"
import { getBackend } from "@/backend/client"
import { cn } from "@/lib/utils"
import { getModule } from "@/components/modules/registry"
import { ModuleRenderer } from "@/components/modules/ModuleRenderer"
import { useWorkspace } from "@/store/workspaceContext"
import { X } from "lucide-react"

interface Props {
  compId: string
  windowId?: string | null
  moduleIdFallback?: string | null
  titleFallback?: string | null
}

export function FloatingComponentWindow({ compId, windowId, moduleIdFallback, titleFallback }: Props) {
  const { state } = useWorkspace()
  const comp = state.components.find((item) => item.id === compId)
  const moduleId = comp?.moduleId ?? moduleIdFallback ?? ""
  const mod = getModule(moduleId)
  const title = titleFallback || mod?.name || moduleId || "COMPONENT"

  const themeClass = state.theme === "endfield" ? "theme-endfield" : state.theme === "wuling" ? "theme-wuling" : ""

  const detail = useMemo(() => {
    if (!moduleId) return "missing module"
    if (!comp) return "loading persisted component state"
    return `${comp.workspaceId} / ${comp.id}`
  }, [comp, moduleId])

  async function closeWindow() {
    try {
      const backend = await getBackend()
      await backend.windows.close(windowId ?? compId)
    } catch {
      // Browser fallback windows may not be tracked by the backend.
    }
    window.close()
  }

  return (
    <div className={cn("flex h-screen flex-col overflow-hidden bg-background text-foreground", themeClass)}>
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[11px] font-semibold uppercase tracking-normal">{title}</div>
          <div className="truncate font-mono text-[9px] text-muted-foreground">{detail}</div>
        </div>
        <button
          type="button"
          title="Close window"
          aria-label="Close window"
          onClick={closeWindow}
          className="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden p-2">
        {moduleId ? (
          <ModuleRenderer moduleId={moduleId} compId={compId} />
        ) : (
          <div className="grid h-full place-items-center font-mono text-xs text-muted-foreground">
            // missing floating component target
          </div>
        )}
      </main>
    </div>
  )
}
