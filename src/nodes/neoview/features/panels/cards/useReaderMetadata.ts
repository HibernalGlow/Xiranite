import { useEffect, useSyncExternalStore } from "react"

import type { ReaderHttpClient, ReaderMetadataDto } from "../../../adapters/reader-http-client"

export interface ReaderMetadataState {
  loading: boolean
  value?: ReaderMetadataDto
  error?: string
}

interface MetadataEntry {
  key: string
  state: ReaderMetadataState
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
  return state
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
  if (!entry.request) {
    const controller = new AbortController()
    entry.controller = controller
    entry.request = (client.metadata
      ? client.metadata(sessionId, controller.signal)
      : Promise.reject(new Error("Reader metadata API is unavailable."))
    ).then((value) => {
      if (!controller.signal.aborted) update(entry, { loading: false, value })
    }).catch((error) => {
      if (!controller.signal.aborted) update(entry, { loading: false, error: errorMessage(error) })
    }).finally(() => {
      if (entry.controller === controller) entry.controller = undefined
    })
  }
  return () => {
    entry.references -= 1
    if (entry.references > 0) return
    entry.controller?.abort()
    entry.listeners.clear()
    store.delete(entry.key)
  }
}

function update(entry: MetadataEntry, state: ReaderMetadataState): void {
  entry.state = state
  for (const listener of entry.listeners) listener()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
