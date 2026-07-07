import { lazy, Suspense } from "react"
import type { ComponentType, LazyExoticComponent } from "react"
import { useTranslation } from "react-i18next"
import type { NodeComponentProps } from "@xiranite/contract"
import { Skeleton } from "@/components/ui/skeleton"
import { useNodeHostApi } from "./hostApi"
import { packageModuleLoaders } from "./packageModules.generated"

const modules: Record<string, ReturnType<typeof lazy>> = {
  scratch:     lazy(() => import("./ScratchModule")),
  counter:     lazy(() => import("./CounterModule")),
  "acid-mixer": lazy(() => import("./AcidMixerModule")),
  terminal:    lazy(() => import("./TerminalModule")),
  tasks:       lazy(() => import("./TasksModule")),
  clock:       lazy(() => import("./ClockModule")),
  calculator:  lazy(() => import("./CalculatorModule")),
  kanban:      lazy(() => import("./KanbanModule")),
  database:    lazy(() => import("./DatabaseModule")),
  blocknote:   lazy(() => import("./BlockNoteModule")),
}

const packageComponents = Object.fromEntries(
  Object.entries(packageModuleLoaders).map(([id, loadEntry]) => [
    id,
    lazy(async () => {
      const entry = (await loadEntry()).default
      return { default: entry.Component as ComponentType<NodeComponentProps> }
    }),
  ]),
) as Partial<Record<string, LazyExoticComponent<ComponentType<NodeComponentProps>>>>

export interface ModuleProps {
  /** 当前组件实例的 id — 模块用 useComponentData(compId) 持久化状态到 store。
   *  这样切换 viewMode 时模块状态不丢失（comp.data 一直在 store 中）。 */
  compId: string
}

export function ModuleRenderer({ moduleId, compId }: { moduleId: string; compId: string }) {
  const { t } = useTranslation()
  const host = useNodeHostApi(compId, moduleId)
  const PackageComponent = packageComponents[moduleId]
  if (PackageComponent) {
    return (
      <Suspense fallback={<div className="p-4"><Skeleton className="h-32 w-full" /></div>}>
        <PackageComponent compId={compId} host={host} />
      </Suspense>
    )
  }

  const Comp = modules[moduleId] as ComponentType<ModuleProps> | undefined
  if (!Comp) return <div className="flex items-center justify-center h-full text-xs font-mono text-muted-foreground">{t("module:unknown", { id: moduleId })}</div>
  return (
    <Suspense fallback={<div className="p-4"><Skeleton className="h-32 w-full" /></div>}>
      <Comp compId={compId} />
    </Suspense>
  )
}
