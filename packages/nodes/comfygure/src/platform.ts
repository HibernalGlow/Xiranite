import { mkdir, readFile, readdir } from "node:fs/promises"
import { join, relative, resolve, sep } from "node:path"

import { Client as StableCanvasClient } from "@stable-canvas/comfyui-client"
import { resolveXiraniteDataDir } from "@xiranite/config"
import PQueue from "p-queue"
import writeFileAtomic from "write-file-atomic"

import {
  createComfyuiImageUrl,
  normalizeComfygureProfile,
  normalizeComfyuiEndpoint,
  summarizeComfygureProfile,
  type ComfygureProfile,
  type ComfygureProfileStore,
  type ComfygureRuntime,
  type ComfygureTarget,
  type ComfygureTargetAdapter,
  type ComfyuiOutputImage,
  type ComfyuiPromptHistory,
  type ComfyuiSubmission,
  type CompiledProgram,
} from "./core.js"

export interface NodeComfygureRuntimeOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  dataDir?: string
  now?: () => Date
}

export function createNodeComfygureRuntime(options: NodeComfygureRuntimeOptions = {}): ComfygureRuntime {
  const cwd = options.cwd ?? process.cwd()
  const env = options.env ?? process.env
  return {
    fetch: (url, init) => globalThis.fetch(url, init),
    targetAdapter: createStableCanvasComfygureTargetAdapter(),
    readLoraTrigger: async (libraryPath, loraName) => {
      const loraRoot = resolve(libraryPath, "models", "loras")
      const normalizedName = loraName.replace(/\\/g, "/").replace(/^\/+/, "")
      const extension = normalizedName.lastIndexOf(".")
      const triggerName = `${extension > 0 ? normalizedName.slice(0, extension) : normalizedName}.trigger.txt`
      const candidate = resolve(loraRoot, triggerName)
      const relativeCandidate = relative(loraRoot, candidate)
      if (!relativeCandidate || relativeCandidate === ".." || relativeCandidate.startsWith(`..${sep}`)) return undefined
      try {
        const text = await readFile(candidate, "utf8")
        const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"))
        return lines.join("\n") || undefined
      } catch {
        return undefined
      }
    },
    profileStore: createNodeComfygureProfileStore({ cwd, env, dataDir: options.dataDir }),
    now: options.now ?? (() => new Date()),
  }
}

interface StableCanvasClientLike {
  getNodeDefs(): Promise<unknown>
  queuePrompt(queueIndex: number, options: { prompt: unknown; workflow: unknown }): Promise<unknown>
  getPromptStatus(promptId: string): Promise<{ running: boolean; pending: boolean; done: boolean }>
  getPromptOutputs(promptId: string): Promise<unknown>
}

interface StableCanvasClientOptions {
  api_host: string
  api_base: string
  clientId: string
  ssl: boolean
  fetch: typeof globalThis.fetch
}

export interface StableCanvasComfygureTargetAdapterOptions {
  createClient?: (options: StableCanvasClientOptions) => StableCanvasClientLike
}

const targetQueues = new Map<string, PQueue>()

/**
 * Adapter over the pinned client library. It deliberately exposes only the
 * compiler-facing Target Adapter contract and serializes each local endpoint
 * through the mature PQueue scheduler.
 */
export function createStableCanvasComfygureTargetAdapter(options: StableCanvasComfygureTargetAdapterOptions = {}): ComfygureTargetAdapter {
  const createClient = options.createClient ?? ((clientOptions) => new StableCanvasClient(clientOptions))
  const scheduled = async <T>(target: ComfygureTarget, operation: (client: StableCanvasClientLike, endpoint: string) => Promise<T>): Promise<T> => {
    const config = stableCanvasTargetConfig(target)
    const queue = targetQueue(config.endpoint)
    return await queue.add(async () => await operation(createClient(config), config.endpoint))
  }
  return {
    async readObjectInfo(target) {
      return await scheduled(target, async (client) => {
        const value = await client.getNodeDefs()
        if (!isRecord(value)) throw new Error("/object_info did not return a node map.")
        return value
      })
    },
    async submitPrompt(compiled, target) {
      return await scheduled(target, async (client, endpoint) => {
        const payload = await client.queuePrompt(0, { prompt: compiled.graph, workflow: undefined })
        if (!isRecord(payload)) throw new Error("ComfyUI prompt submission did not return an acknowledgement object.")
        const promptId = stringValue(payload.prompt_id)
        if (!promptId) throw new Error(describeStableCanvasPromptError(payload))
        const queueNumber = numberValue(payload.number)
        return { endpoint, promptId, clientId: stableCanvasTargetConfig(target).clientId, ...(queueNumber === undefined ? {} : { queueNumber }) } satisfies ComfyuiSubmission
      })
    },
    async readPromptHistory(promptId, target) {
      return await scheduled(target, async (client, endpoint) => {
        // Force an uncaught client request first. The client intentionally
        // soft-fails queue/history helpers for browser UX, which would make a
        // stopped local target indistinguishable from an unfinished prompt.
        await client.getNodeDefs()
        const status = await client.getPromptStatus(promptId)
        if (status.running) return { endpoint, promptId, state: "running", images: [] } satisfies ComfyuiPromptHistory
        if (status.pending) return { endpoint, promptId, state: "pending", images: [] } satisfies ComfyuiPromptHistory
        try {
          const outputs = await client.getPromptOutputs(promptId)
          return { endpoint, promptId, state: "complete", images: stableCanvasOutputImages(outputs, endpoint) } satisfies ComfyuiPromptHistory
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (/not found in history/i.test(message)) return { endpoint, promptId, state: "pending", images: [] } satisfies ComfyuiPromptHistory
          return { endpoint, promptId, state: "error", images: [], error: message } satisfies ComfyuiPromptHistory
        }
      })
    },
  }
}

function stableCanvasTargetConfig(target: ComfygureTarget): StableCanvasClientOptions & { endpoint: string } {
  const endpoint = normalizeComfyuiEndpoint(target.endpoint)
  const url = new URL(endpoint)
  const apiBase = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "")
  return {
    endpoint,
    api_host: url.host,
    api_base: apiBase,
    clientId: target.clientId?.trim() || "xiranite-comfygure",
    ssl: url.protocol === "https:",
    fetch: globalThis.fetch.bind(globalThis),
  }
}

function targetQueue(endpoint: string): PQueue {
  const existing = targetQueues.get(endpoint)
  if (existing) return existing
  const queue = new PQueue({ concurrency: 1 })
  targetQueues.set(endpoint, queue)
  return queue
}

function stableCanvasOutputImages(outputs: unknown, endpoint: string): readonly ComfyuiOutputImage[] {
  if (!isRecord(outputs)) return []
  const images: ComfyuiOutputImage[] = []
  for (const output of Object.values(outputs)) {
    if (!isRecord(output) || !Array.isArray(output.images)) continue
    for (const image of output.images) {
      if (!isRecord(image)) continue
      const filename = stringValue(image.filename)
      if (!filename) continue
      const subfolder = stringValue(image.subfolder)
      const type = stringValue(image.type) || "output"
      images.push({ filename, subfolder, type, url: createComfyuiImageUrl(endpoint, { filename, subfolder, type }) })
    }
  }
  return images
}

function describeStableCanvasPromptError(payload: Record<string, unknown>): string {
  const error = stringValue(payload.error)
  if (error) return `ComfyUI rejected the prompt graph: ${error}`
  return "ComfyUI prompt submission did not return a prompt ID."
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export interface NodeComfygureProfileStoreOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  dataDir?: string
}

export function createNodeComfygureProfileStore(options: NodeComfygureProfileStoreOptions = {}): ComfygureProfileStore {
  const cwd = options.cwd ?? process.cwd()
  const env = options.env ?? process.env
  const dataDir = options.dataDir ?? resolveXiraniteDataDir({ cwd, env })
  return {
    async list(profileLibraryPath) {
      const directory = resolveProfileDirectory(dataDir, profileLibraryPath)
      let entries
      try {
        entries = await readdir(directory, { withFileTypes: true })
      } catch (error) {
        if (isMissingDirectory(error)) return []
        throw error
      }
      const profiles: ComfygureProfile[] = []
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue
        const profile = await readProfileFile(join(directory, entry.name))
        if (profile) profiles.push(profile)
      }
      return profiles.map(summarizeComfygureProfile).sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
    },
    async read(id, profileLibraryPath) {
      const path = profilePath(resolveProfileDirectory(dataDir, profileLibraryPath), id)
      return await readProfileFile(path)
    },
    async save(profile, profileLibraryPath) {
      const normalized = normalizeComfygureProfile(profile)
      if (!normalized) throw new Error("The Comfygure profile is invalid.")
      const directory = resolveProfileDirectory(dataDir, profileLibraryPath)
      await mkdir(directory, { recursive: true })
      await writeFileAtomic(profilePath(directory, normalized.id), `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8" })
      return normalized
    },
  }
}

export function resolveNodeComfygureProfileDirectory(options: NodeComfygureProfileStoreOptions = {}, profileLibraryPath?: string): string {
  const cwd = options.cwd ?? process.cwd()
  const env = options.env ?? process.env
  return resolveProfileDirectory(options.dataDir ?? resolveXiraniteDataDir({ cwd, env }), profileLibraryPath)
}

function resolveProfileDirectory(dataDir: string, profileLibraryPath: string | undefined): string {
  return profileLibraryPath?.trim() ? resolve(profileLibraryPath.trim()) : join(resolve(dataDir), "comfygure", "profiles")
}

function profilePath(directory: string, id: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error("The Comfygure profile ID is invalid.")
  return join(directory, `${id}.json`)
}

async function readProfileFile(path: string): Promise<ComfygureProfile | undefined> {
  try {
    return normalizeComfygureProfile(JSON.parse(await readFile(path, "utf8")) as unknown)
  } catch (error) {
    if (isMissingDirectory(error)) return undefined
    return undefined
  }
}

function isMissingDirectory(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT"
}
