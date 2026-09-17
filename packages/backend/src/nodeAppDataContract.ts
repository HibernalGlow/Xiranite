import { updateAtomicJsonFile } from "@xiranite/config"
import { resolveAppDataDir } from "@xiranite/platform"
import { readFile } from "node:fs/promises"
import path from "node:path"

const dataContractSchemaVersion = 1
const initialDataContractVersion = 1

export interface NodeAppDataContractDocument {
  schemaVersion: number
  version: number
}

export function resolveNodeAppDataContractsPath(environment: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveAppDataDir({ env: environment }), "node-apps", "data-contract.json")
}

/**
 * Reads the shared data-contract marker without treating corrupt JSON as a
 * recoverable state. The native host makes the same fail-closed decision
 * before it is allowed to launch a standalone backend.
 */
export async function readNodeAppDataContract(pathname = resolveNodeAppDataContractsPath()): Promise<NodeAppDataContractDocument> {
  const content = await readFile(pathname, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  if (content === undefined) return { schemaVersion: dataContractSchemaVersion, version: initialDataContractVersion }
  return parseNodeAppDataContract(JSON.parse(content) as unknown)
}

/**
 * Publishes a monotonic contract version only after the backend has completed
 * its normal config/database initialization. Older snapshots can never lower
 * this marker, so their native preflight rejects incompatible shared data.
 */
export async function recordNodeAppDataContract(version: number, pathname = resolveNodeAppDataContractsPath()): Promise<NodeAppDataContractDocument> {
  assertDataContractVersion(version)
  const current = await readNodeAppDataContract(pathname)
  return await updateAtomicJsonFile(pathname, (stored) => {
    const parsed = parseNodeAppDataContract(stored)
    return {
      schemaVersion: dataContractSchemaVersion,
      version: Math.max(parsed.version, current.version, version),
    }
  }, {
    fallback: current,
    parse: parseNodeAppDataContract,
  })
}

export function parseNodeAppDataContractVersion(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined
  const parsed = Number(value)
  assertDataContractVersion(parsed)
  return parsed
}

export function parseNodeAppDataContract(value: unknown): NodeAppDataContractDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Node app data contract must be an object.")
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== dataContractSchemaVersion) throw new Error("Node app data contract schema is unsupported.")
  assertDataContractVersion(record.version)
  return { schemaVersion: dataContractSchemaVersion, version: record.version }
}

function assertDataContractVersion(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid node app data contract version: ${String(value)}.`)
}
