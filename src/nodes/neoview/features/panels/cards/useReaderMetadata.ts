import { useCallback, useEffect, useSyncExternalStore } from "react"

import type { ReaderHttpClient, ReaderMetadataDto } from "../../../adapters/reader-http-client"

export interface ReaderMetadataState {
  loading: boolean
  value?: ReaderMetadataDto
  error?: string
  retry(): void
}

type ReaderMetadataSnapshot = Omit<ReaderMetadataState, "retry">

interface MetadataEntry {
  key: string
  state: ReaderMetadataSnapshot
  listeners: Set<() => void>
  references: number
  controller?: AbortController
  request?: Promise<void>
}

const stores = new WeakMap<ReaderHttpClient, Map<string, MetadataEntry>>()

export function useReaderMetadata(client: ReaderHttpClient, sessionId: string, revision: number): ReaderMetadataState {
  const store = storeFor(client)
  const key = `${sessionId}:${revision}`
  const entry = entryFor(store, key)
  const state = useSyncExternalStore(
    (listener) => subscribe(entry, listener),
    () => entry.state,
    () => entry.state,
  )

  useEffect(() => acquire(store, entry, client, sessionId), [client, entry, sessionId, store])
  const retry = useCallback(() => retryEntry(entry, client, sessionId), [client, entry, sessionId])
  return { ...state, retry }
}

function storeFor(client: ReaderHttpClient): Map<string, MetadataEntry> {
  let store = stores.get(client)
  if (!store) {
    store = new Map()
    stores.set(client, store)
  }
  return store
}

function entryFor(store: Map<string, MetadataEntry>, key: string): MetadataEntry {
  let entry = store.get(key)
  if (!entry) {
    entry = { key, state: { loading: true }, listeners: new Set(), references: 0 }
    store.set(key, entry)
  }
  return entry
}

function subscribe(entry: MetadataEntry, listener: () => void): () => void {
  entry.listeners.add(listener)
  return () => entry.listeners.delete(listener)
}

function acquire(store: Map<string, MetadataEntry>, entry: MetadataEntry, client: ReaderHttpClient, sessionId: string): () => void {
  entry.references += 1
  if (!entry.request && entry.state.loading) startRequest(entry, client, sessionId)
  return () => {
    entry.references -= 1
    if (entry.references > 0) return
    queueMicrotask(() => {
      if (entry.references > 0 || store.get(entry.key) !== entry) return
      entry.controller?.abort()
      entry.listeners.clear()
      store.delete(entry.key)
    })
  }
}

function retryEntry(entry: MetadataEntry, client: ReaderHttpClient, sessionId: string): void {
  if (entry.references <= 0) return
  entry.controller?.abort()
  update(entry, { loading: true })
  startRequest(entry, client, sessionId)
}

function startRequest(entry: MetadataEntry, client: ReaderHttpClient, sessionId: string): void {
  const controller = new AbortController()
  entry.controller = controller
  const request = (client.metadata
    ? client.metadata(sessionId, controller.signal)
    : Promise.reject(new Error("Reader metadata API is unavailable."))
  ).then((value) => {
    if (!controller.signal.aborted) update(entry, { loading: false, value })
  }).catch((error) => {
    if (!controller.signal.aborted) update(entry, { loading: false, error: errorMessage(error) })
  }).finally(() => {
    if (entry.controller === controller) entry.controller = undefined
    if (entry.request === request) entry.request = undefined
  })
  entry.request = request
}

function update(entry: MetadataEntry, state: ReaderMetadataSnapshot): void {
  entry.state = state
  for (const listener of entry.listeners) listener()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
