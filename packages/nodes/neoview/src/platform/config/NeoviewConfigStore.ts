import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { dirname } from "node:path"
import { lock } from "proper-lockfile"
import {
  parseToml,
  resolveXiraniteConfigPath,
  stripBom,
  type ResolveConfigPathOptions,
} from "@xiranite/config"
import {
  isOptimizedNeoviewConfigEnvelope,
  unwrapNeoviewConfigEnvelope,
} from "../../application/config/NeoviewConfigEnvelope.js"
import { stringifyXiraniteConfigWithOptimizedNeoview } from "./NeoviewConfigToml.js"

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
  await mkdir(dirname(configPath), { recursive: true })
  const lease = await acquireConfigLock(configPath, options.lockRetries)
  try {
    return await commitLocked(configPath, patch, options.strategy, lease.assertHeld)
  } finally {
    await lease.release()
  }
}

async function commitLocked(
  configPath: string,
  patch: Record<string, unknown>,
  strategy: NeoviewConfigImportStrategy,
  assertLockHeld: () => void,
): Promise<CommitNeoviewConfigResult> {
  const previousText = await readOptional(configPath)
  assertLockHeld()
  const root = previousText === undefined
    ? {}
    : requireRecord(parseToml(stripBom(previousText)), "Xiranite config root")
  const nodes = isRecord(root.nodes) ? { ...root.nodes } : {}
  const rawCurrent = isRecord(nodes.neoview) ? nodes.neoview : {}
  const current = unwrapNeoviewConfigEnvelope(rawCurrent)
  const nextNode = strategy === "overwrite" ? cloneRecord(patch) : deepMerge(current, patch)
  const changed = !deepEqual(current, nextNode) || !isOptimizedNeoviewConfigEnvelope(rawCurrent)

  if (!changed) {
    return { configPath, nodeConfig: nextNode, changed: false }
  }

  const nextRoot = { ...root, nodes: { ...nodes, neoview: nextNode } }
  const nextText = stringifyXiraniteConfigWithOptimizedNeoview(nextRoot, nextNode)
  let backupPath: string | undefined
  if (previousText !== undefined) {
    backupPath = `${configPath}.neoview-import.bak`
    await atomicReplace(backupPath, previousText)
  }
  let verifiedNode: Record<string, unknown>
  try {
    assertLockHeld()
    await atomicReplace(configPath, nextText)
    const verifiedText = await readFile(configPath, "utf8")
    assertLockHeld()
    const verifiedRoot = requireRecord(parseToml(stripBom(verifiedText)), "written Xiranite config root")
    const verifiedNodes = requireRecord(verifiedRoot.nodes, "written [nodes] section")
    const verifiedEnvelope = requireRecord(verifiedNodes.neoview, "written [nodes.neoview] section")
    if (!isOptimizedNeoviewConfigEnvelope(verifiedEnvelope)) {
      throw new Error("NeoView TOML verification failed: optimized config envelope was not written.")
    }
    verifiedNode = unwrapNeoviewConfigEnvelope(verifiedEnvelope)
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

async function acquireConfigLock(configPath: string, retries = 20): Promise<{
  assertHeld(): void
  release(): Promise<void>
}> {
  if (!Number.isSafeInteger(retries) || retries < 0 || retries > 100) {
    throw new RangeError("NeoView config lockRetries must be an integer between 0 and 100.")
  }
  let compromised: Error | undefined
  let release: (() => Promise<void>) | undefined
  try {
    release = await lock(configPath, {
      lockfilePath: `${configPath}.xr-write.lock`,
      realpath: false,
      stale: 30_000,
      update: 10_000,
      retries: {
        retries,
        factor: 1.25,
        minTimeout: 20,
        maxTimeout: 100,
        randomize: true,
      },
      onCompromised: (error) => { compromised = error },
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOCKED") {
      throw new Error(`Timed out waiting for the Xiranite config writer: ${configPath}`, { cause: error })
    }
    throw error
  }
  if (compromised) {
    await release().catch(() => undefined)
    throw new Error(`Xiranite config writer lock was compromised: ${configPath}`, { cause: compromised })
  }
  return {
    assertHeld() {
      if (compromised) throw new Error(`Xiranite config writer lock was compromised: ${configPath}`, { cause: compromised })
    },
    release,
  }
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
