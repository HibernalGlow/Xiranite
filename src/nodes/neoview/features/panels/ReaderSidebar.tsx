/**
 * @migrated-from src/lib/components/layout/LeftSidebar.svelte
 * @source-hash sha256:3c2fce2245cdca6b6224995c39adc4b6199ddd2c4b714e90a7a7f79767404b46
 * @migrated-from src/lib/components/layout/RightSidebar.svelte
 * @source-hash sha256:b9d05589604ae5dcaf05f4a435278f78e23cc55de7ceb32c3700829f419adf90
 * @migrated-from src/lib/components/layout/PanelTabBar.svelte
 * @source-hash sha256:bbeb9b1630d8239cacd946d68818bad85c4b54e537e8008748df40e99a101fd8
 * @migrated-from src/lib/cards/PanelContainer.svelte
 * @source-hash sha256:8c2dc923d863fd8e7c233964b27ccdef496ad68c3097003fe212e597b0c089a8
 * @features panels-toolbar-shell,card-windows-tabs
 * @migration-status adapted
 */
import { Suspense, useState } from "react"
import type { CSSProperties } from "react"
import type { ReaderShellConfigDto } from "../../adapters/reader-http-client"

import { cn } from "@/lib/utils"
import { CollapsibleReaderCard } from "./CollapsibleReaderCard"
import {
  availablePanels,
  cardsForPanel,
  lazyReaderCard,
  type LegacyPanelId,
  type ReaderPanelContext,
  type ReaderPanelSide,
} from "./registry"

export function ReaderSidebar({ side, context, shell }: { side: ReaderPanelSide; context: ReaderPanelContext; shell?: ReaderShellConfigDto }) {
  const panels = availablePanels(side)
  const [activePanel, setActivePanel] = useState<LegacyPanelId>(() => panels[0]?.id ?? (side === "left" ? "pageList" : "info"))
  const active = panels.find((panel) => panel.id === activePanel) ?? panels[0]
  const layout = shell?.sidebars[side]
  const height = sidebarHeight(layout)
  const style = layout ? {
    width: `min(${layout.width}px, calc(100vw - 2rem))`,
    height,
    top: height === "100%" ? 0 : `${(100 - Number.parseFloat(height)) * (layout.verticalAlign / 100)}%`,
    left: side === "left" && layout.horizontalPosition > 0 ? `${layout.horizontalPosition * 0.5}vw` : undefined,
    right: side === "right" && layout.horizontalPosition > 0 ? `${layout.horizontalPosition * 0.5}vw` : undefined,
    backgroundColor: `color-mix(in oklch, var(--background) ${shell!.opacity.sidebar}%, transparent)`,
    backdropFilter: `blur(${shell!.blur.sidebar}px)`,
  } satisfies CSSProperties : undefined

  return (
    <aside
      className={cn(
        "relative flex max-h-full overflow-hidden border-border/70 bg-background/92 shadow-xl backdrop-blur-md",
        side === "left" ? "border-r" : "flex-row-reverse border-l",
      )}
      data-reader-sidebar={side}
      style={style}
    >
      <nav className={cn("flex w-11 shrink-0 flex-col items-center gap-1 py-2", side === "left" ? "border-r" : "border-l")} aria-label={`${side === "left" ? "左" : "右"}侧面板`}>
        {panels.map((panel) => (
          <button
            key={panel.id}
            type="button"
            title={panel.title}
            aria-label={panel.title}
            aria-current={panel.id === active?.id ? "page" : undefined}
            className={cn(
              "grid size-8 place-items-center rounded-md text-sm transition-colors",
              panel.id === active?.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            onClick={() => setActivePanel(panel.id)}
          >
            <span aria-hidden="true">{panel.emoji}</span>
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto overscroll-contain p-2" data-reader-panel={active?.id}>
        <div className="mb-2 flex items-center gap-2 px-1 py-1">
          <span aria-hidden="true">{active?.emoji}</span>
          <h2 className="truncate text-sm font-semibold">{active?.title}</h2>
        </div>
        <div className="grid gap-2">
          {active ? cardsForPanel(active.id).map((card) => {
            const Card = lazyReaderCard(card.id)
            return Card ? (
              <CollapsibleReaderCard key={card.id} title={card.title}>
                <Suspense fallback={<div className="h-16 animate-pulse rounded bg-muted/60" aria-label={`正在加载${card.title}`} />}>
                  <Card {...context} />
                </Suspense>
              </CollapsibleReaderCard>
            ) : null
          }) : null}
        </div>
      </div>
    </aside>
  )
}

function sidebarHeight(layout: ReaderShellConfigDto["sidebars"]["left"] | undefined): string {
  if (!layout || layout.height === "full") return "100%"
  if (layout.height === "two-thirds") return "66.6667%"
  if (layout.height === "half") return "50%"
  if (layout.height === "one-third") return "33.3333%"
  return `${layout.customHeight}%`
}
