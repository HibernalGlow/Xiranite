import { readFile } from "node:fs/promises"
import {
  parseToml,
  resolveXiraniteConfigPath,
  saveXiraniteConfigText,
  stripBom,
  updateXiraniteConfig,
  type ResolveConfigPathOptions,
} from "@xiranite/config"
import { unwrapNeoviewConfigEnvelope } from "../../application/config/NeoviewConfigEnvelope.js"

export type NeoviewConfigImportStrategy = "merge" | "overwrite"

export interface CommitNeoviewConfigOptions extends ResolveConfigPathOptions {
  strategy: NeoviewConfigImportStrategy
  lockRetries?: number
}

export interface CommitNeoviewConfigResult {
  configPath: string
  backupPath?: string
  nodeConfig: Record<string, unknown>
  changed: boolean
}

export async function readNeoviewConfig(
  options: ResolveConfigPathOptions = {},
): Promise<Record<string, unknown>> {
  const configPath = resolveXiraniteConfigPath(options)
  const text = await readOptional(configPath)
  if (text === undefined) return {}
  const root = requireRecord(parseToml(stripBom(text)), "Xiranite config root")
  const nodes = isRecord(root.nodes) ? root.nodes : {}
  return isRecord(nodes.neoview) ? unwrapNeoviewConfigEnvelope(nodes.neoview) : {}
}

export async function commitNeoviewConfig(
  patch: Record<string, unknown>,
  options: CommitNeoviewConfigOptions,
): Promise<CommitNeoviewConfigResult> {
  const configPath = resolveXiraniteConfigPath(options)
  let backupPath: string | undefined
  let nextNode: Record<string, unknown> = {}
  const transaction = await updateXiraniteConfig((root) => {
    const nodes = isRecord(root.nodes) ? { ...root.nodes } : {}
    const rawCurrent = isRecord(nodes.neoview) ? nodes.neoview : {}
    const current = unwrapNeoviewConfigEnvelope(rawCurrent)
    nextNode = canonicalizeTomlRecord(
      options.strategy === "overwrite" ? cloneRecord(patch) : deepMerge(current, patch),
    )
    return { ...root, nodes: { ...nodes, neoview: nextNode } }
  }, {
    ...options,
    configPath,
    lockRetries: options.lockRetries,
    beforeWrite: async ({ beforeText }) => {
      if (beforeText === undefined) return
      backupPath = `${configPath}.neoview-import.bak`
      await saveXiraniteConfigText(beforeText, { configPath: backupPath })
    },
  })
  const writtenNodes = requireRecord(transaction.config.nodes, "written [nodes] section")
  const writtenEnvelope = requireRecord(writtenNodes.neoview, "written [nodes.neoview] section")
  const verifiedNode = unwrapNeoviewConfigEnvelope(writtenEnvelope)
  if (!deepEqual(verifiedNode, nextNode)) {
    throw new Error("NeoView TOML verification failed before atomic write.")
  }
  return {
    configPath,
    backupPath,
    nodeConfig: verifiedNode,
    changed: transaction.changed,
  }
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR") return undefined
    throw error
  }
}

function deepMerge(current: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const result = cloneRecord(current)
  for (const [key, value] of Object.entries(patch)) {
    const previous = result[key]
    result[key] = isRecord(previous) && isRecord(value)
      ? deepMerge(previous, value)
      : cloneValue(value)
  }
  return result
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneValue(child)]))
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneValue)
  if (isRecord(value)) return cloneRecord(value)
  return value
}

/**
 * TOML has no null or undefined value. Treat nullish record fields as an
 * explicit deletion before writing so the expected value matches the parsed
 * value after the atomic replacement.
 */
function canonicalizeTomlRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
    if (child === null || child === undefined) return []
    return [[key, canonicalizeTomlValue(child)]]
  }))
}

function canonicalizeTomlValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.some((child) => child === null || child === undefined)) {
      throw new TypeError("NeoView TOML arrays cannot contain null or undefined values.")
    }
    return value.map(canonicalizeTomlValue)
  }
  return isRecord(value) ? canonicalizeTomlRecord(value) : value
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => deepEqual(value, right[index]))
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key) => Object.hasOwn(right, key) && deepEqual(left[key], right[key]))
  }
  return false
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
