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

export interface ReaderOllamaModel {
  name: string
  digest?: string
  size?: number
  parameterSize?: string
  quantizationLevel?: string
}

export interface ReaderOllamaTranslationClient {
  check(signal?: AbortSignal): Promise<boolean>
  models(signal?: AbortSignal): Promise<readonly ReaderOllamaModel[]>
}
