import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

export const NODE_BUILD_CONFIG_FILENAME = "xiranite.build.toml"

interface NodeBuildConfigOptions {
  configPath?: string
  cwd?: string
  env?: NodeJS.ProcessEnv
}

export async function getDisabledNodeIds(options: NodeBuildConfigOptions = {}): Promise<readonly string[]> {
  const env = options.env ?? process.env
  if (env.XIRANITE_INCLUDE_DISABLED_NODES === "1") return []

  const configPath = options.configPath
    ? resolve(options.cwd ?? process.cwd(), options.configPath)
    : resolve(options.cwd ?? process.cwd(), NODE_BUILD_CONFIG_FILENAME)
  let content: string
  try {
    content = await readFile(configPath, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }

  const parsed = Bun.TOML.parse(content) as Record<string, unknown>
  const nodes = parsed.nodes
  if (nodes === undefined) return []
  if (!isRecord(nodes)) throw new Error(`${configPath}: [nodes] must be a TOML table.`)

  const disabled = nodes.disabled
  if (disabled === undefined) return []
  if (!Array.isArray(disabled) || disabled.some((id) => typeof id !== "string" || id.trim() === "")) {
    throw new Error(`${configPath}: nodes.disabled must be an array of non-empty node IDs.`)
  }

  return [...new Set(disabled.map((id) => (id as string).trim()))]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
