import { describe, expect, it, vi } from "vitest"

import { DEFAULT_NEOVIEW_AI_TRANSLATION_CONFIG } from "../../application/config/ReaderRuntimeConfig.js"
import { ReaderAiHttpController } from "./ReaderAiHttpController.js"

describe("ReaderAiHttpController", () => {
  it("[neoview.ai.http] serves check/models/translate/cache over the control plane", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith("/")) return new Response("ok", { status: 200 })
      if (url.endsWith("/api/tags")) return Response.json({ models: [{ name: "qwen2.5:7b" }] })
      if (url.endsWith("/api/generate")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { prompt?: string }
        expect(body.prompt).toContain("hello")
        return Response.json({ response: "你好" })
      }
      return new Response("missing", { status: 404 })
    })
    const controller = new ReaderAiHttpController({
      config: {
        ...DEFAULT_NEOVIEW_AI_TRANSLATION_CONFIG,
        service: "ollama",
        ollamaUrl: "http://127.0.0.1:11434",
        ollamaModel: "qwen2.5:7b",
      },
      fetch: fetch as typeof globalThis.fetch,
    })

    const check = await controller.handle(new Request("http://127.0.0.1/reader/ai/check"))
    expect(check?.status).toBe(200)
    expect(await check?.json()).toEqual({ online: true, service: "ollama" })

    const models = await controller.handle(new Request("http://127.0.0.1/reader/ai/models"))
    expect(await models?.json()).toEqual({ items: [expect.objectContaining({ name: "qwen2.5:7b" })] })

    const translated = await controller.handle(new Request("http://127.0.0.1/reader/ai/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    }))
    expect(translated?.status).toBe(200)
    expect(await translated?.json()).toEqual({ text: "你好", cached: false })

    const cache = await controller.handle(new Request("http://127.0.0.1/reader/ai/cache"))
    expect(await cache?.json()).toEqual({
      memoryEntries: 1,
      persistentEntries: null,
      totalTranslations: 1,
      cacheHits: 0,
      apiCalls: 1,
      hitRate: 0,
    })

    const cleared = await controller.handle(new Request("http://127.0.0.1/reader/ai/cache?scope=memory", { method: "DELETE" }))
    expect(await cleared?.json()).toEqual({ cleared: 1, scope: "memory" })
  })

  it("[neoview.ai.http] rejects disabled service model listing", async () => {
    const controller = new ReaderAiHttpController({ config: DEFAULT_NEOVIEW_AI_TRANSLATION_CONFIG })
    const response = await controller.handle(new Request("http://127.0.0.1/reader/ai/models"))
    expect(response?.status).toBe(400)
  })
})
