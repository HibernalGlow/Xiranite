export interface ReaderAiTranslationRequest {
  text: string
  sourceLanguage: string
  targetLanguage: string
  model: string
  promptTemplate: string
}

export interface ReaderAiTranslationResult {
  text: string
  cached: boolean
}

export interface ReaderAiTranslationProvider {
  translate(request: ReaderAiTranslationRequest, signal?: AbortSignal): Promise<string>
}

export interface ReaderAiTranslationCacheEntry {
  title: string
  service: "libre" | "ollama"
  model?: string
  timestamp: number
}

export interface ReaderAiTranslationPersistentCache {
  load(key: string, model?: string): Promise<ReaderAiTranslationCacheEntry | undefined>
  save(key: string, entry: ReaderAiTranslationCacheEntry): Promise<void>
  count(): Promise<number>
}

export interface ReaderOllamaModel {
  name: string
  digest?: string
  size?: number
  parameterSize?: string
  quantizationLevel?: string
}

export interface ReaderOllamaTranslationClient extends ReaderAiTranslationProvider {
  check(signal?: AbortSignal): Promise<boolean>
  models(signal?: AbortSignal): Promise<readonly ReaderOllamaModel[]>
}
