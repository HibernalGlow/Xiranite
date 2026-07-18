import { readFile, stat } from "node:fs/promises"
import { resolve } from "node:path"

const MAX_SETTINGS_BYTES = 8 * 1024 * 1024

export interface ReaderEmmCollectTag {
  category: string
  tag: string
}

export interface ReaderEmmCollectTagSnapshot {
  tags: readonly ReaderEmmCollectTag[]
  mixedGender: boolean
  sourcePath?: string
}

export interface PlatformEmmCollectTagSourceOptions {
  settingPath?: string
  env?: NodeJS.ProcessEnv
  cwd?: string
  mixedGender?: boolean
}

export class PlatformEmmCollectTagSource {
  readonly #options: PlatformEmmCollectTagSourceOptions
  #cached?: { path?: string; modifiedAt?: number; snapshot: ReaderEmmCollectTagSnapshot }

  constructor(options: PlatformEmmCollectTagSourceOptions = {}) {
    this.#options = options
  }

  async load(signal?: AbortSignal): Promise<ReaderEmmCollectTagSnapshot> {
    signal?.throwIfAborted()
    const path = await this.#resolvePath()
    if (!path) return this.#empty()
    const metadata = await stat(path).catch(() => undefined)
    signal?.throwIfAborted()
    if (!metadata?.isFile() || metadata.size > MAX_SETTINGS_BYTES) return this.#empty()
    if (this.#cached?.path === path && this.#cached.modifiedAt === metadata.mtimeMs) return this.#cached.snapshot
    const content = await readFile(path, "utf8")
    signal?.throwIfAborted()
    const snapshot: ReaderEmmCollectTagSnapshot = {
      tags: parseCollectTags(content),
      mixedGender: this.#options.mixedGender ?? false,
      sourcePath: path,
    }
    this.#cached = { path, modifiedAt: metadata.mtimeMs, snapshot }
    return snapshot
  }

  async #resolvePath(): Promise<string | undefined> {
    const env = this.#options.env ?? process.env
    const cwd = this.#options.cwd ?? process.cwd()
    const candidates = this.#options.settingPath
      ? [this.#options.settingPath]
      : [
          resolve(cwd, "portable/setting.json"),
          env.APPDATA ? resolve(env.APPDATA, "exhentai-manga-manager/setting.json") : undefined,
          env.LOCALAPPDATA ? resolve(env.LOCALAPPDATA, "exhentai-manga-manager/setting.json") : undefined,
        ].filter((value): value is string => Boolean(value))
    for (const candidate of candidates) {
      if ((await stat(candidate).catch(() => undefined))?.isFile()) return candidate
    }
    return undefined
  }

  #empty(): ReaderEmmCollectTagSnapshot {
    const snapshot = { tags: [], mixedGender: this.#options.mixedGender ?? false }
    this.#cached = { snapshot }
    return snapshot
  }
}

export function parseCollectTags(content: string): ReaderEmmCollectTag[] {
  const value = JSON.parse(content) as unknown
  if (!isRecord(value) || !Array.isArray(value.collectTag)) return []
  const output: ReaderEmmCollectTag[] = []
  const seen = new Set<string>()
  for (const item of value.collectTag) {
    if (!isRecord(item) || typeof item.tag !== "string") continue
    const category = typeof item.cat === "string"
      ? item.cat
      : typeof item.letter === "string" ? item.letter : undefined
    const tag = item.tag.trim()
    if (!category?.trim() || !tag) continue
    const normalized = `${category.trim().toLocaleLowerCase()}\0${tag.toLocaleLowerCase()}`
    if (seen.has(normalized)) continue
    seen.add(normalized)
    output.push({ category: category.trim(), tag })
  }
  return output
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
