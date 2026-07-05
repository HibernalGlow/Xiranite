import { lazy, Suspense } from "react"
import type { ComponentType } from "react"
import { Skeleton } from "@/components/ui/skeleton"

const modules: Record<string, ReturnType<typeof lazy>> = {
  scratch:     lazy(() => import("./ScratchModule")),
  counter:     lazy(() => import("./CounterModule")),
  "acid-mixer": lazy(() => import("./AcidMixerModule")),
  terminal:    lazy(() => import("./TerminalModule")),
  tasks:       lazy(() => import("./TasksModule")),
  clock:       lazy(() => import("./ClockModule")),
  calculator:  lazy(() => import("./CalculatorModule")),
  kanban:      lazy(() => import("./KanbanModule")),
  enginev:     lazy(() => import("./EngineVModule")),
  database:    lazy(() => import("./DatabaseModule")),
}

export interface ModuleProps {
  /** 当前组件实例的 id — 模块用 useComponentData(compId) 持久化状态到 store。
   *  这样切换 viewMode 时模块状态不丢失（comp.data 一直在 store 中）。 */
  compId: string
}

export function ModuleRenderer({ moduleId, compId }: { moduleId: string; compId: string }) {
  const Comp = modules[moduleId] as ComponentType<ModuleProps> | undefined
  if (!Comp) return <div className="flex items-center justify-center h-full text-xs font-mono text-muted-foreground">// unknown module: {moduleId}</div>
  return (
    <Suspense fallback={<div className="p-4"><Skeleton className="h-32 w-full" /></div>}>
      <Comp compId={compId} />
    </Suspense>
  )
}
