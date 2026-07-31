import { useCallback, useEffect, useRef } from "react"

import type { ReaderHistoryAutoCleanupDto, ReaderInvalidLibraryCleanupResultDto } from "../../../../adapters/reader-http-client"

export function useHistoryAutoCleanup({ visible, resident, config, cleanup, onRefresh, onResult, onError }: {
  visible: boolean
  resident: boolean
  config: ReaderHistoryAutoCleanupDto
  cleanup?: (kind: "recents", signal?: AbortSignal) => Promise<ReaderInvalidLibraryCleanupResultDto>
  onRefresh(): void
  onResult(result: ReaderInvalidLibraryCleanupResultDto): void
  onError(message: string): void
}) {
  const requestRef = useRef<AbortController>()
  const visibilityRef = useRef({ visible, hasBeenVisible: visible, enabled: false })

  const cancel = useCallback(() => {
    requestRef.current?.abort()
    requestRef.current = undefined
  }, [])

  const runCleanup = useCallback(async () => {
    if (!cleanup) {
      onRefresh()
      return
    }
    if (requestRef.current) return
    const controller = new AbortController()
    requestRef.current = controller
    try {
      const result = await cleanup("recents", controller.signal)
      if (!controller.signal.aborted) onResult(result)
    } catch (cause) {
      if (!controller.signal.aborted) onError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (requestRef.current === controller) requestRef.current = undefined
      if (!controller.signal.aborted) onRefresh()
    }
  }, [cleanup, onError, onRefresh, onResult])

  useEffect(() => {
    const state = visibilityRef.current
    const becameVisible = !state.visible && visible
    const becameEnabled = !state.enabled && config.enabled
    state.visible = visible
    state.enabled = config.enabled
    if (!visible || !resident) {
      cancel()
      return
    }
    if (becameVisible) {
      if (config.enabled) void runCleanup()
      else if (state.hasBeenVisible) onRefresh()
    } else if (becameEnabled) {
      void runCleanup()
    }
    state.hasBeenVisible = true
  }, [cancel, config.enabled, onRefresh, resident, runCleanup, visible])

  useEffect(() => {
    if (!visible || !resident || !config.enabled || config.trigger !== "interval") return
    const timer = window.setInterval(() => void runCleanup(), config.intervalMinutes * 60_000)
    return () => window.clearInterval(timer)
  }, [config.enabled, config.intervalMinutes, config.trigger, resident, runCleanup, visible])

  useEffect(() => cancel, [cancel])
}
