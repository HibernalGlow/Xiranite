import { describe, expect, it, vi } from "vitest"

import { ReaderAiTranslationService } from "./ReaderAiTranslationService.js"

const request = {
  text: "こんにちは",
  sourceLanguage: "ja",
  targetLanguage: "zh",
  model: "qwen2.5:7b",
  promptTemplate: "Translate {text} from {source_lang} to {target_lang}",
}

describe("ReaderAiTranslationService", () => {
  it("[neoview.ai.translation-cache] caches normalized requests without sharing results across models or prompts", async () => {
    const translate = vi.fn(async () => " 你好 ")
    const service = new ReaderAiTranslationService({ translate })

    await expect(service.translate({ ...request, text: " こんにちは " })).resolves.toEqual({ text: "你好", cached: false })
    await expect(service.translate(request)).resolves.toEqual({ text: "你好", cached: true })
    await expect(service.translate({ ...request, model: "qwen2.5:14b" })).resolves.toEqual({ text: "你好", cached: false })
    await expect(service.translate({ ...request, promptTemplate: "Brief: {text}" })).resolves.toEqual({ text: "你好", cached: false })
    expect(translate).toHaveBeenCalledTimes(3)
    expect(service.cacheSize()).toBe(3)
  })

  it("[neoview.ai.translation-cache] bypasses the provider for identical languages and honors a zero-entry cache", async () => {
    const translate = vi.fn(async () => "你好")
    const service = new ReaderAiTranslationService({ translate }, 0)

    await expect(service.translate({ ...request, sourceLanguage: "zh" })).resolves.toEqual({ text: "こんにちは", cached: false })
    await service.translate(request)
    await service.translate(request)
    expect(translate).toHaveBeenCalledTimes(2)
    expect(service.cacheSize()).toBe(0)
  })

  it("[neoview.ai.translation-cancel] forwards cancellation and never caches a request cancelled after the provider settles", async () => {
    const controller = new AbortController()
    const translate = vi.fn(async () => "你好")
    const service = new ReaderAiTranslationService({ translate })

    controller.abort(new DOMException("navigation", "AbortError"))
    await expect(service.translate(request, controller.signal)).rejects.toMatchObject({ name: "AbortError" })
    expect(translate).not.toHaveBeenCalled()

    const late = Promise.withResolvers<string>()
    const delayed = new ReaderAiTranslationService({ translate: vi.fn(() => late.promise) })
    const lateController = new AbortController()
    const pending = delayed.translate(request, lateController.signal)
    lateController.abort(new DOMException("navigation", "AbortError"))
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    late.resolve("你好")
    await Promise.resolve()
    expect(delayed.cacheSize()).toBe(0)
  })
})
