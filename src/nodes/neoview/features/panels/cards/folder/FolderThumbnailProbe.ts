export type FolderThumbnailProbeErrorKind = "generating" | "stale" | "unavailable" | "failed"

export class FolderThumbnailProbeError extends Error {
  constructor(
    readonly kind: FolderThumbnailProbeErrorKind,
    readonly retryAfterMs?: number,
  ) {
    super(`Folder thumbnail probe failed: ${kind}`)
    this.name = "FolderThumbnailProbeError"
  }
}

export async function probeFolderThumbnailUrls(
  urls: readonly string[],
  signal: AbortSignal,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<readonly string[]> {
  const settled = await Promise.allSettled(urls.map(async (url) => ({
    url,
    response: await fetchImpl(url, { method: "HEAD", cache: "no-store", signal }),
  })))
  const responses: Array<{ url: string; response: Response }> = []
  for (const result of settled) {
    if (result.status === "rejected") throw result.reason
    responses.push(result.value)
  }
  const generating = responses.find(({ response }) => response.status === 429 || response.status === 503 || response.status === 504)
  if (generating) {
    throw new FolderThumbnailProbeError("generating", retryAfterMilliseconds(generating.response.headers.get("retry-after")))
  }
  if (responses.some(({ response }) => response.status === 410)) throw new FolderThumbnailProbeError("stale")
  if (responses.some(({ response }) => response.status === 404)) throw new FolderThumbnailProbeError("unavailable")
  if (responses.some(({ response }) => !response.ok && response.status !== 304)) throw new FolderThumbnailProbeError("failed")
  return responses.map(({ url }) => url)
}

export function retryFolderThumbnailProbe(failureCount: number, error: Error): boolean {
  if (!(error instanceof FolderThumbnailProbeError)) return failureCount < 2
  if (error.kind === "generating") return true
  if (error.kind === "failed") return failureCount < 2
  return false
}

export function folderThumbnailProbeRetryDelay(attempt: number, error: Error): number {
  if (error instanceof FolderThumbnailProbeError && error.retryAfterMs !== undefined) {
    return Math.max(250, Math.min(300_000, error.retryAfterMs))
  }
  return Math.min(30_000, 1_000 * (2 ** Math.min(attempt, 5)))
}

export function isManagedFolderThumbnailUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false
  try {
    return new URL(value).pathname.includes("/reader/library/t/")
  } catch {
    return false
  }
}

function retryAfterMilliseconds(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined
}
