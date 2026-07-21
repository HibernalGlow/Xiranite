import {
  DEFAULT_NEOVIEW_AI_TRANSLATION_CONFIG,
  type NeoviewAiTranslationConfig,
} from "../../application/config/ReaderRuntimeConfig.js"
import {
  ReaderAiTranslationController,
} from "../../application/ai/ReaderAiTranslationController.js"
import type {
  ReaderAiTranslationPersistentCache,
  ReaderAiTranslationRequest,
  ReaderAiTranslationResult,
  ReaderOllamaModel,
} from "../../ports/ReaderAiTranslation.js"
import { OllamaTranslationClient } from "../ai/OllamaTranslationClient.js"

const CHECK_PATH = "/reader/ai/check"
const MODELS_PATH = "/reader/ai/models"
const TRANSLATE_PATH = "/reader/ai/translate"
const CACHE_PATH = "/reader/ai/cache"

export interface ReaderAiHttpControllerOptions {
  config: NeoviewAiTranslationConfig
  updateConfig?: (config: NeoviewAiTranslationConfig) => void
  persistentCache?: ReaderAiTranslationPersistentCache
  fetch?: typeof globalThis.fetch
}

export class ReaderAiHttpController {
  readonly #controller: ReaderAiTranslationController
  readonly #updateConfig?: (config: NeoviewAiTranslationConfig) => void

  constructor(options: ReaderAiHttpControllerOptions) {
    this.#controller = new ReaderAiTranslationController({
      config: options.config ?? DEFAULT_NEOVIEW_AI_TRANSLATION_CONFIG,
      persistentCache: options.persistentCache,
      createClient: (config) => new OllamaTranslationClient({ baseUrl: config.ollamaUrl, fetch: options.fetch }),
    })
    this.#updateConfig = options.updateConfig
  }

  setConfig(config: NeoviewAiTranslationConfig): void {
    this.#controller.setConfig(config)
  }

  async handle(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith("/reader/ai/")) return undefined
    try {
      if (url.pathname === CHECK_PATH && request.method === "GET") {
        return jsonResponse(await this.#controller.check(request.signal))
      }
      if (url.pathname === MODELS_PATH && request.method === "GET") {
        const models = await this.#controller.models(request.signal)
        return jsonResponse({ items: models satisfies readonly ReaderOllamaModel[] })
      }
      if (url.pathname === TRANSLATE_PATH && request.method === "POST") {
        const body = await readJson(request)
        if (!body || typeof body.text !== "string") return jsonResponse({ error: "text is required" }, 400)
        const result: ReaderAiTranslationResult = await this.#controller.translate({
          text: body.text,
          sourceLanguage: optionalString(body.sourceLanguage),
          targetLanguage: optionalString(body.targetLanguage),
          model: optionalString(body.model),
          promptTemplate: optionalString(body.promptTemplate),
        }, request.signal)
        return jsonResponse(result)
      }
      if (url.pathname === CACHE_PATH && request.method === "GET") {
        return jsonResponse(await this.#controller.cacheStats())
      }
      if (url.pathname === CACHE_PATH && request.method === "DELETE") {
        const scope = url.searchParams.get("scope") ?? "memory"
        if (scope === "memory") return jsonResponse({ cleared: this.#controller.clearMemoryCache(), scope })
        if (scope === "persistent") {
          return jsonResponse({ cleared: await this.#controller.clearPersistentCache(), scope })
        }
        if (scope === "all") {
          const memory = this.#controller.clearMemoryCache()
          const persistent = await this.#controller.clearPersistentCache().catch(() => 0)
          return jsonResponse({ cleared: memory + persistent, scope, memory, persistent })
        }
        return jsonResponse({ error: "scope must be memory, persistent, or all" }, 400)
      }
      return jsonResponse({ error: "Method not allowed" }, 405)
    } catch (error) {
      if (request.signal.aborted) throw error
      const message = error instanceof Error ? error.message : String(error)
      const status = /not configured|not set to Ollama|must|required|invalid/i.test(message) ? 400 : 500
      return jsonResponse({ error: message }, status)
    }
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

async function readJson(request: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const value = await request.json()
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  })
}

export type { ReaderAiTranslationRequest }
