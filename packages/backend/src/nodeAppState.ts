import { readAtomicJsonFile, updateAtomicJsonFile } from "@xiranite/config"
import { readdir, stat } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

const stateSchemaVersion = 1

interface NodeAppStateDocument {
  schemaVersion: number
  nodeId: string
  snapshotId: string
  data: Record<string, unknown>
}

export class NodeAppStateStore {
  readonly path: string
  private readonly nodeId: string
  private readonly snapshotId: string
  private readonly initialDocument: Promise<NodeAppStateDocument>

  constructor(nodeId: string, snapshotId: string, statePath = resolveNodeAppStatePath(nodeId, snapshotId)) {
    this.nodeId = nodeId
    this.snapshotId = normalizeSnapshotId(snapshotId)
    this.path = statePath
    this.initialDocument = this.findInitialDocument()
  }

  async get(): Promise<Record<string, unknown>> {
    return (await readAtomicJsonFile(this.path, this.options(await this.initialDocument))).data
  }

  async patch(patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    const fallback = await this.initialDocument
    const next = await updateAtomicJsonFile(this.path, (current) => ({
      ...current,
      data: { ...current.data, ...patch },
    }), this.options(fallback))
    return next.data
  }

  async replace(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const fallback = await this.initialDocument
    const next = await updateAtomicJsonFile(this.path, (current) => ({
      ...current,
      data,
    }), this.options(fallback))
    return next.data
  }

  private options(fallback: NodeAppStateDocument) {
    return {
      fallback,
      parse: (value: unknown): NodeAppStateDocument => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Node app state must be an object.")
        const record = value as Record<string, unknown>
        if (record.schemaVersion !== stateSchemaVersion || record.nodeId !== this.nodeId || record.snapshotId !== this.snapshotId) {
          throw new Error("Node app state belongs to another node or schema version.")
        }
        if (!record.data || typeof record.data !== "object" || Array.isArray(record.data)) {
          throw new Error("Node app state data must be an object.")
        }
        return { schemaVersion: stateSchemaVersion, nodeId: this.nodeId, snapshotId: this.snapshotId, data: record.data as Record<string, unknown> }
      },
    }
  }

  private async findInitialDocument(): Promise<NodeAppStateDocument> {
    const fallback = { schemaVersion: stateSchemaVersion, nodeId: this.nodeId, snapshotId: this.snapshotId, data: {} }
    const candidates = await listStateCandidates(this.nodeId, this.snapshotId)
    for (const candidate of candidates.filter(Boolean).sort((left, right) => right!.mtimeMs - left!.mtimeMs)) {
      const value = await readAtomicJsonFile(candidate!.candidatePath, {
        fallback: undefined,
        parse: (raw: unknown): NodeAppStateDocument => parseCompatibleState(raw, this.nodeId),
      }).catch(() => undefined)
      if (value) return { ...fallback, data: value.data }
    }
    return fallback
  }
}

export function resolveNodeAppDataDirectory(nodeId: string, environment: NodeJS.ProcessEnv = process.env): string {
  const base = environment.LOCALAPPDATA
    ?? environment.APPDATA
    ?? path.join(homedir(), "AppData", "Local")
  return path.join(base, "Xiranite", "node-apps", nodeId)
}

export function resolveNodeAppSnapshotsDirectory(nodeId: string, environment: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveNodeAppDataDirectory(nodeId, environment), "snapshots")
}

export function resolveNodeAppStateDirectory(nodeId: string, environment: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveNodeAppDataDirectory(nodeId, environment), "state")
}

export function resolveNodeAppStatePath(nodeId: string, snapshotId: string, environment: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveNodeAppStateDirectory(nodeId, environment), `${normalizeSnapshotId(snapshotId)}.json`)
}

async function listStateCandidates(nodeId: string, currentSnapshotId: string): Promise<Array<{ snapshotId: string; candidatePath: string; mtimeMs: number }>> {
  const currentLegacyPath = resolveLegacyNodeAppStatePath(nodeId, currentSnapshotId)
  const candidates: Array<{ snapshotId: string; candidatePath: string; mtimeMs: number }> = []
  const currentLegacy = await stat(currentLegacyPath).catch(() => undefined)
  if (currentLegacy?.isFile()) candidates.push({ snapshotId: currentSnapshotId, candidatePath: currentLegacyPath, mtimeMs: currentLegacy.mtimeMs })

  const [stateFiles, legacySnapshots] = await Promise.all([
    readdir(resolveNodeAppStateDirectory(nodeId)).catch(() => []),
    readdir(resolveNodeAppSnapshotsDirectory(nodeId)).catch(() => []),
  ])
  for (const file of stateFiles) {
    if (!file.endsWith(".json")) continue
    const snapshotId = file.slice(0, -".json".length)
    if (snapshotId === currentSnapshotId || !isSnapshotId(snapshotId)) continue
    const candidatePath = resolveNodeAppStatePath(nodeId, snapshotId)
    const info = await stat(candidatePath).catch(() => undefined)
    if (info?.isFile()) candidates.push({ snapshotId, candidatePath, mtimeMs: info.mtimeMs })
  }
  for (const snapshotId of legacySnapshots) {
    if (snapshotId === currentSnapshotId || !isSnapshotId(snapshotId)) continue
    const candidatePath = resolveLegacyNodeAppStatePath(nodeId, snapshotId)
    const info = await stat(candidatePath).catch(() => undefined)
    if (info?.isFile()) candidates.push({ snapshotId, candidatePath, mtimeMs: info.mtimeMs })
  }
  return candidates
}

function resolveLegacyNodeAppStatePath(nodeId: string, snapshotId: string): string {
  return path.join(resolveNodeAppSnapshotsDirectory(nodeId), normalizeSnapshotId(snapshotId), "state.json")
}

function parseCompatibleState(value: unknown, nodeId: string): NodeAppStateDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Node app state must be an object.")
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== stateSchemaVersion || record.nodeId !== nodeId || !isRecord(record.data)) {
    throw new Error("Node app state is not compatible with this node.")
  }
  return {
    schemaVersion: stateSchemaVersion,
    nodeId,
    snapshotId: typeof record.snapshotId === "string" ? record.snapshotId : "legacy",
    data: record.data,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function normalizeSnapshotId(value: string): string {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(value)) throw new Error(`Invalid node app snapshot ID: ${value}`)
  return value
}

function isSnapshotId(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*$/i.test(value)
}
