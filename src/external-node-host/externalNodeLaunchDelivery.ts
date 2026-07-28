import type { ExternalNodeLaunchRequest } from "@xiranite/contract"

type ExternalNodeLaunchDeliveryStore = {
  requests: readonly ExternalNodeLaunchRequest[]
  listeners: Set<() => void>
}

type ExternalNodeLaunchDeliveryGlobal = typeof globalThis & {
  __xiraniteExternalNodeLaunchDeliveryStore__?: ExternalNodeLaunchDeliveryStore
}

const storeKey = "__xiraniteExternalNodeLaunchDeliveryStore__"

function deliveryStore(): ExternalNodeLaunchDeliveryStore {
  const root = globalThis as ExternalNodeLaunchDeliveryGlobal
  return root[storeKey] ??= { requests: [], listeners: new Set() }
}

export function externalNodeLaunchSnapshot(): ExternalNodeLaunchRequest | undefined {
  return deliveryStore().requests[0]
}

export function subscribeToExternalNodeLaunches(listener: () => void): () => void {
  const store = deliveryStore()
  store.listeners.add(listener)
  return () => store.listeners.delete(listener)
}

export function publishExternalNodeLaunch(request: ExternalNodeLaunchRequest): void {
  const store = deliveryStore()
  if (store.requests.some((pending) => pending.requestId === request.requestId)) return
  store.requests = [...store.requests, request]
  notifyExternalNodeLaunchListeners(store)
}

export function completeExternalNodeLaunch(requestId: string): void {
  const store = deliveryStore()
  const requests = store.requests.filter((pending) => pending.requestId !== requestId)
  if (requests.length === store.requests.length) return
  store.requests = requests
  notifyExternalNodeLaunchListeners(store)
}

export function resetExternalNodeLaunchDeliveryForTests(): void {
  const store = deliveryStore()
  store.requests = []
  notifyExternalNodeLaunchListeners(store)
}

function notifyExternalNodeLaunchListeners(store: ExternalNodeLaunchDeliveryStore): void {
  for (const listener of store.listeners) listener()
}
