import { AnimatePresence, motion } from "motion/react"
import { X } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useWorkspace, useWSDispatch, actions } from "@/store/workspaceContext"
import { ModuleRegistry } from "@/components/views/ModuleRegistry"
import { ThemeSettings } from "@/components/views/ThemeSettings"
import { DeploymentHub } from "@/components/views/DeploymentHub"

const TITLE_KEYS = {
  registry: "overlay:registry",
  settings: "overlay:settings",
  deployment: "overlay:deployment",
} as const

/**
 * OverlayHost — 取代被删除的侧栏。
 *
 * 顶栏按钮触发 SET_OVERLAY，弹出层从右侧滑入。
 * Registry / Settings / DeploymentHub 三个视图均承载于此。
 */
export function OverlayHost() {
  const { state } = useWorkspace()
  const dispatch = useWSDispatch()
  const { t } = useTranslation()
  const open = state.overlay !== null

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* 遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => dispatch(actions.setOverlay(null))}
            className="fixed inset-0 bg-black/40 z-40"
          />
          {/* 抽屉 */}
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-[560px] bg-card border-l border-border z-50 flex flex-col"
          >
            <header className="h-12 flex items-center justify-between px-4 border-b border-border flex-shrink-0">
              <h2 className="text-xs font-mono font-semibold tracking-widest text-foreground">
                {state.overlay ? t(TITLE_KEYS[state.overlay]) : ""}
              </h2>
              <button
                onClick={() => dispatch(actions.setOverlay(null))}
                className="grid h-8 w-8 place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="flex-1 overflow-auto">
              {state.overlay === "registry" && <ModuleRegistry />}
              {state.overlay === "settings" && <ThemeSettings />}
              {state.overlay === "deployment" && <DeploymentHub />}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
