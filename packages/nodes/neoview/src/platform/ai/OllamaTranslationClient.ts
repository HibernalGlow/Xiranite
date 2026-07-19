import type {
  ReaderAiTranslationProvider,
  ReaderAiTranslationRequest,
  ReaderOllamaModel,
  ReaderOllamaTranslationClient,
} from "../../ports/ReaderAiTranslation.js"

const DEFAULT_PROMPT_TEMPLATE = "请将以下{source_lang}文本翻译成{target_lang}，只返回翻译结果，不要解释：\n{text}"

export interface OllamaTranslationClientOptions {
  baseUrl: string
  fetch?: typeof globalThis.fetch
}

export class OllamaTranslationClient implements ReaderAiTranslationProvider, ReaderOllamaTranslationClient {
  readonly #baseUrl: URL
  readonly #fetch: typeof globalThis.fetch

  constructor(options: OllamaTranslationClientOptions) {
    this.#baseUrl = parseBaseUrl(options.baseUrl)
    this.#fetch = options.fetch ?? globalThis.fetch
  }

  async check(signal?: AbortSignal): Promise<boolean> {
    try {
      const response = await this.#fetch(this.#url("/"), { signal })
      return response.ok
    } catch (error) {
      if (signal?.aborted) throw error
      return false
    }
  }

  async models(signal?: AbortSignal): Promise<readonly ReaderOllamaModel[]> {
    const response = await this.#fetch(this.#url("/api/tags"), { signal })
    if (!response.ok) throw await responseError("Ollama model listing", response)
    const body = await response.json() as unknown
    if (!isRecord(body) || !Array.isArray(body.models)) throw new Error("Ollama model listing returned an invalid response.")
    return body.models.flatMap((value) => {
      if (!isRecord(value) || typeof value.name !== "string" || !value.name.trim()) return []
      const details = isRecord(value.details) ? value.details : undefined
      return [{
        name: value.name.trim(),
        digest: stringValue(value.digest),
        size: numberValue(value.size),
        parameterSize: details ? stringValue(details.parameter_size) : undefined,
        quantizationLevel: details ? stringValue(details.quantization_level) : undefined,
      }]
    })
  }

  async translate(request: ReaderAiTranslationRequest, signal?: AbortSignal): Promise<string> {
    const response = await this.#fetch(this.#url("/api/generate"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        prompt: renderPrompt(request),
        stream: false,
        options: { temperature: 0.3, num_predict: 256 },
      }),
      signal,
    })
    if (!response.ok) throw await responseError("Ollama translation", response)
    const body = await response.json() as unknown
    if (!isRecord(body) || typeof body.response !== "string") throw new Error("Ollama translation returned an invalid response.")
    return body.response
  }

  #url(path: string): URL {
    return new URL(path, this.#baseUrl)
  }
}

export function renderPrompt(request: ReaderAiTranslationRequest): string {
  const template = request.promptTemplate.trim() || DEFAULT_PROMPT_TEMPLATE
  return template
    .replaceAll("{text}", request.text)
    .replaceAll("{source_lang}", request.sourceLanguage)
    .replaceAll("{target_lang}", request.targetLanguage)
}

function parseBaseUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError("Ollama URL must use HTTP or HTTPS.")
  if (url.username || url.password) throw new TypeError("Ollama URL must not contain credentials.")
  return url
}

async function responseError(context: string, response: Response): Promise<Error> {
  const body = (await response.text()).trim()
  return new Error(`${context} failed with HTTP ${response.status}${body ? `: ${body.slice(0, 512)}` : ""}.`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}
