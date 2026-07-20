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

export const AI_TEST_EXAMPLES = [
  "こんにちは",
  "【東方】霊夢",
  "お兄ちゃん大好き",
  "魔法少女まどか",
] as const

export function formatAiCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—"
  return Math.max(0, Math.trunc(value)).toLocaleString()
}

export function formatAiHitRate(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return "0%"
  return `${(Math.max(0, Math.min(1, rate)) * 100).toFixed(rate > 0 && rate < 0.1 ? 1 : 0)}%`
}

export function detectSampleLanguage(text: string): "ja" | "zh" | "en" | "unknown" {
  const value = text.trim()
  if (!value) return "unknown"
  if (/[぀-ヿ]/.test(value)) return "ja"
  if (/[一-鿿]/.test(value) && !/[぀-ヿ]/.test(value)) return "zh"
  if (/[A-Za-z]/.test(value)) return "en"
  return "unknown"
}
