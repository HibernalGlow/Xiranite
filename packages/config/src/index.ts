import { readFile, writeFile, mkdir, access } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { homedir, platform } from "node:os"
import { parse as parseToml, stringify as stringifyToml } from "smol-toml"
import { z } from "zod"

export const XIRANITE_CONFIG_FILENAME = "xiranite.config.toml"

export interface ResolveConfigPathOptions {
  /** Explicit override path (e.g. from --config). */
  configPath?: string
  /** Environment variables to read from (defaults to process.env). */
  env?: NodeJS.ProcessEnv
  /** Current working directory for relative paths (defaults to process.cwd()). */
  cwd?: string
  /** Optional fallback database path; if set, look for config in its directory. */
  databasePath?: string
}

export function resolveXiraniteConfigPath(options: ResolveConfigPathOptions = {}): string {
  const env = options.env ?? process.env
  const cwd = options.cwd ?? process.cwd()

  if (options.configPath) return resolve(cwd, options.configPath)
  if (env.XIRANITE_CONFIG_PATH) return resolve(cwd, env.XIRANITE_CONFIG_PATH)
  if (env.XIRANITE_DATABASE_PATH) return join(dirname(resolve(cwd, env.XIRANITE_DATABASE_PATH)), XIRANITE_CONFIG_FILENAME)
  if (env.XIRANITE_DATA_DIR) return join(resolve(cwd, env.XIRANITE_DATA_DIR), XIRANITE_CONFIG_FILENAME)

  if (options.databasePath) return join(dirname(resolve(cwd, options.databasePath)), XIRANITE_CONFIG_FILENAME)

  const systemDir = defaultSystemConfigDir()
  return join(systemDir, "Xiranite", XIRANITE_CONFIG_FILENAME)
}

function defaultSystemConfigDir(): string {
  const env = process.env
  if (platform() === "win32") {
    if (env.APPDATA) return env.APPDATA
  }
  if (env.XDG_CONFIG_HOME) return env.XDG_CONFIG_HOME
  return join(homedir(), ".config")
}

export const xiraniteConfigSchema = z.object({
  workspace: z.object({ default: z.string().optional() }).optional(),
  paths: z.object({
    data_dir: z.string().optional(),
    database: z.string().optional(),
  }).optional(),
  nodes: z.record(z.string(), z.unknown()).optional(),
})

export type XiraniteConfig = z.infer<typeof xiraniteConfigSchema>

export interface LoadConfigOptions extends ResolveConfigPathOptions {
  /** Whether to throw on missing file (false) or return empty config (true, default). */
  allowMissing?: boolean
}

export async function loadXiraniteConfig(options: LoadConfigOptions = {}): Promise<{ config: XiraniteConfig; path: string }> {
  const path = resolveXiraniteConfigPath(options)
  let content: string
  try {
    content = await readFile(path, "utf8")
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR") {
      if (options.allowMissing === false) throw new Error(`Xiranite config file not found: ${path}`)
      return { config: {}, path }
    }
    throw error
  }
  const parsed = parseToml(stripBom(content))
  const config = xiraniteConfigSchema.parse(parsed)
  return { config, path }
}

export async function saveXiraniteConfig(config: XiraniteConfig, options: ResolveConfigPathOptions = {}): Promise<string> {
  const path = resolveXiraniteConfigPath(options)
  const content = stringifyToml(config as Record<string, unknown>)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, "utf8")
  return path
}

export function getNodeConfig<NodeConfig = unknown>(config: XiraniteConfig, nodeId: string): NodeConfig | undefined {
  return config.nodes?.[nodeId] as NodeConfig | undefined
}

export function updateNodeConfig<NodeConfig>(config: XiraniteConfig, nodeId: string, patch: NodeConfig): XiraniteConfig {
  const next: XiraniteConfig = { ...config }
  const nodes = { ...(next.nodes ?? {}) }
  nodes[nodeId] = patch
  next.nodes = nodes
  return next
}

export function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export interface NodeConfigResult<NodeConfig> {
  config: NodeConfig | undefined
  source: "cli" | "env" | "xiranite-config" | "default"
  configPath: string
}

export async function resolveNodeConfig<NodeConfig>(
  nodeId: string,
  options: {
    cliConfigPath?: string
    env?: NodeJS.ProcessEnv
    cwd?: string
    databasePath?: string
    extract?: (value: unknown) => NodeConfig | undefined
  } = {},
): Promise<NodeConfigResult<NodeConfig>> {
  const env = options.env ?? process.env
  const cliConfigPath = options.cliConfigPath
  const extract = options.extract

  if (cliConfigPath) {
    const content = await readFile(resolve(cliConfigPath), "utf8").catch(() => null)
    if (content !== null) {
      const parsed = parseToml(stripBom(content)) as Record<string, unknown>
      const nodes = parsed.nodes as Record<string, unknown> | undefined
      const topNodeValue = parsed[nodeId]
      const nodeValue = nodes?.[nodeId]
      const candidate = extract
        ? (extract(topNodeValue) ?? extract(nodeValue) ?? extract(parsed))
        : ((topNodeValue ?? nodeValue ?? parsed) as NodeConfig)
      if (candidate !== undefined) {
        return { config: candidate, source: "cli", configPath: resolve(cliConfigPath) }
      }
    }
  }

  if (env.XIRANITE_CONFIG_PATH) {
    const { config } = await loadXiraniteConfig({ env, cwd: options.cwd, databasePath: options.databasePath })
    const nodeConfig = extract ? extract(config.nodes?.[nodeId]) : (config.nodes?.[nodeId] as NodeConfig | undefined)
    if (nodeConfig !== undefined) {
      return { config: nodeConfig, source: "env", configPath: env.XIRANITE_CONFIG_PATH }
    }
  }

  const xiranitePath = resolveXiraniteConfigPath({ env, cwd: options.cwd, databasePath: options.databasePath })
  if (await pathExists(xiranitePath)) {
    const { config } = await loadXiraniteConfig({ env, cwd: options.cwd, databasePath: options.databasePath })
    const nodeConfig = extract ? extract(config.nodes?.[nodeId]) : (config.nodes?.[nodeId] as NodeConfig | undefined)
    if (nodeConfig !== undefined) {
      return { config: nodeConfig, source: "xiranite-config", configPath: xiranitePath }
    }
  }

  return { config: undefined, source: "default", configPath: xiranitePath }
}

export { parseToml, stringifyToml }
