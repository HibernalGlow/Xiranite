import type {
  ReaderAiTranslationPersistentCache,
  ReaderAiTranslationRequest,
  ReaderAiTranslationResult,
  ReaderOllamaTranslationClient,
  ReaderOllamaModel,
} from "../../ports/ReaderAiTranslation.js"
import type { NeoviewAiTranslationConfig } from "../config/ReaderRuntimeConfig.js"
import { ReaderAiTranslationService } from "../metadata/ReaderAiTranslationService.js"

export interface ReaderAiTranslationControllerOptions {
  config: NeoviewAiTranslationConfig
  persistentCache?: ReaderAiTranslationPersistentCache
  createClient: (config: NeoviewAiTranslationConfig) => ReaderOllamaTranslationClient
}

/**
 * Session-free control plane for AI translation cards.
 * Rebuilds the Ollama client only when the configured endpoint/model cache size changes.
 */
export class ReaderAiTranslationController {
  #config: NeoviewAiTranslationConfig
  #service: ReaderAiTranslationService | undefined
  #client: ReaderOllamaTranslationClient | undefined
  #serviceKey = ""
  #totalTranslations = 0
  #cacheHits = 0
  #apiCalls = 0
  readonly #persistentCache?: ReaderAiTranslationPersistentCache
  readonly #createClient: ReaderAiTranslationControllerOptions["createClient"]

  constructor(options: ReaderAiTranslationControllerOptions) {
    this.#config = options.config
    this.#persistentCache = options.persistentCache
    this.#createClient = options.createClient
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
    const result = await this.#ensureService().translate(request, signal)
    this.#totalTranslations += 1
    if (result.cached) this.#cacheHits += 1
    else this.#apiCalls += 1
    return result
  }

  async cacheStats(): Promise<{
    memoryEntries: number
    persistentEntries: number | null
    totalTranslations: number
    cacheHits: number
    apiCalls: number
    hitRate: number
  }> {
    const memoryEntries = this.#service?.cacheSize() ?? 0
    const persistentEntries = this.#persistentCache ? await this.#persistentCache.count() : null
    const denom = this.#cacheHits + this.#apiCalls
    return {
      memoryEntries,
      persistentEntries,
      totalTranslations: this.#totalTranslations,
      cacheHits: this.#cacheHits,
      apiCalls: this.#apiCalls,
      hitRate: denom > 0 ? this.#cacheHits / denom : 0,
    }
  }

  clearMemoryCache(): number {
    const size = this.#service?.cacheSize() ?? 0
    this.#service?.clearCache()
    this.#totalTranslations = 0
    this.#cacheHits = 0
    this.#apiCalls = 0
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

  #ensureClient(): ReaderOllamaTranslationClient {
    this.#assertOllamaConfigured()
    const key = `${this.#config.ollamaUrl}\0${this.#config.memoryCacheEntries}`
    if (!this.#client || this.#serviceKey !== key) {
      this.#client = this.#createClient(this.#config)
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
