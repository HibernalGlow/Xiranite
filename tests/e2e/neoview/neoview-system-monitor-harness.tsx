import { Monitor } from "lucide-react"
import { useState } from "react"
import { createRoot } from "react-dom/client"

import "../../../src/styles/tailwind.css"
import "../../../src/styles/themes/index.css"
import { createReaderHttpClient } from "../../../src/nodes/neoview/adapters/reader-http-client"
import SystemMonitorCard from "../../../src/nodes/neoview/features/panels/cards/SystemMonitorCard"

declare global {
  interface Window {
    __XIRANITE_BACKEND__?: { baseUrl: string; token?: string }
  }
}

const client = createReaderHttpClient(() => window.__XIRANITE_BACKEND__ ?? { baseUrl: location.origin })

function Harness() {
  const [active, setActive] = useState(true)
  return (
    <main className="min-h-screen bg-background p-2 text-foreground">
      <button className="mb-2 rounded border px-3 py-1 text-sm" type="button" onClick={() => setActive((value) => !value)}>
        {active ? "隐藏卡片" : "显示卡片"}
      </button>
      <section className="mx-auto w-full max-w-5xl rounded-lg border bg-card p-3" data-reader-card="系统资源监控">
        <h1 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Monitor className="size-4" aria-hidden="true" />系统资源监控</h1>
        <SystemMonitorCard client={client} disabled={false} panelActive={active} onGoTo={() => undefined} />
      </section>
    </main>
  )
}

createRoot(document.getElementById("root")!).render(<Harness />)
