import { lazy, Suspense } from "react"
import { useWorkspaceShallowSelector } from "@/store/workspaceContext"
import { TopBar } from "./TopBar"
import { CardView } from "./CardView"
import { OverlayHost } from "./OverlayHost"
import { WorkspaceUrlState } from "./WorkspaceUrlState"
import { BackendStatusBanner } from "./BackendStatusBanner"
import { useDefaultContextMenuItems } from "@/components/context-menu/defaults"
import { cn } from "@/lib/utils"

const DockviewView = lazy(() => import("./DockviewView").then((module) => ({ default: module.DockviewView })))
const FlowView = lazy(() => import("./FlowView").then((module) => ({ default: module.FlowView })))
const LaneView = lazy(() => import("./lane/LaneView").then((module) => ({ default: module.LaneView })))
const BentoView = lazy(() => import("./BentoView").then((module) => ({ default: module.BentoView })))

export function WorkspaceLayout() {
  useDefaultContextMenuItems()
  const chrome = useWorkspaceShallowSelector((state) => ({
    theme: state.theme,
    viewMode: state.viewMode,
    bgMode: state.bgMode,
    bgImageUrl: state.bgImageUrl,
    bgOpacity: state.bgOpacity,
    bgBlur: state.bgBlur,
    bgCoverTopBar: state.bgCoverTopBar,
  }))
  const themeClass = chrome.theme === "endfield" ? "theme-endfield" : chrome.theme === "wuling" ? "theme-wuling" : ""
  const bgClass = `theme-bg-${chrome.bgMode || "dot-grid"}`
  const bgCoverClass = chrome.bgMode === "image" && chrome.bgCoverTopBar ? "theme-bg-cover-topbar" : ""

  const bgStyles = {
    "--ws-bg-image-url": chrome.bgImageUrl ? `url(${JSON.stringify(chrome.bgImageUrl)})` : "none",
    "--ws-bg-opacity": String((chrome.bgOpacity ?? 30) / 100),
    "--ws-bg-blur": `${chrome.bgBlur ?? 5}px`,
  } as React.CSSProperties

  return (
    <div
      className={cn("flex h-screen flex-col overflow-hidden bg-background text-foreground", themeClass, bgClass, bgCoverClass)}
      style={bgStyles}
    >
      <WorkspaceUrlState />
      <TopBar />
      <BackendStatusBanner />

      <main className="relative flex min-h-0 flex-1 overflow-hidden">
        <div
          key={chrome.viewMode}
          data-context-menu="workspace-canvas"
          className="flex min-h-0 min-w-0 flex-1 animate-in fade-in duration-150"
        >
          <Suspense fallback={<div className="min-h-0 flex-1 ws-canvas-bg" />}>
            {chrome.viewMode === "cards" && <CardView />}
            {chrome.viewMode === "dockview" && <DockviewView />}
            {chrome.viewMode === "flow" && <FlowView />}
            {chrome.viewMode === "lane" && <LaneView />}
            {chrome.viewMode === "bento" && <BentoView />}
          </Suspense>
        </div>
        <OverlayHost />
      </main>
    </div>
  )
}
