import pMap from "p-map"
import { z } from "zod"

import type {
  ReaderLibraryThumbnailWarmupItem,
  ReaderLibraryThumbnailWarmupPort,
} from "../../ports/ReaderLibraryThumbnailWarmupPort.js"

const WarmupItemSchema = z.object({
  id: z.string().min(1).max(1_024),
  path: z.string().min(1).max(32_768).refine((value) => !value.includes("\0"), "path cannot contain NUL"),
  kind: z.enum(["file", "folder"]),
  previewCount: z.union([z.literal(1), z.literal(4), z.literal(9), z.literal(16)]).default(1),
}).superRefine((item, context) => {
  if (item.kind !== "folder" && item.previewCount !== 1) {
    context.addIssue({ code: "custom", path: ["previewCount"], message: "mosaic previews require a folder" })
  }
})

export const ReaderLibraryThumbnailWarmupCommandSchema = z.object({
  items: z.array(WarmupItemSchema).min(1).max(256).superRefine((items, context) => {
    const ids = new Set<string>()
    for (const [index, item] of items.entries()) {
      if (ids.has(item.id)) context.addIssue({ code: "custom", path: [index, "id"], message: "duplicate id" })
      ids.add(item.id)
    }
  }),
  mode: z.enum(["ensure", "refresh"]).default("ensure"),
  concurrency: z.number().int().min(1).max(8).default(2),
})

export type ReaderLibraryThumbnailWarmupCommand = z.infer<typeof ReaderLibraryThumbnailWarmupCommandSchema>

export type ReaderLibraryThumbnailWarmupProgress =
  | { type: "item"; index: number; id: string; status: "completed" }
  | { type: "item"; index: number; id: string; status: "failed"; error: string }

export interface ReaderLibraryThumbnailWarmupSummary {
  total: number
  completed: number
  failed: number
}

export class ReaderLibraryThumbnailWarmupService {
  constructor(private readonly port: ReaderLibraryThumbnailWarmupPort) {}

  async run(
    command: ReaderLibraryThumbnailWarmupCommand,
    options: {
      contextId: string
      signal?: AbortSignal
      onProgress?: (progress: ReaderLibraryThumbnailWarmupProgress) => void
    },
  ): Promise<ReaderLibraryThumbnailWarmupSummary> {
    const input = ReaderLibraryThumbnailWarmupCommandSchema.parse(command)
    if (!options.contextId || options.contextId.length > 1_024) throw new Error("Thumbnail warmup contextId is invalid.")
    options.signal?.throwIfAborted()
    let completed = 0
    let failed = 0
    let sawAbortError = false
    let stopDispatch = false
    let firstAbortError: unknown
    try {
      await pMap(input.items, async (item, index) => {
        if (stopDispatch) return
        options.signal?.throwIfAborted()
        try {
          await this.port.warm(item as ReaderLibraryThumbnailWarmupItem, {
            contextId: options.contextId,
            mode: input.mode,
            signal: options.signal,
          })
          options.signal?.throwIfAborted()
          completed += 1
        } catch (error) {
          if (options.signal?.aborted || isAbortError(error)) {
            sawAbortError = true
            stopDispatch = true
            firstAbortError ??= error
            throw error
          }
          failed += 1
          options.onProgress?.({ type: "item", index, id: item.id, status: "failed", error: errorMessage(error) })
          return
        }
        options.onProgress?.({ type: "item", index, id: item.id, status: "completed" })
      }, { concurrency: input.concurrency, stopOnError: false })
    } catch (error) {
      if (options.signal?.aborted) options.signal.throwIfAborted()
      if (sawAbortError) throw firstAbortError ?? error
      throw error
    }
    options.signal?.throwIfAborted()
    return { total: input.items.length, completed, failed }
  }
}

function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException || error instanceof Error) && error.name === "AbortError"
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 1_024)
}
