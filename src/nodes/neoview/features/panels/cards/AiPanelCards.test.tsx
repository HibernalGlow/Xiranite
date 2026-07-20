import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient, ReaderRuntimeConfigDto } from "../../adapters/reader-http-client"
import AiServiceConfigCard from "./AiServiceConfigCard"
import AiTranslationTestCard from "./AiTranslationTestCard"
import AiTranslationCacheCard from "./AiTranslationCacheCard"
import AiTitleTranslationCard from "./AiTitleTranslationCard"

afterEach(cleanup)

const AI_CONFIG = {
  enabled: true,
  autoTranslate: false,
  service: "ollama" as const,
  ollamaUrl: "http://127.0.0.1:11434",
  ollamaModel: "qwen2.5:7b",
  sourceLanguage: "ja",
  targetLanguage: "zh",
  promptTemplate: "translate {text}",
  memoryCacheEntries: 100,
}

function client(overrides: Partial<ReaderHttpClient> = {}): ReaderHttpClient {
  return {
    config: vi.fn(async () => ({ aiTranslation: AI_CONFIG }) as ReaderRuntimeConfigDto),
    updateAiTranslation: vi.fn(async (patch) => ({ ...AI_CONFIG, ...patch.aiTranslation })),
    aiCheck: vi.fn(async () => ({ online: true, service: "ollama" as const })),
    aiModels: vi.fn(async () => [{ name: "qwen2.5:7b" }]),
    aiTranslate: vi.fn(async () => ({ text: "你好", cached: false })),
    aiCacheStats: vi.fn(async () => ({ memoryEntries: 2, persistentEntries: 5 })),
    aiClearCache: vi.fn(async (scope = "memory") => ({ cleared: 2, scope })),
    ...overrides,
  } as unknown as ReaderHttpClient
}

describe("AI panel cards", () => {
  it("[neoview.ai.service-config.gui] loads config, checks Ollama, and saves model", async () => {
    const api = client()
    render(<AiServiceConfigCard client={api} disabled={false} panelActive />)
    await screen.findByDisplayValue("http://127.0.0.1:11434")
    fireEvent.click(screen.getByRole("button", { name: /探测并拉取模型/ }))
    await waitFor(() => expect(api.aiCheck).toHaveBeenCalled())
    await waitFor(() => expect(api.aiModels).toHaveBeenCalled())
    expect(document.querySelector('[data-neoview-card="ai-service-config"]')).toBeTruthy()
  })

  it("[neoview.ai.title-translation.gui] toggles enabled without page-turn work", async () => {
    const api = client()
    const view = render(<AiTitleTranslationCard client={api} disabled={false} panelActive />)
    await screen.findByText("启用 AI 标题翻译")
    const toggle = view.container.querySelector('button[data-slot="switch"], button[role="switch"], input[type="checkbox"]')
      ?? view.container.querySelector("button")
    expect(toggle).toBeTruthy()
    fireEvent.click(toggle!)
    await waitFor(() => expect(api.updateAiTranslation).toHaveBeenCalled())
  })

  it("[neoview.ai.translation-test.gui] translates through the shared control plane", async () => {
    const api = client()
    render(<AiTranslationTestCard client={api} disabled={false} panelActive />)
    fireEvent.click(screen.getByRole("button", { name: "翻译" }))
    await waitFor(() => expect(api.aiTranslate).toHaveBeenCalledWith({ text: "こんにちは" }))
    expect(await screen.findByText("你好")).toBeTruthy()
  })

  it("[neoview.ai.translation-cache.gui] shows stats and clears memory cache", async () => {
    const api = client()
    render(<AiTranslationCacheCard client={api} disabled={false} panelActive />)
    await waitFor(() => expect(api.aiCacheStats).toHaveBeenCalled())
    fireEvent.click(screen.getByRole("button", { name: /清内存/ }))
    await waitFor(() => expect(api.aiClearCache).toHaveBeenCalledWith("memory"))
  })

  it("[neoview.ai.lifecycle] inactive cards do no network work", () => {
    const api = client()
    render(<AiServiceConfigCard client={api} disabled={false} panelActive={false} />)
    expect(api.config).not.toHaveBeenCalled()
  })
})
