import type { ReaderAiTranslationConfigDto } from "../../../adapters/reader-http-client"

export const DEFAULT_AI_TRANSLATION_CONFIG: ReaderAiTranslationConfigDto = {
  enabled: false,
  autoTranslate: false,
  service: "disabled",
  ollamaUrl: "http://127.0.0.1:11434",
  ollamaModel: "",
  sourceLanguage: "ja",
  targetLanguage: "zh",
  promptTemplate: "请将以下{source_lang}文本翻译成{target_lang}，只返回翻译结果，不要解释：\n{text}",
  memoryCacheEntries: 1_000,
}

export function mergeAiTranslationConfig(
  value?: Partial<ReaderAiTranslationConfigDto> | null,
): ReaderAiTranslationConfigDto {
  return { ...DEFAULT_AI_TRANSLATION_CONFIG, ...value }
}
