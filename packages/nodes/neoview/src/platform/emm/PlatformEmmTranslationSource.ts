import { readFile, stat } from "node:fs/promises"
import { resolve } from "node:path"

import type { ReaderEmmCatalogTag } from "../../ports/ReaderEmmTagCatalogStore.js"
import { emmTranslationKey, emmTranslationNamespace } from "../../ports/ReaderEmmTagTranslation.js"

export { emmTranslationKey } from "../../ports/ReaderEmmTagTranslation.js"

const MAX_TRANSLATION_BYTES = 8 * 1024 * 1024

export interface PlatformEmmTranslationSourceOptions {
  path?: string
  env?: NodeJS.ProcessEnv
  cwd?: string
}

export class PlatformEmmTranslationSource {
  readonly #options: PlatformEmmTranslationSourceOptions
  #cached?: { path: string; modifiedAt: number; dictionary: unknown }

  constructor(options: PlatformEmmTranslationSourceOptions = {}) {
    this.#options = options
  }

  async translate(tags: readonly ReaderEmmCatalogTag[], signal?: AbortSignal): Promise<ReadonlyMap<string, string>> {
    signal?.throwIfAborted()
    if (!tags.length) return new Map()
    const dictionary = await this.#load(signal)
    if (!dictionary) return new Map()
    const requested = new Map<string, Set<string>>()
    for (const value of tags) {
      const namespace = emmTranslationNamespace(value.category)
      const names = requested.get(namespace) ?? new Set<string>()
      names.add(value.tag)
      requested.set(namespace, names)
    }
    const output = new Map<string, string>()
    const data = isRecord(dictionary) && Array.isArray(dictionary.data) ? dictionary.data : []
    for (const namespaceRecord of data) {
      if (!isRecord(namespaceRecord) || typeof namespaceRecord.namespace !== "string" || !isRecord(namespaceRecord.data)) continue
      const namespace = emmTranslationNamespace(namespaceRecord.namespace)
      const names = requested.get(namespace)
      if (!names) continue
      for (const tag of names) {
        const record = Object.prototype.hasOwnProperty.call(namespaceRecord.data, tag) ? namespaceRecord.data[tag] : undefined
        if (!isRecord(record) || typeof record.name !== "string") continue
        const translated = record.name.trim()
        if (translated && translated.length <= 512) output.set(emmTranslationKey({ category: namespace, tag }), translated)
      }
    }
    return output
  }

  clear(): boolean {
    const cleared = Boolean(this.#cached)
    this.#cached = undefined
    return cleared
  }

  async #load(signal?: AbortSignal): Promise<unknown | undefined> {
    const path = await this.#resolvePath()
    if (!path) return undefined
    const metadata = await stat(path).catch(() => undefined)
    signal?.throwIfAborted()
    if (!metadata?.isFile() || metadata.size > MAX_TRANSLATION_BYTES) return undefined
    if (this.#cached?.path === path && this.#cached.modifiedAt === metadata.mtimeMs) return this.#cached.dictionary
    const content = await readFile(path, "utf8")
    signal?.throwIfAborted()
    const dictionary = JSON.parse(content) as unknown
    this.#cached = { path, modifiedAt: metadata.mtimeMs, dictionary }
    return dictionary
  }

  async #resolvePath(): Promise<string | undefined> {
    const env = this.#options.env ?? process.env
    const cwd = this.#options.cwd ?? process.cwd()
    const candidates = this.#options.path
      ? [this.#options.path]
      : [
          resolve(cwd, "portable/db.text.json"),
          env.APPDATA ? resolve(env.APPDATA, "exhentai-manga-manager/db.text.json") : undefined,
          env.LOCALAPPDATA ? resolve(env.LOCALAPPDATA, "exhentai-manga-manager/db.text.json") : undefined,
        ].filter((value): value is string => Boolean(value))
    for (const candidate of candidates) {
      if ((await stat(candidate).catch(() => undefined))?.isFile()) return candidate
    }
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
