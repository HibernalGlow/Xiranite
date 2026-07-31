import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

export type ClipmCallResult = Awaited<ReturnType<Client["callTool"]>>

export interface ClipmMcpConnection {
  readonly pid: number | null
  callTool(name: string, args?: Record<string, unknown>): Promise<ClipmCallResult>
  close(): Promise<void>
}

export interface ClipmMcpConnectionOptions {
  runtimeRoot: string
  pythonProjectRoot?: string
  uvCommand?: string
  device?: "cuda" | "cpu"
  modelResidency?: "immediate" | "idle-10m" | "worker"
  onStderr?(message: string): void
}

export async function createClipmMcpConnection(options: ClipmMcpConnectionOptions): Promise<ClipmMcpConnection> {
  const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
  const pythonProjectRoot = resolve(options.pythonProjectRoot ?? join(packageRoot, "python"))
  const runtimeRoot = resolve(options.runtimeRoot)
  const transport = new StdioClientTransport({
    command: options.uvCommand ?? process.env.CLIPM_UV_COMMAND ?? "uv",
    args: ["run", "--project", pythonProjectRoot, "python", "-m", "xiranite_clipm.server"],
    cwd: pythonProjectRoot,
    stderr: "pipe",
    env: {
      ...getDefaultEnvironment(),
      XIRANITE_CLIPM_RUNTIME_ROOT: runtimeRoot,
      XIRANITE_CLIPM_DEVICE: options.device ?? "cuda",
      XIRANITE_CLIPM_MODEL_RESIDENCY: options.modelResidency ?? "idle-10m",
      UV_CACHE_DIR: join(runtimeRoot, "uv-cache"),
      UV_PYTHON_INSTALL_DIR: join(runtimeRoot, "python-installations"),
      UV_PROJECT_ENVIRONMENT: join(runtimeRoot, "python"),
      HF_HOME: join(runtimeRoot, "huggingface-cache"),
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
    callTool: (name, args = {}) => client.callTool({ name, arguments: args }),
    close: () => client.close(),
  }
}
