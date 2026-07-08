import { useMemo } from "react"
import type {
  HostComponentRef,
  NodeCapabilityId,
  NodeHostApi,
  NodeSchema,
  NodeSchemas,
} from "@xiranite/contract"
import { NODE_HOST_CONTRACT_VERSION } from "@xiranite/contract"
import { localBackendFileUrl } from "@/backend/localBackendConfig"
import { getNodeConfigFromBackend, openConfigFileWithBackend, saveNodeConfigToBackend } from "@/backend/configRpcClient"
import { runNodeOnLocalBackend } from "@/backend/nodeRpcClient"
import { useTheme } from "@/components/theme-provider"
import { getWorkspaceState, useWorkspaceActions, useWorkspaceComponentData } from "@/store/workspaceContext"
import type { ComponentInstance, ComponentState, ViewMode } from "@/types/workspace"

const componentStates = new Set<ComponentState>(["docked", "floating", "focused", "fullscreen", "compact"])
const viewModes = new Set<ViewMode>(["cards", "dockview", "flow", "lane", "bento"])

const injectedCapabilities: readonly NodeCapabilityId[] = [
  "contract",
  "state",
  "workspace",
  "runner",
  "clipboard",
  "downloads",
  "localFiles",
  "config",
  "env",
]

export function useNodeHostApi(
  compId: string,
  nodeId?: string,
  schemas?: NodeSchemas,
): NodeHostApi {
  useWorkspaceComponentData(compId)
  const workspaceActions = useWorkspaceActions()
  const { theme } = useTheme()
  const hostTheme = theme === "dark"
    ? "dark"
    : theme === "light"
      ? "light"
      : document.documentElement.classList.contains("dark")
        ? "dark"
        : "light"

  return useMemo(() => {
    const readComponentData = () =>
      getWorkspaceState().components.find((component) => component.id === compId)?.data

    const stateCapability = {
      getData: () => {
        const raw = readComponentData()
        if (raw === undefined) return undefined
        return parseWithSchema(schemas?.data, raw, {} as Record<string, unknown>)
      },
      patchData: (patch: Record<string, unknown>) => {
        workspaceActions.patchComponentData(compId, patch)
        const next = { ...(readComponentData() ?? {}), ...patch }
        warnOnSchemaMismatch(schemas?.data, next, "patchData")
      },
    }

    const workspaceCapability = {
      listComponents: () => {
        const state = getWorkspaceState()
        return state.components
          .filter((component) => component.workspaceId === state.activeWorkspaceId)
          .map(toHostRef)
      },
      updateComponent: (id: string, patch: Partial<HostComponentRef>) => {
        const nextHiddenIn: Partial<Record<ViewMode, boolean>> = {}
        if (patch.hiddenIn) {
          for (const [mode, hidden] of Object.entries(patch.hiddenIn)) {
            if (viewModes.has(mode as ViewMode)) {
              nextHiddenIn[mode as ViewMode] = hidden
            }
          }
        }
        workspaceActions.updateComponent(id, {
          data: patch.data,
          tags: patch.tags,
          state: patch.state && componentStates.has(patch.state as ComponentState)
            ? patch.state as ComponentState
            : undefined,
          hiddenIn: Object.keys(nextHiddenIn).length ? nextHiddenIn : undefined,
        })
      },
    }

    const runnerCapability = {
      run: runNodeOnLocalBackend,
    }

    const clipboardCapability = {
      readText: () => navigator.clipboard.readText(),
      writeText: (text: string) => navigator.clipboard.writeText(text),
    }

    const downloadsCapability = {
      text: (filename: string, content: string) => {
        const blob = new Blob([content], { type: "text/plain;charset=utf-8" })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = filename
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        URL.revokeObjectURL(url)
      },
    }

    const localFilesCapability = {
      getUrl: (path: string) => localBackendFileUrl(path),
    }

    const configCapability = {
      get: async <T,>() => {
        if (!nodeId) throw new Error("Node ID is required for config.get")
        return getNodeConfigFromBackend<T>(nodeId)
      },
      save: async <T,>(config: T) => {
        if (!nodeId) throw new Error("Node ID is required for config.save")
        await saveNodeConfigToBackend<T>(nodeId, config)
      },
      openFile: async () => {
        await openConfigFileWithBackend()
      },
    }

    const envCapability = {
      theme: hostTheme,
      platform: "web" as const,
    }

    const contractCapability = {
      name: "xiranite.node-host" as const,
      version: NODE_HOST_CONTRACT_VERSION,
      supportedCapabilities: injectedCapabilities,
      hasCapability: (capability: NodeCapabilityId) => injectedCapabilities.includes(capability),
    }

    return {
      contract: contractCapability,
      state: stateCapability,
      workspace: workspaceCapability,
      runner: runnerCapability,
      clipboard: clipboardCapability,
      downloads: downloadsCapability,
      localFiles: localFilesCapability,
      config: configCapability,
      env: envCapability,

      // Deprecated compatibility aliases — map onto the capability domains so
      // unmigrated nodes keep working. Removed once every node uses host.state etc.
      getData: <T,>(_compId: string) => stateCapability.getData() as T | undefined,
      patchData: (_compId: string, patch: Record<string, unknown>) => stateCapability.patchData(patch),
      listComponents: () => workspaceCapability.listComponents(),
      updateComponent: (id: string, patch: Partial<HostComponentRef>) =>
        workspaceCapability.updateComponent(id, patch),
      actions: { run: runnerCapability.run },
      downloadText: (filename: string, content: string) => downloadsCapability.text(filename, content),
      getNodeConfig: async <T,>() => configCapability.get<T>(),
      saveNodeConfig: async <T,>(config: T) => configCapability.save<T>(config),
      openConfigFile: () => configCapability.openFile(),
    } satisfies NodeHostApi
  }, [hostTheme, workspaceActions, compId, nodeId, schemas])
}

function toHostRef(component: ComponentInstance): HostComponentRef {
  return {
    id: component.id,
    moduleId: component.moduleId,
    state: component.state,
    tags: component.tags,
    hiddenIn: component.hiddenIn,
    data: component.data,
  }
}

/**
 * Parse persisted component data with an optional schema. On parse failure,
 * returns a safe fallback instead of throwing so a single bad persisted value
 * cannot crash the workspace render. Diagnostics surface via console warning.
 */
function parseWithSchema<T>(
  schema: NodeSchema<T> | undefined,
  value: unknown,
  fallback: T,
): T {
  if (!schema) return (value ?? fallback) as T
  const safeResult = schema.safeParse?.(value)
  if (safeResult) return safeResult.success ? safeResult.data : fallback
  try {
    return schema.parse(value)
  } catch {
    return fallback
  }
}

function warnOnSchemaMismatch<T>(
  schema: NodeSchema<T> | undefined,
  value: unknown,
  label: string,
): void {
  if (!schema) return
  const safeResult = schema.safeParse?.(value)
  if (safeResult && !safeResult.success && import.meta.env.DEV) {
    console.warn(`[node-host] ${label} produced state that failed schema validation`, safeResult.error)
  }
}
