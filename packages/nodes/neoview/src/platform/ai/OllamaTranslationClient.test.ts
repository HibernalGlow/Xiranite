import { describe, expect, it, vi } from "vitest"

import { OllamaTranslationClient, renderPrompt } from "./OllamaTranslationClient.js"

const request = {
  text: "こんにちは",
  sourceLanguage: "ja",
  targetLanguage: "zh",
  model: "qwen2.5:7b",
  promptTemplate: "Translate {text} from {source_lang} to {target_lang}",
}

describe("OllamaTranslationClient", () => {
  it("[neoview.ai.ollama-client] probes, lists models, and uses the frozen non-streaming generate protocol", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
      .mockResolvedValueOnce(Response.json({ models: [{
        name: "qwen2.5:7b", digest: "sha256:abc", size: 123, details: { parameter_size: "7B", quantization_level: "Q4" },
      }] }))
      .mockResolvedValueOnce(Response.json({ response: "你好" }))
    const client = new OllamaTranslationClient({ baseUrl: "http://127.0.0.1:11434", fetch })

    await expect(client.check()).resolves.toBe(true)
    await expect(client.models()).resolves.toEqual([{
      name: "qwen2.5:7b", digest: "sha256:abc", size: 123, parameterSize: "7B", quantizationLevel: "Q4",
    }])
    await expect(client.translate(request)).resolves.toBe("你好")
    expect(String(fetch.mock.calls[0]?.[0])).toBe("http://127.0.0.1:11434/")
    expect(fetch.mock.calls[0]?.[1]).toEqual({ signal: undefined })
    expect(String(fetch.mock.calls[1]?.[0])).toBe("http://127.0.0.1:11434/api/tags")
    expect(fetch.mock.calls[1]?.[1]).toEqual({ signal: undefined })
    const [, init] = fetch.mock.calls[2] as [string, RequestInit]
    expect(init).toMatchObject({ method: "POST", headers: { "content-type": "application/json" } })
    expect(JSON.parse(String(init.body))).toEqual({
      model: "qwen2.5:7b", prompt: "Translate こんにちは from ja to zh", stream: false,
      options: { temperature: 0.3, num_predict: 256 },
    })
  })

  it("[neoview.ai.ollama-client] rejects unsafe URLs, invalid payloads, and HTTP failures while preserving aborts", async () => {
    expect(() => new OllamaTranslationClient({ baseUrl: "file:///tmp/ollama" })).toThrow("HTTP or HTTPS")
    expect(() => new OllamaTranslationClient({ baseUrl: "http://user:secret@localhost:11434" })).toThrow("credentials")
    const client = new OllamaTranslationClient({ baseUrl: "http://localhost:11434", fetch: vi.fn().mockResolvedValue(Response.json({})) })
    await expect(client.translate(request)).rejects.toThrow("invalid response")

    const failing = new OllamaTranslationClient({ baseUrl: "http://localhost:11434", fetch: vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })) })
    await expect(failing.models()).rejects.toThrow("HTTP 503: unavailable")

    const controller = new AbortController()
    const aborted = new OllamaTranslationClient({ baseUrl: "http://localhost:11434", fetch: vi.fn(async () => { throw controller.signal.reason }) })
    controller.abort(new DOMException("stop", "AbortError"))
    await expect(aborted.check(controller.signal)).rejects.toMatchObject({ name: "AbortError" })
  })

  it("[neoview.ai.ollama-client] substitutes every supported prompt placeholder", () => {
    expect(renderPrompt(request)).toBe("Translate こんにちは from ja to zh")
    expect(renderPrompt({ ...request, promptTemplate: "{text}/{text}/{source_lang}/{target_lang}" })).toBe("こんにちは/こんにちは/ja/zh")
  })
})
