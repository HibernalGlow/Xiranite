import { AnimatePresence, motion } from "motion/react"
import { useWorkspace } from "@/store/workspaceContext"
import { TopBar } from "./TopBar"
import { CardView } from "./CardView"
import { DockviewView } from "./DockviewView"
import { FlowView } from "./FlowView"
import { OverlayHost } from "./OverlayHost"
import { cn } from "@/lib/utils"

export function WorkspaceLayout() {
  const { state } = useWorkspace()
  const themeClass = state.theme === "endfield" ? "theme-endfield" : state.theme === "wuling" ? "theme-wuling" : ""

  return (
    <div className={cn("flex flex-col h-screen overflow-hidden bg-background text-foreground", themeClass)}>
      <TopBar />

      {/* 主面板：三种形态共享同一份 store 数据，互不隔离。
          切换 viewMode 只换渲染器，组件实例 + data 不重挂载 */}
      <main className="flex-1 flex overflow-hidden relative">
        <AnimatePresence mode="wait">
          <motion.div
            key={state.viewMode}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex-1 flex"
          >
            {state.viewMode === "cards" && <CardView />}
            {state.viewMode === "dockview" && <DockviewView />}
            {state.viewMode === "flow" && <FlowView />}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* 弹出层（取代侧栏） */}
      <OverlayHost />
    </div>
  )
}
