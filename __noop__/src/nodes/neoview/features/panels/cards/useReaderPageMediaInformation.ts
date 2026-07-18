import { useCallback, useEffect, useState } from "react"

import type { ReaderHttpClient, ReaderPageMediaInformationDto } from "../../../adapters/reader-http-client"

interface PageMediaInformationState {
  key: string
  loading: boolean
  value?: ReaderPageMediaInformationDto
  error?: string
}

export function useReaderPageMediaInformation(
  client: ReaderHttpClient,
  sessionId: string,
  page: { id: string; contentVersion: string; mediaKind: string } | undefined,
) {
  const key = page ? `${sessionId}:${page.id}:${page.contentVersion}` : `${sessionId}:none`
  const enabled = page?.mediaKind === "video"
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<PageMediaInformationState>(() => ({ key, loading: enabled }))
  const current = state.key === key ? state : { key, loading: enabled }

  useEffect(() => {
    if (!enabled) {
      setState({ key, loading: false })
      return
    }
    const request = client.pageMediaInformation
    if (!request) {
      setState({ key, loading: false, error: "当前后端不支持视频媒体信息" })
      return
    }
    const controller = new AbortController()
    setState({ key, loading: true })
    void request(sessionId, controller.signal).then((value) => {
      if (controller.signal.aborted) return
      if (value.pageId !== page.id || value.contentVersion !== page.contentVersion) {
        throw new Error("视频媒体信息已过期")
      }
      setState({ key, loading: false, value })
    }).catch((error) => {
      if (!controller.signal.aborted) setState({ key, loading: false, error: errorMessage(error) })
    })
    return () => controller.abort()
  }, [client, enabled, key, page?.contentVersion, page?.id, revision, sessionId])

  const retry = useCallback(() => setRevision((value) => value + 1), [])
  return { ...current, retry }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
