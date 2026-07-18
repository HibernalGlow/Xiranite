const listeners = new Set<() => void>()

export function publishReaderLibraryMutation(): void {
  for (const listener of listeners) listener()
}

export function subscribeReaderLibraryMutations(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
