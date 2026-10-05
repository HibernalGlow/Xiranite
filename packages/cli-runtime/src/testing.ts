import type { CliHost } from "./index.js"
import { join } from "node:path"

export const explicitInteractionModes = ["ui", "gd", "guided"] as const

export interface MemoryCliHost extends CliHost {
  stdoutText: () => string
  stderrText: () => string
}

/// A config path that does not exist: the loader treats a missing `XIRANITE_CONFIG_PATH` as "no
/// overrides", which is the state a CLI test means to run in.
const HERMETIC_TEST_CONFIG_PATH = ["artifacts", "test-runs", "cli-runtime-missing-config.toml"].join("/")

export function createMemoryCliHost(options: {
  tty?: boolean
  cwd?: string
  env?: Record<string, string | undefined>
  configPath?: string
  columns?: number
} = {}): MemoryCliHost {
  let stdout = ""
  let stderr = ""
  const tty = options.tty ?? false
  const columns = options.columns ?? 120
  // Without this, a test that asserts a clean stderr passes or fails depending on whether the machine it
  // runs on has a `[nodes.<id>]` block in the user's own config — measured: `packages/nodes/trename`'s CLI
  // test is green on one host and red on another for exactly that reason, because the loader prints a
  // "loaded with overrides" hint. An explicit `configPath` (or `env`) from the caller still wins.
  const env = { ...process.env, ...options.env }
  if (env.XIRANITE_CONFIG_PATH === undefined) {
    env.XIRANITE_CONFIG_PATH = options.configPath ?? join(process.cwd(), HERMETIC_TEST_CONFIG_PATH)
  }
  return {
    cwd: options.cwd ?? process.cwd(),
    env,
    stdin: { isTTY: tty } as CliHost["stdin"],
    stdout: { isTTY: tty, columns, write(chunk) { stdout += chunk; return true } },
    stderr: { isTTY: tty, columns, write(chunk) { stderr += chunk; return true } },
    stdoutText: () => stdout,
    stderrText: () => stderr,
  }
}

export function containsAnsi(value: string): boolean {
  return /\u001b\[[0-9;?]*[ -/]*[@-~]/.test(value)
}
