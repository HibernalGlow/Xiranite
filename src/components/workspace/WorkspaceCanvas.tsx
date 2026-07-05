import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { useWorkspace, useWSDispatch, actions } from "@/store/workspaceContext"
import { ComponentCard } from "./ComponentCard"
import { computeLayout } from "@/lib/workspaceLayout"
import { Button } from "@/components/ui/button"
import { LayoutGrid, Plus } from "lucide-react"

export function WorkspaceCanvas() {
  const { state, visibleComponents } = useWorkspace()
  const dispatch = useWSDispatch()
  const canvasRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 1200, h: 800 })

  const { layoutMode, focusedComponentId, fullscreenComponentId } = state

  // Track canvas size via ResizeObserver so the layout engine can compute
  // target geometry in real px. An Arc-like smooth handoff between modes.
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ w: width, h: height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Esc exits fullscreen / clears focus.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (fullscreenComponentId) dispatch(actions.setFullscreen(null))
        else if (focusedComponentId) dispatch(actions.focusComponent(null))
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [fullscreenComponentId, focusedComponentId, dispatch])

  const layouts = computeLayout({
    components: visibleComponents,
    mode: layoutMode,
    focusedId: focusedComponentId,
    fullscreenId: fullscreenComponentId,
    W: size.w,
    H: size.h,
  })

  if (visibleComponents.length === 0) {
    return (
      <div className="flex-1 ws-canvas-bg flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center">
            <div className="w-12 h-12 rounded-sm border-2 border-dashed border-border flex items-center justify-center">
              <LayoutGrid className="h-5 w-5 text-muted-foreground/50" />
            </div>
          </div>
          <div>
            <p className="text-sm font-mono text-muted-foreground">// canvas is empty</p>
            <p className="text-xs font-mono text-muted-foreground/60 mt-1">Deploy modules from the registry to populate this workspace.</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="font-mono text-xs"
            onClick={() => dispatch(actions.setSidebarView("registry"))}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            OPEN MODULE REGISTRY
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 ws-canvas-bg overflow-hidden relative" ref={canvasRef}>
      {visibleComponents.map(comp => (
        <ComponentCard
          key={comp.id}
          comp={comp}
          layout={layouts[comp.id]}
          canvasRef={canvasRef}
          isFocused={focusedComponentId === comp.id}
          hasFocused={focusedComponentId !== null}
          layoutMode={layoutMode}
        />
      ))}

      {/* Fullscreen exit hint */}
      <AnimatePresence>
        {fullscreenComponentId && (
          <motion.button
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            onClick={() => dispatch(actions.setFullscreen(null))}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1001] rounded-full border border-border bg-card/90 px-4 py-1.5 font-mono text-[11px] tracking-widest text-muted-foreground hover:text-primary backdrop-blur"
          >
            ESC · EXIT FULLSCREEN
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}
