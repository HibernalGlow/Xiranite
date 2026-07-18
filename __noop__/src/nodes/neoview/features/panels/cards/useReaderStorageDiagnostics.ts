import { useCallback, useEffect, useState } from "react"

import type { ReaderHttpClient, ReaderStorageDiagnosticsDto } from "../../../adapters/reader-http-client"

interface ReaderStorageDiagnosticsState {
  loading: boolean
  value?: ReaderStorageDiagnosticsDto
  error?: string
}

export function useReaderStorageDiagnostics(client: ReaderHttpClient) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<ReaderStorageDiagnosticsState>({ loading: true })

  useEffect(() => {
    const controller = new AbortController()
    setState({ loading: true })
    const request = client.diagnostics
      ? client.diagnostics(controller.signal)
      : Promise.reject(new Error("Reader diagnostics API is unavailable."))
    request.then((value) => {
      if (!controller.signal.aborted) setState({ loading: false, value })
    }).catch((error) => {
      if (!controller.signal.aborted) setState({ loading: false, error: errorMessage(error) })
    })
    return () => controller.abort()
  }, [client, revision])

  const retry = useCallback(() => setRevision((value) => value + 1), [])
  return { ...state, retry }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
