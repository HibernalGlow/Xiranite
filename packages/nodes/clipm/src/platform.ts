import { join, resolve } from "node:path"
import { loadNodeConfigWithHints, updateNodeConfigFile } from "@xiranite/config"
import { ClipmAutoTrainingScheduler } from "./auto-training-scheduler.js"
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
  auto_train?: boolean
  auto_train_batch_size?: number
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
    autoTrain: config?.auto_train ?? booleanSetting(env.XIRANITE_CLIPM_AUTO_TRAIN, true),
    autoTrainBatchSize: batchSize(config?.auto_train_batch_size ?? env.XIRANITE_CLIPM_AUTO_TRAIN_BATCH_SIZE),
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
  let workerOptions: Promise<ClipmWorkerManagerOptions> | undefined
  const getWorkerOptions = () => workerOptions ??= dependencies.loadWorkerOptions(options)
  const getManager = () => manager ??= getWorkerOptions().then(dependencies.createManager)
  const getScheduler = () => getWorkerOptions().then((loaded) => autoTrainingSchedulerFor(loaded, dependencies))
  const runActivity = async <T>(operation: () => Promise<T>): Promise<T> => (
    await getScheduler()
  ).runActivity(operation)
  return {
    scoreLibrary: (...args) => runActivity(() => getManager().then((gateway) => gateway.scoreLibrary(...args))),
    scoreWork: (...args) => runActivity(() => getManager().then((gateway) => gateway.scoreWork(...args))),
    getWorkScore: (...args) => runActivity(() => getManager().then((gateway) => gateway.getWorkScore(...args))),
    scanFeedback: (...args) => runActivity(() => getManager().then((gateway) => gateway.scanFeedback(...args))),
    applyFeedback: (...args) => runActivity(() => getManager().then((gateway) => gateway.applyFeedback(...args))),
    listFeedbackEvents: (...args) => runActivity(() => getManager().then((gateway) => gateway.listFeedbackEvents(...args))),
    undoFeedback: (...args) => runActivity(() => getManager().then((gateway) => gateway.undoFeedback(...args))),
    listReviewItems: (...args) => runActivity(() => getManager().then((gateway) => gateway.listReviewItems(...args))),
    resolveReviewItem: (...args) => runActivity(() => getManager().then((gateway) => gateway.resolveReviewItem(...args))),
    trainHeads: (...args) => runActivity(() => getManager().then((gateway) => gateway.trainHeads(...args))),
    runAutoTraining: (...args) => runActivity(() => getManager().then((gateway) => gateway.runAutoTraining(...args))),
    listModels: (...args) => runActivity(() => getManager().then((gateway) => gateway.listModels(...args))),
    activateModel: (...args) => runActivity(() => getManager().then((gateway) => gateway.activateModel(...args))),
    rollbackModel: (...args) => runActivity(() => getManager().then((gateway) => gateway.rollbackModel(...args))),
    environmentStatus: (...args) => runActivity(() => getManager().then((gateway) => gateway.environmentStatus(...args))),
    removeWorkMetadata: (...args) => runActivity(() => getManager().then((gateway) => gateway.removeWorkMetadata(...args))),
    async configureEnvironment(command, callOptions) {
      const sourceScheduler = await getScheduler()
      return sourceScheduler.runActivity(async () => {
        const sourceOptions = await getWorkerOptions()
        const targetOptions = {
          ...sourceOptions,
          runtimeRoot: resolve(command.runtimeRoot),
          pythonEnvironmentRoot: join(resolve(command.runtimeRoot), "python"),
          device: command.device,
        }
        const targetManager = dependencies.createManager(targetOptions)
        try {
          const targetStatus = await targetManager.health(callOptions)
          validateConfiguredEnvironment(targetStatus, targetOptions.runtimeRoot, command.device)
          await dependencies.updateConfig({
            runtime_root: targetStatus.runtimeRoot,
            device: command.device,
          }, options)
          sourceScheduler.disable()
          const previousManager = await manager
          manager = Promise.resolve(targetManager)
          workerOptions = Promise.resolve(targetOptions)
          await previousManager?.dispose().catch((error) => {
            sourceOptions.onStderr?.(`Unable to dispose the previous ClipM manager: ${errorMessage(error)}`)
          })
          await autoTrainingSchedulerFor(targetOptions, dependencies).runActivity(async () => undefined)
          return targetStatus
        } catch (error) {
          await targetManager.dispose().catch(() => undefined)
          throw error
        }
      })
    },
    async migrateEnvironment(command, callOptions) {
      const sourceScheduler = await getScheduler()
      return sourceScheduler.runActivity(async () => {
        const sourceManager = await getManager()
        const prepared = await sourceManager.migrateEnvironment(command, callOptions)
        const sourceOptions = await getWorkerOptions()
        const targetOptions = {
          ...sourceOptions,
          runtimeRoot: prepared.targetRuntimeRoot,
          pythonEnvironmentRoot: join(prepared.targetRuntimeRoot, "python"),
        }
        const targetManager = dependencies.createManager(targetOptions)
        let sourceDisposed = false
        try {
          const targetStatus = await targetManager.health(callOptions)
          validateMigratedEnvironment(prepared.sourceStatus, targetStatus)
          await sourceManager.dispose()
          sourceDisposed = true
          await dependencies.updateConfig({ runtime_root: prepared.targetRuntimeRoot }, options)
          sourceScheduler.disable()
          manager = Promise.resolve(targetManager)
          workerOptions = Promise.resolve(targetOptions)
          await autoTrainingSchedulerFor(targetOptions, dependencies).runActivity(async () => undefined)
          return { ...prepared, targetStatus, warnings: targetStatus.warnings ?? [] }
        } catch (error) {
          if (sourceDisposed) manager = undefined
          await targetManager.dispose().catch(() => undefined)
          throw error
        }
      })
    },
    async dispose() {
      const active = await manager
      manager = undefined
      await active?.dispose()
    },
  }
}

const schedulerRegistries = new WeakMap<
  ClipmPlatformDependencies["createManager"],
  Map<string, ClipmAutoTrainingScheduler>
>()

function autoTrainingSchedulerFor(
  options: ClipmWorkerManagerOptions,
  dependencies: ClipmPlatformDependencies,
): ClipmAutoTrainingScheduler {
  let registry = schedulerRegistries.get(dependencies.createManager)
  if (!registry) {
    registry = new Map()
    schedulerRegistries.set(dependencies.createManager, registry)
  }
  const runAttempt = async (batchSizeValue: number) => {
    const manager = dependencies.createManager(options)
    try {
      await manager.runAutoTraining(batchSizeValue)
    } finally {
      await manager.dispose()
    }
  }
  const schedulerOptions = {
    enabled: options.autoTrain ?? true,
    batchSize: options.autoTrainBatchSize ?? 20,
    runAttempt,
    onError: (error: unknown) => options.onStderr?.(`Automatic ClipM training failed: ${errorMessage(error)}`),
  }
  const key = resolve(options.runtimeRoot).toLocaleLowerCase()
  const existing = registry.get(key)
  if (existing) {
    existing.update(schedulerOptions)
    return existing
  }
  const created = new ClipmAutoTrainingScheduler(schedulerOptions)
  registry.set(key, created)
  return created
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

function validateConfiguredEnvironment(
  status: EnvironmentStatus,
  runtimeRoot: string,
  device: "cuda" | "cpu",
): void {
  if (!status.healthy || !status.databaseOk) {
    throw new Error("The selected ClipM MCP worker failed its database health check.")
  }
  if (resolve(status.runtimeRoot) !== resolve(runtimeRoot)) {
    throw new Error("The selected ClipM MCP worker reported a different runtime root.")
  }
  if (status.device !== device) {
    throw new Error(`The selected ClipM MCP worker started in ${status.device} mode instead of ${device}.`)
  }
  if (device === "cuda" && !status.cudaAvailable) {
    throw new Error("CUDA is unavailable in the selected runtime; choose explicit CPU mode before retrying.")
  }
  if (status.activeBundleVersion !== null && status.activeBundleVersion !== undefined && !status.modelAvailable) {
    throw new Error("The selected ClipM runtime has an active model pointer that failed validation.")
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

function booleanSetting(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  return value.trim().toLowerCase() === "true"
}

function batchSize(value: number | string | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 1000 ? parsed : 20
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
