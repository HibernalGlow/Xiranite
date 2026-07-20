import { createRoot } from "react-dom/client"
import type { ReactNode } from "react"

import "../../../src/styles/tailwind.css"
import "../../../src/index.css"
import "../../../src/styles/themes/index.css"
import type { ReaderAiTranslationConfigDto, ReaderHttpClient, ReaderRuntimeConfigDto } from "../../../src/nodes/neoview/adapters/reader-http-client"
import AiServiceConfigCard from "../../../src/nodes/neoview/features/panels/cards/AiServiceConfigCard"
import AiTitleTranslationCard from "../../../src/nodes/neoview/features/panels/cards/AiTitleTranslationCard"
import AiTranslationCacheCard from "../../../src/nodes/neoview/features/panels/cards/AiTranslationCacheCard"
import AiTranslationTestCard from "../../../src/nodes/neoview/features/panels/cards/AiTranslationTestCard"
import type { ReaderPanelContext } from "../../../src/nodes/neoview/features/panels/registry"

let config: ReaderAiTranslationConfigDto = {
  enabled: true,
  autoTranslate: true,
  service: "ollama" as const,
  ollamaUrl: "http://127.0.0.1:11434",
  ollamaModel: "qwen2.5:7b",
  sourceLanguage: "ja",
  targetLanguage: "zh",
  promptTemplate: "Translate the following text to Chinese: {text}",
  memoryCacheEntries: 100,
}

let cacheStats = {
  memoryEntries: 12,
  persistentEntries: 48,
  totalTranslations: 72,
  cacheHits: 46,
  apiCalls: 26,
  hitRate: 46 / 72,
}

const client = {
  config: async () => ({ aiTranslation: config }) as ReaderRuntimeConfigDto,
  updateAiTranslation: async (patch: { aiTranslation: Partial<ReaderAiTranslationConfigDto> }) => {
    config = { ...config, ...patch.aiTranslation }
    document.documentElement.dataset.aiConfigUpdated = "true"
    return config
  },
  aiCheck: async () => ({ online: true, service: "ollama" as const }),
  aiModels: async () => [
    { name: "qwen2.5:7b" },
    { name: "qwen3:8b" },
    { name: "gemma3:4b" },
  ],
  aiTranslate: async ({ text }: { text: string }) => ({ text: `译文：${text}`, cached: false }),
  aiCacheStats: async () => cacheStats,
  aiClearCache: async (scope: "memory" | "persistent" | "all" = "memory") => {
    const cleared = scope === "all" ? cacheStats.memoryEntries + (cacheStats.persistentEntries ?? 0) : cacheStats.memoryEntries
    cacheStats = { memoryEntries: 0, persistentEntries: scope === "all" ? 0 : cacheStats.persistentEntries, totalTranslations: 0, cacheHits: 0, apiCalls: 0, hitRate: 0 }
    document.documentElement.dataset.aiCacheScope = scope
    return { cleared, scope }
  },
} as unknown as ReaderHttpClient

const context: ReaderPanelContext = {
  client,
  disabled: false,
  panelActive: true,
  onGoTo: () => undefined,
}

function Harness() {
  return (
    <main className="dark min-h-screen bg-[#0b0a1d] px-3 py-5 text-foreground sm:px-5">
      <section className="mx-auto grid max-w-5xl items-start gap-3 md:grid-cols-2" data-ai-card-board="true">
        <Card title="翻译服务配置"><AiServiceConfigCard {...context} /></Card>
        <Card title="标题翻译"><AiTitleTranslationCard {...context} /></Card>
        <Card title="翻译测试"><AiTranslationTestCard {...context} /></Card>
        <Card title="翻译缓存"><AiTranslationCacheCard {...context} /></Card>
      </section>
    </main>
  )
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-md border border-border/70 bg-card/95 p-3 shadow-sm" data-reader-card={title}>
      <h1 className="mb-3 text-sm font-semibold">{title}</h1>
      {children}
    </section>
  )
}

createRoot(document.getElementById("root")!).render(<Harness />)
