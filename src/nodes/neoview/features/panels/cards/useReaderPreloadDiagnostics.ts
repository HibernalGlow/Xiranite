import { useCallback, useEffect, useState } from "react"

import type { ReaderHttpClient, ReaderStorageDiagnosticsDto } from "../../../adapters/reader-http-client"

const REFRESH_INTERVAL_MS = 2_000

interface ReaderPreloadDiagnosticsState {
  sessionId: string
  loading: boolean
  value?: ReaderStorageDiagnosticsDto
  error?: string
}

export function useReaderPreloadDiagnostics(
  client: ReaderHttpClient,
  sessionId: string,
  frameGeneration: number,
) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<ReaderPreloadDiagnosticsState>(() => ({ sessionId, loading: true }))

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined

    async function refresh() {
      setState((current) => current.sessionId === sessionId
        ? { ...current, loading: true, error: undefined }
        : { sessionId, loading: true })
      try {
        const request = client.preloadDiagnostics
          ? client.preloadDiagnostics(sessionId, controller.signal)
          : client.diagnostics?.(controller.signal)
        if (!request) throw new Error("unavailable")
        const value = await request
        if (!controller.signal.aborted) setState({ sessionId, loading: false, value })
      } catch {
        if (!controller.signal.aborted) {
          setState((current) => current.sessionId === sessionId ? {
            sessionId,
            loading: false,
            value: current.value,
            error: "预加载诊断暂时不可用",
          } : current)
        }
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, REFRESH_INTERVAL_MS)
      }
    }

    void refresh()
    return () => {
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [client, frameGeneration, revision, sessionId])

  const retry = useCallback(() => setRevision((value) => value + 1), [])
  return state.sessionId === sessionId ? { ...state, retry } : { sessionId, loading: true, retry }
}
