import { lazy, Suspense } from "react"
import { useWorkspaceShallowSelector } from "@/store/workspaceContext"
import { TopBar } from "./TopBar"
import { CardView } from "./CardView"
import { OverlayHost } from "./OverlayHost"
import { WorkspaceUrlState } from "./WorkspaceUrlState"
import { BackendStatusBanner } from "./BackendStatusBanner"
import { cn } from "@/lib/utils"

const DockviewView = lazy(() => import("./DockviewView").then((module) => ({ default: module.DockviewView })))
const FlowView = lazy(() => import("./FlowView").then((module) => ({ default: module.FlowView })))
const LaneView = lazy(() => import("./lane/LaneView").then((module) => ({ default: module.LaneView })))

export function WorkspaceLayout() {
  const chrome = useWorkspaceShallowSelector((state) => ({
    theme: state.theme,
    viewMode: state.viewMode,
    bgMode: state.bgMode,
    bgImageUrl: state.bgImageUrl,
    bgOpacity: state.bgOpacity,
    bgBlur: state.bgBlur,
  }))
  const themeClass = chrome.theme === "endfield" ? "theme-endfield" : chrome.theme === "wuling" ? "theme-wuling" : ""
  const bgClass = `theme-bg-${chrome.bgMode || "dot-grid"}`

  const bgStyles = {
    "--ws-bg-image-url": chrome.bgImageUrl ? `url(${JSON.stringify(chrome.bgImageUrl)})` : "none",
    "--ws-bg-opacity": String((chrome.bgOpacity ?? 30) / 100),
    "--ws-bg-blur": `${chrome.bgBlur ?? 5}px`,
  } as React.CSSProperties

  return (
    <div
      className={cn("flex flex-col h-screen overflow-hidden bg-background text-foreground", themeClass, bgClass)}
      style={bgStyles}
    >
      <WorkspaceUrlState />
      <TopBar />
      <BackendStatusBanner />

      {/* 主面板：四种形态共享同一份 store 数据，互不隔离。
          切换 viewMode 只换渲染器，组件实例 + data 不重挂载 */}
      <main className="flex-1 min-h-0 flex overflow-hidden relative">
        <div
          key={chrome.viewMode}
          className="flex-1 min-h-0 w-full flex animate-in fade-in duration-150"
        >
          <Suspense fallback={<div className="flex-1 min-h-0 ws-canvas-bg" />}>
            {chrome.viewMode === "cards" && <CardView />}
            {chrome.viewMode === "dockview" && <DockviewView />}
            {chrome.viewMode === "flow" && <FlowView />}
            {chrome.viewMode === "lane" && <LaneView />}
          </Suspense>
        </div>
      </main>

      {/* 弹出层（取代侧栏） */}
      <OverlayHost />
    </div>
  )
}
