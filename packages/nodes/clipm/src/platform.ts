import { resolve } from "node:path"
import { loadNodeConfigWithHints } from "@xiranite/config"
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

function optionalResolvedPath(cwd: string, value: string | undefined): string | undefined {
  return value?.trim() ? resolve(cwd, value) : undefined
}

function devicePreference(value: string | undefined): "cuda" | "cpu" | undefined {
  return value === "cuda" || value === "cpu" ? value : undefined
}

function modelResidency(value: string | undefined): "immediate" | "idle-10m" | "worker" | undefined {
  return value === "immediate" || value === "idle-10m" || value === "worker" ? value : undefined
}
