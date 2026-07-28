const DEFAULT_DIRECTORY_CACHE_LIMIT = 1_024

export function createBoundedDirectoryEnsurer(
  ensureDirectory: (path: string) => Promise<void>,
  capacity = DEFAULT_DIRECTORY_CACHE_LIMIT,
): (path: string) => Promise<void> {
  const ensured = new Map<string, Promise<void>>()
  return (path) => {
    const key = path.replaceAll("\\", "/").toLocaleLowerCase("en-US")
    const existing = ensured.get(key)
    if (existing) return existing
    let pending: Promise<void>
    pending = ensureDirectory(path).catch((error) => {
      if (ensured.get(key) === pending) ensured.delete(key)
      throw error
    })
    if (ensured.size >= capacity) {
      const oldest = ensured.keys().next().value
      if (oldest !== undefined) ensured.delete(oldest)
    }
    ensured.set(key, pending)
    return pending
  }
}
