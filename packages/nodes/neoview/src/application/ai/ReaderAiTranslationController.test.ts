import { describe, expect, it, vi } from "vitest"

import { DEFAULT_NEOVIEW_AI_TRANSLATION_CONFIG } from "../config/ReaderRuntimeConfig.js"
import { ReaderAiTranslationController } from "./ReaderAiTranslationController.js"

describe("ReaderAiTranslationController", () => {
  it("[neoview.ai.controller] checks Ollama, lists models, translates, and clears memory cache", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith("/") && (!init || init.method === undefined || init.method === "GET")) {
        return new Response("Ollama is running", { status: 200 })
      }
      if (url.endsWith("/api/tags")) {
        return Response.json({
          models: [{ name: "qwen2.5:7b", details: { parameter_size: "7B", quantization_level: "Q4_K_M" } }],
        })
      }
      if (url.endsWith("/api/generate")) {
        return Response.json({ response: "  你好  " })
      }
      return new Response("missing", { status: 404 })
    })
    const controller = new ReaderAiTranslationController({
      config: {
        ...DEFAULT_NEOVIEW_AI_TRANSLATION_CONFIG,
        service: "ollama",
        ollamaUrl: "http://127.0.0.1:11434",
        ollamaModel: "qwen2.5:7b",
        memoryCacheEntries: 8,
      },
      fetch: fetch as typeof globalThis.fetch,
    })

    await expect(controller.check()).resolves.toEqual({ online: true, service: "ollama" })
    await expect(controller.models()).resolves.toEqual([
      expect.objectContaining({ name: "qwen2.5:7b", parameterSize: "7B" }),
    ])
    const first = await controller.translate({ text: "こんにちは" })
    expect(first).toEqual({ text: "你好", cached: false })
    const second = await controller.translate({ text: "こんにちは" })
    expect(second).toEqual({ text: "你好", cached: true })
    expect(await controller.cacheStats()).toEqual({ memoryEntries: 1, persistentEntries: null })
    expect(controller.clearMemoryCache()).toBe(1)
    expect(await controller.cacheStats()).toEqual({ memoryEntries: 0, persistentEntries: null })
  })

  it("[neoview.ai.controller] rejects non-ollama service for model listing", async () => {
    const controller = new ReaderAiTranslationController({
      config: DEFAULT_NEOVIEW_AI_TRANSLATION_CONFIG,
    })
    await expect(controller.models()).rejects.toThrow("not set to Ollama")
  })
})
