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
  const leaseRef = useRef<ThumbnailLease>()
  const [urlState, setUrlState] = useState<ThumbnailUrlState>(() => ({ owner, urls: new Map() }))
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    return () => {
      releaseLease(leaseRef, client, owner)
    }
  }, [client, owner])

  useEffect(() => {
    const register = client.registerLibraryThumbnails
    if (!register || !items.length) {
      releaseLease(leaseRef)
      setUrlState((current) => current.owner === owner && !current.urls.size
        ? current
        : { owner, urls: new Map() })
      setLoading(false)
      return
    }
    let lease = leaseRef.current
    if (!lease || lease.client !== client || lease.owner !== owner) {
      releaseLease(leaseRef)
      lease = {
        client,
        owner,
        contextId: `${owner}:${++contextSequence}`,
        generation: 0,
      }
      leaseRef.current = lease
    }
    const controller = new AbortController()
    const generation = ++lease.generation
    const { contextId } = lease
    setLoading(true)
    void register(contextId, generation, items, controller.signal).then((batch) => {
      if (controller.signal.aborted || batch.generation !== generation || leaseRef.current !== lease || lease.generation !== generation) return
      setUrlState({ owner, urls: new Map(batch.items.map((item) => [item.id, item.thumbnailUrl])) })
    }).catch(() => {
      if (!controller.signal.aborted && leaseRef.current === lease && lease.generation === generation) {
        setUrlState({ owner, urls: new Map() })
      }
    }).finally(() => {
      if (!controller.signal.aborted && leaseRef.current === lease && lease.generation === generation) setLoading(false)
    })
    return () => controller.abort()
  }, [client, items, owner])

  return { urls: urlState.owner === owner ? urlState.urls : EMPTY_URLS, loading }
}

interface ThumbnailLease {
  client: ReaderHttpClient
  owner: string
  contextId: string
  generation: number
}

interface ThumbnailUrlState {
  owner: string
  urls: ReadonlyMap<string, string>
}

const EMPTY_URLS: ReadonlyMap<string, string> = new Map()

function releaseLease(
  leaseRef: { current: ThumbnailLease | undefined },
  expectedClient?: ReaderHttpClient,
  expectedOwner?: string,
): void {
  const lease = leaseRef.current
  if (!lease || (expectedClient && lease.client !== expectedClient) || (expectedOwner && lease.owner !== expectedOwner)) return
  leaseRef.current = undefined
  void lease.client.releaseLibraryThumbnailContext?.(lease.contextId).catch(() => undefined)
}
