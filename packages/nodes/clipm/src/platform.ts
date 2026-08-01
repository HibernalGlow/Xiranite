import { join, resolve } from "node:path"
import { loadNodeConfigWithHints, updateNodeConfigFile } from "@xiranite/config"
import type { ClipmGateway } from "./core.js"
import type { EnvironmentStatus } from "./generated/contracts.js"
import { ClipmWorkerManager, type ClipmWorkerManagerOptions } from "./worker-manager.js"

export interface ClipmNodeConfig {
  runtime_root?: string
  python_project_root?: string
  python_environment_root?: string
  uv_command?: string
  device?: "cuda" | "cpu"
  model_residency?: "immediate" | "idle-10m" | "worker"
}

export interface ClipmPlatformOptions {
  cwd?: string
  env?: Record<string, string | undefined>
  jsonMode?: boolean
  stderr?: { write(chunk: string): unknown }
  onStderr?(message: string): void
}

export interface ClipmPlatformDependencies {
  loadWorkerOptions(options: ClipmPlatformOptions): Promise<ClipmWorkerManagerOptions>
  createManager(options: ClipmWorkerManagerOptions): ClipmWorkerManager
  updateConfig(patch: ClipmNodeConfig, options: ClipmPlatformOptions): Promise<void>
}

export async function loadClipmWorkerOptions(options: ClipmPlatformOptions = {}): Promise<ClipmWorkerManagerOptions> {
  const cwd = options.cwd ?? process.cwd()
  const env = options.env ?? process.env
  const loaded = await loadNodeConfigWithHints<ClipmNodeConfig>("clipm", {
    cwd,
    env,
    jsonMode: options.jsonMode,
    hintSink: options.stderr ? { stderr: options.stderr } : undefined,
  })
  const config = loaded.config
  return {
    runtimeRoot: resolve(cwd, config?.runtime_root ?? env.XIRANITE_CLIPM_RUNTIME_ROOT ?? "artifacts/clipm-runtime"),
    pythonProjectRoot: optionalResolvedPath(cwd, config?.python_project_root ?? env.XIRANITE_CLIPM_PYTHON_PROJECT_ROOT),
    pythonEnvironmentRoot: optionalResolvedPath(cwd, config?.python_environment_root ?? env.XIRANITE_CLIPM_PYTHON_ENVIRONMENT_ROOT),
    uvCommand: config?.uv_command ?? env.CLIPM_UV_COMMAND,
    device: config?.device ?? devicePreference(env.XIRANITE_CLIPM_DEVICE),
    modelResidency: config?.model_residency ?? modelResidency(env.XIRANITE_CLIPM_MODEL_RESIDENCY),
    onStderr: options.onStderr,
  }
}

export async function createNodeClipmWorkerManager(options: ClipmPlatformOptions = {}): Promise<ClipmWorkerManager> {
  return new ClipmWorkerManager(await loadClipmWorkerOptions(options))
}

export function createNodeClipmRuntime(
  options: ClipmPlatformOptions = {},
  dependencies: ClipmPlatformDependencies = defaultPlatformDependencies,
): ClipmGateway & { dispose(): Promise<void> } {
  let manager: Promise<ClipmWorkerManager> | undefined
  const getManager = () => manager ??= dependencies.loadWorkerOptions(options).then(dependencies.createManager)
  return {
    scoreLibrary: (...args) => getManager().then((gateway) => gateway.scoreLibrary(...args)),
    scoreWork: (...args) => getManager().then((gateway) => gateway.scoreWork(...args)),
    scanFeedback: (...args) => getManager().then((gateway) => gateway.scanFeedback(...args)),
    applyFeedback: (...args) => getManager().then((gateway) => gateway.applyFeedback(...args)),
    listReviewItems: (...args) => getManager().then((gateway) => gateway.listReviewItems(...args)),
    resolveReviewItem: (...args) => getManager().then((gateway) => gateway.resolveReviewItem(...args)),
    trainHeads: (...args) => getManager().then((gateway) => gateway.trainHeads(...args)),
    listModels: (...args) => getManager().then((gateway) => gateway.listModels(...args)),
    activateModel: (...args) => getManager().then((gateway) => gateway.activateModel(...args)),
    rollbackModel: (...args) => getManager().then((gateway) => gateway.rollbackModel(...args)),
    environmentStatus: (...args) => getManager().then((gateway) => gateway.environmentStatus(...args)),
    async migrateEnvironment(command, callOptions) {
      const sourceManager = await getManager()
      const prepared = await sourceManager.migrateEnvironment(command, callOptions)
      const sourceOptions = await dependencies.loadWorkerOptions(options)
      const targetManager = dependencies.createManager({
        ...sourceOptions,
        runtimeRoot: prepared.targetRuntimeRoot,
        pythonEnvironmentRoot: join(prepared.targetRuntimeRoot, "python"),
      })
      let sourceDisposed = false
      try {
        const targetStatus = await targetManager.health(callOptions)
        validateMigratedEnvironment(prepared.sourceStatus, targetStatus)
        await sourceManager.dispose()
        sourceDisposed = true
        await dependencies.updateConfig({ runtime_root: prepared.targetRuntimeRoot }, options)
        manager = Promise.resolve(targetManager)
        return { ...prepared, targetStatus, warnings: targetStatus.warnings ?? [] }
      } catch (error) {
        if (sourceDisposed) manager = undefined
        await targetManager.dispose().catch(() => undefined)
        throw error
      }
    },
    async dispose() {
      const active = await manager
      manager = undefined
      await active?.dispose()
    },
  }
}

const defaultPlatformDependencies: ClipmPlatformDependencies = {
  loadWorkerOptions: loadClipmWorkerOptions,
  createManager: (managerOptions) => new ClipmWorkerManager(managerOptions),
  async updateConfig(patch, platformOptions) {
    await updateNodeConfigFile<ClipmNodeConfig>("clipm", patch, {
      cwd: platformOptions.cwd,
      env: platformOptions.env,
    })
  },
}

function validateMigratedEnvironment(source: EnvironmentStatus, target: EnvironmentStatus): void {
  if (!target.healthy || !target.databaseOk) {
    throw new Error("The migrated ClipM MCP worker failed its database health check.")
  }
  if (source.modelAvailable && !target.modelAvailable) {
    throw new Error("The migrated ClipM MCP worker could not load the active model bundle.")
  }
  if (target.device === "cuda" && !target.cudaAvailable) {
    throw new Error("CUDA is unavailable in the migrated runtime; configure explicit CPU mode before retrying.")
  }
}

function optionalResolvedPath(cwd: string, value: string | undefined): string | undefined {
  return value?.trim() ? resolve(cwd, value) : undefined
}

function devicePreference(value: string | undefined): "cuda" | "cpu" | undefined {
  return value === "cuda" || value === "cpu" ? value : undefined
}

function modelResidency(value: string | undefined): "immediate" | "idle-10m" | "worker" | undefined {
  return value === "immediate" || value === "idle-10m" || value === "worker" ? value : undefined
}
