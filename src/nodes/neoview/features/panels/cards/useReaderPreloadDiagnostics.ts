import { useCallback, useEffect, useState } from "react"

import type { ReaderHttpClient, ReaderStorageDiagnosticsDto } from "../../../adapters/reader-http-client"

const REFRESH_INTERVAL_MS = 2_000

interface ReaderPreloadDiagnosticsState {
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
  const [state, setState] = useState<ReaderPreloadDiagnosticsState>({ loading: true })

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined

    async function refresh() {
      setState((current) => ({ ...current, loading: true, error: undefined }))
      try {
        if (!client.diagnostics) throw new Error("unavailable")
        const value = await client.diagnostics(controller.signal)
        if (!controller.signal.aborted) setState({ loading: false, value })
      } catch {
        if (!controller.signal.aborted) {
          setState((current) => ({
            loading: false,
            value: current.value,
            error: "预加载诊断暂时不可用",
          }))
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
  return { ...state, retry }
}
