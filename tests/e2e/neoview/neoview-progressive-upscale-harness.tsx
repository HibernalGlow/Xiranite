import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "../../../src/styles/tailwind.css"
import "../../../src/index.css"
import "../../../src/styles/themes/index.css"
import type { ReaderHttpClient, ReaderRuntimeConfigDto, ReaderSuperResolutionConfigDto } from "../../../src/nodes/neoview/adapters/reader-http-client"
import ProgressiveUpscaleCard from "../../../src/nodes/neoview/features/panels/cards/ProgressiveUpscaleCard"

let superResolution: ReaderSuperResolutionConfigDto = {
  provider: "opencomic-system",
  preferences: {
    autoUpscaleEnabled: true,
    preUpscaleEnabled: true,
    preloadPages: 3,
    backgroundConcurrency: 2,
    progressiveEnabled: false,
    progressiveDwellTimeMs: 3_000,
    progressiveMaxPages: 20,
  },
}

const client: ReaderHttpClient = {
  config: async () => ({ superResolution } as ReaderRuntimeConfigDto),
  updateSuperResolution: async (patch) => {
    superResolution = {
      ...superResolution,
      preferences: { ...superResolution.preferences, ...patch.superResolution.preferences },
    }
    document.documentElement.dataset.upscaleWrites = String(Number(document.documentElement.dataset.upscaleWrites ?? "0") + 1)
    return superResolution
  },
} as ReaderHttpClient

function Harness() {
  return (
    <main className="grid h-screen overflow-hidden bg-neutral-950 text-foreground" style={{ gridTemplateColumns: "minmax(0, 1fr) 360px" }}>
      <section className="relative min-h-0 bg-neutral-950" aria-label="阅读页面">
        <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">NeoView Reader</div>
      </section>
      <aside className="overflow-y-auto border-l border-border bg-background px-3 py-4" aria-label="超分面板">
        <header className="mb-3 border-b border-border pb-3"><p className="text-xs text-muted-foreground">超分</p><h1 className="text-sm font-semibold">递进超分</h1></header>
        <ProgressiveUpscaleCard client={client} disabled={false} />
      </aside>
    </main>
  )
}

createRoot(document.getElementById("root")!).render(<StrictMode><Harness /></StrictMode>)
