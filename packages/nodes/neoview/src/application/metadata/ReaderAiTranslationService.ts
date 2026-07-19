import { createHash } from "node:crypto"

import { LRUCache } from "lru-cache"

import { waitWithAbort } from "../../domain/page/wait-with-abort.js"
import type {
  ReaderAiTranslationProvider,
  ReaderAiTranslationPersistentCache,
  ReaderAiTranslationRequest,
  ReaderAiTranslationResult,
} from "../../ports/ReaderAiTranslation.js"

const MAX_TEXT_LENGTH = 16_384
const MAX_PROMPT_TEMPLATE_LENGTH = 8_192

export class ReaderAiTranslationService {
  readonly #cache: LRUCache<string, string>
  readonly #cacheEnabled: boolean

  constructor(
    private readonly provider: ReaderAiTranslationProvider,
    cacheEntries = 1_000,
    private readonly persistentCache?: ReaderAiTranslationPersistentCache,
  ) {
    if (!Number.isSafeInteger(cacheEntries) || cacheEntries < 0 || cacheEntries > 10_000) {
      throw new RangeError("AI translation cache entries must be from 0 to 10000.")
    }
    this.#cacheEnabled = cacheEntries > 0
    this.#cache = new LRUCache({ max: Math.max(1, cacheEntries) })
  }

  async translate(request: ReaderAiTranslationRequest, signal?: AbortSignal): Promise<ReaderAiTranslationResult> {
    signal?.throwIfAborted()
    const normalized = normalizeRequest(request)
    if (normalized.sourceLanguage === normalized.targetLanguage) return { text: normalized.text, cached: false }
    const key = cacheKey(normalized)
    const cached = this.#cacheEnabled ? this.#cache.get(key) : undefined
    if (cached !== undefined) return { text: cached, cached: true }

    const persisted = await this.#loadPersisted(normalized.text, normalized.model, signal)
    if (persisted !== undefined) {
      if (this.#cacheEnabled) this.#cache.set(key, persisted)
      return { text: persisted, cached: true }
    }

    const translated = normalizeTranslated(await waitWithAbort(this.provider.translate(normalized, signal), signal))
    signal?.throwIfAborted()
    if (!translated) throw new Error("AI translation provider returned an empty result.")
    if (this.#cacheEnabled) this.#cache.set(key, translated)
    void this.persistentCache?.save(normalized.text, {
      title: translated,
      service: "ollama",
      model: normalized.model,
      timestamp: Date.now(),
    }).catch(() => undefined)
    return { text: translated, cached: false }
  }

  clearCache(): void {
    this.#cache.clear()
  }

  cacheSize(): number {
    return this.#cache.size
  }

  async #loadPersisted(key: string, model: string, signal?: AbortSignal): Promise<string | undefined> {
    if (!this.persistentCache) return undefined
    try {
      const entry = await waitWithAbort(this.persistentCache.load(key, model), signal)
      if (entry?.service !== "ollama" || entry.model !== model) return undefined
      return normalizeTranslated(entry.title) || undefined
    } catch {
      signal?.throwIfAborted()
      return undefined
    }
  }
}

function normalizeRequest(value: ReaderAiTranslationRequest): ReaderAiTranslationRequest {
  const text = value.text.normalize("NFKC").trim()
  const sourceLanguage = value.sourceLanguage.trim().toLowerCase()
  const targetLanguage = value.targetLanguage.trim().toLowerCase()
  const model = value.model.trim()
  const promptTemplate = value.promptTemplate.trim()
  if (!text || text.length > MAX_TEXT_LENGTH) throw new RangeError("AI translation text must contain at most 16384 characters.")
  if (!sourceLanguage || sourceLanguage.length > 32 || !targetLanguage || targetLanguage.length > 32) {
    throw new RangeError("AI translation languages must contain at most 32 characters.")
  }
  if (!model || model.length > 256) throw new RangeError("AI translation model must contain at most 256 characters.")
  if (!promptTemplate || promptTemplate.length > MAX_PROMPT_TEMPLATE_LENGTH) {
    throw new RangeError("AI translation prompt template must contain at most 8192 characters.")
  }
  return { text, sourceLanguage, targetLanguage, model, promptTemplate }
}

function normalizeTranslated(value: string): string {
  return value.normalize("NFKC").trim()
}

function cacheKey(value: ReaderAiTranslationRequest): string {
  return createHash("sha256")
    .update(value.model)
    .update("\0")
    .update(value.sourceLanguage)
    .update("\0")
    .update(value.targetLanguage)
    .update("\0")
    .update(value.promptTemplate)
    .update("\0")
    .update(value.text)
    .digest("hex")
}
