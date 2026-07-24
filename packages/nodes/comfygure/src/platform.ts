import { mkdir, readFile, readdir } from "node:fs/promises"
import { join, relative, resolve, sep } from "node:path"

import { resolveXiraniteDataDir } from "@xiranite/config"
import writeFileAtomic from "write-file-atomic"

import { normalizeComfygureProfile, summarizeComfygureProfile, type ComfygureProfile, type ComfygureProfileStore, type ComfygureRuntime } from "./core.js"

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
