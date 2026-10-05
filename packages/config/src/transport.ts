import { resolve } from "node:path"

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

/**
 * The durability primitives a config document needs, and nothing else.
 *
 * ## Why a seam instead of two implementations
 *
 * `@xiranite/config`'s IO used to call `proper-lockfile` and `write-file-atomic` directly. That is one
 * runtime's answer to a question two runtimes ask: the Node/Bun face (a CLI process that owns its own files)
 * and the QuickJS realm inside the host (which must not — a realm that implements its own cross-process lock
 * has no witness anyone else can check, and `graceful-fs`, pulled in by the lock, fails at load there because
 * it assigns properties onto an `fs` object whose properties are not writable: measured on `linku`,
 * `docs/migration/quickjs-substrate-evaluation.md` §15.8).
 *
 * So the *transaction bodies* live here once — read, validate, merge, serialize, compare, commit — and only
 * the seven primitives below differ per runtime. A bundler picks the transport by module alias
 * (`HOST_SERVED_PACKAGES` maps `@xiranite/config/node` to the realm binding), which is why no branch on
 * "am I in a realm?" appears anywhere in this file: a runtime test would drag the Node transport into the
 * bundle anyway, and the 455 KB of lock machinery with it.
 *
 * ## What the transport may not do
 *
 * It answers text and existence, and it holds a lock. It never parses TOML, never validates a schema, never
 * merges a patch: those are config semantics and belong above this line, in one place.
 */
export interface ConfigTransport {
  /** The document at `path`, or `null` when nothing is there. */
  read(path: string): Promise<string | null>
  /** Whether anything exists at `path`. */
  exists(path: string): Promise<boolean>
  /** Replace `path` atomically, creating parent directories as needed. */
  writeAtomic(path: string, contents: string): Promise<void>
  /** Take the cross-process lock on `path` and read the document under it. */
  begin(path: string): Promise<{ token: string; contents: string | null }>
  /** Write `path` and release the lock, only while `token` still proves the holder. */
  commit(path: string, token: string, contents: string): Promise<void>
  /** Release the lock without writing. */
  abort(path: string, token: string): Promise<void>
  /** Whether `token` still holds the lock on `path`; false once somebody else has taken it. */
  held(path: string, token: string): Promise<boolean>
}

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

export interface NodeConfigResult<NodeConfig> {
  config: NodeConfig | undefined
  source: "cli" | "env" | "xiranite-config" | "default"
  configPath: string
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

/** The IO surface one runtime exposes, built from its transport. */
export interface ConfigIo {
  loadXiraniteConfig(options?: LoadConfigOptions): Promise<{ config: XiraniteConfig; path: string }>
  saveXiraniteConfig(config: XiraniteConfig, options?: XiraniteConfigWriteOptions): Promise<string>
  saveXiraniteConfigText(content: string, options?: XiraniteConfigWriteOptions): Promise<string>
  updateXiraniteConfig(
    updater: (config: XiraniteConfig) => XiraniteConfig | Promise<XiraniteConfig>,
    options?: UpdateXiraniteConfigOptions,
  ): Promise<UpdateXiraniteConfigResult>
  updateNodeConfigFile<NodeConfig>(
    nodeId: string,
    patch: NodeConfig,
    options?: UpdateXiraniteConfigOptions,
  ): Promise<UpdateNodeConfigFileResult<NodeConfig>>
  readAtomicJsonFile<T>(path: string, options: AtomicJsonFileOptions<T>): Promise<T>
  withXiraniteFileLock<Result>(
    path: string,
    operation: (assertLockHeld: () => Promise<void>) => Promise<Result>,
    lockRetries?: number,
  ): Promise<Result>
  updateAtomicJsonFile<T>(
    path: string,
    updater: (current: T) => T | Promise<T>,
    options: AtomicJsonFileOptions<T>,
  ): Promise<T>
  resolveNodeConfig<NodeConfig>(
    nodeId: string,
    options?: {
      cliConfigPath?: string
      env?: NodeJS.ProcessEnv
      cwd?: string
      databasePath?: string
      extract?: (value: unknown) => NodeConfig | undefined
    },
  ): Promise<NodeConfigResult<NodeConfig>>
  loadNodeConfigWithHints<T = unknown>(
    nodeId: string,
    options?: LoadNodeConfigHintOptions,
  ): Promise<LoadNodeConfigHintResult<T>>
  pathExists(path: string): Promise<boolean>
}

/**
 * Builds the config IO surface over a transport. Every function here is pure with respect to the runtime:
 * the only reach outside this file is through the injected primitives.
 */
export function createConfigIo(transport: ConfigTransport): ConfigIo {
  /** The lock-checked write every patch path shares: read, merge, validate, serialize, commit. */
  async function updateXiraniteConfig(
    updater: (config: XiraniteConfig) => XiraniteConfig | Promise<XiraniteConfig>,
    options: UpdateXiraniteConfigOptions = {},
  ): Promise<UpdateXiraniteConfigResult> {
    const path = resolveXiraniteConfigPath(options)
    const { token, contents } = await transport.begin(path)
    try {
      const beforeText = contents ?? undefined
      const loaded = beforeText === undefined ? {} : xiraniteConfigSchema.parse(parseToml(stripBom(beforeText)))
      const before = cloneValue(loaded)
      const updated = await updater(cloneValue(loaded))
      const config = xiraniteConfigSchema.parse(updated)
      const content = serializeValidatedConfig(config)
      const changed = beforeText !== content
      if (!changed) {
        return { before, beforeText, changed, config, path }
      }
      await assertHeld(path, token)
      await options.beforeWrite?.({ before, beforeText, config, content, path })
      await transport.commit(path, token, content)
      return { before, beforeText, changed, config, path }
    } catch (error) {
      await transport.abort(path, token)
      throw error
    }
  }

  /**
   * The guard `proper-lockfile`'s `onCompromised` gave the TypeScript: a lock taken from under this writer
   * must stop the write rather than produce a lost update. It is a transport call because the witness is on
   * disk (the lock file's own contents), not in this process's memory.
   */
  async function assertHeld(path: string, token: string): Promise<void> {
    if (!(await transport.held(path, token))) {
      throw new Error(`Xiranite config writer lock was compromised: ${path}`)
    }
  }

  async function loadXiraniteConfig(options: LoadConfigOptions = {}) {
    const path = resolveXiraniteConfigPath(options)
    const content = await transport.read(path)
    if (content === null) {
      if (options.allowMissing === false) throw new Error(`Xiranite config file not found: ${path}`)
      return { config: {} as XiraniteConfig, path }
    }
    return { config: xiraniteConfigSchema.parse(parseToml(stripBom(content))), path }
  }

  async function saveXiraniteConfig(config: XiraniteConfig, options: XiraniteConfigWriteOptions = {}) {
    const path = resolveXiraniteConfigPath(options)
    await transport.writeAtomic(path, serializeValidatedConfig(config))
    return path
  }

  async function saveXiraniteConfigText(content: string, options: XiraniteConfigWriteOptions = {}) {
    const path = resolveXiraniteConfigPath(options)
    xiraniteConfigSchema.parse(parseToml(stripBom(content)))
    await transport.writeAtomic(path, content)
    return path
  }

  async function updateNodeConfigFile<NodeConfig>(
    nodeId: string,
    patch: NodeConfig,
    options: UpdateXiraniteConfigOptions = {},
  ): Promise<UpdateNodeConfigFileResult<NodeConfig>> {
    const result = await updateXiraniteConfig((config) => updateNodeConfig(config, nodeId, patch), options)
    return { config: getNodeConfig<NodeConfig>(result.config, nodeId), path: result.path }
  }

  async function readAtomicJsonFile<T>(path: string, options: AtomicJsonFileOptions<T>): Promise<T> {
    return parseJsonDocument(await transport.read(path), options)
  }

  async function updateAtomicJsonFile<T>(
    path: string,
    updater: (current: T) => T | Promise<T>,
    options: AtomicJsonFileOptions<T>,
  ): Promise<T> {
    const { token, contents } = await transport.begin(path)
    try {
      // The document is the one read under the lock, not a second read after it: re-reading would reopen
      // the stale-snapshot window this transaction exists to close.
      const current = parseJsonDocument(contents, options)
      const next = await updater(cloneValue(current))
      const validated = options.parse ? options.parse(next) : next
      await transport.commit(path, token, `${JSON.stringify(validated, null, 2)}\n`)
      return validated
    } catch (error) {
      await transport.abort(path, token)
      throw error
    }
  }

  async function withXiraniteFileLock<Result>(
    path: string,
    operation: (assertLockHeld: () => Promise<void>) => Promise<Result>,
  ): Promise<Result> {
    const { token } = await transport.begin(path)
    let result: Result
    try {
      result = await operation(() => assertHeld(path, token))
    } catch (error) {
      await transport.abort(path, token)
      throw error
    }
    // The wrapper checks the lease itself, after the work resolved. Without this arm a caller that calls
    // `assertLockHeld()` but forgets to await it gets a promise nobody observes, and the guard becomes
    // decoration — `packages/repository/src/libsql.ts` did exactly that when the callback went async.
    // The early probe stays available for callers that want to stop mid-way; this one cannot be forgotten.
    if (!(await transport.held(path, token))) {
      throw new Error(`Xiranite config writer lock was compromised: ${path}`)
    }
    await transport.abort(path, token)
    return result
  }

  async function pathExists(path: string): Promise<boolean> {
    return await transport.exists(path)
  }

  async function resolveNodeConfig<NodeConfig>(
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
      const content = await transport.read(resolve(cliConfigPath))
      if (content !== null) {
        const parsed = parseToml(stripBom(content)) as Record<string, unknown>
        const nodes = parsed.nodes as Record<string, unknown> | undefined
        const topNodeValue = parsed[nodeId]
        const nodeValue = nodes?.[nodeId]
        const candidate = extract
          ? extract(topNodeValue) ?? extract(nodeValue) ?? extract(parsed)
          : ((topNodeValue ?? nodeValue ?? parsed) as NodeConfig)
        if (candidate !== undefined) {
          return { config: candidate, source: "cli", configPath: resolve(cliConfigPath) }
        }
      }
    }

    if (env.XIRANITE_CONFIG_PATH) {
      const { config } = await loadXiraniteConfig({ env, cwd: options.cwd, databasePath: options.databasePath })
      const nodeConfig = extract
        ? extract(config.nodes?.[nodeId])
        : (config.nodes?.[nodeId] as NodeConfig | undefined)
      if (nodeConfig !== undefined) {
        return { config: nodeConfig, source: "env", configPath: env.XIRANITE_CONFIG_PATH }
      }
    }

    const xiranitePath = resolveXiraniteConfigPath({ env, cwd: options.cwd, databasePath: options.databasePath })
    if (await pathExists(xiranitePath)) {
      const { config } = await loadXiraniteConfig({ env, cwd: options.cwd, databasePath: options.databasePath })
      const nodeConfig = extract
        ? extract(config.nodes?.[nodeId])
        : (config.nodes?.[nodeId] as NodeConfig | undefined)
      if (nodeConfig !== undefined) {
        return { config: nodeConfig, source: "xiranite-config", configPath: xiranitePath }
      }
    }

    return { config: undefined, source: "default", configPath: xiranitePath }
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
  async function loadNodeConfigWithHints<T = unknown>(
    nodeId: string,
    options: LoadNodeConfigHintOptions = {},
  ): Promise<LoadNodeConfigHintResult<T>> {
    const path = resolveXiraniteConfigPath(options)
    const content = await transport.read(path)
    if (content === null) {
      return { config: undefined, path, source: "default", fields: [] }
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

  return {
    loadXiraniteConfig,
    saveXiraniteConfig,
    saveXiraniteConfigText,
    updateXiraniteConfig,
    updateNodeConfigFile,
    readAtomicJsonFile,
    withXiraniteFileLock,
    updateAtomicJsonFile,
    resolveNodeConfig,
    loadNodeConfigWithHints,
    pathExists,
  }
}

/**
 * A structural copy of plain config data.
 *
 * `structuredClone` would be the obvious call, and it is not available in the QuickJS realm (rquickjs gives
 * the bundle `console`, `URL` and `performance`, not the HTML structured-clone algorithm), so the one place
 * that has to work in both runtimes clones its own plain objects. Config and JSON documents only ever carry
 * objects, arrays and primitives here, which is exactly what this covers.
 */
function cloneValue<T>(value: T): T {
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map((entry) => cloneValue(entry)) as unknown as T
  const copy: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    copy[key] = cloneValue(entry)
  }
  return copy as T
}

function serializeValidatedConfig(config: XiraniteConfig): string {
  const validated = xiraniteConfigSchema.parse(config)
  const content = stringifyXiraniteConfig(validated as Record<string, unknown>)
  xiraniteConfigSchema.parse(parseToml(stripBom(content)))
  return content
}

/**
 * One host-owned JSON document's text into a value, falling back when the file is missing, blank, or damaged
 * so a corrupt window-state file cannot keep a node application from opening.
 */
function parseJsonDocument<T>(content: string | null, options: AtomicJsonFileOptions<T>): T {
  if (!content?.trim()) return cloneValue(options.fallback)
  try {
    const value = JSON.parse(content) as unknown
    return options.parse ? options.parse(value) : (value as T)
  } catch {
    return cloneValue(options.fallback)
  }
}
