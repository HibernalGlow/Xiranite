import { Gauge } from "lucide-react"
import { useState } from "react"
import { createRoot } from "react-dom/client"

import "../../../src/styles/tailwind.css"
import "../../../src/styles/themes/index.css"
import { createReaderHttpClient } from "../../../src/nodes/neoview/adapters/reader-http-client"
import ThumbnailArchitectureMetricsCard from "../../../src/nodes/neoview/features/panels/cards/ThumbnailArchitectureMetricsCard"

const client = createReaderHttpClient(() => ({ baseUrl: location.origin, token: "thumbnail-metrics-e2e" }))

function Harness() {
  const [active, setActive] = useState(true)
  return (
    <main className="min-h-screen bg-background p-2 text-foreground">
      <div className="mx-auto grid w-full max-w-5xl gap-2 md:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <section className="grid min-h-40 place-items-center overflow-hidden rounded border bg-black/90 p-2">
          <img
            alt="当前页"
            className="max-h-44 max-w-full"
            src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='180'%3E%3Crect width='320' height='180' fill='%23232a36'/%3E%3Cpath d='M40 140L120 55l55 55 35-35 70 65z' fill='%2366b8a7'/%3E%3C/svg%3E"
          />
        </section>
        <div className="min-w-0">
          <button className="mb-2 rounded border px-3 py-1 text-sm" type="button" onClick={() => setActive((value) => !value)}>
            {active ? "折叠卡片" : "展开卡片"}
          </button>
          <section className="min-w-0 rounded border bg-card p-3" data-reader-card="缩略图架构指标">
            <h1 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Gauge className="size-4" aria-hidden="true" />缩略图架构指标</h1>
            <ThumbnailArchitectureMetricsCard client={client} disabled={false} panelActive={active} onGoTo={() => undefined} />
          </section>
        </div>
      </div>
    </main>
  )
}

createRoot(document.getElementById("root")!).render(<Harness />)
