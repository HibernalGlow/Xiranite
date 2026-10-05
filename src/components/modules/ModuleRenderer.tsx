import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from "react"
import { createLogger } from "@/lib/logger"

const logger = createLogger("module.renderer")
import type { ComponentType } from "react"
import { useTranslation } from "react-i18next"
import type {
  AppNodeEntry,
  HeadlessNodePackage,
  NodeCapabilityId,
  NodeComponentProps,
  NodeContractCapability,
  NodeHostApi,
  NodeHostRequirements,
} from "@xiranite/contract"
import { checkContractVersion } from "@xiranite/contract"
import { AlertTriangle, RefreshCw } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useNodeHostApi } from "./hostApi"
import { NodeRenderBoundary } from "./NodeRenderBoundary"
import {
  resolveEntryLoader,
  frontendPluginForModule,
  getEntryBindingsVersion,
  subscribeEntryBindings,
  type PackageModuleEntry,
  type PackageModuleLoader,
} from "@/plugins/dynamicEntries"
import { projectHostForFrontendPlugin } from "@/plugins/frontendHost"
import { LocalFilesProvider } from "@/nodes/shared/useLocalFileDrop"
import { NodeRuntimeProvider } from "@/nodes/shared/NodeRuntimeContext"
import { startupDebug, startupDebugAsync } from "@/lib/startupDebug"
import { registerNodeTrays } from "@/desktop/tray/trayCoordinator"

const packageNodeEntryLoads = new Map<string, Promise<{ default: PackageModuleEntry }>>()

/**
 * Cache key includes the entry-binding version, so binding or unbinding a plugin re-resolves the
 * module instead of replaying the previously cached source. MF itself keeps the evaluated module
 * (§4's honest limit); this is about which entry the *host* hands the workspace, not about memory.
 */
function loadPackageNodeEntry(moduleId: string, loader: PackageModuleLoader): Promise<{ default: PackageModuleEntry }> {
  const cacheKey = `${moduleId}#${getEntryBindingsVersion()}`
  const existing = packageNodeEntryLoads.get(cacheKey)
  if (existing) return existing

  const pending = loader().catch((error: unknown) => {
    // Failed entries must remain retryable after Vite updates a stale module graph.
    packageNodeEntryLoads.delete(cacheKey)
    throw error
  })
  packageNodeEntryLoads.set(cacheKey, pending)
  return pending
}

const modules: Record<string, ReturnType<typeof lazy>> = {
  scratch:      lazy(() => import("./ScratchModule")),
  counter:      lazy(() => import("./CounterModule")),
  tasks:        lazy(() => import("./TasksModule")),
  clock:        lazy(() => import("./ClockModule")),
  calculator:   lazy(() => import("./CalculatorModule")),
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

  if (resolveEntryLoader(moduleId)) {
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
    <div className={nodeSurfaceClassName(moduleId)}>
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
  "use no memo"
  // Node components read their controlled state through the stable host API.
  // The host hook subscribes this boundary to workspace changes, so this
  // boundary must recreate the child element even when its props are stable.
  const [entry, setEntry] = useState<PackageModuleEntry | null | undefined>(undefined)
  const [loadRevision, setLoadRevision] = useState(0)
  // Re-resolve when a plugin is bound or unbound: this is what unmounts a remote's React tree on
  // disable (§4's second unload step) instead of leaving it on screen until something else renders.
  const bindingsVersion = useSyncExternalStore(subscribeEntryBindings, getEntryBindingsVersion)
  const host = useNodeHostApi(compId, moduleId, entry && isRenderableNodeEntry(entry) ? entry.schemas : undefined)

  useEffect(() => {
    let cancelled = false
    setEntry(undefined)
    const loader = resolveEntryLoader(moduleId)
    if (!loader) {
      setEntry(null)
      return
    }
    const loadStartedAt = performance.now()
    startupDebugAsync(`node-entry:${moduleId}`, () => loadPackageNodeEntry(moduleId, loader))
      .then((mod) => {
        if (!cancelled) {
          const durationMs = Math.round((performance.now() - loadStartedAt) * 10) / 10
          startupDebug(`node-entry:${moduleId}:commit`, { durationMs, compId })
          registerNodeTrays(moduleId, mod.default)
          setEntry(mod.default)
        }
      })
      .catch((error) => {
        logger.error("Failed to load module entry", { moduleId }, error)
        if (!cancelled) setEntry(null)
      })
    return () => {
      cancelled = true
    }
  }, [bindingsVersion, compId, loadRevision, moduleId])

  if (entry === undefined) {
    return <div className="p-4"><Skeleton className="h-32 w-full" /></div>
  }
  if (entry === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-xs text-muted-foreground">
        <span className="font-mono">Module &quot;{moduleId}&quot; failed to load</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setEntry(undefined)
            setLoadRevision((revision) => revision + 1)
          }}
        >
          <RefreshCw />
          Retry loading
        </Button>
      </div>
    )
  }

  if (!isRenderableNodeEntry(entry)) {
    return <HeadlessNodeFallback moduleId={moduleId} entry={entry} />
  }

  const nodeHost = projectHostForModule(host, moduleId)
  const diagnostic = diagnoseHostRequirements(entry.host, nodeHost.contract)
  if (diagnostic) {
    return <DiagnosticFallback moduleId={moduleId} diagnostic={diagnostic} />
  }

  const Component = entry.Component as ComponentType<NodeComponentProps>
  return (
    <div className={nodeSurfaceClassName(moduleId)} data-module-id={moduleId} data-component-id={compId}>
      <NodeRenderBoundary moduleId={moduleId}>
        <NodeRuntimeProvider nodeId={moduleId}>
          <LocalFilesProvider value={nodeHost.localFiles}>
            <Component compId={compId} host={nodeHost} />
          </LocalFilesProvider>
        </NodeRuntimeProvider>
      </NodeRenderBoundary>
    </div>
  )
}

/**
 * The host object a module is actually handed.
 *
 * Built-in nodes keep the full {@link NodeHostApi} (identity unchanged, so the memoisation behaviour
 * nodes rely on in §10.2 第 3 条 of `docs/plugin-architecture.md` does not move). A module id bound to
 * a runtime-registered remote is a *plugin*, so it gets the capability projection instead — and the
 * requirement check above therefore compares its declaration against what the projection provides,
 * which is what makes `contract.supportedCapabilities` a true statement.
 *
 * The cast is the seam's debt, not a hole: `NodeComponentProps.host` is typed as the full API because
 * that is what the built-in contract says, and the SDK type for third-party components
 * (`@xiranite/plugin-sdk`, §12) is what should carry `XiraniteFrontendHost` instead. Enforcement lives
 * here and in the diagnostics, not in the type.
 */
function projectHostForModule(host: NodeHostApi, moduleId: string): NodeHostApi {
  return projectHostForFrontendPlugin(host, frontendPluginForModule(moduleId)) as unknown as NodeHostApi
}

function nodeSurfaceClassName(moduleId: string): string {
  void moduleId
  return "h-full min-h-0 w-full overflow-hidden xiranite-node-surface"
}

function isRenderableNodeEntry(entry: PackageModuleEntry): entry is AppNodeEntry {
  return typeof (entry as Partial<AppNodeEntry>).Component === "function"
}

type HostDiagnostic =
  | { kind: "version"; range: string; version: string; detail: string; unsupported: boolean }
  | { kind: "capabilities"; missing: readonly NodeCapabilityId[] }

function diagnoseHostRequirements(
  requirements: NodeHostRequirements | undefined,
  contract: NodeContractCapability,
): HostDiagnostic | null {
  if (!requirements) return null

  if (requirements.contractVersion) {
    const verdict = checkContractVersion(requirements.contractVersion, contract.version)
    if (!verdict.compatible) {
      return {
        kind: "version",
        range: requirements.contractVersion,
        version: contract.version,
        detail: verdict.detail,
        // A range we do not implement must not read like "your host is too old" — that sends people
        // to upgrade the host for nothing.
        unsupported: verdict.reason === "unsupported-range",
      }
    }
  }

  const missing = (requirements.capabilities ?? []).filter((cap) => !contract.hasCapability(cap))
  if (missing.length > 0) {
    return { kind: "capabilities", missing }
  }

  return null
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
            ? diagnostic.unsupported
              ? `Contract range unsupported: node requires ${diagnostic.range}, host provides ${diagnostic.version} (${diagnostic.detail}).`
              : `Contract version mismatch: node requires ${diagnostic.range}, host provides ${diagnostic.version}.`
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
