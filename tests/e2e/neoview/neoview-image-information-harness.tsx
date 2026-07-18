import { createRoot } from "react-dom/client"

import "../../../src/styles/tailwind.css"
import "../../../src/styles/themes/index.css"
import ImageInformationCard from "../../../src/nodes/neoview/features/panels/cards/ImageInformationCard"
import type { ReaderPanelContext } from "../../../src/nodes/neoview/features/panels/registry"

const context: ReaderPanelContext = {
  client: {} as ReaderPanelContext["client"],
  disabled: false,
  onGoTo: () => undefined,
}

createRoot(document.getElementById("root")!).render(
  <main className="grid h-screen overflow-hidden bg-neutral-950 text-foreground" style={{ gridTemplateColumns: "minmax(0, 1fr) 320px" }}>
    <section className="grid min-h-0 place-items-center bg-neutral-950 text-sm text-white/45" aria-label="阅读画面">
      打开书籍后，当前页图像会在这里显示
    </section>
    <aside className="overflow-y-auto border-l border-border bg-background px-3 py-4" aria-label="信息面板">
      <header className="mb-3 border-b border-border pb-3">
        <p className="text-xs text-muted-foreground">信息</p>
        <h1 className="text-sm font-semibold">图像信息</h1>
      </header>
      <ImageInformationCard {...context} />
    </aside>
  </main>,
)
