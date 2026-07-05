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
}

export function ModuleRenderer({ moduleId }: { moduleId: string }) {
  const Comp = modules[moduleId] as ComponentType | undefined
  if (!Comp) return <div className="flex items-center justify-center h-full text-xs font-mono text-muted-foreground">// unknown module: {moduleId}</div>
  return (
    <Suspense fallback={<div className="p-4"><Skeleton className="h-32 w-full" /></div>}>
      <Comp />
    </Suspense>
  )
}
