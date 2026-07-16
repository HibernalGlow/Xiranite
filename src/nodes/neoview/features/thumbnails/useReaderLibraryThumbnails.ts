import { useEffect, useRef, useState } from "react"

import type { ReaderHttpClient, ReaderLibraryThumbnailRegistrationDto } from "../../adapters/reader-http-client"

let contextSequence = 0

export interface ReaderLibraryThumbnailItem extends ReaderLibraryThumbnailRegistrationDto {
  id: string
}

export interface ReaderLibraryThumbnailsState {
  urls: ReadonlyMap<string, string>
  loading: boolean
}

export function useReaderLibraryThumbnails(
  client: ReaderHttpClient,
  owner: string,
  items: readonly ReaderLibraryThumbnailItem[],
): ReaderLibraryThumbnailsState {
  const [contextId] = useState(() => `${owner}:${++contextSequence}`)
  const generationRef = useRef(0)
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    return () => {
      void client.releaseLibraryThumbnailContext?.(contextId).catch(() => undefined)
    }
  }, [client, contextId])

  useEffect(() => {
    const register = client.registerLibraryThumbnails
    if (!register || !items.length) {
      setUrls((current) => current.size ? new Map() : current)
      setLoading(false)
      return
    }
    const controller = new AbortController()
    const generation = ++generationRef.current
    setLoading(true)
    void register(contextId, generation, items, controller.signal).then((batch) => {
      if (controller.signal.aborted || batch.generation !== generation || generation !== generationRef.current) return
      setUrls(new Map(batch.items.map((item) => [item.id, item.thumbnailUrl])))
    }).catch(() => {
      if (!controller.signal.aborted && generation === generationRef.current) setUrls(new Map())
    }).finally(() => {
      if (!controller.signal.aborted && generation === generationRef.current) setLoading(false)
    })
    return () => controller.abort()
  }, [client, contextId, items])

  return { urls, loading }
}
