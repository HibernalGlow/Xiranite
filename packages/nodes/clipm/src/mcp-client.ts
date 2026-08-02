import { access } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { resolveClipmUvCommand } from "./uv-bootstrap.js"

export type ClipmCallResult = Awaited<ReturnType<Client["callTool"]>>

export interface ClipmProgress {
  progress: number
  total?: number
  message?: string
  data?: unknown
}

/** Suffix used by the Python MCP tool to carry one completed work result in a
 * progress notification. MCP progress itself only has a text message field. */
export const CLIPM_PROGRESS_DATA_MARKER = "\u001eclipm-data:"

export function decodeClipmProgressMessage(message: string | undefined): { message?: string; data?: unknown } {
  if (!message) return {}
  const marker = message.lastIndexOf(CLIPM_PROGRESS_DATA_MARKER)
  if (marker < 0) return { message }
  try {
    return {
      message: message.slice(0, marker).trimEnd(),
      data: JSON.parse(message.slice(marker + CLIPM_PROGRESS_DATA_MARKER.length)),
    }
  } catch {
    return { message }
  }
}

export interface ClipmCallOptions {
  signal?: AbortSignal
  onProgress?(progress: ClipmProgress): void
  timeoutMs?: number
  maxTotalTimeoutMs?: number
}

export interface ClipmMcpConnection {
  readonly pid: number | null
  callTool(name: string, args?: Record<string, unknown>, options?: ClipmCallOptions): Promise<ClipmCallResult>
  close(): Promise<void>
}

export interface ClipmMcpConnectionOptions {
  runtimeRoot: string
  configPath?: string
  pythonProjectRoot?: string
  pythonEnvironmentRoot?: string
  uvCommand?: string
  device?: "cuda" | "cpu"
  modelResidency?: "immediate" | "idle-10m" | "worker"
  scoringWorkBatchSize?: number
  scoringPageBatchSize?: number
  scoringBatchPauseMs?: number
  syncEnvironment?: boolean
  onStderr?(message: string): void
}

export async function createClipmMcpConnection(options: ClipmMcpConnectionOptions): Promise<ClipmMcpConnection> {
  const pythonProjectRoot = await resolveClipmPythonProjectRoot(options.pythonProjectRoot)
  const runtimeRoot = resolve(options.runtimeRoot)
  const pythonEnvironmentRoot = resolve(options.pythonEnvironmentRoot ?? join(runtimeRoot, "python"))
  const uvCommand = await resolveClipmUvCommand({
    runtimeRoot,
    configuredCommand: options.uvCommand ?? process.env.CLIPM_UV_COMMAND,
  })
  const transport = new StdioClientTransport({
    command: uvCommand,
    args: ["run", ...(options.syncEnvironment === false ? ["--no-sync"] : []), "--project", pythonProjectRoot, "python", "-m", "xiranite_clipm.server"],
    cwd: pythonProjectRoot,
    stderr: "pipe",
    env: {
      ...getDefaultEnvironment(),
      XIRANITE_CLIPM_RUNTIME_ROOT: runtimeRoot,
      ...(options.configPath ? { XIRANITE_CONFIG_PATH: resolve(options.configPath) } : {}),
      XIRANITE_CLIPM_PYTHON_PROJECT_ROOT: pythonProjectRoot,
      XIRANITE_CLIPM_UV_COMMAND: uvCommand,
      XIRANITE_CLIPM_DEVICE: options.device ?? "cuda",
      XIRANITE_CLIPM_MODEL_RESIDENCY: options.modelResidency ?? "idle-10m",
      XIRANITE_CLIPM_SCORING_WORK_BATCH_SIZE: String(options.scoringWorkBatchSize ?? 8),
      XIRANITE_CLIPM_SCORING_PAGE_BATCH_SIZE: String(options.scoringPageBatchSize ?? 32),
      XIRANITE_CLIPM_SCORING_BATCH_PAUSE_MS: String(options.scoringBatchPauseMs ?? 0),
      UV_CACHE_DIR: join(runtimeRoot, "uv-cache"),
      UV_PYTHON_INSTALL_DIR: join(runtimeRoot, "python-installations"),
      UV_PROJECT_ENVIRONMENT: pythonEnvironmentRoot,
      HF_HOME: join(runtimeRoot, "huggingface-cache"),
      HF_HUB_OFFLINE: "1",
      TRANSFORMERS_OFFLINE: "1",
    },
  })
  transport.stderr?.on("data", (chunk: Buffer | string) => {
    const message = chunk.toString().trim()
    if (message) options.onStderr?.(message)
  })
  const client = new Client({ name: "xiranite-clipm-gateway", version: "0.1.0" }, { capabilities: {} })
  try {
    await client.connect(transport)
  } catch (error) {
    await transport.close().catch(() => undefined)
    throw error
  }
  return {
    get pid() { return transport.pid },
    callTool: (name, args = {}, callOptions) => client.callTool(
      { name, arguments: args },
      undefined,
      callOptions ? {
        signal: callOptions.signal,
        onprogress: (progress) => {
          const raw = progress as unknown as ClipmProgress
          const decoded = decodeClipmProgressMessage(raw.message)
          callOptions.onProgress?.({
            ...raw,
            ...decoded,
          })
        },
        timeout: callOptions.timeoutMs,
        resetTimeoutOnProgress: callOptions.onProgress !== undefined,
        maxTotalTimeout: callOptions.maxTotalTimeoutMs,
      } : undefined,
    ),
    close: () => client.close(),
  }
}

export async function resolveClipmPythonProjectRoot(
  configuredRoot?: string,
  moduleUrl = import.meta.url,
): Promise<string> {
  const moduleDirectory = dirname(fileURLToPath(moduleUrl))
  const candidates = configuredRoot?.trim()
    ? [resolve(configuredRoot)]
    : [
        resolve(moduleDirectory, "..", "python"),
        resolve(moduleDirectory, "backend-assets", "clipm-python"),
      ]
  for (const candidate of candidates) {
    try {
      await access(join(candidate, "pyproject.toml"))
      return candidate
    } catch {
      // Try the next supported package layout.
    }
  }
  throw new Error(`ClipM Python project is unavailable; checked: ${candidates.join(", ")}`)
}
