import { useEffect } from "react"

import { neoviewDebug } from "../neoviewDebug"

export function useReaderSwimlaneSidebarDeferral({
  readerChromeReady,
  sessionScopeId,
  shellPresent,
  workspaceMode,
  setLeftReady,
  setRightReady,
}: {
  readerChromeReady: boolean
  sessionScopeId: string
  shellPresent: boolean
  workspaceMode: string | undefined
  setLeftReady: (ready: boolean) => void
  setRightReady: (ready: boolean) => void
}): void {
  useEffect(() => {
    if (workspaceMode !== "swimlane" || !shellPresent || !readerChromeReady) {
      setLeftReady(false)
      setRightReady(false)
      return
    }

    let cancelled = false
    let outerRaf = 0
    let innerRaf = 0
    let idleHandle: number | undefined
    let timeoutHandle: number | undefined
    let rightTimeout: number | undefined
    const startedAt = performance.now()
    neoviewDebug("reader:swimlane-shell:schedule-sidebars", { sessionScopeId })
    outerRaf = requestAnimationFrame(() => {
      innerRaf = requestAnimationFrame(() => {
        if (cancelled) return
        neoviewDebug("reader:swimlane-shell:first-paint", {
          sessionScopeId,
          sinceScheduleMs: Math.round((performance.now() - startedAt) * 10) / 10,
        })
        const revealLeft = () => {
          if (cancelled) return
          neoviewDebug("reader:swimlane-sidebars:left-ready", {
            sessionScopeId,
            sinceScheduleMs: Math.round((performance.now() - startedAt) * 10) / 10,
          })
          setLeftReady(true)
          rightTimeout = window.setTimeout(() => {
            if (cancelled) return
            neoviewDebug("reader:swimlane-sidebars:right-ready", {
              sessionScopeId,
              sinceScheduleMs: Math.round((performance.now() - startedAt) * 10) / 10,
            })
            setRightReady(true)
          }, 120)
        }
        if (typeof requestIdleCallback === "function") {
          idleHandle = requestIdleCallback(revealLeft, { timeout: 400 })
        } else {
          timeoutHandle = window.setTimeout(revealLeft, 50)
        }
      })
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(outerRaf)
      cancelAnimationFrame(innerRaf)
      if (idleHandle !== undefined && typeof cancelIdleCallback === "function") cancelIdleCallback(idleHandle)
      if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle)
      if (rightTimeout !== undefined) window.clearTimeout(rightTimeout)
    }
  }, [readerChromeReady, sessionScopeId, shellPresent, setLeftReady, setRightReady, workspaceMode])
}
