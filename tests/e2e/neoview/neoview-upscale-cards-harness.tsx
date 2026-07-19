import { useState } from "react"
import { createRoot } from "react-dom/client"

import "../../../src/styles/tailwind.css"
import "../../../src/index.css"
import "../../../src/styles/themes/index.css"
import type { ReaderHttpClient, ReaderRuntimeConfigDto, ReaderSessionDto, ReaderSuperResolutionConfigDto } from "../../../src/nodes/neoview/adapters/reader-http-client"
import UpscaleCacheCard from "../../../src/nodes/neoview/features/panels/cards/UpscaleCacheCard"
import UpscaleConditionsCard from "../../../src/nodes/neoview/features/panels/cards/UpscaleConditionsCard"
import UpscaleModelCard from "../../../src/nodes/neoview/features/panels/cards/UpscaleModelCard"
import UpscaleStatusCard from "../../../src/nodes/neoview/features/panels/cards/UpscaleStatusCard"
import ProgressiveUpscaleCard from "../../../src/nodes/neoview/features/panels/cards/ProgressiveUpscaleCard"
import { PageImage } from "../../../src/nodes/neoview/features/reader/PageImage"

const originalUrl = image("#2563eb")
const upscaledUrl = image("#16a34a")
const session = {
  sessionId: "upscale-cards-harness",
  book: { id: "book-1", displayName: "Characterization Book", pageCount: 24 },
  frame: { anchorPageIndex: 0, visiblePageIndexes: [0], generation: 1, pageMode: "single", direction: "ltr", fitMode: "contain", rotation: 0, scale: 1, offset: { x: 0, y: 0 } },
  visiblePages: [{ id: "page-1", index: 0, name: "Page 1", mediaKind: "image", dimensions: { width: 900, height: 1350 }, contentVersion: "v1", assetUrl: originalUrl }],
} as ReaderSessionDto

let cache = { entries: 18, bytes: 48 * 1024 * 1024, maxBytes: 1024 * 1024 * 1024, maxEntryBytes: 64 * 1024 * 1024, activeLeases: 0, hits: 31, misses: 4, writes: 18, rejectedWrites: 0, evictions: 2, integrityFailures: 0 }

function Harness() {
  const [config, setConfig] = useState<ReaderSuperResolutionConfigDto>({ provider: "opencomic-system", modelsDirectory: "D:/NeoView/models", preferences: { autoUpscaleEnabled: true, preUpscaleEnabled: true, preloadPages: 3, backgroundConcurrency: 2, showPanelPreview: true, defaultModelId: "anime", defaultScale: 2, defaultTileEnabled: true, defaultTileSize: 512, defaultNoise: 0, defaultGpuId: "0", progressiveEnabled: false, progressiveDwellTimeMs: 3000, progressiveMaxPages: 20, conditionalEnabled: true, conditions: [{ id: "default", name: "默认条件", enabled: true, priority: 0, match: { dimensionMode: "and", maxWidth: 1600 }, action: { skip: false, modelId: "anime", scale: 2, tileEnabled: true, tileSize: 512, noise: 0, gpuId: "0", useCache: true } }] } })
  const update = async (patch: Parameters<NonNullable<ReaderHttpClient["updateSuperResolution"]>>[0]) => {
    const next = { ...config, ...(patch.superResolution.modelsDirectory ? { modelsDirectory: patch.superResolution.modelsDirectory } : {}), preferences: { ...config.preferences, ...(patch.superResolution.preferences ?? {}) } }
    setConfig(next); document.documentElement.dataset.upscaleWrites = String(Number(document.documentElement.dataset.upscaleWrites ?? "0") + 1); return next
  }
  const client = {
    config: async () => ({ superResolution: config } as ReaderRuntimeConfigDto), updateSuperResolution: update,
    upscaleCapabilities: async () => ({ available: true as const, models: [{ id: "anime", displayName: "Anime Illustration", engine: "upscayl" as const, scales: [2, 4] }, { id: "manga", displayName: "Manga Line Art", engine: "realcugan" as const, scales: [2, 3] }], engines: [], probedAt: Date.now() }),
    upscalePage: async () => ({ status: "hit" as const, artifactUrl: upscaledUrl, contentType: "image/svg+xml", bytes: 1024, version: "upscaled-v1" }),
    upscalePreloadSnapshots: async () => [{ contextId: "nearby", generation: 1, mode: "nearby" as const, state: "running" as const, planned: 8, settled: 5, failed: 0, cancelled: 0, pending: 3, progress: 0.625, startedAt: 1, updatedAt: 2 }],
    upscaleCache: async () => cache,
    cleanupUpscaleCache: async (_sessionId: string, kind: "age" | "book" | "all") => { const removedEntries = kind === "all" ? cache.entries : 3; const removedBytes = kind === "all" ? cache.bytes : 8 * 1024 * 1024; cache = { ...cache, entries: cache.entries - removedEntries, bytes: cache.bytes - removedBytes }; document.documentElement.dataset.cacheCleanup = kind; return { ...cache, reason: kind === "age" ? "age" as const : kind === "book" ? "book" as const : "explicit" as const, removedEntries, removedBytes } },
  } as ReaderHttpClient
  const rootChange = (patch: Parameters<typeof update>[0]["superResolution"]) => update({ superResolution: patch })
  const props = { client, session, disabled: false, superResolution: config, onGoTo: () => undefined, onSuperResolutionChange: (preferences: typeof config.preferences) => rootChange({ preferences }), onSuperResolutionConfigChange: rootChange }
  return <main className="grid h-screen grid-cols-[minmax(0,1fr)_360px] overflow-hidden bg-neutral-950 text-foreground max-[640px]:grid-cols-1"><section className="grid min-h-0 place-items-center overflow-hidden max-[640px]:hidden" aria-label="阅读画面"><PageImage page={session.visiblePages[0]!} scale={0.42} sessionId={session.sessionId} client={client} superResolution={config} /></section><aside className="overflow-y-auto border-l border-border bg-background px-3 py-4 max-[640px]:border-l-0" aria-label="超分面板"><header className="mb-3 border-b pb-3"><p className="text-xs text-muted-foreground">超分</p><h1 className="text-sm font-semibold">超分设置与状态</h1></header><Card title="超分控制"><ProgressiveUpscaleCard {...props} /></Card><Card title="模型选择"><UpscaleModelCard {...props} pickDirectory={async () => "D:/Selected/models"} /></Card><Card title="处理状态"><UpscaleStatusCard {...props} /></Card><Card title="缓存管理"><UpscaleCacheCard {...props} /></Card><Card title="条件超分"><UpscaleConditionsCard {...props} /></Card></aside></main>
}
function Card({ title, children }: { title: string; children: React.ReactNode }) { return <section className="mb-4 border-b border-border pb-4" data-harness-card={title}><h2 className="mb-2 text-xs font-semibold">{title}</h2>{children}</section> }
function image(color: string): string { return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1350"><rect width="900" height="1350" fill="${color}"/><text x="450" y="675" text-anchor="middle" fill="white" font-size="72">NeoView</text></svg>`)}` }
createRoot(document.getElementById("root")!).render(<Harness />)
