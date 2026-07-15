import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { dirname } from "node:path"
import {
  parseToml,
  resolveXiraniteConfigPath,
  stringifyToml,
  stripBom,
  type ResolveConfigPathOptions,
} from "@xiranite/config"

export type NeoviewConfigImportStrategy = "merge" | "overwrite"

export interface CommitNeoviewConfigOptions extends ResolveConfigPathOptions {
  strategy: NeoviewConfigImportStrategy
}

export interface CommitNeoviewConfigResult {
  configPath: string
  backupPath?: string
  nodeConfig: Record<string, unknown>
  changed: boolean
}

export async function commitNeoviewConfig(
  patch: Record<string, unknown>,
  options: CommitNeoviewConfigOptions,
): Promise<CommitNeoviewConfigResult> {
  const configPath = resolveXiraniteConfigPath(options)
  const previousText = await readOptional(configPath)
  const root = previousText === undefined
    ? {}
    : requireRecord(parseToml(stripBom(previousText)), "Xiranite config root")
  const nodes = isRecord(root.nodes) ? { ...root.nodes } : {}
  const current = isRecord(nodes.neoview) ? nodes.neoview : {}
  const nextNode = options.strategy === "overwrite" ? cloneRecord(patch) : deepMerge(current, patch)
  const changed = !deepEqual(current, nextNode)

  if (!changed) {
    return { configPath, nodeConfig: nextNode, changed: false }
  }

  const nextRoot = { ...root, nodes: { ...nodes, neoview: nextNode } }
  const nextText = stringifyToml(nextRoot)
  let backupPath: string | undefined
  if (previousText !== undefined) {
    backupPath = `${configPath}.neoview-import.bak`
    await atomicReplace(backupPath, previousText)
  }
  let verifiedNode: Record<string, unknown>
  try {
    await atomicReplace(configPath, nextText)
    const verifiedText = await readFile(configPath, "utf8")
    const verifiedRoot = requireRecord(parseToml(stripBom(verifiedText)), "written Xiranite config root")
    const verifiedNodes = requireRecord(verifiedRoot.nodes, "written [nodes] section")
    verifiedNode = requireRecord(verifiedNodes.neoview, "written [nodes.neoview] section")
    if (!deepEqual(verifiedNode, nextNode)) {
      throw new Error("NeoView TOML verification failed after atomic write.")
    }
  } catch (error) {
    if (previousText === undefined) await rm(configPath, { force: true }).catch(() => undefined)
    else await atomicReplace(configPath, previousText)
    throw error
  }

  return { configPath, backupPath, nodeConfig: verifiedNode, changed: true }
}

async function atomicReplace(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" })
    await rename(temporaryPath, path)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
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
