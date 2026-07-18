import {
  createContext,
  useContext,
  useLayoutEffect,
  type MouseEvent,
  type ReactNode,
} from "react"
import { useTranslation } from "react-i18next"
import type { MainWindowAction } from "@/backend/runtime/runtime"
import { cn } from "@/lib/utils"
import { WindowControlIcon } from "./WindowControlIcon"

interface FloatingWindowFrameValue {
  isMaximized: boolean
  pending: boolean
  control: (action: MainWindowAction) => void
  handleTitlebarDoubleClick: (event: MouseEvent<HTMLElement>) => void
  registerIntegratedTitlebar: () => () => void
}

const FloatingWindowFrameContext = createContext<FloatingWindowFrameValue | null>(null)

export function FloatingWindowFrameProvider({ children, value }: {
  children: ReactNode
  value: FloatingWindowFrameValue
}) {
  return (
    <FloatingWindowFrameContext.Provider value={value}>
      {children}
    </FloatingWindowFrameContext.Provider>
  )
}

export function useFloatingWindowFrame() {
  return useContext(FloatingWindowFrameContext)
}

/** Keeps fallback chrome disabled while an auto-hidden title bar owns it. */
export function FloatingWindowTitlebarReservation() {
  const frame = useFloatingWindowFrame()

  useLayoutEffect(() => {
    if (!frame) return
    return frame.registerIntegratedTitlebar()
  }, [frame])

  return null
}

/**
 * Adapts an existing node header to the frameless Wails window chrome.
 *
 * In the normal workspace this is a transparent wrapper, so node cards keep
 * their existing layout. Inside a floating window it turns the header into
 * the draggable title bar and appends the shared window controls.
 */
export function FloatingWindowNodeHeader({ children, className }: {
  children: ReactNode
  className?: string
}) {
  const frame = useFloatingWindowFrame()

  if (!frame) return <>{children}</>

  return (
    <div
      data-floating-window-titlebar="true"
      onDoubleClick={frame.handleTitlebarDoubleClick}
      className={cn("flex min-w-0 items-stretch justify-between gap-3", className)}
    >
      <div className="xiranite-app-region-drag flex min-w-0 flex-1 select-none items-center">
        {children}
      </div>
      <FloatingWindowCaptionControls integrated />
    </div>
  )
}

export function FloatingWindowCaptionControls({ className, integrated = false }: {
  className?: string
  integrated?: boolean
}) {
  const frame = useFloatingWindowFrame()
  const { t } = useTranslation()

  useLayoutEffect(() => {
    if (!frame || !integrated) return
    return frame.registerIntegratedTitlebar()
  }, [frame, integrated])

  if (!frame) return null

  const buttonClass = "grid min-h-9 w-11 place-items-center text-foreground/70 transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45"

  return (
    <div
      data-testid={integrated ? "floating-window-integrated-controls" : "floating-window-fallback-controls"}
      className={cn("xiranite-app-region-no-drag flex shrink-0 self-stretch items-stretch", className)}
    >
      <button data-window-caption-button type="button" title={t("common:minimize")} aria-label={t("common:minimize")} disabled={frame.pending} onClick={() => frame.control("minimize")} className={buttonClass}>
        <WindowControlIcon action="minimize" />
      </button>
      <button data-window-caption-button type="button" title={t("common:maximize")} aria-label={t("common:maximize")} aria-pressed={frame.isMaximized} disabled={frame.pending} onClick={() => frame.control("maximize")} className={buttonClass}>
        <WindowControlIcon action="maximize" maximized={frame.isMaximized} />
      </button>
      <button data-window-caption-button data-window-caption-tone="close" type="button" title={t("common:closeWindow")} aria-label={t("common:closeWindow")} disabled={frame.pending} onClick={() => frame.control("close")} className={cn(buttonClass, "hover:bg-[#c42b1c] hover:text-white")}>
        <WindowControlIcon action="close" />
      </button>
    </div>
  )
}
