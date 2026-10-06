import { mkdir, access, realpath, readFile, writeFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { lock } from "proper-lockfile"
import writeFileAtomic from "write-file-atomic"

import { resolveXiraniteConfigPath, type ResolveConfigPathOptions } from "./paths.js"
import {
  getNodeConfig,
  isPlainRecord,
  stripBom,
  updateNodeConfig,
  xiraniteConfigSchema,
  type XiraniteConfig,
} from "./schema.js"
import { parseToml, stringifyXiraniteConfig } from "./xiraniteToml.js"

export const XIRANITE_CONFIG_LOCK_SUFFIX = ".xr-write.lock"

export interface LoadConfigOptions extends ResolveConfigPathOptions {
  /** Whether to throw on missing file (false) or return empty config (true, default). */
  allowMissing?: boolean
}

export interface XiraniteConfigWriteOptions extends ResolveConfigPathOptions {
  lockRetries?: number
}

export interface UpdateXiraniteConfigOptions extends XiraniteConfigWriteOptions {
  beforeWrite?: (context: {
    before: XiraniteConfig
    beforeText: string | undefined
    config: XiraniteConfig
    content: string
    path: string
  }) => Promise<void>
}

export interface UpdateXiraniteConfigResult {
  before: XiraniteConfig
  beforeText: string | undefined
  changed: boolean
  config: XiraniteConfig
  path: string
}

export interface UpdateNodeConfigFileResult<NodeConfig = unknown> {
  config: NodeConfig | undefined
  path: string
}

export interface AtomicJsonFileOptions<T> {
  fallback: T
  /**
   * Optional validation/normalization for values read from disk and values
   * about to be persisted. Throw to reject an invalid state transition.
   */
  parse?: (value: unknown) => T
  lockRetries?: number
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

/**
 * Atomically replaces the complete config. Callers changing one section must
 * use updateXiraniteConfig or updateNodeConfigFile to avoid stale snapshots.
 */
export async function saveXiraniteConfig(config: XiraniteConfig, options: XiraniteConfigWriteOptions = {}): Promise<string> {
  const path = resolveXiraniteConfigPath(options)
  await mkdir(dirname(path), { recursive: true })
  const targetPath = await canonicalWritablePath(path)
  await withXiraniteConfigWriteLock(targetPath, options.lockRetries, async (assertLockHeld) => {
    assertLockHeld()
    await writeFileAtomic(targetPath, serializeValidatedConfig(config), { encoding: "utf8", fsync: true })
    assertLockHeld()
  })
  return path
}

export async function saveXiraniteConfigText(
  content: string,
  options: XiraniteConfigWriteOptions = {},
): Promise<string> {
  const path = resolveXiraniteConfigPath(options)
  xiraniteConfigSchema.parse(parseToml(stripBom(content)))
  await mkdir(dirname(path), { recursive: true })
  const targetPath = await canonicalWritablePath(path)
  await withXiraniteConfigWriteLock(targetPath, options.lockRetries, async (assertLockHeld) => {
    assertLockHeld()
    await writeFileAtomic(targetPath, content, { encoding: "utf8", fsync: true })
    assertLockHeld()
  })
  return path
}

/**
 * Runs a complete read-modify-write transaction under the shared cross-process
 * config lock. Patch callers must use this instead of saving a stale snapshot.
 */
export async function updateXiraniteConfig(
  updater: (config: XiraniteConfig) => XiraniteConfig | Promise<XiraniteConfig>,
  options: UpdateXiraniteConfigOptions = {},
): Promise<UpdateXiraniteConfigResult> {
  const path = resolveXiraniteConfigPath(options)
  await mkdir(dirname(path), { recursive: true })
  const targetPath = await canonicalWritablePath(path)
  return withXiraniteConfigWriteLock(targetPath, options.lockRetries, async (assertLockHeld) => {
    const beforeText = await readOptionalConfigText(targetPath)
    const loaded = beforeText === undefined
      ? {}
      : xiraniteConfigSchema.parse(parseToml(stripBom(beforeText)))
    const before = structuredClone(loaded)
    const updated = await updater(structuredClone(loaded))
    const config = xiraniteConfigSchema.parse(updated)
    const content = serializeValidatedConfig(config)
    const changed = beforeText !== content
    if (!changed) return { before, beforeText, changed, config, path }
    assertLockHeld()
    await options.beforeWrite?.({ before, beforeText, config, content, path })
    assertLockHeld()
    await writeFileAtomic(targetPath, content, { encoding: "utf8", fsync: true })
    assertLockHeld()
    return { before, beforeText, changed, config, path }
  })
}

/** Atomically merges one node patch into the latest on-disk config. */
export async function updateNodeConfigFile<NodeConfig>(
  nodeId: string,
  patch: NodeConfig,
  options: UpdateXiraniteConfigOptions = {},
): Promise<UpdateNodeConfigFileResult<NodeConfig>> {
  const result = await updateXiraniteConfig(
    (config) => updateNodeConfig(config, nodeId, patch),
    options,
  )
  return {
    config: getNodeConfig<NodeConfig>(result.config, nodeId),
    path: result.path,
  }
}

/**
 * Reads a small host-owned JSON document. Missing or malformed contents fall
 * back to the caller-provided value so a damaged window-state file cannot
 * prevent a node application from opening.
 */
export async function readAtomicJsonFile<T>(path: string, options: AtomicJsonFileOptions<T>): Promise<T> {
  const content = await readFile(path, "utf8").catch(() => undefined)
  if (!content?.trim()) return structuredClone(options.fallback)
  try {
    const value = JSON.parse(content) as unknown
    return options.parse ? options.parse(value) : value as T
  } catch {
    return structuredClone(options.fallback)
  }
}

/**
 * Serializes a short cross-process operation for an Xiranite-owned local file.
 * Database adapters use this only around schema work; normal reads and writes
 * remain governed by the database engine itself.
 */
export async function withXiraniteFileLock<Result>(
  path: string,
  operation: (assertLockHeld: () => void) => Promise<Result>,
  lockRetries?: number,
): Promise<Result> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, "", { encoding: "utf8", flag: "a" })
  return await withXiraniteConfigWriteLock(path, lockRetries, operation)
}

/**
 * Performs a complete JSON read-modify-write under a cross-process lock and
 * replaces the file atomically. It is deliberately generic so host-owned
 * runtime state can use the same durability semantics as project config.
 */
export async function updateAtomicJsonFile<T>(
  path: string,
  updater: (current: T) => T | Promise<T>,
  options: AtomicJsonFileOptions<T>,
): Promise<T> {
  await mkdir(dirname(path), { recursive: true })
  // proper-lockfile locks an existing path. Creating an empty seed file is
  // harmless because the actual update below is atomic and protected by lock.
  await writeFile(path, "", { encoding: "utf8", flag: "a" })
  return withXiraniteConfigWriteLock(path, options.lockRetries, async (assertLockHeld) => {
    const current = await readAtomicJsonFile(path, options)
    const next = await updater(structuredClone(current))
    const validated = options.parse ? options.parse(next) : next
    assertLockHeld()
    await writeFileAtomic(path, `${JSON.stringify(validated, null, 2)}\n`, { encoding: "utf8", fsync: true })
    assertLockHeld()
    return validated
  })
}

function serializeValidatedConfig(config: XiraniteConfig): string {
  const validated = xiraniteConfigSchema.parse(config)
  const content = stringifyXiraniteConfig(validated as Record<string, unknown>)
  xiraniteConfigSchema.parse(parseToml(stripBom(content)))
  return content
}

async function readOptionalConfigText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR") return undefined
    throw error
  }
}

async function canonicalWritablePath(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error
  }

  try {
    return join(await realpath(dirname(path)), basename(path))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error
    return path
  }
}

async function withXiraniteConfigWriteLock<Result>(
  path: string,
  lockRetries: number | undefined,
  operation: (assertLockHeld: () => void) => Promise<Result>,
): Promise<Result> {
  const retries = lockRetries ?? 50
  if (!Number.isSafeInteger(retries) || retries < 0 || retries > 100) {
    throw new RangeError("Xiranite config lockRetries must be an integer between 0 and 100.")
  }
  let compromised: Error | undefined
  let release: (() => Promise<void>) | undefined
  try {
    release = await lock(path, {
      lockfilePath: `${path}${XIRANITE_CONFIG_LOCK_SUFFIX}`,
      realpath: false,
      stale: 30_000,
      update: 10_000,
      retries: {
        retries,
        factor: 1.2,
        minTimeout: 20,
        maxTimeout: 250,
        randomize: true,
      },
      onCompromised: (error) => { compromised = error },
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOCKED") {
      throw new Error(`Timed out waiting for the Xiranite config writer: ${path}`, { cause: error })
    }
    throw error
  }

  const assertLockHeld = () => {
    if (compromised) {
      throw new Error(`Xiranite config writer lock was compromised: ${path}`, { cause: compromised })
    }
  }
  try {
    assertLockHeld()
    return await operation(assertLockHeld)
  } finally {
    await release().catch((error) => {
      if (!compromised) throw error
    })
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

export interface NodeConfigHintSink {
  stderr?: { write: (chunk: string) => unknown }
  stdout?: { write: (chunk: string) => unknown }
}

export interface LoadNodeConfigHintOptions extends ResolveConfigPathOptions {
  /** Optional sink for emitting hints. When omitted, no hints are written. */
  hintSink?: NodeConfigHintSink
  /** Disable hint output even when sink is provided. */
  silent?: boolean
  /** When true, suppress hints (e.g. in --json output mode). */
  jsonMode?: boolean
}

export interface LoadNodeConfigHintResult<T> {
  config: T | undefined
  path: string
  source: "xiranite-config" | "default"
  /** Field keys present in the loaded node section (empty when no section found). */
  fields: string[]
}

/**
 * 从 xiranite.config.toml 读取 [nodes.<nodeId>] 段，并通过 hintSink 输出提示。
 *
 * 提示策略（输出到 stderr，避免污染 stdout/JSON）：
 * - 配置文件不存在：不输出
 * - 文件存在但无 [nodes.<nodeId>] 段：不输出
 * - 文件存在且有该段：输出 `ℹ 配置: 从 <path> 加载 [nodes.<nodeId>] — 覆盖字段: a, b, c`
 *
 * `silent` 或 `jsonMode` 为 true 时不输出。
 */
export async function loadNodeConfigWithHints<T = unknown>(
  nodeId: string,
  options: LoadNodeConfigHintOptions = {},
): Promise<LoadNodeConfigHintResult<T>> {
  const path = resolveXiraniteConfigPath(options)

  let content: string
  try {
    content = await readFile(path, "utf8")
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR") {
      return { config: undefined, path, source: "default", fields: [] }
    }
    throw error
  }

  const parsed = parseToml(stripBom(content)) as Record<string, unknown>
  const nodes = parsed.nodes as Record<string, unknown> | undefined
  const nodeConfig = nodes?.[nodeId] as T | undefined

  if (nodeConfig === undefined) {
    return { config: undefined, path, source: "xiranite-config", fields: [] }
  }

  const fields = isPlainRecord(nodeConfig) ? Object.keys(nodeConfig) : []

  if (!options.silent && !options.jsonMode && options.hintSink?.stderr) {
    const fieldList = fields.length > 0 ? ` — 覆盖字段: ${fields.join(", ")}` : ""
    const hint = `ℹ 配置: 从 ${path} 加载 [nodes.${nodeId}]${fieldList}\n`
    options.hintSink.stderr.write(hint)
  }

  return { config: nodeConfig, path, source: "xiranite-config", fields }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
