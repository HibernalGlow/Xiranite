import type { ReaderHttpClient } from "../../../../adapters/reader-http-client"

const PREWARM_BATCH_SIZE = 500

export async function prewarmPageThumbnails(
  client: ReaderHttpClient,
  sessionId: string,
  initialTotal: number,
  signal: AbortSignal,
  onProgress: (completed: number, total: number) => void,
): Promise<number> {
  if (!client.listPageCatalog) throw new Error("当前后端不支持页面缩略图预热")
  let cursor = 0
  let total = initialTotal
  while (cursor < total) {
    const limit = Math.min(PREWARM_BATCH_SIZE, total - cursor)
    const result = await client.listPageCatalog(sessionId, cursor, limit, { query: "", thumbnails: true }, signal)
    signal.throwIfAborted()
    total = result.total
    const nextCursor = result.nextCursor ?? cursor + result.pages.length
    if (nextCursor <= cursor && cursor < total) throw new Error("缩略图预热未能继续分页")
    cursor = Math.min(nextCursor, total)
    onProgress(cursor, total)
  }
  return total
}
