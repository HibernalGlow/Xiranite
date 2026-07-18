import { useEffect, useRef } from "react"

import type { ReaderDirectoryPageDto, ReaderHttpClient } from "../../../../adapters/reader-http-client"

interface DirectoryWatchProps {
  client: ReaderHttpClient
  sessionId: string
  generation: number
  focusPath?: string
  onPage(page: ReaderDirectoryPageDto): void
  onError(error: unknown): void
}

export default function DirectoryWatch({ client, sessionId, generation, focusPath, onPage, onError }: DirectoryWatchProps) {
  const focusPathRef = useRef(focusPath)
  const onPageRef = useRef(onPage)
  const onErrorRef = useRef(onError)
  useEffect(() => { focusPathRef.current = focusPath }, [focusPath])
  useEffect(() => { onPageRef.current = onPage }, [onPage])
  useEffect(() => { onErrorRef.current = onError }, [onError])

  useEffect(() => {
    const watch = client.watchDirectoryBrowser
    if (!watch) return
    const controller = new AbortController()
    void (async () => {
      while (!controller.signal.aborted) {
        const page = await watch(sessionId, generation, focusPathRef.current, controller.signal)
        if (!page) continue
        if (page.watchError) throw new Error(page.watchError)
        if (!page.watching) return
        if (page.generation > generation) {
          onPageRef.current(page)
          return
        }
      }
    })().catch((error) => {
      if (!controller.signal.aborted) onErrorRef.current(error)
    })
    return () => controller.abort()
  }, [client.watchDirectoryBrowser, sessionId, generation])
  return null
}
