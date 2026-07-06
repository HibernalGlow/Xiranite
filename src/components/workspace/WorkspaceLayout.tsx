import { AnimatePresence, motion } from "motion/react"
import { useWorkspace } from "@/store/workspaceContext"
import { TopBar } from "./TopBar"
import { CardView } from "./CardView"
import { DockviewView } from "./DockviewView"
import { FlowView } from "./FlowView"
import { LaneView } from "./lane/LaneView"
import { OverlayHost } from "./OverlayHost"
import { cn } from "@/lib/utils"

export function WorkspaceLayout() {
  const { state } = useWorkspace()
  const themeClass = state.theme === "endfield" ? "theme-endfield" : state.theme === "wuling" ? "theme-wuling" : ""
  const bgClass = `theme-bg-${state.bgMode || "dot-grid"}`

  const bgStyles = {
    "--ws-bg-image-url": state.bgImageUrl ? `url(${JSON.stringify(state.bgImageUrl)})` : "none",
    "--ws-bg-opacity": String((state.bgOpacity ?? 30) / 100),
    "--ws-bg-blur": `${state.bgBlur ?? 5}px`,
  } as React.CSSProperties

  return (
    <div
      className={cn("flex flex-col h-screen overflow-hidden bg-background text-foreground", themeClass, bgClass)}
      style={bgStyles}
    >
      <TopBar />

      {/* 主面板：四种形态共享同一份 store 数据，互不隔离。
          切换 viewMode 只换渲染器，组件实例 + data 不重挂载 */}
      <main className="flex-1 min-h-0 flex overflow-hidden relative">
        <AnimatePresence mode="wait">
          <motion.div
            key={state.viewMode}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex-1 min-h-0 w-full flex"
          >
            {state.viewMode === "cards" && <CardView />}
            {state.viewMode === "dockview" && <DockviewView />}
            {state.viewMode === "flow" && <FlowView />}
            {state.viewMode === "lane" && <LaneView />}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* 弹出层（取代侧栏） */}
      <OverlayHost />
    </div>
  )
}
