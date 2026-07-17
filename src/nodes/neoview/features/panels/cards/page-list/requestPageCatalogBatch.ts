import type { Dispatch, RefObject, SetStateAction } from "react"

import type { ReaderHttpClient, ReaderPageDto } from "../../../../adapters/reader-http-client"
import {
  mergeSparsePageBatch,
  sparseBatchLoaded,
  type SparsePageCatalog,
} from "./SparsePageCatalog"

export interface CatalogBatchRequest {
  client: ReaderHttpClient
  sessionId: string
  query: string
  cursor: number
  limit: number
  catalogKey: string
  catalogKeyRef: RefObject<string>
  catalogRef: RefObject<SparsePageCatalog<ReaderPageDto>>
  retentionPositionsRef: RefObject<readonly number[]>
  requestsRef: RefObject<Map<number, AbortController>>
  setCatalog: Dispatch<SetStateAction<SparsePageCatalog<ReaderPageDto>>>
  setResultCount: Dispatch<SetStateAction<number>>
  setCatalogReady: Dispatch<SetStateAction<boolean>>
  setCatalogError: Dispatch<SetStateAction<string | undefined>>
}

export function requestPageCatalogBatch(request: CatalogBatchRequest): void {
  if (request.limit < 1 || request.requestsRef.current.has(request.cursor) || sparseBatchLoaded(request.catalogRef.current, request.cursor, request.limit)) return
  const controller = new AbortController()
  request.requestsRef.current.set(request.cursor, controller)
  const operation = request.client.listPageCatalog
    ? request.client.listPageCatalog(request.sessionId, request.cursor, request.limit, { query: request.query, thumbnails: false }, controller.signal)
    : request.client.listPages(request.sessionId, request.cursor, request.limit, controller.signal)
  void operation.then((result) => {
    if (controller.signal.aborted || request.catalogKeyRef.current !== request.catalogKey) return
    request.setResultCount(result.total)
    request.setCatalogReady(true)
    request.setCatalogError(undefined)
    request.setCatalog((existing) => {
      const next = mergeSparsePageBatch(existing, request.cursor, result.pages, result.total, request.retentionPositionsRef.current)
      request.catalogRef.current = next
      return next
    })
  }).catch((error) => {
    if (!controller.signal.aborted && request.catalogKeyRef.current === request.catalogKey) {
      request.setCatalogReady(true)
      request.setCatalogError(error instanceof Error ? error.message : String(error))
    }
  }).finally(() => {
    if (request.requestsRef.current.get(request.cursor) === controller) request.requestsRef.current.delete(request.cursor)
  })
}
