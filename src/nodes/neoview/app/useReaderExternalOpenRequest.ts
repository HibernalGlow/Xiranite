import { useEffect, useRef } from "react"

import type { ReaderExternalOpenRequest, ReaderExternalOpenResult } from "./ReaderAppModules"

export function useReaderExternalOpenRequest(
  request: ReaderExternalOpenRequest | undefined,
  open: (request: ReaderExternalOpenRequest) => Promise<ReaderExternalOpenResult>,
  onResult: ((result: ReaderExternalOpenResult) => void) | undefined,
): void {
  const openRef = useRef(open)
  const onResultRef = useRef(onResult)
  const lastRequestIdRef = useRef<string>()
  openRef.current = open
  onResultRef.current = onResult

  useEffect(() => {
    if (!request || lastRequestIdRef.current === request.requestId) return
    lastRequestIdRef.current = request.requestId
    let active = true
    void openRef.current(request)
      .then((result) => {
        if (active) onResultRef.current?.({ ...result, requestId: request.requestId })
      })
      .catch((cause: unknown) => {
        if (!active) return
        const message = cause instanceof Error ? cause.message : String(cause)
        onResultRef.current?.({ requestId: request.requestId, opened: false, message })
      })
    return () => { active = false }
  }, [request?.requestId])
}
