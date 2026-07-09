import { lazy, Suspense, useEffect, useState } from "react"
import type { ComponentType } from "react"
import { useTranslation } from "react-i18next"
import type {
  AppNodeEntry,
  HeadlessNodePackage,
  NodeCapabilityId,
  NodeComponentProps,
  NodeContractCapability,
  NodeHostRequirements,
} from "@xiranite/contract"
import { AlertTriangle } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { useNodeHostApi } from "./hostApi"
import { NodeRenderBoundary } from "./NodeRenderBoundary"
import { packageModuleLoaders } from "./packageModules.generated"

type PackageModuleEntry = AppNodeEntry | HeadlessNodePackage
type PackageModuleLoader = () => Promise<{ default: PackageModuleEntry }>

const packageNodeLoaders = packageModuleLoaders as Readonly<Record<string, PackageModuleLoader>>

const modules: Record<string, ReturnType<typeof lazy>> = {
  scratch:      lazy(() => import("./ScratchModule")),
  counter:      lazy(() => import("./CounterModule")),
  "acid-mixer": lazy(() => import("./AcidMixerModule")),
  terminal:     lazy(() => import("./TerminalModule")),
  tasks:        lazy(() => import("./TasksModule")),
  clock:        lazy(() => import("./ClockModule")),
  calculator:   lazy(() => import("./CalculatorModule")),
  kanban:       lazy(() => import("./KanbanModule")),
  database:     lazy(() => import("./DatabaseModule")),
  blocknote:    lazy(() => import("./BlockNoteModule")),
  "music-player": lazy(() => import("./MusicPlayerModule")),
  "settings":          lazy(() => import("./OverlayViewModules").then((m) => ({ default: m.SettingsModule }))),
  "module-registry":   lazy(() => import("./OverlayViewModules").then((m) => ({ default: m.ModuleRegistryModule }))),
  "node-history":      lazy(() => import("./OverlayViewModules").then((m) => ({ default: m.NodeHistoryModule }))),
  "node-operations":   lazy(() => import("./OverlayViewModules").then((m) => ({ default: m.NodeOperationsModule }))),
}

export interface ModuleProps {
  /** 当前组件实例的 id — 模块用 useComponentData(compId) 持久化状态到 store。
   *  这样切换 viewMode 时模块状态不丢失（comp.data 一直在 store 中）。 */
  compId: string
}

export function ModuleRenderer({ moduleId, compId }: { moduleId: string; compId: string }) {
  "use memo"
  const { t } = useTranslation()

  if (packageNodeLoaders[moduleId]) {
    return <PackageNodeRenderer moduleId={moduleId} compId={compId} />
  }

  const Comp = modules[moduleId] as ComponentType<ModuleProps> | undefined
  if (!Comp) {
    return (
      <div className="flex items-center justify-center h-full text-xs font-mono text-muted-foreground">
        {t("module:unknown", { id: moduleId })}
      </div>
    )
  }
  return (
    <div className="xiranite-node-surface h-full min-h-0 w-full overflow-hidden">
      <Suspense fallback={<div className="p-4"><Skeleton className="h-32 w-full" /></div>}>
        <Comp compId={compId} />
      </Suspense>
    </div>
  )
}

/**
 * Renders a package-backed node. Loads the entry first so we can inspect its
 * declared host requirements (contractVersion + capabilities), surface a
 * diagnostic fallback when the host cannot satisfy them, and only then mount
 * the node component wrapped in {@link NodeRenderBoundary}.
 */
function PackageNodeRenderer({ moduleId, compId }: { moduleId: string; compId: string }) {
  const [entry, setEntry] = useState<PackageModuleEntry | null | undefined>(undefined)
  const host = useNodeHostApi(compId, moduleId, entry && isRenderableNodeEntry(entry) ? entry.schemas : undefined)

  useEffect(() => {
    let cancelled = false
    const loader = packageNodeLoaders[moduleId]
    if (!loader) {
      setEntry(null)
      return
    }
    loader()
      .then((mod) => {
        if (!cancelled) setEntry(mod.default)
      })
      .catch((error) => {
        console.error(`[module-renderer] failed to load entry for ${moduleId}`, error)
        if (!cancelled) setEntry(null)
      })
    return () => {
      cancelled = true
    }
  }, [moduleId])

  if (entry === undefined) {
    return <div className="p-4"><Skeleton className="h-32 w-full" /></div>
  }
  if (entry === null) {
    return (
      <div className="flex items-center justify-center h-full text-xs font-mono text-muted-foreground">
        Module &quot;{moduleId}&quot; failed to load
      </div>
    )
  }

  if (!isRenderableNodeEntry(entry)) {
    return <HeadlessNodeFallback moduleId={moduleId} entry={entry} />
  }

  const diagnostic = diagnoseHostRequirements(entry.host, host.contract)
  if (diagnostic) {
    return <DiagnosticFallback moduleId={moduleId} diagnostic={diagnostic} />
  }

  const Component = entry.Component as ComponentType<NodeComponentProps>
  return (
    <div className="xiranite-node-surface h-full min-h-0 w-full overflow-hidden">
      <NodeRenderBoundary moduleId={moduleId}>
        <Component compId={compId} host={host} />
      </NodeRenderBoundary>
    </div>
  )
}

function isRenderableNodeEntry(entry: PackageModuleEntry): entry is AppNodeEntry {
  return typeof (entry as Partial<AppNodeEntry>).Component === "function"
}

type HostDiagnostic =
  | { kind: "version"; range: string; version: string }
  | { kind: "capabilities"; missing: readonly NodeCapabilityId[] }

function diagnoseHostRequirements(
  requirements: NodeHostRequirements | undefined,
  contract: NodeContractCapability,
): HostDiagnostic | null {
  if (!requirements) return null

  if (requirements.contractVersion && !isContractVersionCompatible(requirements.contractVersion, contract.version)) {
    return { kind: "version", range: requirements.contractVersion, version: contract.version }
  }

  const missing = (requirements.capabilities ?? []).filter((cap) => !contract.hasCapability(cap))
  if (missing.length > 0) {
    return { kind: "capabilities", missing }
  }

  return null
}

/**
 * Minimal contract version check. Supports exact match (`"1.0.0"`) and caret
 * ranges (`"^1.0.0"` = same major). Missing range on the node side is treated
 * as legacy-compatible. Replace with a real semver implementation if/when the
 * project pulls in `semver`.
 */
function isContractVersionCompatible(range: string, version: string): boolean {
  if (range === version) return true
  const caretMatch = /^\^(\d+)\.\d+\.\d+$/.exec(range)
  if (caretMatch) {
    const requiredMajor = Number.parseInt(caretMatch[1]!, 10)
    const hostMajor = Number.parseInt(version.split(".")[0] ?? "0", 10)
    return requiredMajor === hostMajor
  }
  return false
}

function DiagnosticFallback({
  moduleId,
  diagnostic,
}: {
  moduleId: string
  diagnostic: HostDiagnostic
}) {
  return (
    <div className="p-4">
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>Node &quot;{moduleId}&quot; unavailable</AlertTitle>
        <AlertDescription>
          {diagnostic.kind === "version"
            ? `Contract version mismatch: node requires ${diagnostic.range}, host provides ${diagnostic.version}.`
            : `Missing host capabilities: ${diagnostic.missing.join(", ")}.`}
        </AlertDescription>
      </Alert>
    </div>
  )
}

function HeadlessNodeFallback({
  moduleId,
  entry,
}: {
  moduleId: string
  entry: HeadlessNodePackage
}) {
  return (
    <div className="p-4">
      <Alert>
        <AlertTriangle />
        <AlertTitle>Node &quot;{entry.def?.id ?? moduleId}&quot; has no UI component</AlertTitle>
        <AlertDescription>
          This package is available for runtime and CLI execution, but it does not export a React component for workspace rendering.
        </AlertDescription>
      </Alert>
    </div>
  )
}
