/** Keeps a local deletion projection reversible until the backend command settles. */
export function createOptimisticFolderDeletion<T>(
  entry: T,
  started?: (entry: T) => void,
  failed?: (entry: T) => void | Promise<void>,
) {
  let active = false

  return {
    start() {
      if (active || !started) return
      started(entry)
      active = true
    },
    async restore() {
      if (!active) return
      try {
        await failed?.(entry)
      } catch {
        // The original deletion error remains the actionable failure.
      }
    },
  }
}
