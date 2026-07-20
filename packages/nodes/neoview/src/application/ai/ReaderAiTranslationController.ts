import type {
  ReaderAiTranslationPersistentCache,
  ReaderAiTranslationRequest,
  ReaderAiTranslationResult,
  ReaderOllamaModel,
} from "../../ports/ReaderAiTranslation.js"
import type { NeoviewAiTranslationConfig } from "../config/ReaderRuntimeConfig.js"
import { ReaderAiTranslationService } from "../metadata/ReaderAiTranslationService.js"
import { OllamaTranslationClient } from "../../platform/ai/OllamaTranslationClient.js"

export interface ReaderAiTranslationControllerOptions {
  config: NeoviewAiTranslationConfig
  persistentCache?: ReaderAiTranslationPersistentCache
  fetch?: typeof globalThis.fetch
}

/**
 * Session-free control plane for AI translation cards.
 * Rebuilds the Ollama client only when the configured endpoint/model cache size changes.
 */
export class ReaderAiTranslationController {
  #config: NeoviewAiTranslationConfig
  #service: ReaderAiTranslationService | undefined
  #client: OllamaTranslationClient | undefined
  #serviceKey = ""
  readonly #persistentCache?: ReaderAiTranslationPersistentCache
  readonly #fetch?: typeof globalThis.fetch

  constructor(options: ReaderAiTranslationControllerOptions) {
    this.#config = options.config
    this.#persistentCache = options.persistentCache
    this.#fetch = options.fetch
  }

  getConfig(): NeoviewAiTranslationConfig {
    return this.#config
  }

  setConfig(config: NeoviewAiTranslationConfig): void {
    this.#config = config
  }

  async check(signal?: AbortSignal): Promise<{ online: boolean; service: NeoviewAiTranslationConfig["service"] }> {
    signal?.throwIfAborted()
    if (this.#config.service !== "ollama") return { online: false, service: this.#config.service }
    const client = this.#ensureClient()
    return { online: await client.check(signal), service: "ollama" }
  }

  async models(signal?: AbortSignal): Promise<readonly ReaderOllamaModel[]> {
    signal?.throwIfAborted()
    this.#assertOllamaConfigured()
    return this.#ensureClient().models(signal)
  }

  async translate(input: {
    text: string
    sourceLanguage?: string
    targetLanguage?: string
    model?: string
    promptTemplate?: string
  }, signal?: AbortSignal): Promise<ReaderAiTranslationResult> {
    signal?.throwIfAborted()
    this.#assertOllamaConfigured()
    const request: ReaderAiTranslationRequest = {
      text: input.text,
      sourceLanguage: input.sourceLanguage?.trim() || this.#config.sourceLanguage,
      targetLanguage: input.targetLanguage?.trim() || this.#config.targetLanguage,
      model: input.model?.trim() || this.#config.ollamaModel,
      promptTemplate: input.promptTemplate?.trim() || this.#config.promptTemplate,
    }
    if (!request.model) throw new Error("Ollama model is not configured.")
    return this.#ensureService().translate(request, signal)
  }

  async cacheStats(): Promise<{ memoryEntries: number; persistentEntries: number | null }> {
    const memoryEntries = this.#service?.cacheSize() ?? 0
    if (!this.#persistentCache) return { memoryEntries, persistentEntries: null }
    return { memoryEntries, persistentEntries: await this.#persistentCache.count() }
  }

  clearMemoryCache(): number {
    const size = this.#service?.cacheSize() ?? 0
    this.#service?.clearCache()
    return size
  }

  async clearPersistentCache(): Promise<number> {
    if (!this.#persistentCache || !("clearAiTranslations" in this.#persistentCache)) {
      throw new Error("Persistent AI translation cache clearing is unavailable.")
    }
    return (this.#persistentCache as ReaderAiTranslationPersistentCache & {
      clearAiTranslations(): Promise<number>
    }).clearAiTranslations()
  }

  #assertOllamaConfigured(): void {
    if (this.#config.service !== "ollama") throw new Error("AI translation service is not set to Ollama.")
    if (!this.#config.ollamaUrl.trim()) throw new Error("Ollama URL is not configured.")
  }

  #ensureClient(): OllamaTranslationClient {
    this.#assertOllamaConfigured()
    const key = `${this.#config.ollamaUrl}\0${this.#config.memoryCacheEntries}`
    if (!this.#client || this.#serviceKey !== key) {
      this.#client = new OllamaTranslationClient({ baseUrl: this.#config.ollamaUrl, fetch: this.#fetch })
      this.#service = new ReaderAiTranslationService(this.#client, this.#config.memoryCacheEntries, this.#persistentCache)
      this.#serviceKey = key
    }
    return this.#client
  }

  #ensureService(): ReaderAiTranslationService {
    this.#ensureClient()
    return this.#service!
  }
}
